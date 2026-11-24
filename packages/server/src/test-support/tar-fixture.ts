import { gzipSync } from "node:zlib";

/**
 * Builds `.tar.gz` bytes in tests, including the archives a safe unpacker must refuse (absolute
 * names, `..`, links out of the folder), which the system `tar` will not write.
 */
export interface TarFixtureEntry {
  name: string;
  /** Default `file`. */
  type?: "file" | "dir" | "symlink" | "hardlink" | "device";
  content?: string | Buffer;
  mode?: number;
  /** Target of a symbolic or hard link. */
  linkname?: string;
  /** Write the name as a GNU `L` record (names longer than 100 bytes). */
  gnuLongName?: boolean;
}

const TYPE_FLAGS = { file: "0", dir: "5", symlink: "2", hardlink: "1", device: "3" } as const;

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function header(name: string, type: string, size: number, mode: number, linkname: string): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, "utf8");
  block.write(octal(mode, 8), 100, "latin1");
  block.write(octal(0, 8), 108, "latin1");
  block.write(octal(0, 8), 116, "latin1");
  block.write(octal(size, 12), 124, "latin1");
  block.write(octal(0, 12), 136, "latin1");
  block.write("        ", 148, "latin1");
  block.write(type, 156, "latin1");
  block.write(linkname, 157, "utf8");
  block.write("ustar\0", 257, "latin1");
  block.write("00", 263, "latin1");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return block;
}

function dataBlocks(data: Buffer): Buffer {
  const padding = (512 - (data.length % 512)) % 512;
  return Buffer.concat([data, Buffer.alloc(padding)]);
}

/** The uncompressed tar bytes. */
export function buildTar(entries: readonly TarFixtureEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const type = entry.type ?? "file";
    const content = Buffer.from(entry.content ?? "");
    const defaultMode = type === "dir" ? 0o755 : 0o644;
    if (entry.gnuLongName) {
      const nameData = Buffer.from(`${entry.name}\0`);
      parts.push(header("././@LongLink", "L", nameData.length, 0, ""), dataBlocks(nameData));
    }
    parts.push(
      header(
        entry.name,
        TYPE_FLAGS[type],
        type === "file" ? content.length : 0,
        entry.mode ?? defaultMode,
        entry.linkname ?? "",
      ),
    );
    if (type === "file") parts.push(dataBlocks(content));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** The `.tar.gz` bytes. */
export function buildTarGz(entries: readonly TarFixtureEntry[]): Buffer {
  return gzipSync(buildTar(entries));
}
