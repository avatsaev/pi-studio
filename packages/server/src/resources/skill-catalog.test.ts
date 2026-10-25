/**
 * Isolated-HOME fixture tests for `buildCatalog` (sprint-075/task-003). Every test constructs a
 * throwaway temp directory tree and points Pi's resolver at it via `agentDir`/`home` — never the
 * real `~/.pi`/`~/.agents` (`$HOME` is only ever reassigned to a temp dir, restored afterward).
 *
 * `process.env.HOME`/`PI_CODING_AGENT_DIR` must be set before `@earendil-works/pi-coding-agent`'s
 * module graph loads (it reads `$HOME` lazily inside `resolve()`, but the dynamic `import()` below
 * — mirroring `extensions/sync-executor.test.ts`'s pattern — removes any doubt). Each test then
 * reassigns `process.env.HOME` to its own fixture before calling `buildCatalog`, since Pi reads it
 * per-call (`getHomeDir()`), not once at import time.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const BOOTSTRAP_HOME = await mkdtemp(join(tmpdir(), "pi-studio-skill-catalog-bootstrap-"));
process.env.HOME = BOOTSTRAP_HOME;
process.env.PI_CODING_AGENT_DIR = join(BOOTSTRAP_HOME, "agent");

const { buildCatalog } = await import("./skill-catalog.js");

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
});

afterAll(async () => {
  await rm(BOOTSTRAP_HOME, { recursive: true, force: true });
});

/** `---\nname: ...\ndescription: ...\n---\n` frontmatter + a trivial body. */
function skillMd(name: string, description = `${name} description`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nBody for ${name}.\n`;
}

async function writeSkill(dir: string, name: string, description?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), skillMd(name, description), "utf8");
}

interface Fixture {
  home: string;
  agentDir: string;
}

/** One full fixture tree used by most tests below:
 *  - `<agentDir>/skills/alpha` — agent_dir origin, enabled
 *  - `~/.agents/skills/beta` — agents_dir origin, enabled
 *  - `<home>/pkgs/fake-pkg/skills/gamma` — a local-path "package" (no install/network needed;
 *    `DefaultPackageManager` treats any non-`npm:`/`git:` source as a local directory) — package
 *    origin, enabled
 *  - `<home>/extra/standalone` — referenced via an explicit `settings.skills` plain-path entry —
 *    settings_path origin, enabled
 *  - `<agentDir>/skills/dup-enabled-a` / `~/.agents/skills/dup-enabled-b`, both named
 *    `"dup-enabled"` — both enabled, agents_dir instance shadowed
 *  - `<agentDir>/skills/dup-disabled-a` / `~/.agents/skills/dup-disabled-b`, both named
 *    `"dup-disabled"` — the agents_dir instance individually disabled via a settings.skills
 *    pattern targeting only its own relative path; neither row gets `shadowedBy`
 *  - `<agentDir>/skills/linked` — a symlink to `<home>/link-target`
 *  - `npm:pi-web-access` package source — curated (core pack), not installed (no skills/network)
 */
async function buildFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "pi-studio-skill-catalog-"));
  const agentDir = join(home, "pi-agent");
  await mkdir(agentDir, { recursive: true });

  await writeSkill(join(agentDir, "skills", "alpha"), "alpha-skill");
  await writeSkill(join(home, ".agents", "skills", "beta"), "beta-skill");

  const packageRoot = join(home, "pkgs", "fake-pkg");
  await writeSkill(join(packageRoot, "skills", "gamma"), "gamma-skill");

  await writeSkill(join(home, "extra", "standalone"), "standalone-skill");

  await writeSkill(join(agentDir, "skills", "dup-enabled-a"), "dup-enabled");
  await writeSkill(join(home, ".agents", "skills", "dup-enabled-b"), "dup-enabled");

  await writeSkill(join(agentDir, "skills", "dup-disabled-a"), "dup-disabled");
  await writeSkill(join(home, ".agents", "skills", "dup-disabled-b"), "dup-disabled");

  const linkTarget = join(home, "link-target");
  await writeSkill(linkTarget, "linked-skill");
  await symlink(linkTarget, join(agentDir, "skills", "linked"), "dir");

  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify(
      {
        packages: [packageRoot, "npm:pi-web-access"],
        skills: [
          join(home, "extra", "standalone"),
          // Disables only the agents_dir "dup-disabled" instance: its relative pattern
          // (relative to `~/.agents`) is "skills/dup-disabled-b/SKILL.md", distinct from the
          // agent_dir instance's "skills/dup-disabled-a/SKILL.md".
          "-skills/dup-disabled-b/SKILL.md",
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  return { home, agentDir };
}

function lockPathFor(home: string): string {
  return join(home, ".agents", ".skill-lock.json");
}

describe("buildCatalog — isolated-HOME fixture", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture();
  });

  afterAll(async () => {
    await rm(fixture.home, { recursive: true, force: true });
  });

  function run() {
    process.env.HOME = fixture.home;
    process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
    return buildCatalog({
      agentDir: fixture.agentDir,
      home: fixture.home,
      lockPath: lockPathFor(fixture.home),
    });
  }

  it("each origin resolves with the right origin and enabled state", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byName = new Map(result.skills.map((s) => [s.name, s]));

    const alpha = byName.get("alpha-skill");
    expect(alpha?.origin).toBe("agent_dir");
    expect(alpha?.originLabel).toBe("Pi skills");
    expect(alpha?.enabled).toBe(true);
    expect(alpha?.removable).toBe(true);

    const beta = byName.get("beta-skill");
    expect(beta?.origin).toBe("agents_dir");
    expect(beta?.originLabel).toBe("Agent Skills");
    expect(beta?.enabled).toBe(true);
    expect(beta?.removable).toBe(true);

    const gamma = byName.get("gamma-skill");
    expect(gamma?.origin).toBe("package");
    expect(gamma?.enabled).toBe(true);
    expect(gamma?.removable).toBe(false);
    expect(gamma?.packageSource).toBe(join(fixture.home, "pkgs", "fake-pkg"));

    const standalone = byName.get("standalone-skill");
    expect(standalone?.origin).toBe("settings_path");
    expect(standalone?.originLabel).toBe("Skill paths");
    expect(standalone?.enabled).toBe(true);
    expect(standalone?.removable).toBe(true);
  });

  it("an enabled duplicate name: the agents_dir loser has shadowedBy = the agent_dir winner's path", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dupEnabled = result.skills.filter((s) => s.name === "dup-enabled");
    expect(dupEnabled).toHaveLength(2);
    const winner = dupEnabled.find((s) => s.origin === "agent_dir");
    const loser = dupEnabled.find((s) => s.origin === "agents_dir");
    expect(winner?.shadowedBy).toBeUndefined();
    expect(loser?.shadowedBy).toBe(winner?.path);
  });

  it("a disabled duplicate shadows nothing: neither row gets shadowedBy", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dupDisabled = result.skills.filter((s) => s.name === "dup-disabled");
    expect(dupDisabled).toHaveLength(2);
    const enabledOne = dupDisabled.find((s) => s.origin === "agent_dir");
    const disabledOne = dupDisabled.find((s) => s.origin === "agents_dir");
    expect(enabledOne?.enabled).toBe(true);
    expect(disabledOne?.enabled).toBe(false);
    expect(enabledOne?.shadowedBy).toBeUndefined();
    expect(disabledOne?.shadowedBy).toBeUndefined();
  });

  it("a symlinked skill dir reports symlinkTarget", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const linked = result.skills.find((s) => s.name === "linked-skill");
    expect(linked?.origin).toBe("agent_dir");
    expect(linked?.symlinkTarget).toBe(join(fixture.home, "link-target"));
  });

  it("a curated package (identity in CURATED_PACKS) reports curated: true", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const curated = result.packages.find((p) => p.source === "npm:pi-web-access");
    expect(curated).toBeDefined();
    expect(curated?.kind).toBe("npm");
    expect(curated?.identity).toBe("pi-web-access");
    expect(curated?.curated).toBe(true);
    expect(curated?.pinned).toBe(false);

    const local = result.packages.find((p) => p.source === join(fixture.home, "pkgs", "fake-pkg"));
    expect(local).toBeDefined();
    expect(local?.kind).toBe("local");
    expect(local?.curated).toBe(false);
    expect(local?.skillCount).toBe(1);
  });
});

describe("buildCatalog — corrupt settings.json", () => {
  it("returns settings_unreadable and never rewrites the file", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-studio-skill-catalog-corrupt-"));
    try {
      const agentDir = join(home, "pi-agent");
      await mkdir(agentDir, { recursive: true });
      const corruptContent = "{ not valid json";
      await writeFile(join(agentDir, "settings.json"), corruptContent, "utf8");

      process.env.HOME = home;
      process.env.PI_CODING_AGENT_DIR = agentDir;

      const result = await buildCatalog({
        agentDir,
        home,
        lockPath: lockPathFor(home),
      });

      expect(result).toEqual({ ok: false, error: "settings_unreadable" });

      const { readFile } = await import("node:fs/promises");
      const after = await readFile(join(agentDir, "settings.json"), "utf8");
      expect(after).toBe(corruptContent);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("a missing settings.json is not corrupt — empty catalog, ok: true", async () => {
    const home = await mkdtemp(join(tmpdir(), "pi-studio-skill-catalog-missing-"));
    try {
      const agentDir = join(home, "pi-agent");
      await mkdir(agentDir, { recursive: true });

      process.env.HOME = home;
      process.env.PI_CODING_AGENT_DIR = agentDir;

      const result = await buildCatalog({
        agentDir,
        home,
        lockPath: lockPathFor(home),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.skills).toEqual([]);
      expect(result.packages).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
