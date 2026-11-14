import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared helpers for the external-client fixtures (swe/architecture/external-client-fixtures.md):
 * loading, JSON-pointer access, shape signatures and the breaking-change guard. Used by
 * `src/external-fixtures.test.ts` and `scripts/update-fixture-signatures.ts`. Lives outside `src/`
 * on purpose — it is neither compiled into `dist` nor published.
 */

export const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "external-clients",
);
export const MANIFEST_FILE = "manifest.json";
export const SIGNATURES_FILE = ".signatures.json";
export const CHANGELOG_FILE = "CHANGELOG.md";

export type FixtureDirection = "server_to_client" | "client_to_server" | "http";
export type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface ManifestEntry {
  file: string;
  type: string;
  direction: FixtureDirection;
  /** client_to_server only: the fixture file the daemon must answer with. */
  response?: string;
  /** Marks a fixture no daemon path emits today (schema only); skipped by the live-output test. */
  exception?: string;
}

export interface Manifest {
  formatVersion: number;
  messages: ManifestEntry[];
}

export interface Fixture {
  type: string;
  direction: FixtureDirection;
  description: string;
  since: string;
  stage: number;
  requiresFeature: string | null;
  volatile: string[];
  frame: unknown;
}

/** `pointer → JSON type` for every leaf of a fixture frame, per fixture file. */
export interface Signatures {
  formatVersion: number;
  files: Record<string, Record<string, JsonType>>;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as T;
}

export function loadManifest(): Manifest {
  return readJson<Manifest>(MANIFEST_FILE);
}

export function loadFixture(file: string): Fixture {
  return readJson<Fixture>(file);
}

export function loadChangelog(): string {
  return readFileSync(join(FIXTURE_DIR, CHANGELOG_FILE), "utf8");
}

/** Every `.json` fixture on disk — the manifest and the generated signatures are not fixtures. */
export function listFixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && f !== MANIFEST_FILE && f !== SIGNATURES_FILE)
    .toSorted();
}

export function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as JsonType;
}

/** RFC 6901 pointer lookup; `found: false` when any segment is missing. */
export function resolvePointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  if (pointer === "") return { found: true, value: root };
  let node: unknown = root;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(node)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) {
        return { found: false, value: undefined };
      }
      node = node[index];
    } else if (node !== null && typeof node === "object" && key in node) {
      node = (node as Record<string, unknown>)[key];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: node };
}

function escapeSegment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** `pointer → JSON type` for every leaf (scalars plus empty objects/arrays). Volatile VALUES never
 *  enter the signature — only types do — so a per-run value change cannot alter it. */
export function leafTypes(frame: unknown): Record<string, JsonType> {
  const out: Record<string, JsonType> = {};
  const visit = (node: unknown, pointer: string): void => {
    if (Array.isArray(node) && node.length > 0) {
      node.forEach((child, i) => visit(child, `${pointer}/${i}`));
    } else if (
      node !== null &&
      typeof node === "object" &&
      !Array.isArray(node) &&
      Object.keys(node).length > 0
    ) {
      for (const [key, child] of Object.entries(node)) {
        visit(child, `${pointer}/${escapeSegment(key)}`);
      }
    } else {
      out[pointer] = jsonType(node);
    }
  };
  visit(frame, "");
  return out;
}

export function computeSignatures(manifest: Manifest): Signatures {
  const files: Signatures["files"] = {};
  for (const file of listFixtureFiles()) {
    const types = leafTypes(loadFixture(file).frame);
    files[file] = Object.fromEntries(
      Object.entries(types).toSorted(([a], [b]) => a.localeCompare(b)),
    );
  }
  return { formatVersion: manifest.formatVersion, files };
}

export interface BreakingChange {
  file: string;
  pointer: string;
  was: JsonType;
  now: JsonType | "missing";
}

/** Pairs present in `recorded` that are missing or retyped in `current`. Added pairs and added
 *  files are additive and never reported; a removed file reports all of its pairs. */
export function breakingChanges(recorded: Signatures, current: Signatures): BreakingChange[] {
  const changes: BreakingChange[] = [];
  for (const [file, pairs] of Object.entries(recorded.files)) {
    const now = current.files[file] ?? {};
    for (const [pointer, was] of Object.entries(pairs)) {
      const type = now[pointer];
      if (type !== was) changes.push({ file, pointer, was, now: type ?? "missing" });
    }
  }
  return changes;
}

function describeChange(c: BreakingChange): string {
  return `${c.file} ${c.pointer || "(root)"}: ${c.was} -> ${c.now}`;
}

/**
 * The bump + note rule: breaking changes are acceptable only when `formatVersion` is higher than
 * the recorded one AND the changelog names every affected file. Returns the problems (empty = ok).
 */
export function guardProblems(
  recorded: Signatures,
  current: Signatures,
  changelog: string,
): string[] {
  const changes = breakingChanges(recorded, current);
  if (changes.length === 0) return [];
  const problems: string[] = [];
  if (current.formatVersion <= recorded.formatVersion) {
    problems.push(
      `breaking fixture change without a formatVersion bump (recorded ${recorded.formatVersion}):\n  ${changes.map(describeChange).join("\n  ")}`,
    );
  }
  for (const file of new Set(changes.map((c) => c.file))) {
    if (!changelog.includes(file))
      problems.push(`CHANGELOG.md does not name changed fixture ${file}`);
  }
  return problems;
}

const SECRET_KEY =
  /^(password|passwd|secret|token|(access|refresh|auth|api)[-_]?(token|key)|authorization|bearer|credentials?)$/i;
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/;
/** The only credential value a fixture may carry. */
export const FAKE_SECRET = "FAKE";
/** The only home directory a fixture may show. */
export const FAKE_HOME = "/home/user";

/** Secret-looking content in a fixture frame: credential keys whose value is not `"FAKE"`,
 *  token-shaped string values, and real-looking home paths. Empty = clean. */
export function findSecrets(frame: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown, pointer: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${pointer}/${i}`));
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const here = `${pointer}/${escapeSegment(key)}`;
        const scalar = child === null || typeof child !== "object";
        if (SECRET_KEY.test(key) && scalar && child !== FAKE_SECRET) {
          found.push(`${here}: credential-like key holds a non-FAKE value`);
        }
        visit(child, here);
      }
    } else if (typeof node === "string") {
      if (SECRET_VALUE.test(node)) found.push(`${pointer}: token-shaped value`);
      if (
        /^\/(home|Users)\//.test(node) &&
        node !== FAKE_HOME &&
        !node.startsWith(`${FAKE_HOME}/`)
      ) {
        found.push(`${pointer}: real-looking home path`);
      }
    }
  };
  visit(frame, "");
  return found;
}
