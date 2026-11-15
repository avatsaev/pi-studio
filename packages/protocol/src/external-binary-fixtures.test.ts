import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
} from "./binary-frames/file-transfer-protocol.js";
import {
  decodeTerminalFrame,
  encodeTerminalFrame,
} from "./binary-frames/terminal-stream-protocol.js";

/**
 * Binary external-client fixtures (swe/features/desktop-client-protocol-followups.md § 3). They
 * live in `fixtures/external-clients/binary/`, a SUBDIRECTORY, because the dashboard's vendored
 * consistency test fails on any top-level `*.json` that `manifest.json` does not list. Each file
 * holds one complete frame as hex plus its decoded form; this test proves the real codec decodes the
 * hex to the decoded form and encodes the decoded form back to the same bytes.
 */

const DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "external-clients",
  "binary",
);

interface BinaryManifestEntry {
  file: string;
  family: "file_transfer" | "terminal";
  opcode: string;
  direction: "server_to_client" | "client_to_server" | "both";
}

interface BinaryFixture extends BinaryManifestEntry {
  description: string;
  since: string;
  hex: string;
  decoded: Record<string, unknown>;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(DIR, file), "utf8")) as T;
const toBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.split(" ").map((byte) => Number.parseInt(byte, 16)));
const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");

/** The wire values, written out here so a codec edit cannot silently move the fixtures with it. */
const OPCODE_BYTE: Record<string, number> = {
  "file_transfer.Begin": 0x10,
  "file_transfer.Chunk": 0x11,
  "file_transfer.End": 0x12,
  "file_transfer.Error": 0x13,
  "terminal.Output": 0x01,
  "terminal.Input": 0x02,
  "terminal.Resize": 0x03,
  "terminal.Snapshot": 0x04,
  "terminal.Restore": 0x05,
};

/** `decoded` as the fixtures write it: raw payloads become `dataHex`. */
function describeFrame(entry: BinaryManifestEntry, bytes: Uint8Array): Record<string, unknown> {
  const frame =
    entry.family === "file_transfer" ? decodeFileTransferFrame(bytes) : decodeTerminalFrame(bytes);
  if ("data" in frame) {
    const { data, ...rest } = frame;
    return { ...rest, dataHex: toHex(data) };
  }
  return { ...frame };
}

/** The inverse of `describeFrame`, handed to the real encoder. */
function encodeDecoded(entry: BinaryManifestEntry, decoded: Record<string, unknown>): Uint8Array {
  const { dataHex, ...rest } = decoded;
  const frame = dataHex === undefined ? rest : { ...rest, data: toBytes(String(dataHex)) };
  return entry.family === "file_transfer"
    ? encodeFileTransferFrame(frame as Parameters<typeof encodeFileTransferFrame>[0])
    : encodeTerminalFrame(frame as Parameters<typeof encodeTerminalFrame>[0]);
}

const manifest = readJson<{ formatVersion: number; frames: BinaryManifestEntry[] }>(
  "manifest.json",
);

describe("binary fixtures manifest", () => {
  it("starts at its own formatVersion 1", () => {
    expect(manifest.formatVersion).toBe(1);
  });

  it("lists exactly the fixture files on disk: ten frames, two for the file-transfer Begin", () => {
    const onDisk = readdirSync(DIR)
      .filter((name) => name.endsWith(".json") && name !== "manifest.json")
      .toSorted();
    expect(manifest.frames.map((entry) => entry.file).toSorted()).toEqual(onDisk);
    expect(manifest.frames).toHaveLength(10);
    const keys = manifest.frames.map((entry) => `${entry.family}.${entry.opcode}`);
    expect(new Set(keys)).toEqual(new Set(Object.keys(OPCODE_BYTE)));
    expect(keys.filter((key) => key === "file_transfer.Begin")).toHaveLength(2);
  });
});

describe("binary fixtures round-trip through the real codec", () => {
  for (const entry of manifest.frames) {
    describe(entry.file, () => {
      const fixture = readJson<BinaryFixture>(entry.file);

      it("repeats its manifest entry and carries the documented fields", () => {
        expect({
          family: fixture.family,
          opcode: fixture.opcode,
          direction: fixture.direction,
        }).toEqual({ family: entry.family, opcode: entry.opcode, direction: entry.direction });
        expect(fixture.description.length).toBeGreaterThan(20);
        expect(fixture.since).toMatch(/^\d+\.\d+\.\d+$/);
      });

      it("starts with the opcode byte the wire format assigns", () => {
        expect(toBytes(fixture.hex)[0]).toBe(OPCODE_BYTE[`${entry.family}.${entry.opcode}`]);
      });

      it("decodes the hex to the decoded form", () => {
        expect(describeFrame(entry, toBytes(fixture.hex))).toEqual(fixture.decoded);
      });

      it("encodes the decoded form back to the same bytes", () => {
        expect(toHex(encodeDecoded(entry, fixture.decoded))).toBe(fixture.hex);
      });
    });
  }
});
