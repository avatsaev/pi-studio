import type { PersistedConfig } from "../config/daemon-config.js";
import type { Logger } from "../logging/logger.js";
import { redactSource } from "../resources/spawn-runner.js";
import { piCommand } from "../runtime/self.js";
import { SERVER_VERSION } from "../version.js";
import {
  effectivePiHomeKey,
  loadExtensionsState,
  saveExtensionsState,
  type PiHomeState,
} from "./extensions-state.js";
import type { SyncPlan } from "./sync-planner.js";

/**
 * Runs a `SyncPlan` by spawning `pi install <spec>` per action, one package succeeding or failing
 * never affecting another (swe/features/preinstalled-extensions.md § Executor — tenet 5). Every
 * planned action is attempted regardless of how many earlier ones failed; state is committed after
 * **each** action so a crash mid-sync loses neither the successes already achieved nor the failure
 * diagnostics already gathered.
 */

export type ExtensionFailureReason =
  | "not_found"
  | "unauthorized"
  | "network"
  | "timeout"
  | "install_failed"
  | "spawn_failed"
  | "unknown";

export interface SyncReport {
  at: string;
  outcome: "ok" | "noop" | "partial" | "failed" | "skipped";
  installed: string[];
  failures: {
    identity: string;
    source: string;
    pack: string;
    reason: ExtensionFailureReason;
    message: string;
  }[];
}

/** Injectable process seam — tests pass a fake; production spawns the bundled pi through the
 *  daemon's `InstallProcesses` (`install-processes.ts`), which owns the per-package timeout, the
 *  process-tree kill and the stop at shutdown. The executor only interprets the result. */
export interface InstallSpawn {
  (args: {
    command: string[];
    env: Record<string, string>;
    timeoutMs: number;
    /** Working directory for the child; omitted = the daemon's own cwd. */
    cwd?: string;
  }): Promise<InstallSpawnResult>;
}

export interface InstallSpawnResult {
  exitCode: number | null;
  /** The tail of stderr (bounded by the seam), raw: every consumer redacts before it stores, logs
   *  or sends any of it. */
  stderr: string;
  /** Tail of stdout (bounded). Only the `skills` CLI needs it — it reports failures there. */
  stdout?: string;
  timedOut?: boolean;
}

const INSTALL_TIMEOUT_MS = 180_000;
const STDERR_TAIL_MAX = 2048;

/** Maps a spawn result (non-zero exit / timeout) or a caught throw to the reason taxonomy.
 *  Best-effort and cosmetic — misclassification never affects whether the run continues, whether
 *  other packages are attempted, or whether the entry is retried later (all three unconditional). */
export function classify(input: unknown): ExtensionFailureReason {
  if (input && typeof input === "object" && "exitCode" in input) {
    if ("timedOut" in input && input.timedOut === true) return "timeout";
    const stderr = "stderr" in input && typeof input.stderr === "string" ? input.stderr : "";
    if (/\b404\b|E404/.test(stderr)) return "not_found";
    if (/\b40[13]\b|E40[13]/.test(stderr)) return "unauthorized";
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|\b5\d\d\b/.test(stderr)) return "network";
    return "install_failed";
  }
  const message = input instanceof Error ? input.message : String(input);
  return /ENOENT/.test(message) ? "spawn_failed" : "unknown";
}

function recordFailure(
  piHomeState: PiHomeState,
  report: SyncReport,
  action: { identity: string; pack: string; source: string },
  reason: ExtensionFailureReason,
  message: string,
  at: string,
): void {
  // The state key stays the raw identity (the planner looks failures up by it); everything stored
  // as a value, and the report that goes to clients, carries only redacted text.
  const source = redactSource(action.source);
  const attempts = (piHomeState.failures[action.identity]?.attempts ?? 0) + 1;
  piHomeState.failures[action.identity] = { source, reason, message, attempts, at };
  report.failures.push({
    identity: redactSource(action.identity),
    source,
    pack: action.pack,
    reason,
    message,
  });
}

function deriveOutcome(report: Pick<SyncReport, "installed" | "failures">): SyncReport["outcome"] {
  if (report.failures.length === 0) return "ok";
  return report.installed.length > 0 ? "partial" : "failed";
}

/** What a failure keeps of a child's output or a thrown error: credential-redacted FIRST (a cut
 *  could otherwise leave a credential's tail unrecognisable), then the last `STDERR_TAIL_MAX`. */
function failureText(text: string): string {
  return redactSource(text).slice(-STDERR_TAIL_MAX);
}

/** A `process.env` snapshot with `undefined` entries dropped, so callers get a plain
 *  `Record<string, string>` without an unchecked cast. */
function processEnvSnapshot(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * The environment every bundled-pi spawn gets. `PI_CODING_AGENT_DIR` uses the SAME derivation as the
 * state key and the spawn path (features/preinstalled-extensions.md § Public Contract — Effective
 * pi-home key), computed fresh from `config`, so it can never diverge from what a live agent
 * receives.
 */
function piSpawnEnv(config: PersistedConfig): Record<string, string> {
  return {
    ...processEnvSnapshot(),
    PI_CODING_AGENT_DIR: effectivePiHomeKey(config),
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
    npm_config_yes: "true",
  };
}

export async function executePlan(
  plan: SyncPlan,
  deps: {
    home: string;
    /** State-file key for this pi-home (`effectivePiHomeKey(config)` — kept separate from the env
     *  derivation below so a caller mistake in this value can never redirect installs). */
    piHomeKey: string;
    config: PersistedConfig;
    spawn: InstallSpawn;
    /** Aborted when the daemon stops: the run ends after the package in flight (whose child the
     *  seam kills), that package is not recorded as a failure, and `executePlan` rejects with the
     *  abort reason instead of returning a report. */
    signal?: AbortSignal;
    logger: Logger;
    now?: () => Date;
  },
): Promise<SyncReport> {
  const now = deps.now ?? (() => new Date());

  if (plan.actions.length === 0) {
    return { at: now().toISOString(), outcome: "noop", installed: [], failures: [] };
  }

  // The launcher without its arguments: each action appends its own.
  const base = piCommand([]);
  if (!base) {
    deps.logger.warn("no bundled pi CLI resolvable — extensions sync skipped");
    return { at: now().toISOString(), outcome: "skipped", installed: [], failures: [] };
  }

  const loaded = await loadExtensionsState(deps.home);
  if (loaded === "unreadable") {
    deps.logger.error("extensions-state.json is unreadable — extensions sync skipped");
    return { at: now().toISOString(), outcome: "skipped", installed: [], failures: [] };
  }

  const state = loaded;
  const piHomeState: PiHomeState = state.piHomes[deps.piHomeKey] ?? { offered: {}, failures: {} };
  state.piHomes[deps.piHomeKey] = piHomeState;

  const env = piSpawnEnv(deps.config);

  const report: SyncReport = { at: "", outcome: "ok", installed: [], failures: [] };

  for (const action of plan.actions) {
    if (deps.signal?.aborted) break; // a stop between two packages: the next one is not started
    const at = now().toISOString();
    try {
      const result = await deps.spawn({
        command: [...base, "install", action.source],
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (result.exitCode === 0) {
        piHomeState.offered[action.identity] = {
          installedSpec: action.source,
          atVersion: SERVER_VERSION,
          at,
        };
        delete piHomeState.failures[action.identity];
        report.installed.push(redactSource(action.identity));
        deps.logger.info(
          { identity: redactSource(action.identity), source: redactSource(action.source) },
          "installed recommended extension",
        );
      } else {
        if (deps.signal?.aborted) break; // killed by the stop: not a verdict on the package
        const reason = classify(result);
        const message = failureText(result.stderr);
        recordFailure(piHomeState, report, action, reason, message, at);
        deps.logger.warn(
          { identity: redactSource(action.identity), source: redactSource(action.source), reason },
          "failed to install recommended extension",
        );
      }
    } catch (error) {
      if (deps.signal?.aborted) break; // the seam refused or lost the child at the stop
      const reason = classify(error);
      const message = failureText(error instanceof Error ? error.message : String(error));
      recordFailure(piHomeState, report, action, reason, message, at);
      deps.logger.warn(
        { identity: redactSource(action.identity), source: redactSource(action.source), reason },
        "failed to install recommended extension",
      );
    } finally {
      await saveExtensionsState(deps.home, state);
    }
  }

  deps.signal?.throwIfAborted();
  report.at = now().toISOString();
  report.outcome = deriveOutcome(report);
  return report;
}

/**
 * `pi update --extensions` through the same spawn seam and environment as the sync (the apply
 * pipeline's extensions step, features/self-update.md § Apply). Resolves when pi exits 0; throws
 * with the reason otherwise (no bundled pi, a spawn error, a timeout, a non-zero exit with its
 * stderr tail) — the caller decides that a failure is not fatal.
 */
export async function updateInstalledExtensions(deps: {
  config: PersistedConfig;
  spawn: InstallSpawn;
}): Promise<void> {
  const command = piCommand(["update", "--extensions"]);
  if (!command) throw new Error("no bundled pi CLI resolvable");
  const result = await deps.spawn({
    command,
    env: piSpawnEnv(deps.config),
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  if (result.timedOut === true) throw new Error("pi update --extensions timed out");
  if (result.exitCode !== 0) {
    throw new Error(
      `pi update --extensions exited ${result.exitCode}: ${failureText(result.stderr)}`,
    );
  }
}
