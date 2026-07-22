import { randomUUID } from "node:crypto";
import { open, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

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

function mimeHintForFile(path: string): string {
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
