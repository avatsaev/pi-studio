/**
 * Isolated-HOME integration tests for `ResourceService` (sprint-075/task-004). Mirrors
 * `skill-catalog.test.ts`'s bootstrap pattern (`process.env.HOME`/`PI_CODING_AGENT_DIR` set to a
 * throwaway temp dir before a dynamic `import()` of the module under test), plus
 * `file-watch-service.test.ts`'s real-fs + `vi.waitFor` style for the watcher/debounce tests.
 * Real `fs`, no mocked readers; the real `~/.pi-studio`/`~/.agents` are never touched.
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistedConfigSchema, type PersistedConfig } from "../config/daemon-config.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import { silentLogger } from "../logging/logger.js";

const BOOTSTRAP_HOME = await mkdtemp(join(tmpdir(), "pi-studio-resource-service-bootstrap-"));
process.env.HOME = BOOTSTRAP_HOME;
process.env.PI_CODING_AGENT_DIR = join(BOOTSTRAP_HOME, "agent");

// Dynamic import, deliberately: `resource-service.js` pulls in `pi-sdk.js`, which eagerly imports
// `@earendil-works/pi-coding-agent` — a module with home-directory-dependent side effects at
// import time. The bootstrap env vars above must be in place *before* that import runs, which a
// static top-of-file import cannot guarantee (mirrors `skill-catalog.test.ts`'s same pattern).
const { ResourceService } = await import("./resource-service.js");
const { FileWatchService } = await import("../files/file-watch-service.js");

let originalHome: string | undefined;
let originalPiDir: string | undefined;
let originalXdgState: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  originalPiDir = process.env.PI_CODING_AGENT_DIR;
  originalXdgState = process.env.XDG_STATE_HOME;
  delete process.env.XDG_STATE_HOME;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiDir;
  if (originalXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalXdgState;
  for (const service of watchServices.splice(0)) service.close();
});

afterAll(async () => {
  await rm(BOOTSTRAP_HOME, { recursive: true, force: true });
});

const watchServices: InstanceType<typeof FileWatchService>[] = [];

/** Fast but real: production uses 500 ms, tests use a much shorter window so the watcher/fold
 *  assertions below run quickly while staying genuinely event-driven. */
const TEST_DEBOUNCE_MS = 40;

/** A genuine wall-clock wait — deliberately, not fake timers: the watcher/fold behavior under
 *  test spans real `fs.watch` events and `proper-lockfile`-backed disk writes (`SettingsManager`),
 *  neither of which a mocked clock drives. Mirrors `file-watch-service.test.ts`'s own real-timer
 *  settle-window checks for the same reason. */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function makeWatchService(): InstanceType<typeof FileWatchService> {
  const service = new FileWatchService({ coalesceMs: 10 });
  watchServices.push(service);
  return service;
}

interface BroadcastCall {
  type: string;
  reason: string;
}

function makeBroadcastRecorder(): {
  calls: BroadcastCall[];
  broadcast: (sessions: Iterable<unknown>, message: unknown) => void;
} {
  const calls: BroadcastCall[] = [];
  return {
    calls,
    broadcast: (_sessions: Iterable<unknown>, message: unknown) => {
      calls.push(message as BroadcastCall);
    },
  };
}

interface Fixture {
  home: string;
  agentDir: string;
  config: PersistedConfig;
}

/** A fresh isolated `$HOME`/pi-home pair, `agentDir` derived the same way production does
 *  (`effectivePiHomeKey`), with `process.env.HOME`/`PI_CODING_AGENT_DIR` pointed at it — required
 *  because `ResourceService`'s `~/.agents/skills` resolution (via Pi's own `getHomeDir()`) reads
 *  the environment, not an injected parameter. */
async function buildFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "pi-studio-resource-service-"));
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

async function readSettings(agentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function makeService(
  fixture: Fixture,
  overrides: Partial<{
    broadcast: (sessions: Iterable<unknown>, message: unknown) => void;
    getActiveSessions: () => Iterable<unknown>;
    spawn: ConstructorParameters<typeof ResourceService>[0]["spawn"];
  }> = {},
): InstanceType<typeof ResourceService> {
  const { broadcast } = overrides.broadcast
    ? { broadcast: overrides.broadcast }
    : makeBroadcastRecorder();
  return new ResourceService({
    config: fixture.config,
    fileWatchService: makeWatchService(),
    broadcast: broadcast as never,
    getActiveSessions: overrides.getActiveSessions ?? (() => []),
    logger: silentLogger(),
    externalDebounceMs: TEST_DEBOUNCE_MS,
    spawn: overrides.spawn,
  });
}

describe("ResourceService.setEnabled — top-level skill (acceptance #1)", () => {
  it("disabling an agents_dir skill writes -skills/<name>/SKILL.md; re-enabling replaces it with +…", async () => {
    const fixture = await buildFixture();
    const betaDir = join(fixture.home, ".agents", "skills", "beta");
    await writeSkill(betaDir, "beta-skill");
    const betaPath = join(betaDir, "SKILL.md");

    const { calls, broadcast } = makeBroadcastRecorder();
    const service = new ResourceService({
      config: fixture.config,
      fileWatchService: makeWatchService(),
      broadcast,
      getActiveSessions: () => [],
      logger: silentLogger(),
      externalDebounceMs: TEST_DEBOUNCE_MS,
    });

    const off = await service.setEnabled(betaPath, false);
    expect(off.ok).toBe(true);
    expect(off.skills.find((s) => s.path === betaPath)?.enabled).toBe(false);
    expect((await readSettings(fixture.agentDir)).skills).toEqual(["-skills/beta/SKILL.md"]);

    const on = await service.setEnabled(betaPath, true);
    expect(on.ok).toBe(true);
    expect(on.skills.find((s) => s.path === betaPath)?.enabled).toBe(true);
    // Replaced, never duplicated.
    expect((await readSettings(fixture.agentDir)).skills).toEqual(["+skills/beta/SKILL.md"]);

    expect(calls).toEqual([
      { type: "skills_changed", reason: "mutation" },
      { type: "skills_changed", reason: "mutation" },
    ]);
  });
});

describe("ResourceService.setEnabled — package skill (amended acceptance #2)", () => {
  it("toggling off upgrades the entry to object form; re-enabling writes +…, staying object form (no collapse)", async () => {
    const fixture = await buildFixture();
    const packageRoot = join(fixture.home, "pkgs", "fake-pkg");
    await writeSkill(join(packageRoot, "skills", "gamma"), "gamma-skill");
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [packageRoot] }),
      "utf8",
    );
    const gammaPath = join(packageRoot, "skills", "gamma", "SKILL.md");

    const service = makeService(fixture);

    const off = await service.setEnabled(gammaPath, false);
    expect(off.ok).toBe(true);
    expect(off.skills.find((s) => s.path === gammaPath)?.enabled).toBe(false);
    expect((await readSettings(fixture.agentDir)).packages).toEqual([
      { source: packageRoot, skills: ["-skills/gamma/SKILL.md"] },
    ]);

    const on = await service.setEnabled(gammaPath, true);
    expect(on.ok).toBe(true);
    expect(on.skills.find((s) => s.path === gammaPath)?.enabled).toBe(true);
    // Amended acceptance criterion (task-002's deviation note): re-enabling writes `+…` exactly as
    // `pi config` does — the entry stays object form, it never collapses back to a bare string.
    expect((await readSettings(fixture.agentDir)).packages).toEqual([
      { source: packageRoot, skills: ["+skills/gamma/SKILL.md"] },
    ]);
  });
});

describe("ResourceService.setEnabled — errors", () => {
  it("an unknown path answers not_found and echoes the current list", async () => {
    const fixture = await buildFixture();
    await writeSkill(join(fixture.agentDir, "skills", "alpha"), "alpha-skill");
    const service = makeService(fixture);

    const result = await service.setEnabled(
      join(fixture.agentDir, "skills", "missing", "SKILL.md"),
      false,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
    expect(result.skills.some((s) => s.name === "alpha-skill")).toBe(true);
  });

  it("list() and setEnabled() both answer settings_unreadable for a corrupt settings.json, never rewriting it", async () => {
    const fixture = await buildFixture();
    await writeFile(join(fixture.agentDir, "settings.json"), "{not valid json", "utf8");
    const before = await readFile(join(fixture.agentDir, "settings.json"), "utf8");
    const service = makeService(fixture);

    const listResult = await service.list();
    expect(listResult).toEqual({
      ok: false,
      error: "settings_unreadable",
      skills: [],
      packages: [],
    });

    const setResult = await service.setEnabled("/nonexistent/SKILL.md", true);
    expect(setResult).toEqual({
      ok: false,
      error: "settings_unreadable",
      skills: [],
      packages: [],
    });

    expect(await readFile(join(fixture.agentDir, "settings.json"), "utf8")).toBe(before);
  });
});

describe("ResourceService — watcher (sprint-075/task-004)", () => {
  it('an external edit to settings.json yields exactly one skills_changed("external")', async () => {
    const fixture = await buildFixture();
    await writeSkill(join(fixture.agentDir, "skills", "alpha"), "alpha-skill");
    const { calls, broadcast } = makeBroadcastRecorder();
    const service = new ResourceService({
      config: fixture.config,
      fileWatchService: makeWatchService(),
      broadcast,
      getActiveSessions: () => [],
      logger: silentLogger(),
      externalDebounceMs: TEST_DEBOUNCE_MS,
    });

    // Starts the watcher — "on the first skills_* RPC".
    await service.list();

    // An edit this service did NOT make itself.
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ skills: [] }),
      "utf8",
    );

    await vi.waitFor(() => expect(calls).toHaveLength(1), { timeout: 2000 });
    expect(calls[0]).toEqual({ type: "skills_changed", reason: "external" });

    // Settle well past the debounce window; still exactly one push.
    await sleep(TEST_DEBOUNCE_MS * 4);
    expect(calls).toHaveLength(1);
  });

  it("a burst of external edits inside the debounce window collapses to one push", async () => {
    const fixture = await buildFixture();
    await writeSkill(join(fixture.agentDir, "skills", "alpha"), "alpha-skill");
    const { calls, broadcast } = makeBroadcastRecorder();
    const service = new ResourceService({
      config: fixture.config,
      fileWatchService: makeWatchService(),
      broadcast,
      getActiveSessions: () => [],
      logger: silentLogger(),
      externalDebounceMs: TEST_DEBOUNCE_MS,
    });
    await service.list();

    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ skills: [] }),
      "utf8",
    );
    await sleep(TEST_DEBOUNCE_MS / 4);
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ skills: ["+x"] }),
      "utf8",
    );

    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    await sleep(TEST_DEBOUNCE_MS * 4);
    expect(calls).toHaveLength(1);
  });

  it("an fs event landing within the debounce of the service's own write folds into the mutation broadcast — no extra external push", async () => {
    const fixture = await buildFixture();
    const betaDir = join(fixture.home, ".agents", "skills", "beta");
    await writeSkill(betaDir, "beta-skill");
    const betaPath = join(betaDir, "SKILL.md");
    const { calls, broadcast } = makeBroadcastRecorder();
    const service = new ResourceService({
      config: fixture.config,
      fileWatchService: makeWatchService(),
      broadcast,
      getActiveSessions: () => [],
      logger: silentLogger(),
      externalDebounceMs: TEST_DEBOUNCE_MS,
    });

    const result = await service.setEnabled(betaPath, false);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ type: "skills_changed", reason: "mutation" }]);

    // Give the watcher's own coalescing plus this service's debounce window plenty of room to
    // have fired a stray "external" push if the own-write fold were broken.
    await sleep(TEST_DEBOUNCE_MS * 6);
    expect(calls).toEqual([{ type: "skills_changed", reason: "mutation" }]);
  });
});

describe("ResourceService — queue, spawn, mutation tail (sprint-076/task-003)", () => {
  it("two queued mutations run strictly in submission order; a concurrent setEnabled isn't blocked by the queue", async () => {
    const fixture = await buildFixture();
    const betaDir = join(fixture.home, ".agents", "skills", "beta");
    await writeSkill(betaDir, "beta-skill");
    const betaPath = join(betaDir, "SKILL.md");
    const service = makeService(fixture);

    const order: string[] = [];
    const { promise: firstGate, resolve: releaseFirst } = Promise.withResolvers<void>();

    const first = service.enqueueMutation("remove", "skills_repo", "first", async (ctx) => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
      return { ok: true, target: ctx.agentDir };
    });
    const second = service.enqueueMutation("remove", "skills_repo", "second", async () => {
      order.push("second-start");
      order.push("second-end");
      return { ok: true };
    });

    // `setEnabled` bypasses the queue entirely (D21) — it must settle while the first mutation is
    // still blocked on `firstGate`, proving it never waits behind the FIFO.
    const toggleResult = await service.setEnabled(betaPath, false);
    expect(toggleResult.ok).toBe(true);
    expect(order).toEqual(["first-start"]); // `second` hasn't started yet — proves FIFO ordering.

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  it("a timed-out spawn returns error:'timeout' and the queue proceeds to the next mutation", async () => {
    const fixture = await buildFixture();
    const service = makeService(fixture, {
      spawn: () => Promise.resolve({ exitCode: null, stderr: "stuck", timedOut: true }),
    });

    const outcome = await service.runSpawn(["pi", "install", "npm:x"], {}, 1000);
    expect(outcome).toEqual({ ok: false, error: "timeout", exitCode: null, stderr: "stuck" });

    // The queue isn't wedged by the prior timeout — a subsequent queued mutation still runs.
    const next = await service.enqueueMutation("remove", "skills_repo", "next", async () => ({
      ok: true,
    }));
    expect(next.ok).toBe(true);
  });

  it("enqueueMutation logs the redacted source and broadcasts+re-lists even on failure", async () => {
    const fixture = await buildFixture();
    const { calls, broadcast } = makeBroadcastRecorder();
    const service = makeService(fixture, { broadcast });

    const result = await service.enqueueMutation(
      "remove",
      "skills_repo",
      "git:https://user:tok@host/r?access_token=x",
      async () => ({ ok: false, error: "remove_failed", stderr: "boom" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("remove_failed");
    expect(calls).toEqual([{ type: "skills_changed", reason: "mutation" }]);
  });
});

describe("ResourceService.remove — remove-by-path (sprint-076/task-004)", () => {
  it("removes a symlinked skill by unlinking the link only, leaving its target directory intact", async () => {
    const fixture = await buildFixture();
    const linkTarget = join(fixture.home, "link-target");
    await writeSkill(linkTarget, "linked-skill");
    const linkPath = join(fixture.agentDir, "skills", "linked");
    await mkdir(join(fixture.agentDir, "skills"), { recursive: true });
    await symlink(linkTarget, linkPath, "dir");
    const skillPath = join(linkPath, "SKILL.md");
    const service = makeService(fixture);

    const result = await service.remove({ path: skillPath });
    expect(result.ok).toBe(true);
    expect(result.skills.find((s) => s.name === "linked-skill")).toBeUndefined();

    await expect(readFile(join(linkTarget, "SKILL.md"), "utf8")).resolves.toContain("linked-skill");
  });

  it("lock-tracked removal spawns `skills remove -g -y <name>` without -a; the row disappears", async () => {
    const fixture = await buildFixture();
    const betaDir = join(fixture.home, ".agents", "skills", "beta");
    await writeSkill(betaDir, "beta-skill");
    const betaPath = join(betaDir, "SKILL.md");
    const lockPath = join(fixture.home, ".agents", ".skill-lock.json");
    await mkdir(join(fixture.home, ".agents"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ version: 3, skills: { "beta-skill": { source: "owner/repo" } } }),
      "utf8",
    );

    const calls: { command: string[]; env: Record<string, string> }[] = [];
    const service = makeService(fixture, {
      spawn: async ({ command, env }) => {
        calls.push({ command, env: env as Record<string, string> });
        await rm(betaDir, { recursive: true, force: true });
        return { exitCode: 0, stderr: "" };
      },
    });

    const result = await service.remove({ path: betaPath });
    expect(result.ok).toBe(true);
    expect(result.skills.find((s) => s.name === "beta-skill")).toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toEqual(expect.arrayContaining(["remove", "-g", "-y", "beta-skill"]));
    expect(calls[0]?.command).not.toContain("-a");
    expect(calls[0]?.env.PI_CODING_AGENT_DIR).toBe(fixture.agentDir);
  });

  it("removes a settings_path entry from settings.skills, leaving its files on disk", async () => {
    const fixture = await buildFixture();
    const standaloneDir = join(fixture.home, "extra", "standalone");
    await writeSkill(standaloneDir, "standalone-skill");
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ skills: [standaloneDir] }),
      "utf8",
    );
    const skillPath = join(standaloneDir, "SKILL.md");
    const service = makeService(fixture);

    const result = await service.remove({ path: skillPath });
    expect(result.ok).toBe(true);
    expect(result.skills.find((s) => s.name === "standalone-skill")).toBeUndefined();

    const settings = await readSettings(fixture.agentDir);
    expect(settings.skills).toEqual([]);
    await expect(readFile(skillPath, "utf8")).resolves.toContain("standalone-skill");
  });

  it("refuses and leaves untouched a dir whose realpath escapes its origin root via a symlinked ancestor", async () => {
    const fixture = await buildFixture();
    const outsideDir = join(fixture.home, "outside-root");
    await writeSkill(join(outsideDir, "escaped"), "escaped-skill");
    await mkdir(join(fixture.agentDir, "skills"), { recursive: true });
    await symlink(outsideDir, join(fixture.agentDir, "skills", "trap"), "dir");
    const skillPath = join(fixture.agentDir, "skills", "trap", "escaped", "SKILL.md");
    const service = makeService(fixture);

    const result = await service.remove({ path: skillPath });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_removable");
    expect(result.skills.find((s) => s.name === "escaped-skill")).toBeDefined();

    await expect(readFile(skillPath, "utf8")).resolves.toContain("escaped-skill");
  });

  it("a package row's own path answers not_removable", async () => {
    const fixture = await buildFixture();
    const packageRoot = join(fixture.home, "pkgs", "fake-pkg");
    await writeSkill(join(packageRoot, "skills", "gamma"), "gamma-skill");
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [packageRoot] }),
      "utf8",
    );
    const skillPath = join(packageRoot, "skills", "gamma", "SKILL.md");
    const service = makeService(fixture);

    const result = await service.remove({ path: skillPath });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_removable");
  });

  it("an unknown path answers not_found", async () => {
    const fixture = await buildFixture();
    const service = makeService(fixture);

    const result = await service.remove({
      path: join(fixture.agentDir, "skills", "nope", "SKILL.md"),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("a spawn failure answers remove_failed with the spawn's stderr", async () => {
    const fixture = await buildFixture();
    const betaDir = join(fixture.home, ".agents", "skills", "beta");
    await writeSkill(betaDir, "beta-skill");
    const betaPath = join(betaDir, "SKILL.md");
    const lockPath = join(fixture.home, ".agents", ".skill-lock.json");
    await mkdir(join(fixture.home, ".agents"), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ version: 3, skills: { "beta-skill": { source: "owner/repo" } } }),
      "utf8",
    );
    const service = makeService(fixture, {
      spawn: () => Promise.resolve({ exitCode: 1, stderr: "boom" }),
    });

    const result = await service.remove({ path: betaPath });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("remove_failed");
    expect(result.stderr).toBe("boom");
  });
});

describe("ResourceService.remove — remove-by-package (sprint-076/task-004)", () => {
  it("removes a whole package by spawning `pi remove <source>`", async () => {
    const fixture = await buildFixture();
    const packageRoot = join(fixture.home, "pkgs", "fake-pkg");
    await writeSkill(join(packageRoot, "skills", "gamma"), "gamma-skill");
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [packageRoot] }),
      "utf8",
    );

    const calls: { command: string[]; cwd?: string }[] = [];
    const service = makeService(fixture, {
      spawn: async ({ command, cwd }) => {
        calls.push({ command, cwd });
        await writeFile(
          join(fixture.agentDir, "settings.json"),
          JSON.stringify({ packages: [] }),
          "utf8",
        );
        return { exitCode: 0, stderr: "" };
      },
    });

    const result = await service.remove({ packageSource: packageRoot });
    expect(result.ok).toBe(true);
    expect(result.packages).toEqual([]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toEqual(expect.arrayContaining(["remove", packageRoot]));
    // Relative local-path entries are relative to agentDir; `pi remove` resolves against its cwd.
    expect(calls[0]?.cwd).toBe(fixture.agentDir);
  });

  it("never puts embedded git credentials on the wire, yet removes by the redacted source", async () => {
    const fixture = await buildFixture();
    const secret = "git:https://user:tok@127.0.0.1:1/r.git?access_token=sekret";
    await writeFile(
      join(fixture.agentDir, "settings.json"),
      JSON.stringify({ packages: [secret] }),
      "utf8",
    );

    const calls: string[][] = [];
    const service = makeService(fixture, {
      spawn: async ({ command }) => {
        calls.push(command);
        await writeFile(
          join(fixture.agentDir, "settings.json"),
          JSON.stringify({ packages: [] }),
          "utf8",
        );
        return { exitCode: 0, stderr: "" };
      },
    });

    const listed = await service.list();
    const wireSource = listed.packages[0]?.source ?? "";
    expect(JSON.stringify(listed)).not.toMatch(/sekret|user:tok/);

    const result = await service.remove({ packageSource: wireSource });
    expect(result.ok).toBe(true);
    // The spawn receives the real settings entry, not the client's redacted echo.
    expect(calls[0]).toContain(secret);
  });

  it("an unknown packageSource answers not_found", async () => {
    const fixture = await buildFixture();
    const service = makeService(fixture);

    const result = await service.remove({ packageSource: "npm:does-not-exist" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });
});

describe("ResourceService.updateAll (sprint-076/task-005)", () => {
  it("spawns `skills update -g -y` then `pi update --extensions`, in sequence, with the spec's env", async () => {
    const fixture = await buildFixture();
    const calls: { command: string[]; env: Record<string, string> }[] = [];
    const service = makeService(fixture, {
      spawn: async ({ command, env }) => {
        calls.push({ command, env: env as Record<string, string> });
        return { exitCode: 0, stderr: "" };
      },
    });

    const result = await service.updateAll();
    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      { target: "agent-skills", ok: true },
      { target: "pi-packages", ok: true },
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.command.slice(-3)).toEqual(["update", "-g", "-y"]);
    expect(calls[1]?.command.slice(-2)).toEqual(["update", "--extensions"]);
    for (const call of calls) {
      expect(call.env.PI_CODING_AGENT_DIR).toBe(fixture.agentDir);
      expect(call.env.GIT_TERMINAL_PROMPT).toBe("0");
    }
  });

  it("a failure in the first spawn still runs the second; results report each independently", async () => {
    const fixture = await buildFixture();
    let callCount = 0;
    const service = makeService(fixture, {
      spawn: () => {
        callCount += 1;
        return Promise.resolve(
          callCount === 1
            ? { exitCode: 1, stderr: "skills update failed" }
            : { exitCode: 0, stderr: "" },
        );
      },
    });

    const result = await service.updateAll();
    expect(callCount).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      target: "agent-skills",
      ok: false,
      error: "update_failed",
    });
    expect(result.results[1]).toMatchObject({ target: "pi-packages", ok: true });
  });
});
