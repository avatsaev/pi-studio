/**
 * Unit tests for the pinned `skills` CLI resolution and argv/env builders (sprint-076/task-002).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveSkillsCli, skillsArgv, spawnEnv } from "./skills-cli.js";

describe("resolveSkillsCli", () => {
  it("returns the path declared in the installed package's own `bin` (like the Pi CLI test)", () => {
    const cli = resolveSkillsCli();
    expect(cli).toBeTruthy();
    expect(existsSync(cli as string)).toBe(true);

    // `import.meta.resolve` is unavailable under vitest (same caveat as `resolveBundledPiCli`'s
    // own test), so the expected root is located the same way `resolveSkillsCli`'s own fallback
    // does: walking up from cwd for `node_modules/skills`.
    const root = join(process.cwd(), "node_modules", "skills");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };
    expect(cli).toBe(join(root, manifest.bin.skills));
  });
});

describe("skillsArgv", () => {
  it("builds `add` argv: <src> first, then -g -a pi -y -s <names…> (-s is variadic)", () => {
    expect(skillsArgv("add", "owner/repo", ["foo", "bar"])).toEqual([
      "add",
      "owner/repo",
      "-g",
      "-a",
      "pi",
      "-y",
      "-s",
      "foo",
      "bar",
    ]);
  });

  it("builds `remove` argv: -g -y <name>, never -a", () => {
    const argv = skillsArgv("remove", "foo");
    expect(argv).toEqual(["remove", "-g", "-y", "foo"]);
    expect(argv).not.toContain("-a");
  });

  it("builds `update` argv: -g -y", () => {
    expect(skillsArgv("update")).toEqual(["update", "-g", "-y"]);
  });
});

describe("spawnEnv", () => {
  it("sets the required env vars with the default clone timeout", () => {
    expect(spawnEnv("/tmp/agent-dir")).toEqual({
      PI_CODING_AGENT_DIR: "/tmp/agent-dir",
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
      npm_config_yes: "true",
      DISABLE_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      SKILLS_CLONE_TIMEOUT_MS: "300000",
    });
  });

  it("accepts an explicit clone timeout below the caller's item timeout", () => {
    expect(spawnEnv("/tmp/agent-dir", 500_000).SKILLS_CLONE_TIMEOUT_MS).toBe("500000");
  });
});
