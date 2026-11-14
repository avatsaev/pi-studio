import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { MockAgentSession } from "../agent/providers/mock/mock-provider.js";
import {
  connectTestClient,
  listeningPort,
  messageOf,
  type TestClient,
  type WireFrame,
} from "../test-support/daemon-test-client.js";
import {
  runExternalFixtureScenario,
  scenarioDaemonOptions,
} from "../test-support/external-fixtures-scenario.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Layer B of the external-client fixture contract test
 * (swe/architecture/external-client-fixtures.md; sprint-083/task-006): one real dev daemon, the
 * shared scenario (`test-support/external-fixtures-scenario.ts`, also what the recorder prints),
 * and every fixture under `packages/protocol/fixtures/external-clients/` checked against what the
 * daemon really sends or accepts. Layer A (`packages/protocol/src/external-fixtures.test.ts`)
 * covers the fixtures themselves.
 */

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../protocol/fixtures/external-clients",
);

interface ManifestEntry {
  file: string;
  type: string;
  direction: "server_to_client" | "client_to_server" | "http";
  response?: string;
  exception?: string;
}

interface Fixture {
  type: string;
  requiresFeature: string | null;
  volatile: string[];
  frame: WireFrame;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as T;
}

const manifest = readJson<{ formatVersion: number; messages: ManifestEntry[] }>("manifest.json");
const loadFixture = (file: string): Fixture => readJson<Fixture>(file);
const stemOf = (file: string): string => file.replace(/\.json$/, "");

// ── shapeMatches ──────────────────────────────────────────────────────────────────────────────

export interface ShapeResult {
  /** Contract violations (empty = the live value matches the fixture). */
  errors: string[];
  /** Keys the daemon sent that the fixture does not list — additive, allowed, reported. */
  extras: string[];
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function escapeSegment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * `expected` (a fixture frame) against `actual` (a live frame). Objects: every expected key must
 * exist with a matching shape; extra actual keys are allowed and listed. Primitives: same JSON
 * type, and equal unless the pointer is in `volatile`. Arrays: element-wise over the fixture's
 * elements — the live array must have at least that many. `null` and absent are distinct.
 */
export function shapeMatches(
  expected: unknown,
  actual: unknown,
  volatile: readonly string[] = [],
  pointer = "",
  result: ShapeResult = { errors: [], extras: [] },
): ShapeResult {
  const where = pointer || "(root)";
  const expectedKind = kindOf(expected);
  const actualKind = kindOf(actual);
  if (expectedKind !== actualKind) {
    result.errors.push(`${where}: expected ${expectedKind}, got ${actualKind}`);
    return result;
  }
  if (Array.isArray(expected)) {
    const live = actual as unknown[];
    if (live.length < expected.length) {
      result.errors.push(
        `${where}: expected at least ${expected.length} element(s), got ${live.length}`,
      );
    }
    expected.forEach((child, i) => {
      if (i < live.length) shapeMatches(child, live[i], volatile, `${pointer}/${i}`, result);
    });
  } else if (expectedKind === "object") {
    const want = expected as Record<string, unknown>;
    const live = actual as Record<string, unknown>;
    for (const [key, child] of Object.entries(want)) {
      const here = `${pointer}/${escapeSegment(key)}`;
      if (key in live) shapeMatches(child, live[key], volatile, here, result);
      else result.errors.push(`${here}: missing in live output`);
    }
    for (const key of Object.keys(live)) {
      if (!(key in want)) result.extras.push(`${pointer}/${escapeSegment(key)}`);
    }
  } else if (!volatile.includes(pointer) && expected !== actual) {
    result.errors.push(
      `${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
  return result;
}

const warnings = new Map<string, string[]>();

function expectMatch(label: string, fixture: Fixture, live: unknown): void {
  const result = shapeMatches(fixture.frame, live, fixture.volatile);
  // The feature-flag map grows with every feature; listing each new flag would drown real news.
  const extras = result.extras.filter((pointer) => !pointer.startsWith("/payload/features/"));
  if (extras.length > 0) warnings.set(label, extras);
  expect(result.errors, `${label} vs live output`).toEqual([]);
}

// ── daemon + scenario ─────────────────────────────────────────────────────────────────────────

let dev: DevBootstrapHandle;
let client: TestClient;
let port: number;
let captured: Map<string, WireFrame>;

beforeAll(async () => {
  dev = startDevDaemon({
    host: "127.0.0.1",
    port: 0,
    ...scenarioDaemonOptions(),
  });
  port = await listeningPort(dev.httpServer);
  client = await connectTestClient(port, { appVersion: "pistudiodashboard/0.1.0" });
  captured = await runExternalFixtureScenario(dev, client);
}, 45_000);

afterAll(async () => {
  await client?.close();
  await dev?.close();
  if (warnings.size > 0) {
    const lines = [...warnings].map(([file, keys]) => `  ${file}: ${keys.join(", ")}`);
    console.warn(
      `external fixtures: daemon sends fields the fixtures do not list (additive):\n${lines.join("\n")}`,
    );
  }
});

const outputs = manifest.messages.filter((e) => e.direction !== "client_to_server");
const inputs = manifest.messages.filter((e) => e.direction === "client_to_server");

describe("daemon output matches the fixtures", () => {
  it("every output fixture has a scenario producer or a documented exception", () => {
    const unexercised = outputs
      .filter((e) => e.exception === undefined && !captured.has(stemOf(e.file)))
      .map((e) => e.file);
    expect(unexercised, "fixtures no scenario step produces").toEqual([]);
  });

  for (const entry of outputs) {
    it(entry.file, () => {
      const key = stemOf(entry.file);
      if (entry.exception !== undefined) {
        // Documented as unproducible today: fail loudly the day a daemon path starts emitting it,
        // so the exception is removed and the fixture gets a real live check.
        expect(
          captured.has(key),
          `${entry.file} is now produced — remove its manifest exception`,
        ).toBe(false);
        return;
      }
      const fixture = loadFixture(entry.file);
      expectMatch(entry.file, fixture, captured.get(key));
      if (fixture.requiresFeature !== null) {
        const features = (client.status.payload as { features: Record<string, unknown> }).features;
        expect(features[fixture.requiresFeature], `${entry.file} requires feature`).toBe(true);
      }
    });
  }
});

// ── client-input fixtures ─────────────────────────────────────────────────────────────────────

/** `frame` with its volatile ids replaced by live values; `requestId` is stamped by the helper. */
function withLiveIds(fixture: Fixture, live: Record<string, string>): WireFrame {
  const message = structuredClone(messageOf(fixture.frame));
  for (const pointer of fixture.volatile) {
    const key = pointer.split("/").at(-1) ?? "";
    if (key in live) message[key] = live[key];
  }
  return message;
}

async function liveAgent(): Promise<string> {
  const created = await client.rpc("create_agent_request", {
    config: { provider: "mock", cwd: "/tmp" },
    initialPrompt: "hello",
  });
  const agentId = (created.payload as { agentId: string }).agentId;
  await client.waitFor((f) => {
    const m = messageOf(f);
    return m.type === "agent_update" && m.agentId === agentId && m.status === "idle";
  });
  return agentId;
}

/** Emits a UI request on the agent and resolves with the daemon-minted wire request id. */
async function raiseDialog(
  agentId: string,
  method: string,
  payload: Record<string, unknown> = { title: "fixture probe" },
  surfaceKey?: string,
): Promise<string> {
  const seen = new Set(client.frames);
  const session = dev.manager.get(agentId)?.session;
  if (!(session instanceof MockAgentSession)) throw new Error("expected a live mock session");
  session.emitUiRequest({
    method,
    expectsResponse: surfaceKey === undefined,
    payload,
    ...(surfaceKey !== undefined ? { surfaceKey } : {}),
  });
  const frame = await client.waitFor((f) => {
    const m = messageOf(f);
    return (
      !seen.has(f) && m.type === "agent_ui_request" && m.agentId === agentId && m.method === method
    );
  });
  return String(messageOf(frame).requestId);
}

describe("client-input fixtures are accepted and answered with the paired response shape", () => {
  for (const entry of inputs) {
    it(entry.file, async () => {
      const fixture = loadFixture(entry.file);
      const paired = loadFixture(entry.response!);

      if (entry.type === "hello") {
        const frame = { ...fixture.frame, clientId: `fixture-${Date.now()}` };
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const reply = Promise.withResolvers<WireFrame>();
        ws.once("message", (data: Buffer) =>
          reply.resolve(JSON.parse(data.toString("utf8")) as WireFrame),
        );
        ws.once("error", reply.reject);
        ws.once("open", () => ws.send(JSON.stringify(frame)));
        const status = await reply.promise;
        ws.close();
        expect(status.type).not.toBe("rpc_error");
        expectMatch(`${entry.file} → ${entry.response}`, paired, status);
        return;
      }

      if (entry.type === "ping") {
        const requestId = `fixture-ping-${Date.now()}`;
        client.send({ ...fixture.frame, requestId });
        const pong = await client.waitFor((f) => f.type === "pong" && f.requestId === requestId);
        expectMatch(`${entry.file} → ${entry.response}`, paired, pong);
        return;
      }

      const agentId = await liveAgent();
      const live: Record<string, string> = { agentId };
      if (entry.type === "agent_ui_respond_request") {
        live.uiRequestId = await raiseDialog(
          agentId,
          entry.file.includes(".select") ? "select" : "confirm",
        );
      }
      if (entry.type === "daemon_logs_subscribe_request") {
        // The fixture asks for a one-line backlog.
        dev.logger.info("external fixture log line");
      }
      if (entry.type === "agent_ui_list_request") {
        // Same content the scenario (and so the fixture) uses: dialog payloads are literal.
        await raiseDialog(agentId, "select", { title: "Pick one", options: ["a", "b"] });
        await raiseDialog(agentId, "setStatus", { statusText: "building" }, "status:build");
      }
      const { type: _type, requestId: _requestId, ...body } = withLiveIds(fixture, live);
      const reply = await client.rpcFrame(entry.type, body);
      expect(messageOf(reply).type, "must not be an rpc_error").not.toBe("rpc_error");
      expectMatch(`${entry.file} → ${entry.response}`, paired, reply);
    });
  }
});

// ── shapeMatches rules ────────────────────────────────────────────────────────────────────────

describe("shapeMatches", () => {
  const pass = (expected: unknown, actual: unknown, volatile: string[] = []): ShapeResult =>
    shapeMatches(expected, actual, volatile);

  it("accepts extra keys and reports them", () => {
    const result = pass({ a: 1 }, { a: 1, b: 2 });
    expect(result.errors).toEqual([]);
    expect(result.extras).toEqual(["/b"]);
  });

  it("fails on a missing key, a retyped value and a changed literal", () => {
    expect(pass({ a: 1, b: 2 }, { a: 1 }).errors).toHaveLength(1);
    expect(pass({ a: 1 }, { a: "1" }).errors).toHaveLength(1);
    expect(pass({ a: "x" }, { a: "y" }).errors).toHaveLength(1);
  });

  it("ignores the value of a volatile pointer but still checks its type", () => {
    expect(pass({ id: "a" }, { id: "b" }, ["/id"]).errors).toEqual([]);
    expect(pass({ id: "a" }, { id: 7 }, ["/id"]).errors).toHaveLength(1);
  });

  it("treats null and absent as distinct", () => {
    expect(pass({ a: null }, {}).errors).toHaveLength(1);
    expect(pass({ a: null }, { a: "x" }).errors).toHaveLength(1);
    expect(pass({ a: null }, { a: null }).errors).toEqual([]);
  });

  it("matches arrays element-wise and requires at least the fixture's elements", () => {
    expect(pass({ l: [{ a: 1 }] }, { l: [{ a: 1 }, { a: 2 }] }).errors).toEqual([]);
    expect(pass({ l: [{ a: 1 }] }, { l: [] }).errors).toHaveLength(1);
    expect(pass({ l: [{ a: 1 }] }, { l: [{ a: "x" }] }).errors).toHaveLength(1);
  });

  it("omitted optional fields in the fixture are not required", () => {
    expect(pass({ a: 1 }, { a: 1, optional: true }).errors).toEqual([]);
  });
});
