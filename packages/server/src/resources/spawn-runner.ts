import type { InstallSpawn } from "../extensions/sync-executor.js";

/**
 * Shared spawn seam for skills-manager mutations (install/remove/update_all — tasks 004/005/077),
 * reusing `InstallSpawn`'s injectable child-process seam (`extensions/sync-executor.ts`) so tests
 * fake the exact same shape `ExtensionsService`'s sync executor already does, plus the credential
 * redaction every logged source/stderr tail and wire `source`/`sourceUrl` field goes through
 * (swe/architecture/pi-resource-management.md § Spawn environment, § Redaction & logging, D29).
 */

/** stderr tail bound shared with `sync-executor.ts`'s own (unexported) `STDERR_TAIL_MAX` — kept
 *  as an independent local constant since the two call sites don't share a module. */
const STDERR_TAIL_MAX = 2048;

export interface SpawnOutcome {
  ok: boolean;
  /** Set only when the process never produced an exit code (`spawn_failed`) or was killed for
   *  running past `timeoutMs` (`timeout`). A plain nonzero exit leaves this `undefined` — callers
   *  map that case to their own domain reason (`install_failed`/`remove_failed`/`update_failed`). */
  error?: "spawn_failed" | "timeout";
  exitCode: number | null;
  /** Bounded to `STDERR_TAIL_MAX` bytes and credential-redacted (redacted *before* truncation —
   *  truncating first could cut a credential mid-string and leave a partial, unredacted tail). */
  stderr: string;
}

/**
 * Runs `command` through the injected `InstallSpawn` seam, translating its result (or a thrown
 * `spawn` error — e.g. ENOENT) into the `skills_*` error taxonomy. The seam itself owns the
 * per-call timeout and process-tree kill (`sync-executor.ts`'s `defaultInstallSpawn`); this
 * function only interprets the outcome.
 */
export async function runSpawn(
  spawn: InstallSpawn,
  command: string[],
  env: Record<string, string>,
  timeoutMs: number,
  cwd?: string,
): Promise<SpawnOutcome> {
  let result: { exitCode: number | null; stderr: string; timedOut?: boolean };
  try {
    result = await spawn({ command, env, timeoutMs, cwd });
  } catch {
    return { ok: false, error: "spawn_failed", exitCode: null, stderr: "" };
  }

  const stderr = redactSource(result.stderr).slice(0, STDERR_TAIL_MAX);
  if (result.timedOut) return { ok: false, error: "timeout", exitCode: result.exitCode, stderr };
  return { ok: result.exitCode === 0, exitCode: result.exitCode, stderr };
}

/**
 * Strips `user[:password]@` from URL-like substrings and masks `token`/`access_token` query
 * values. Applied to logs, stderr tails, and every wire `source`/`sourceUrl`
 * (architecture doc § Redaction & logging, D29). Pure.
 */
export function redactSource(source: string): string {
  const withoutUserinfo = source.replace(/:\/\/[^@/\s]*@/g, "://");
  return withoutUserinfo.replace(/([?&](?:access_)?token=)[^&\s]*/gi, "$1***");
}

/**
 * `process.env` with `undefined` entries dropped, so a spawn's `env` can be built as
 * `{...processEnvSnapshot(), ...spawnEnv(agentDir)}` — the child still sees `PATH` etc. (needed to
 * find `git`/`node`) while the skills-manager overrides win. Mirrors
 * `extensions/sync-executor.ts`'s own unexported helper of the same name/shape; kept as an
 * independent local copy since the two call sites don't share a module (same precedent as
 * `STDERR_TAIL_MAX` above).
 */
export function processEnvSnapshot(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
