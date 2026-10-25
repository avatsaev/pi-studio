import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the pinned `skills` CLI (sprint-076/task-002) and builds its argv/env for each
 * operation (`add`, `remove`, `update`). Mirrors `resolveBundledPiCli()`
 * (`agent/providers/pi/rpc-transport.ts`): the bin path is read from the dependency's own
 * `package.json` `bin`, never hardcoded, so a future `skills` release that moves its entrypoint
 * fails loudly instead of silently falling back to a stale path.
 *
 * `skills` 1.7.4 declares `bin: {skills: "./bin/cli.mjs", "add-skill": "./bin/cli.mjs"}` and no
 * `exports`/`main` (spawn-only package — see swe/architecture/pi-resource-management.md § Ground
 * truth). `skills` is the canonical bin name; `resolveSkillsCli()` prefers it, falling back to
 * `add-skill` only if `skills` isn't declared.
 */

const PREFERRED_BIN_NAMES = ["skills", "add-skill"] as const;

function resolveSkillsCliInPackage(root: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    if (typeof manifest.bin === "string") {
      return join(root, manifest.bin);
    }
    if (manifest.bin && typeof manifest.bin === "object") {
      for (const name of PREFERRED_BIN_NAMES) {
        const declared = manifest.bin[name];
        if (declared) return join(root, declared);
      }
    }
  } catch {
    // Unreadable/malformed manifest — fall through to null.
  }
  return null;
}

/**
 * Resolve the `skills` CLI bundled as a pinned `packages/server` dependency. Returns `null` if the
 * package isn't present (should never happen once installed — `skills` is a hard dependency, not
 * optional, unlike the bundled `pi` CLI).
 */
export function resolveSkillsCli(): string | null {
  // 1) ESM resolution — works in the compiled daemon (real `node` ESM).
  try {
    const manifestPath = fileURLToPath(import.meta.resolve("skills/package.json"));
    const cli = resolveSkillsCliInPackage(dirname(manifestPath));
    if (cli) return cli;
  } catch {
    // `import.meta.resolve` may be unavailable under some loaders (e.g. vitest); fall through.
  }
  // 2) Walk up from cwd looking for the dependency in node_modules (loader-independent).
  const rel = join("node_modules", "skills");
  let dir = process.cwd();
  for (;;) {
    const cli = resolveSkillsCliInPackage(join(dir, rel));
    if (cli) return cli;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type SkillsOp = "add" | "remove" | "update";

/**
 * Build the argv (minus `[node, cli]`) for one `skills` operation.
 *
 * - `add`: `<src> -g -a pi -y -s <names…>` — universal agent `pi`, non-interactive, picked names.
 *   The source MUST precede `-s`: `-s` is variadic and swallows a trailing source, so the CLI
 *   fails with "Missing required argument: source" (found live in sprint-076/task-008).
 * - `remove`: `-g -y <name>` — **never `-a`**: passing `-a pi` to `remove` keeps the canonical copy
 *   if any other detected agent still links it, which would leave Pi-Studio's own remove silently
 *   no-op the deletion it promised.
 * - `update`: `-g -y` — reinstalls every outdated global skill.
 */
export function skillsArgv(op: "add", src: string, names: string[]): string[];
export function skillsArgv(op: "remove", name: string): string[];
export function skillsArgv(op: "update"): string[];
export function skillsArgv(op: SkillsOp, a?: string, b?: string[]): string[] {
  switch (op) {
    case "add": {
      const src = a as string;
      const names = b as string[];
      return ["add", src, "-g", "-a", "pi", "-y", "-s", ...names];
    }
    case "remove": {
      const name = a as string;
      return ["remove", "-g", "-y", name];
    }
    case "update":
      return ["update", "-g", "-y"];
  }
}

/** Default clone timeout the `skills` CLI itself uses (`SKILLS_CLONE_TIMEOUT_MS`, 300 000 ms). */
const DEFAULT_SKILLS_CLONE_TIMEOUT_MS = 300_000;

/**
 * Spawn environment for a `skills` CLI invocation. `cloneTimeoutMs` must stay below the caller's
 * own item timeout (600 s for install/remove, 1 300 s for update_all) so the CLI's own clone
 * deadline fires before the daemon's spawn-kill does, surfacing a useful `stderr` tail instead of
 * a bare `timeout`.
 */
export function spawnEnv(
  agentDir: string,
  cloneTimeoutMs: number = DEFAULT_SKILLS_CLONE_TIMEOUT_MS,
): Record<string, string> {
  return {
    PI_CODING_AGENT_DIR: agentDir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    npm_config_yes: "true",
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    SKILLS_CLONE_TIMEOUT_MS: String(cloneTimeoutMs),
  };
}
