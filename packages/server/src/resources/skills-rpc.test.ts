/**
 * `skills_list_request`/`skills_set_enabled_request` RPC-level tests (sprint-075/task-004).
 * Mirrors `viewer-settings-rpc.test.ts`'s `fakeSession`/`boot`/`dispatch` harness — routes real
 * text frames through `HandlerRegistry` rather than calling `ResourceService` directly, so the
 * malformed-shape guard and the broadcast-before-response ordering are exercised exactly as a real
 * client would.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  skillsInstallResponseSchema,
  skillsListResponseSchema,
  skillsPreviewResponseSchema,
  skillsRemoveResponseSchema,
  skillsSetEnabledResponseSchema,
  skillsUpdateAllResponseSchema,
  type SkillsInstallResponse,
  type SkillsListResponse,
  type SkillsPreviewResponse,
  type SkillsRemoveResponse,
  type SkillsSetEnabledResponse,
  type SkillsUpdateAllResponse,
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
function boot(
  config: PersistedConfig,
  overrides: Partial<{
    spawn: ConstructorParameters<typeof ResourceService>[0]["spawn"];
  }> = {},
): {
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
    spawn: overrides.spawn,
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

async function rpcRemove(
  registry: HandlerRegistry,
  payload: Record<string, unknown>,
  session?: FakeSession & Session,
): Promise<SkillsRemoveResponse> {
  const { response } = await dispatch(
    registry,
    { type: "skills_remove_request", ...payload },
    session,
  );
  return skillsRemoveResponseSchema.parse(response);
}

async function rpcUpdateAll(
  registry: HandlerRegistry,
  session?: FakeSession & Session,
): Promise<SkillsUpdateAllResponse> {
  const { response } = await dispatch(registry, { type: "skills_update_all_request" }, session);
  return skillsUpdateAllResponseSchema.parse(response);
}

async function rpcPreview(
  registry: HandlerRegistry,
  payload: Record<string, unknown>,
  session?: FakeSession & Session,
): Promise<SkillsPreviewResponse> {
  const { response } = await dispatch(
    registry,
    { type: "skills_preview_request", ...payload },
    session,
  );
  return skillsPreviewResponseSchema.parse(response);
}

async function rpcInstall(
  registry: HandlerRegistry,
  payload: Record<string, unknown>,
  session?: FakeSession & Session,
): Promise<SkillsInstallResponse> {
  const { response } = await dispatch(
    registry,
    { type: "skills_install_request", ...payload },
    session,
  );
  return skillsInstallResponseSchema.parse(response);
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

describe("skills_remove_request", () => {
  it("rejects a malformed (neither/both) request as a domain error, never rpc_error", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const { response } = await dispatch(registry, { type: "skills_remove_request" });
    const parsed = skillsRemoveResponseSchema.parse(response);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/invalid request/);

    const both = await dispatch(registry, {
      type: "skills_remove_request",
      path: "a",
      packageSource: "b",
    });
    const parsedBoth = skillsRemoveResponseSchema.parse(both.response);
    expect(parsedBoth.ok).toBe(false);
    expect(parsedBoth.error).toMatch(/invalid request/);
  });

  it("removes a settings_path skill by path and reflects it in a fresh list", async () => {
    const fixture = await buildFixture();
    const standaloneDir = join(fixture.home, "extra", "standalone");
    await writeSkill(standaloneDir, "standalone-skill");
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ skills: [standaloneDir] }),
      "utf8",
    );
    const { registry } = boot(fixture.config);

    const res = await rpcRemove(registry, { path: join(standaloneDir, "SKILL.md") });
    expect(res.ok).toBe(true);
    expect(res.skills.find((s) => s.name === "standalone-skill")).toBeUndefined();

    const list = await rpcList(registry);
    expect(list.skills.find((s) => s.name === "standalone-skill")).toBeUndefined();
  });

  it("an unknown path answers not_found", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcRemove(registry, {
      path: join(fixture.agentDir, "skills", "nope", "SKILL.md"),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_found");
  });

  it('broadcasts skills_changed("mutation") to every active session before the response', async () => {
    const fixture = await buildFixture();
    const alphaDir = join(fixture.agentDir, "skills", "alpha");
    await writeSkill(alphaDir, "alpha-skill");
    const { registry, sessions } = boot(fixture.config);
    const caller = fakeSession();
    const other = fakeSession();
    sessions.push(caller, other);

    await mkdir(join(fixture.agentDir, "skills", "linked-base"), { recursive: true });
    await symlink(alphaDir, join(fixture.agentDir, "skills", "linked-base", "link"), "dir");
    await rpcRemove(
      registry,
      { path: join(fixture.agentDir, "skills", "linked-base", "link", "SKILL.md") },
      caller,
    );

    for (const s of [caller, other]) {
      const idx = s.sent.findIndex((env) => messageType(env) === "skills_changed");
      expect(idx, "session should receive the broadcast").not.toBe(-1);
    }
    const pushIdx = caller.sent.findIndex((env) => messageType(env) === "skills_changed");
    const responseIdx = caller.sent.findIndex(
      (env) => messageType(env) === "skills_remove_response",
    );
    expect(responseIdx).toBeGreaterThan(pushIdx);
  });
});

describe("skills_update_all_request", () => {
  it("spawns both engines and answers ok:true with one ItemResult per engine", async () => {
    const fixture = await buildFixture();
    const calls: string[][] = [];
    const { registry } = boot(fixture.config, {
      spawn: ({ command }) => {
        calls.push(command);
        return Promise.resolve({ exitCode: 0, stderr: "" });
      },
    });

    const res = await rpcUpdateAll(registry);
    expect(res.ok).toBe(true);
    expect(res.results).toEqual([
      { target: "agent-skills", ok: true },
      { target: "pi-packages", ok: true },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('broadcasts skills_changed("mutation") once to every active session before the response', async () => {
    const fixture = await buildFixture();
    const { registry, sessions } = boot(fixture.config, {
      spawn: () => Promise.resolve({ exitCode: 0, stderr: "" }),
    });
    const caller = fakeSession();
    sessions.push(caller);

    await rpcUpdateAll(registry, caller);

    const changedCount = caller.sent.filter((env) => messageType(env) === "skills_changed").length;
    expect(changedCount).toBe(1);
    const pushIdx = caller.sent.findIndex((env) => messageType(env) === "skills_changed");
    const responseIdx = caller.sent.findIndex(
      (env) => messageType(env) === "skills_update_all_response",
    );
    expect(responseIdx).toBeGreaterThan(pushIdx);
  });
});

describe("skills_preview_request", () => {
  it("rejects a malformed request as a domain error, never rpc_error", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcPreview(registry, {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid request/);
  });

  it("an invalid source answers invalid_source", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcPreview(registry, { source: "not-a-valid-source" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_source");
    expect(res.kind).toBe("invalid_source");
    expect(res.source).toBe("not-a-valid-source");
  });

  it("a pi_npm source answers ok:true with no skills to pick", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcPreview(registry, { source: "npm:some-pkg" });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("pi_npm");
    expect(res.skills).toEqual([]);
  });

  it("a local_path source previews the host folder without a client-sent kind ever being trusted", async () => {
    const fixture = await buildFixture();
    const hostDir = join(fixture.home, "host-skills");
    await writeSkill(hostDir, "alpha-skill");
    const { registry } = boot(fixture.config);

    const res = await rpcPreview(registry, { source: hostDir, kind: "pi_npm" });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("local_path");
    expect(res.skills.map((s) => s.name)).toEqual(["alpha-skill"]);
  });
});

describe("skills_install_request", () => {
  it("rejects a malformed request as a domain error, never rpc_error, and echoes the current list", async () => {
    const fixture = await buildFixture();
    await writeSkill(join(fixture.agentDir, "skills", "alpha"), "alpha-skill");
    const { registry } = boot(fixture.config);

    const res = await rpcInstall(registry, { skills: "not-an-array" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid request/);
    expect(res.skills.map((s) => s.name)).toContain("alpha-skill");
  });

  it("an invalid source answers invalid_source", async () => {
    const fixture = await buildFixture();
    const { registry } = boot(fixture.config);

    const res = await rpcInstall(registry, { source: "not-a-valid-source" });
    expect(res.ok).toBe(false);
    expect(res.results).toEqual([
      { target: "not-a-valid-source", ok: false, error: "invalid_source" },
    ]);
  });

  it("installs a local_path source, reflected by a fresh list", async () => {
    const fixture = await buildFixture();
    const hostDir = join(fixture.home, "host-skills");
    await writeSkill(hostDir, "alpha-skill");
    const { registry } = boot(fixture.config);

    const res = await rpcInstall(registry, { source: hostDir });
    expect(res.ok).toBe(true);
    expect(res.results).toEqual([{ target: hostDir, ok: true }]);
    expect(res.skills.map((s) => s.name)).toContain("alpha-skill");

    const list = await rpcList(registry);
    expect(list.skills.map((s) => s.name)).toContain("alpha-skill");
  });

  it('broadcasts skills_changed("mutation") once to every active session before the response', async () => {
    const fixture = await buildFixture();
    const hostDir = join(fixture.home, "host-skills");
    await writeSkill(hostDir, "alpha-skill");
    const { registry, sessions } = boot(fixture.config);
    const caller = fakeSession();
    sessions.push(caller);

    await rpcInstall(registry, { source: hostDir }, caller);

    const changedCount = caller.sent.filter((env) => messageType(env) === "skills_changed").length;
    expect(changedCount).toBe(1);
    const pushIdx = caller.sent.findIndex((env) => messageType(env) === "skills_changed");
    const responseIdx = caller.sent.findIndex(
      (env) => messageType(env) === "skills_install_response",
    );
    expect(responseIdx).toBeGreaterThan(pushIdx);
  });
});
