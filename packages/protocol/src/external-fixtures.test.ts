import { describe, expect, it } from "vitest";

import {
  breakingChanges,
  computeSignatures,
  findSecrets,
  guardProblems,
  leafTypes,
  listFixtureFiles,
  loadChangelog,
  loadFixture,
  loadManifest,
  readJson,
  resolvePointer,
  SIGNATURES_FILE,
  type Fixture,
  type Signatures,
} from "../scripts/external-fixtures-support.ts";
import {
  helloSchema,
  pingSchema,
  pongSchema,
  sessionMessageSchema,
  statusSchema,
  topLevelEnvelopeSchema,
} from "./messages.js";

/**
 * Layer A of the external-client fixture contract test
 * (swe/architecture/external-client-fixtures.md): no daemon. Every fixture is well-formed, listed
 * in the manifest, valid against its Zod schema (when it has one), free of secrets, and no
 * fixture shape changed in a breaking way without the "bump + note" rule
 * (`fixtures/external-clients/README.md`). Layer B (`packages/server/src/daemon/
 * external-fixtures-e2e.test.ts`) proves the live daemon still matches the fixtures.
 */

const manifest = loadManifest();
const fixtures = new Map<string, Fixture>(
  manifest.messages.map((e) => [e.file, loadFixture(e.file)]),
);

const DIRECTIONS = ["server_to_client", "client_to_server", "http"];

/** Top-level frame types that are not session-wrapped. */
const TOP_LEVEL_SCHEMAS = {
  hello: helloSchema,
  status: statusSchema,
  ping: pingSchema,
  pong: pongSchema,
} as const;

function innerMessage(frame: Record<string, unknown>): Record<string, unknown> {
  return frame.type === "session" ? (frame.message as Record<string, unknown>) : frame;
}

describe("manifest", () => {
  it("lists exactly the fixture files on disk", () => {
    expect(manifest.messages.map((e) => e.file).toSorted()).toEqual(listFixtureFiles());
  });

  it("has a positive integer formatVersion and unique files", () => {
    expect(Number.isInteger(manifest.formatVersion) && manifest.formatVersion >= 1).toBe(true);
    const files = manifest.messages.map((e) => e.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("pairs every client_to_server entry with a listed response fixture", () => {
    for (const entry of manifest.messages) {
      if (entry.direction === "client_to_server") {
        expect(entry.response, `${entry.file} needs a response`).toBeDefined();
        const paired = manifest.messages.find((m) => m.file === entry.response);
        expect(paired, `${entry.file} response ${entry.response} must be listed`).toBeDefined();
        expect(paired?.direction).not.toBe("client_to_server");
      } else {
        expect(entry.response, `${entry.file} must not carry a response`).toBeUndefined();
      }
    }
  });

  it("only marks a fixture as an exception when its type has a Zod schema", () => {
    for (const entry of manifest.messages.filter((m) => m.exception !== undefined)) {
      expect(
        sessionMessageSchema.optionsMap.has(entry.type),
        `${entry.file}: a schema-less type cannot be a Layer-B exception`,
      ).toBe(true);
    }
  });
});

describe("fixture shape and schema validation", () => {
  for (const entry of manifest.messages) {
    it(entry.file, () => {
      const fx = fixtures.get(entry.file)!;
      expect(typeof fx.description).toBe("string");
      expect(typeof fx.since).toBe("string");
      expect(typeof fx.stage).toBe("number");
      expect(fx.requiresFeature === null || typeof fx.requiresFeature === "string").toBe(true);
      expect(DIRECTIONS).toContain(fx.direction);
      expect(fx.type).toBe(entry.type);
      expect(fx.direction).toBe(entry.direction);
      expect(
        entry.file.startsWith(`${entry.type}.json`) || entry.file.startsWith(`${entry.type}.`),
      ).toBe(true);

      expect(Array.isArray(fx.volatile)).toBe(true);
      for (const pointer of fx.volatile) {
        expect(
          resolvePointer(fx.frame, pointer).found,
          `${entry.file}: ${pointer} must resolve`,
        ).toBe(true);
      }

      if (fx.direction === "http") return; // no wire envelope or schema
      const frame = fx.frame as Record<string, unknown>;
      expect(topLevelEnvelopeSchema.safeParse(frame).success, "outer envelope parses").toBe(true);

      const message = innerMessage(frame);
      expect(message.type).toBe(fx.type);
      if (frame.type !== "session") {
        const schema = TOP_LEVEL_SCHEMAS[frame.type as keyof typeof TOP_LEVEL_SCHEMAS];
        expect(schema.safeParse(frame).success, "top-level schema").toBe(true);
      } else if (sessionMessageSchema.optionsMap.has(fx.type)) {
        const parsed = sessionMessageSchema.safeParse(message);
        expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
      }
      // No schema for this type: Layer B is its only guard (enforced there).
    });
  }
});

describe("no secrets", () => {
  it("no fixture contains a credential, token-shaped value or real home path", () => {
    for (const [file, fx] of fixtures) {
      expect(findSecrets(fx.frame), file).toEqual([]);
    }
  });

  it("flags a password with a real value, accepts the literal FAKE", () => {
    expect(findSecrets({ password: "hunter2" })).toHaveLength(1);
    expect(findSecrets({ nested: { apiKey: "abc" } })).toHaveLength(1);
    expect(findSecrets({ password: "FAKE" })).toEqual([]);
    expect(findSecrets({ tokens: { total: 0 } })).toEqual([]);
    expect(findSecrets({ homeDir: "/home/alice" })).toHaveLength(1);
    expect(findSecrets({ homeDir: "/home/user" })).toEqual([]);
    expect(findSecrets({ note: "sk-abcdefghijklmnopqrstuvwxyz" })).toHaveLength(1);
  });
});

const base = (): Signatures => ({
  formatVersion: 1,
  files: { "x.json": { "/a": "string", "/b/c": "number" } },
});

describe("breaking-change guard", () => {
  const recorded = readJson<Signatures>(SIGNATURES_FILE);

  it("current fixtures contain no unrecorded breaking change (or it is bumped and noted)", () => {
    const current = computeSignatures(manifest);
    expect(guardProblems(recorded, current, loadChangelog())).toEqual([]);
  });

  describe("rules (in-memory mutations)", () => {
    it("a renamed leaf fails without a bump", () => {
      const current = base();
      current.files["x.json"] = { "/a": "string", "/b/renamed": "number" };
      expect(breakingChanges(base(), current)).toEqual([
        { file: "x.json", pointer: "/b/c", was: "number", now: "missing" },
      ]);
      expect(guardProblems(base(), current, "")[0]).toContain("without a formatVersion bump");
    });

    it("a retyped leaf fails without a bump", () => {
      const current = base();
      current.files["x.json"] = { "/a": "number", "/b/c": "number" };
      expect(guardProblems(base(), current, "x.json")).toHaveLength(1);
    });

    it("a bump plus a changelog entry naming the file passes", () => {
      const current = base();
      current.formatVersion = 2;
      current.files["x.json"] = { "/a": "string", "/b/renamed": "number" };
      expect(guardProblems(base(), current, "## formatVersion 2\n- x.json: /b/c renamed")).toEqual(
        [],
      );
    });

    it("a bump without a changelog entry fails", () => {
      const current = base();
      current.formatVersion = 2;
      current.files["x.json"] = { "/a": "string" };
      expect(guardProblems(base(), current, "nothing relevant")[0]).toContain("does not name");
    });

    it("an added optional leaf or a new file passes", () => {
      const current = base();
      current.files["x.json"] = { "/a": "string", "/b/c": "number", "/new": "boolean" };
      current.files["y.json"] = { "/z": "string" };
      expect(guardProblems(base(), current, "")).toEqual([]);
    });

    it("a removed fixture file is breaking", () => {
      const current: Signatures = { formatVersion: 1, files: {} };
      expect(breakingChanges(base(), current)).toHaveLength(2);
    });
  });

  it("leafTypes records scalars, empty containers and array elements", () => {
    expect(leafTypes({ a: [1, { b: null }], c: {}, d: [], "e/f": true })).toEqual({
      "/a/0": "number",
      "/a/1/b": "null",
      "/c": "object",
      "/d": "array",
      "/e~1f": "boolean",
    });
  });
});
