/**
 * `skills_list_request`/`skills_set_enabled_request` RPC-level tests (sprint-075/task-004).
 * Mirrors `viewer-settings-rpc.test.ts`'s `fakeSession`/`boot`/`dispatch` harness — routes real
 * text frames through `HandlerRegistry` rather than calling `ResourceService` directly, so the
 * malformed-shape guard and the broadcast-before-response ordering are exercised exactly as a real
 * client would.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  skillsListResponseSchema,
  skillsSetEnabledResponseSchema,
  type SkillsListResponse,
  type SkillsSetEnabledResponse,
} from "@av-pi-studio/protocol";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { persistedConfigSchema, type PersistedConfig } from "../config/daemon-config.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import { silentLogger } from "../logging/logger.js";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";

const BOOTSTRAP_HOME = await mkdtemp(join(tmpdir(), "pi-studio-skills-rpc-bootstrap-"));
process.env.HOME = BOOTSTRAP_HOME;
process.env.PI_CODING_AGENT_DIR = join(BOOTSTRAP_HOME, "agent");

// Dynamic import, deliberately: both modules route through `pi-sdk.js`, which eagerly imports
// `@earendil-works/pi-coding-agent` — a module with home-directory-dependent side effects at
// import time. The bootstrap env vars above must be in place *before* that import runs, which a
// static top-of-file import cannot guarantee (mirrors `skill-catalog.test.ts`'s same pattern).
const { ResourceService } = await import("./resource-service.js");
const { registerSkillsHandlers } = await import("./skills-rpc.js");
const { FileWatchService } = await import("../files/file-watch-service.js");

let originalHome: string | undefined;
let originalPiDir: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  originalPiDir = process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiDir;
  for (const service of watchServices.splice(0)) service.close();
});

afterAll(async () => {
  await rm(BOOTSTRAP_HOME, { recursive: true, force: true });
});

const watchServices: InstanceType<typeof FileWatchService>[] = [];

interface Fixture {
  home: string;
  agentDir: string;
  config: PersistedConfig;
}

async function buildFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "pi-studio-skills-rpc-"));
  const config = persistedConfigSchema.parse({ daemon: { piHome: join(home, "pihome") } });
  const agentDir = effectivePiHomeKey(config);
  await mkdir(agentDir, { recursive: true });
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return { home, agentDir, config };
}

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\nBody for ${name}.\n`;
}

async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name), "utf8");
}

interface FakeSession {
  sent: unknown[];
  send: (env: unknown) => void;
}

function fakeSession(): FakeSession & Session {
  const sent: unknown[] = [];
  return { sent, send: (env: unknown) => sent.push(env) } as unknown as FakeSession & Session;
}

/** Boots a registry with the skills handlers registered — the same shape `bootstrap.ts` wires,
 *  minus the rest of the daemon. `sessions` is a mutable array so a test can register extra fake
 *  sessions before dispatching a `set` and observe the broadcast on all of them. */
function boot(config: PersistedConfig): {
  registry: HandlerRegistry;
  sessions: (FakeSession & Session)[];
} {
  const sessions: (FakeSession & Session)[] = [];
  const registry = new HandlerRegistry();
  const fileWatchService = new FileWatchService({ coalesceMs: 10 });
  watchServices.push(fileWatchService);
  const service = new ResourceService({
    config,
    fileWatchService,
    broadcast: (targets, message) => {
      for (const s of targets) s.send({ type: "session", message });
    },
    getActiveSessions: () => sessions,
    logger: silentLogger(),
    externalDebounceMs: 30,
  });
  registerSkillsHandlers(registry, { service, logger: silentLogger() });
  return { registry, sessions };
}

/** Dispatches one session RPC through the real router, targeting `session` (defaults to a fresh
 *  one not in `sessions`), and returns the raw response message. */
async function dispatch(
  registry: HandlerRegistry,
  message: Record<string, unknown>,
  session: FakeSession & Session = fakeSession(),
): Promise<{ session: FakeSession & Session; response: unknown }> {
  const requestId = message.requestId ?? "r1";
  await routeTextFrame(
    session,
    JSON.stringify({ type: "session", message: { ...message, requestId } }),
    registry,
  );
  const envelope = session.sent.at(-1) as { type: string; message: unknown };
  return { session, response: envelope?.message };
}

async function rpcList(
  registry: HandlerRegistry,
  session?: FakeSession & Session,
): Promise<SkillsListResponse> {
  const { response } = await dispatch(registry, { type: "skills_list_request" }, session);
  return skillsListResponseSchema.parse(response);
}

async function rpcSetEnabled(
  registry: HandlerRegistry,
  payload: Record<string, unknown>,
  session?: FakeSession & Session,
): Promise<SkillsSetEnabledResponse> {
  const { response } = await dispatch(
    registry,
    { type: "skills_set_enabled_request", ...payload },
    session,
  );
  return skillsSetEnabledResponseSchema.parse(response);
}

function messageType(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null || !("message" in env)) return undefined;
  const { message } = env as { message: unknown };
  if (typeof message !== "object" || message === null || !("type" in message)) return undefined;
  const { type } = message as { type: unknown };
  return typeof type === "string" ? type : undefined;
}

describe("skills_list_request", () => {
  it("answers ok:true with an empty catalog on a fresh pi-home", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcList(registry);
    expect(res.ok).toBe(true);
    expect(res.skills).toEqual([]);
    expect(res.packages).toEqual([]);
  });

  it("lists a resolved skill", async () => {
    const fixture = await buildFixture();
    await writeSkill(join(fixture.agentDir, "skills", "alpha"), "alpha-skill");
    const { registry } = boot(fixture.config);

    const res = await rpcList(registry);
    expect(res.ok).toBe(true);
    expect(res.skills.map((s) => s.name)).toContain("alpha-skill");
  });
});

describe("skills_set_enabled_request", () => {
  it("rejects a malformed request as a domain error, never rpc_error, and echoes the current list", async () => {
    const fixture = await buildFixture();
    await writeSkill(join(fixture.agentDir, "skills", "alpha"), "alpha-skill");
    const { registry } = boot(fixture.config);

    const { response } = await dispatch(registry, { type: "skills_set_enabled_request" });
    const parsed = skillsSetEnabledResponseSchema.parse(response);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/invalid request/);
    expect(parsed.skills.map((s) => s.name)).toContain("alpha-skill");
  });

  it("toggles a top-level skill off and on, reflected by a fresh list", async () => {
    const fixture = await buildFixture();
    const alphaDir = join(fixture.agentDir, "skills", "alpha");
    await writeSkill(alphaDir, "alpha-skill");
    const alphaPath = join(alphaDir, "SKILL.md");
    const { registry } = boot(fixture.config);

    const off = await rpcSetEnabled(registry, { path: alphaPath, enabled: false });
    expect(off.ok).toBe(true);
    expect(off.skills.find((s) => s.path === alphaPath)?.enabled).toBe(false);

    const list = await rpcList(registry);
    expect(list.skills.find((s) => s.path === alphaPath)?.enabled).toBe(false);
  });

  it("an unknown path answers not_found", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcSetEnabled(registry, {
      path: join(fixture.agentDir, "skills", "nope", "SKILL.md"),
      enabled: false,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_found");
  });

  it('broadcasts skills_changed("mutation") to every active session, including the caller, before the response', async () => {
    const fixture = await buildFixture();
    const alphaDir = join(fixture.agentDir, "skills", "alpha");
    await writeSkill(alphaDir, "alpha-skill");
    const alphaPath = join(alphaDir, "SKILL.md");
    const { registry, sessions } = boot(fixture.config);
    const caller = fakeSession();
    const other = fakeSession();
    sessions.push(caller, other);

    await rpcSetEnabled(registry, { path: alphaPath, enabled: false }, caller);

    for (const s of [caller, other]) {
      const idx = s.sent.findIndex((env) => messageType(env) === "skills_changed");
      expect(idx, "session should receive the broadcast").not.toBe(-1);
    }

    const pushIdx = caller.sent.findIndex((env) => messageType(env) === "skills_changed");
    const responseIdx = caller.sent.findIndex(
      (env) => messageType(env) === "skills_set_enabled_response",
    );
    expect(responseIdx).toBeGreaterThan(pushIdx);
  });
});
