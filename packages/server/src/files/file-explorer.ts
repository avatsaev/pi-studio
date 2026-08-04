import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile as writeFileFs,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { MAX_INLINE_FILE_READ_BYTES } from "./limits.js";

import type { HandlerRegistry } from "../ws/router.js";

/**
 * File explorer: directory listing + file preview with server-side path normalization and symlink
 * resolution (features/file-explorer-transfer.md § Behavior (listOrPreview), § Trust boundary;
 * architecture/auth-security.md § Trust model). Connected clients are trusted operators — a preview
 * may read any regular file the daemon can read; workspace-relative paths are a UI convenience, not a
 * security boundary. Normalization/symlink checks stay server-side.
 */

const DEFAULT_PREVIEW_BYTES = 256 * 1024;
const BINARY_SNIFF_BYTES = 8192;

export interface DirEntry {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  /** Lightweight icon hint (extension or "dir"); full theme mapping is a client concern. */
  iconHint: string;
}

export type FileExplorerResult =
  | { ok: true; kind: "directory"; path: string; resolvedPath: string; entries: DirEntry[] }
  | {
      ok: true;
      kind: "text";
      path: string;
      resolvedPath: string;
      content: string;
      truncated: boolean;
    }
  | {
      ok: true;
      kind: "binary";
      path: string;
      resolvedPath: string;
      metadata: { size: number; mtimeMs: number; mimeHint: string };
      transferToken: string;
    }
  | { ok: false; error: string };

export interface FileExplorerDeps {
  /** Issue a download token for a binary file (task-005 supplies the real store). */
  issueDownloadToken?: (resolvedPath: string) => string;
  previewBytes?: number;
}

export class FileExplorerService {
  constructor(private readonly deps: FileExplorerDeps = {}) {}

  registerHandlers(registry: HandlerRegistry): void {
    registry.register("file_explorer_request", async (ctx) => ({
      type: "file_explorer_response",
      result: await this.listOrPreview(String(ctx.message.path ?? "")),
    }));

    registry.register("directory_suggestions_request", async (ctx) => ({
      type: "directory_suggestions_response",
      base: String(ctx.message.path ?? ctx.message.base ?? ""),
      suggestions: await this.directorySuggestions(
        String(ctx.message.path ?? ctx.message.base ?? ""),
      ),
    }));

    registry.register("project_icon_request", (ctx) => ({
      type: "project_icon_response",
      projectId: String(ctx.message.projectId ?? ""),
      icon: null, // resolution mechanism TODO(verify)
    }));

    registry.register("file_delete_request", async (ctx) => ({
      type: "file_delete_response",
      ...(await this.deleteFile(String(ctx.message.path ?? ""))),
    }));

    registry.register("file_write_request", async (ctx) => ({
      type: "file_write_response",
      ...(await this.writeFile(String(ctx.message.path ?? ""), String(ctx.message.content ?? ""))),
    }));

    registry.register("file_create_request", async (ctx) => ({
      type: "file_create_response",
      ...(await this.createEntry(
        String(ctx.message.path ?? ""),
        String(ctx.message.name ?? ""),
        ctx.message.kind === "directory" ? "directory" : "file",
      )),
    }));

    registry.register("file_move_request", async (ctx) => ({
      type: "file_move_response",
      ...(await this.moveEntry(
        String(ctx.message.path ?? ""),
        String(ctx.message.destination ?? ""),
      )),
    }));
  }

  /**
   * Create an empty file or an empty directory named `rawName` inside `parentPath` — same
   * normalization/trust-boundary posture as `deleteFile`. Non-recursive `mkdir` and
   * create-exclusive (`wx`) file opens are deliberate: both fail loudly on a name collision
   * instead of silently overwriting or truncating existing data.
   */
  async createEntry(
    parentPath: string,
    rawName: string,
    kind: "file" | "directory",
  ): Promise<
    { ok: true; path: string; kind: "file" | "directory" } | { ok: false; error: string }
  > {
    if (!parentPath) return { ok: false, error: "empty_path" };
    const name = rawName.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
      return { ok: false, error: "invalid_name" };
    }
    let resolvedParent: string;
    try {
      resolvedParent = await realpath(resolve(parentPath));
    } catch {
      return { ok: false, error: "not_found" };
    }
    let info;
    try {
      info = await stat(resolvedParent);
    } catch {
      return { ok: false, error: "unreadable" };
    }
    if (!info.isDirectory()) return { ok: false, error: "not_a_directory" };

    const target = join(resolvedParent, name);
    try {
      if (kind === "directory") {
        await mkdir(target);
      } else {
        const handle = await open(target, "wx");
        await handle.close();
      }
      return { ok: true, path: target, kind };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return { ok: false, error: "exists" };
      }
      return { ok: false, error: err instanceof Error ? err.message : "create_failed" };
    }
  }

  /**
   * Move or rename `inputPath` to `inputDestination` (`fs.rename`-shaped). Every rejection is
   * decided here so the client never has to duplicate a legality rule (features/file-explorer-
   * move.md § Behavior & Algorithms). Only the *parent* of each path is `realpath`-resolved and
   * the basename re-joined — resolving the full source would follow a symlink to its target
   * instead of moving the link itself, which is not `mv` semantics. The existence check
   * (`lstat(destination)`) and the `rename` below race under concurrent callers (TOCTOU); this is
   * accepted for a single-user local daemon rather than adding a lock.
   */
  async moveEntry(
    inputPath: string,
    inputDestination: string,
  ): Promise<{ ok: true; path: string; destination: string } | { ok: false; error: string }> {
    if (!inputPath || !inputDestination) return { ok: false, error: "empty_path" };

    let source: string;
    try {
      source = join(await realpath(resolve(dirname(inputPath))), basename(inputPath));
    } catch {
      return { ok: false, error: "not_found" };
    }
    let destination: string;
    let destinationParent: string;
    // `basename()` keeps leading/trailing spaces, so a free-text destination like `foo.txt `
    // would validate as `foo.txt` but land on disk with the trailing space. Trim once and use
    // the trimmed value for BOTH the join and the guard, matching `createEntry` (which trims
    // its `rawName` before validating and joining).
    const destName = basename(inputDestination).trim();
    try {
      destinationParent = await realpath(resolve(dirname(inputDestination)));
      destination = join(destinationParent, destName);
    } catch {
      return { ok: false, error: "not_found" };
    }
    if (
      !destName ||
      destName === "." ||
      destName === ".." ||
      destName.includes("/") ||
      destName.includes("\0")
    ) {
      return { ok: false, error: "invalid_name" };
    }

    let sourceInfo;
    try {
      sourceInfo = await lstat(source);
    } catch {
      return { ok: false, error: "not_found" };
    }

    let destinationParentInfo;
    try {
      destinationParentInfo = await stat(destinationParent);
    } catch {
      return { ok: false, error: "not_found" };
    }
    if (!destinationParentInfo.isDirectory()) return { ok: false, error: "not_a_directory" };

    if (source === destination) return { ok: false, error: "same_path" };
    if (sourceInfo.isDirectory() && destination.startsWith(`${source}/`)) {
      return { ok: false, error: "into_descendant" };
    }

    try {
      await lstat(destination);
      return { ok: false, error: "exists" };
    } catch {
      // Destination absent — good, proceed.
    }

    try {
      await rename(source, destination);
      return { ok: true, path: source, destination };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV")
        return { ok: false, error: "cross_device" };
      return { ok: false, error: err instanceof Error ? err.message : "move_failed" };
    }
  }

  /**
   * Overwrite an existing regular file's full content, atomically. Unlike `createEntry`'s
   * create-exclusive semantics, this requires the target to already exist — creating a new file
   * is `file_create_request`'s job, and a write against a missing path is `not_found`, not a
   * silent create. The write itself goes to a sibling temp file first, then `rename`s over the
   * resolved target, so a crash mid-write (or a concurrent reader/preview) never observes a
   * partially-written file. Capped at `MAX_INLINE_FILE_READ_BYTES` — the same ceiling
   * `previewFile` reads under, since a save that round-trips a preview truncated by that cap
   * would otherwise silently discard the tail of the file.
   */
  async writeFile(
    inputPath: string,
    content: string,
  ): Promise<
    { ok: true; path: string; size: number; mtimeMs: number } | { ok: false; error: string }
  > {
    if (!inputPath) return { ok: false, error: "empty_path" };
    if (Buffer.byteLength(content, "utf8") > MAX_INLINE_FILE_READ_BYTES) {
      return { ok: false, error: "too_large" };
    }

    let resolvedPath: string;
    try {
      resolvedPath = await realpath(resolve(inputPath));
    } catch {
      return { ok: false, error: "not_found" };
    }
    let info;
    try {
      info = await stat(resolvedPath);
    } catch {
      return { ok: false, error: "unreadable" };
    }
    if (!info.isFile()) return { ok: false, error: "not_a_file" };

    // Preserve the target's permission bits across the tmp+rename: the rename replaces the inode,
    // so without this an edited executable script would silently lose its +x bit. The creation
    // `mode` is umask-masked (never broader than the target); the explicit chmod then restores the
    // exact bits before the file becomes visible under its real name.
    const mode = info.mode & 0o7777;
    const tmpPath = join(dirname(resolvedPath), `.${basename(resolvedPath)}.tmp-${randomUUID()}`);
    try {
      await writeFileFs(tmpPath, content, { encoding: "utf8", mode });
      await chmod(tmpPath, mode);
      await rename(tmpPath, resolvedPath);
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {});
      return { ok: false, error: err instanceof Error ? err.message : "write_failed" };
    }

    const updated = await stat(resolvedPath);
    return { ok: true, path: resolvedPath, size: updated.size, mtimeMs: updated.mtimeMs };
  }

  /** Normalize + resolve a path (symlinks), then list a directory or preview a file. */
  async listOrPreview(inputPath: string): Promise<FileExplorerResult> {
    if (!inputPath) return { ok: false, error: "empty_path" };
    const normalized = resolve(inputPath);

    let resolvedPath: string;
    try {
      resolvedPath = await realpath(normalized); // server-side symlink resolution
    } catch {
      return { ok: false, error: "not_found" };
    }

    let info;
    try {
      info = await stat(resolvedPath);
    } catch {
      return { ok: false, error: "unreadable" };
    }

    if (info.isDirectory()) {
      try {
        const entries = await this.readDirectory(resolvedPath);
        return { ok: true, kind: "directory", path: inputPath, resolvedPath, entries };
      } catch {
        return { ok: false, error: "unreadable" };
      }
    }

    if (!info.isFile()) return { ok: false, error: "unsupported" };

    return this.previewFile(inputPath, resolvedPath, info.size, info.mtimeMs);
  }

  /**
   * Delete a file or directory (recursively) at `inputPath`, resolving symlinks first — same
   * normalization/trust boundary as `listOrPreview` (features/file-explorer-transfer.md § Trust
   * boundary). No confirmation/undo server-side; the client is expected to confirm destructive
   * deletes before calling.
   */
  async deleteFile(inputPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!inputPath) return { ok: false, error: "empty_path" };
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(resolve(inputPath));
    } catch {
      return { ok: false, error: "not_found" };
    }
    try {
      await rm(resolvedPath, { recursive: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "delete_failed" };
    }
  }

  private async readDirectory(dir: string): Promise<DirEntry[]> {
    const dirents = await readdir(dir, { withFileTypes: true });
    const entries: DirEntry[] = [];
    for (const dirent of dirents) {
      const full = join(dir, dirent.name);
      let size = 0;
      let mtimeMs = 0;
      try {
        const s = await stat(full);
        size = s.size;
        mtimeMs = s.mtimeMs;
      } catch {
        // Unstattable entry (e.g. broken symlink) → keep with zeroed metadata.
      }
      const kind: DirEntry["kind"] = dirent.isDirectory()
        ? "directory"
        : dirent.isSymbolicLink()
          ? "symlink"
          : dirent.isFile()
            ? "file"
            : "other";
      entries.push({
        name: dirent.name,
        kind,
        size,
        mtimeMs,
        iconHint: kind === "directory" ? "dir" : iconHintForFile(dirent.name),
      });
    }
    return entries.toSorted((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : b.kind === "directory" ? 1 : 0;
      return a.name.localeCompare(b.name);
    });
  }

  private async previewFile(
    inputPath: string,
    resolvedPath: string,
    size: number,
    mtimeMs: number,
  ): Promise<FileExplorerResult> {
    const previewBytes = this.deps.previewBytes ?? DEFAULT_PREVIEW_BYTES;
    let handle;
    try {
      handle = await open(resolvedPath, "r");
    } catch {
      return { ok: false, error: "unreadable" };
    }
    try {
      const sniffLen = Math.min(size, BINARY_SNIFF_BYTES);
      const sniff = Buffer.alloc(sniffLen);
      if (sniffLen > 0) await handle.read(sniff, 0, sniffLen, 0);

      if (isBinary(sniff)) {
        const transferToken = this.deps.issueDownloadToken?.(resolvedPath) ?? randomUUID();
        return {
          ok: true,
          kind: "binary",
          path: inputPath,
          resolvedPath,
          metadata: { size, mtimeMs, mimeHint: mimeHintForFile(resolvedPath) },
          transferToken,
        };
      }

      const readLen = Math.min(size, previewBytes);
      const buffer = Buffer.alloc(readLen);
      if (readLen > 0) await handle.read(buffer, 0, readLen, 0);
      return {
        ok: true,
        kind: "text",
        path: inputPath,
        resolvedPath,
        content: buffer.toString("utf8"),
        truncated: size > previewBytes,
      };
    } finally {
      await handle.close();
    }
  }

  /** Immediate subdirectory paths under `base` (path picker). */
  async directorySuggestions(base: string): Promise<string[]> {
    if (!base) return [];
    try {
      const resolved = await realpath(resolve(base));
      const dirents = await readdir(resolved, { withFileTypes: true });
      return dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => join(resolved, d.name))
        .toSorted((a, b) => basename(a).localeCompare(basename(b)));
    } catch {
      return [];
    }
  }
}

/** A buffer is treated as binary if it contains a NUL byte in the sniffed prefix. */
function isBinary(sniff: Buffer): boolean {
  return sniff.includes(0);
}

function iconHintForFile(name: string): string {
  const ext = extname(name).slice(1).toLowerCase();
  return ext || "file";
}

/** Extension → MIME-type lookup used to stamp downloaded files' `Begin` frame (task-001,
 *  features/inline-image-rendering.md § MIME type) as well as file-explorer previews. Unknown
 *  extensions fall back to `application/octet-stream`; browsers still sniff `<img>` blob URLs
 *  correctly in that case. */
export function mimeHintForFile(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    pdf: "application/pdf",
    zip: "application/zip",
    wasm: "application/wasm",
  };
  return map[ext] ?? "application/octet-stream";
}
