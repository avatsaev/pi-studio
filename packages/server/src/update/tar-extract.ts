import { constants, createReadStream } from "node:fs";
import { chmod, link, lstat, mkdir, open, realpath, symlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

/**
 * Safe `.tar.gz` unpacking for the binary's update (swe/features/self-update.md § Apply, P9): the
 * archive came over the network, so an entry is refused unless it stays inside the target folder.
 *
 * Refused: absolute names, any `..` segment, a symbolic link whose target is absolute or resolves
 * outside the folder (also after the last entry, through earlier links), an entry written through a
 * symbolic link, a hard link outside the folder, and any type but file, folder, symbolic link and
 * hard link. File modes keep only the permission bits (no setuid). Reads ustar, GNU long names and
 * pax `path`/`linkpath`/`size` records; streams, so the archive is never held in memory.
 */

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(`unsafe archive: ${message}`);
    this.name = "UnsafeArchiveError";
  }
}

/** Upper bounds against an archive that expands without limit. */
export interface ExtractLimits {
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxEntries: 200_000,
  maxBytes: 4 * 1024 ** 3,
};

const BLOCK = 512;

/** The record types that describe the next entry instead of being one. */
type MetadataType = "x" | "g" | "L" | "K";

function isMetadataType(type: string): type is MetadataType {
  return type === "x" || type === "g" || type === "L" || type === "K";
}

interface TarHeader {
  name: string;
  mode: number;
  size: number;
  type: string;
  linkname: string;
}

function readString(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return (end === -1 ? field : field.subarray(0, end)).toString("utf8");
}

function readNumber(block: Buffer, start: number, length: number): number {
  const field = block.subarray(start, start + length);
  const first = field[0] ?? 0;
  if ((first & 0x80) !== 0) {
    let value = first & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + (field[i] ?? 0);
    if (!Number.isSafeInteger(value)) throw new UnsafeArchiveError("a size is too large");
    return value;
  }
  const text = readString(block, start, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new UnsafeArchiveError("a header field is not a number");
  return parseInt(text, 8);
}

function checksumOk(block: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (block[i] ?? 0);
  return sum === readNumber(block, 148, 8);
}

function parseHeader(block: Buffer): TarHeader {
  if (!checksumOk(block)) throw new UnsafeArchiveError("a header checksum does not match");
  let name = readString(block, 0, 100);
  const ustar = block.toString("latin1", 257, 263) === "ustar\0";
  const prefix = ustar ? readString(block, 345, 155) : "";
  if (prefix !== "") name = `${prefix}/${name}`;
  return {
    name,
    mode: readNumber(block, 100, 8),
    size: readNumber(block, 124, 12),
    type: String.fromCharCode(block[156] ?? 0x30),
    linkname: readString(block, 157, 100),
  };
}

/** pax records (`<length> <key>=<value>\n`) as a map. */
function parsePax(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(data.toString("utf8", offset, space));
    if (!Number.isInteger(length) || length <= space - offset + 1) break;
    const record = data.toString("utf8", space + 1, offset + length - 1);
    const eq = record.indexOf("=");
    if (eq !== -1) records.set(record.slice(0, eq), record.slice(eq + 1));
    offset += length;
  }
  return records;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** What the entry's name resolves to under `root`; `null` for the folder itself. */
function entryPath(root: string, name: string): string | null {
  if (name.includes("\0")) throw new UnsafeArchiveError("an entry name has a NUL byte");
  if (name.startsWith("/")) throw new UnsafeArchiveError(`an entry has an absolute name`);
  const segments = name.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) throw new UnsafeArchiveError("an entry name leaves the folder");
  return segments.length === 0 ? null : join(root, ...segments);
}

type Sink =
  | { kind: "collect"; type: MetadataType; chunks: Buffer[] }
  | { kind: "file"; handle: FileHandle; path: string; mode: number }
  | { kind: "skip" };

/** Unpacks one archive into one folder; the entry points are `extract`'s loop. */
class Extractor {
  private pending: Buffer = Buffer.alloc(0);
  private sink: Sink | null = null;
  private remaining = 0;
  private padding = 0;
  private done = false;
  private entries = 0;
  private bytes = 0;
  private longName: string | undefined;
  private longLink: string | undefined;
  private pax = new Map<string, string>();
  private readonly links: string[] = [];

  constructor(
    private readonly root: string,
    private readonly limits: ExtractLimits,
  ) {}

  async feed(chunk: Buffer): Promise<void> {
    let data = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    while (data.length > 0 && !this.done) {
      if (this.sink !== null) {
        const take = Math.min(this.remaining, data.length);
        if (take > 0) await this.write(data.subarray(0, take));
        this.remaining -= take;
        data = data.subarray(take);
        if (this.remaining > 0) break;
        const skip = Math.min(this.padding, data.length);
        this.padding -= skip;
        data = data.subarray(skip);
        if (this.padding > 0) break;
        await this.endData();
        continue;
      }
      if (data.length < BLOCK) break;
      const block = data.subarray(0, BLOCK);
      data = data.subarray(BLOCK);
      if (block.every((b) => b === 0)) {
        this.done = true;
        break;
      }
      await this.begin(parseHeader(block));
    }
    if (!this.done && data.length > 0) this.pending = Buffer.from(data);
  }

  /** After the last byte: the archive must have ended on an entry boundary. */
  async finish(): Promise<void> {
    if (this.sink !== null || this.pending.length > 0 || this.padding > 0) {
      throw new UnsafeArchiveError("the archive is truncated");
    }
    const realRoot = await realpath(this.root);
    for (const path of this.links) {
      let real: string;
      try {
        real = await realpath(path);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        throw new UnsafeArchiveError("a symbolic link does not resolve");
      }
      if (!isInside(realRoot, real)) {
        throw new UnsafeArchiveError("a symbolic link points outside the folder");
      }
    }
  }

  async abort(): Promise<void> {
    if (this.sink?.kind === "file") await this.sink.handle.close().catch(() => undefined);
    this.sink = null;
  }

  private async write(data: Buffer): Promise<void> {
    this.bytes += data.length;
    if (this.bytes > this.limits.maxBytes) throw new UnsafeArchiveError("the archive is too large");
    const sink = this.sink;
    if (sink?.kind === "collect") sink.chunks.push(Buffer.from(data));
    else if (sink?.kind === "file") await sink.handle.write(data);
  }

  /** A header was read: start its data, or complete a data-less entry. */
  private async begin(header: TarHeader): Promise<void> {
    this.entries += 1;
    if (this.entries > this.limits.maxEntries) throw new UnsafeArchiveError("too many entries");
    const { type } = header;
    const size = isMetadataType(type) ? header.size : Number(this.pax.get("size") ?? header.size);
    this.remaining = size;
    this.padding = (BLOCK - (size % BLOCK)) % BLOCK;
    if (isMetadataType(type)) {
      this.sink = { kind: "collect", type, chunks: [] };
      if (size === 0) await this.endData();
      return;
    }
    const name = this.longName ?? this.pax.get("path") ?? header.name;
    const linkname = this.longLink ?? this.pax.get("linkpath") ?? header.linkname;
    this.longName = undefined;
    this.longLink = undefined;
    this.pax = new Map();
    const entry: TarHeader = { ...header, name, linkname, size };
    if (type === "0" || type === "\0" || type === "7") {
      const path = entryPath(this.root, name);
      if (path === null) throw new UnsafeArchiveError("a file entry names the folder itself");
      await this.prepareParents(path);
      const existing = await lstat(path).catch(() => null);
      if (existing?.isSymbolicLink()) {
        throw new UnsafeArchiveError("a file entry is written through a symbolic link");
      }
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600,
      );
      this.sink = { kind: "file", handle, path, mode: entry.mode & 0o777 };
      if (size === 0) await this.endData();
      return;
    }
    await this.nonFile(entry);
    if (size > 0) this.sink = { kind: "skip" };
  }

  private async endData(): Promise<void> {
    const sink = this.sink;
    this.sink = null;
    if (sink?.kind === "file") {
      await sink.handle.close();
      await chmod(sink.path, sink.mode);
    } else if (sink?.kind === "collect") {
      const data = Buffer.concat(sink.chunks);
      if (sink.type === "x") {
        for (const [key, value] of parsePax(data)) this.pax.set(key, value);
      } else if (sink.type === "L") {
        this.longName = readString(data, 0, data.length);
      } else if (sink.type === "K") {
        this.longLink = readString(data, 0, data.length);
      }
    }
  }

  private async nonFile(entry: TarHeader): Promise<void> {
    const path = entryPath(this.root, entry.name);
    switch (entry.type) {
      case "5": {
        if (path === null) return;
        await this.prepareParents(path);
        const existing = await lstat(path).catch(() => null);
        if (existing?.isSymbolicLink() || (existing !== null && !existing.isDirectory())) {
          throw new UnsafeArchiveError("a folder entry replaces a file or a link");
        }
        if (existing === null) await mkdir(path);
        await chmod(path, (entry.mode & 0o777) | 0o700);
        return;
      }
      case "2": {
        if (path === null) throw new UnsafeArchiveError("a link entry names the folder itself");
        if (entry.linkname === "" || isAbsolute(entry.linkname) || entry.linkname.includes("\0")) {
          throw new UnsafeArchiveError("a symbolic link has an absolute or empty target");
        }
        if (!isInside(this.root, resolve(dirname(path), entry.linkname))) {
          throw new UnsafeArchiveError("a symbolic link points outside the folder");
        }
        await this.prepareParents(path);
        await symlink(entry.linkname, path);
        this.links.push(path);
        return;
      }
      case "1": {
        const target = entryPath(this.root, entry.linkname);
        if (path === null || target === null) {
          throw new UnsafeArchiveError("a hard link names the folder itself");
        }
        await this.prepareParents(path);
        await link(target, path);
        return;
      }
      default:
        throw new UnsafeArchiveError(`an entry has the unsupported type "${entry.type}"`);
    }
  }

  /** Creates the folders above `path`, refusing to pass through a symbolic link or a file. */
  private async prepareParents(path: string): Promise<void> {
    let current = this.root;
    for (const segment of relative(this.root, dirname(path)).split(sep)) {
      if (segment === "") continue;
      current = join(current, segment);
      const stat = await lstat(current).catch(() => null);
      if (stat === null) {
        await mkdir(current);
      } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new UnsafeArchiveError("an entry is written through a link or a file");
      }
    }
  }
}

/**
 * Unpacks `archive` into the existing folder `dest`. Throws `UnsafeArchiveError` for an entry the
 * rules above refuse (what was already written stays: the caller deletes the folder), and the
 * stream's own error for a corrupt archive.
 */
export async function extractTarGz(
  archive: string,
  dest: string,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): Promise<void> {
  const root = resolve(dest);
  await mkdir(root, { recursive: true });
  const extractor = new Extractor(root, limits);
  try {
    await pipeline(createReadStream(archive), createGunzip(), async (source) => {
      for await (const chunk of source) await extractor.feed(chunk as Buffer);
    });
    await extractor.finish();
  } catch (err) {
    await extractor.abort();
    throw err;
  }
}
