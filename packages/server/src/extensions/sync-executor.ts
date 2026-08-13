import { spawn } from "node:child_process";

import treeKill from "tree-kill";

import type { PersistedConfig } from "../config/daemon-config.js";
import { resolveBundledPiCli } from "../agent/providers/pi/rpc-transport.js";
import type { Logger } from "../logging/logger.js";
import { SERVER_VERSION } from "./curated-packs.js";
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

/** Injectable process seam — tests pass a fake; production spawns the bundled pi. The seam owns
 *  the per-package timeout and the process-tree kill; the executor only interprets the result. */
export interface InstallSpawn {
  (args: { command: string[]; env: Record<string, string>; timeoutMs: number }): Promise<{
    exitCode: number | null;
    stderr: string;
    timedOut?: boolean;
  }>;
}

const INSTALL_TIMEOUT_MS = 180_000;
const STDERR_TAIL_MAX = 2048;

/** The production seam: spawns `command`, captures stderr (unbounded here — the executor bounds
 *  what it stores), and kills the whole process tree on timeout rather than just the direct child,
 *  so a `pi install` that itself forked a build/postinstall step doesn't linger. */
export const defaultInstallSpawn: InstallSpawn = ({ command, env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const [bin, ...args] = command;
    const child = spawn(bin as string, args, { env, stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) treeKill(child.pid, "SIGKILL", () => undefined);
      else child.kill("SIGKILL");
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stderr, timedOut });
    });
  });

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
  const attempts = (piHomeState.failures[action.identity]?.attempts ?? 0) + 1;
  piHomeState.failures[action.identity] = { source: action.source, reason, message, attempts, at };
  report.failures.push({
    identity: action.identity,
    source: action.source,
    pack: action.pack,
    reason,
    message,
  });
}

function deriveOutcome(report: Pick<SyncReport, "installed" | "failures">): SyncReport["outcome"] {
  if (report.failures.length === 0) return "ok";
  return report.installed.length > 0 ? "partial" : "failed";
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

export async function executePlan(
  plan: SyncPlan,
  deps: {
    home: string;
    /** State-file key for this pi-home (`effectivePiHomeKey(config)` — kept separate from the env
     *  derivation below so a caller mistake in this value can never redirect installs). */
    piHomeKey: string;
    config: PersistedConfig;
    spawn?: InstallSpawn;
    logger: Logger;
    now?: () => Date;
  },
): Promise<SyncReport> {
  const now = deps.now ?? (() => new Date());

  if (plan.actions.length === 0) {
    return { at: now().toISOString(), outcome: "noop", installed: [], failures: [] };
  }

  const cli = resolveBundledPiCli();
  if (!cli) {
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

  const spawnFn = deps.spawn ?? defaultInstallSpawn;
  // SAME derivation as the state key and the spawn path (features/preinstalled-extensions.md §
  // Public Contract — Effective pi-home key) — computed fresh from `config` rather than trusted
  // from `piHomeKey`, so this env var can never diverge from what a live agent would receive.
  const env: Record<string, string> = {
    ...processEnvSnapshot(),
    PI_CODING_AGENT_DIR: effectivePiHomeKey(deps.config),
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
    npm_config_yes: "true",
  };

  const report: SyncReport = { at: "", outcome: "ok", installed: [], failures: [] };

  for (const action of plan.actions) {
    const at = now().toISOString();
    try {
      const result = await spawnFn({
        command: [process.execPath, cli, "install", action.source],
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
        report.installed.push(action.identity);
        deps.logger.info(
          { identity: action.identity, source: action.source },
          "installed recommended extension",
        );
      } else {
        const reason = classify(result);
        const message =
          result.stderr.length > STDERR_TAIL_MAX
            ? result.stderr.slice(-STDERR_TAIL_MAX)
            : result.stderr;
        recordFailure(piHomeState, report, action, reason, message, at);
        deps.logger.warn(
          { identity: action.identity, source: action.source, reason },
          "failed to install recommended extension",
        );
      }
    } catch (error) {
      const reason = classify(error);
      const message = error instanceof Error ? error.message : String(error);
      recordFailure(piHomeState, report, action, reason, message, at);
      deps.logger.warn(
        { identity: action.identity, source: action.source, reason },
        "failed to install recommended extension",
      );
    } finally {
      await saveExtensionsState(deps.home, state);
    }
  }

  report.at = now().toISOString();
  report.outcome = deriveOutcome(report);
  return report;
}
