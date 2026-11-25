import { readFile, rm } from "node:fs/promises";
import { z } from "zod";

import type {
  DaemonUpdateInstallKind,
  DaemonUpdateState,
  DaemonUpdateStatus,
} from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import { atomicWriteJson } from "../persistence/atomic-store.js";
import { redactSource } from "../resources/spawn-runner.js";
import { RELEASES_PAGE } from "./binary-manifest.js";
import type { CannotUpdateReason } from "./install-kind.js";
import { updateBlocker } from "./install-kind.js";
import { compareVersions } from "./npm.js";

type InstallFailureCode = Extract<DaemonUpdateState, { kind: "failed" }>["code"];

/**
 * Daemon self-update state machine (features/self-update.md § Check, § Apply). Memory-only state,
 * a 6 h check timer, a check when a client connects (`checkIfStale`), single flight, and an injected
 * apply pipeline. Every probe (npm, filesystem, clock, timer, platform) is an injected seam so each
 * path is tested without npm. The install, the helper and the restart are the pipeline's job
 * (`createUpdatePipeline`).
 */

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * A client that connects (`hello` done) starts an automatic check, unless the last attempt, successful
 * or not, is younger than this (`UpdateService.checkIfStale`).
 */
export const UPDATE_CONNECT_CHECK_MIN_AGE_MS = 10 * 60_000;

export const UPDATE_RESULT_FILE = "update-result.json";
export const UPDATE_SKIP_FILE = "update-skip.json";

/** Result the restart helper leaves for the next daemon start (`update-result.json`). */
const lastResultSchema = z.object({
  from: z.string(),
  to: z.string(),
  outcome: z.string(),
  at: z.number(),
  message: z.string().optional(),
});
export type UpdateLastResult = z.infer<typeof lastResultSchema>;

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

const NPM_COMMAND = "npm i -g @av-pi-studio/cli@latest && pi-studio daemon restart";

/** The line to run by hand for each reason a daemon cannot update itself. */
export const MANUAL_UPDATE_COMMANDS: Readonly<Record<CannotUpdateReason, string>> = {
  docker: "docker compose pull && docker compose up -d",
  source: "git pull && npm run build",
  unknown_install: NPM_COMMAND,
  npm_missing: NPM_COMMAND,
  not_writable: NPM_COMMAND,
  unsupported_platform: NPM_COMMAND,
  unmanaged_binary: RELEASES_PAGE,
};

/** Why a refused apply was refused (`daemon_update_apply_response.error`). */
export type ApplyRefusal = "in_progress" | "cannot_update" | "not_available";
export type ApplyResult = { ok: true } | { ok: false; error: ApplyRefusal };

/** Timer seam: the production one `unref()`s so a pending check never keeps the process alive. */
export interface UpdateTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const systemUpdateTimer: UpdateTimer = {
  set: (fn, ms) => {
    const handle = setInterval(fn, ms);
    handle.unref();
    return handle;
  },
  clear: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** Moves the apply forward. The pipeline reports each stage through it. */
export interface UpdatePipelineContext {
  /** The version being installed (`available.version` at apply time). */
  target: string;
  /** The version running now. */
  previous: string;
  /** Publish a new state: `installing`, `updating_extensions`, `restarting` or `failed`. */
  setState(state: DaemonUpdateState): void;
}

/**
 * The background work of an apply: install, extensions, helper, restart. A rejection is reported as
 * `failed(install)` with the error's message.
 */
export type UpdatePipeline = (context: UpdatePipelineContext) => Promise<void>;

/** The last 2048 characters of a failed command's output, with credentials in URLs removed. */
const FAILURE_MESSAGE_MAX = 2048;

/** How long the last broadcast gets to reach the sockets before the daemon shuts down. */
export const HANDOFF_PAUSE_MS = 300;

/** How the daemon looks for the helper's result after its own start (`watchForResult`). */
export const RESULT_POLL_MS = 500;
export const RESULT_WATCH_MS = 30_000;

export function failureMessage(err: unknown): string {
  const text = redactSource(err instanceof Error ? err.message : String(err)).trim();
  return text.length > FAILURE_MESSAGE_MAX ? text.slice(-FAILURE_MESSAGE_MAX) : text;
}

/**
 * The `failed` code of an install failure: `permission` (EACCES/EPERM), `timeout` (the install was
 * killed at its limit), `network`, else `install`.
 */
export function classifyInstallFailure(message: string): InstallFailureCode {
  if (/\b(EACCES|EPERM)\b/.test(message)) return "permission";
  if (/timed out after/i.test(message)) return "timeout";
  if (
    /\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b/.test(
      message,
    )
  ) {
    return "network";
  }
  return "install";
}

/** What the release channel answered: the newest version, or why it could not be read. */
type LatestLookup = { version: string; hasAsset: boolean } | { failure: "offline" | "bad_answer" };

/** What reading `latest.json` found (the binary's `fetchLatest`). */
export type BinaryManifestLookup =
  | { kind: "ok"; version: string; hasAsset: boolean }
  | { kind: "offline" }
  | { kind: "bad_answer" };

/** What the service asks of a binary install (`createBinaryUpdate`). */
export interface BinaryUpdateProbes {
  /** Reads `latest.json`: its version, and whether it has an archive for this system. */
  lookup(): Promise<BinaryManifestLookup>;
  /** The can-update rule: why this binary cannot replace itself, `null` when it can. */
  blocker(): Promise<"unmanaged_binary" | "not_writable" | null>;
}

/** Everything the apply pipeline does to the outside world; each is a seam. */
export interface UpdatePipelineDeps {
  /** `npm install -g <package>@<version>` (throws with npm's output on failure). */
  install(version: string): Promise<void>;
  /** `pi update --extensions`; throws on failure (logged, the update goes on). */
  updateExtensions(): Promise<void>;
  /** Starts the detached helper; throws when it cannot start (nothing was shut down yet). */
  spawnHelper(target: string, previous: string): void;
  /** The daemon's one shutdown (`DaemonHandle.close`). */
  shutdown(): Promise<void>;
  /** Ends the process; `undefined` when this daemon is embedded and does not own its process. */
  exit: ((code: number) => void) | undefined;
  /** Waits `ms` (default `setTimeout`). */
  pause?(ms: number): Promise<void>;
  logger?: Logger;
}

/**
 * The apply pipeline (features/self-update.md § Apply): install, extensions, helper, shutdown,
 * exit. An install failure ends in `failed` with the daemon still running and no restart (D11);
 * an extensions failure is logged and the update goes on (D8). Nothing runs between the install
 * and the exit but the extensions child process: the running daemon's files were replaced, and
 * code it has not loaded yet would come from the new version.
 */
export function createUpdatePipeline(deps: UpdatePipelineDeps): UpdatePipeline {
  const pause = deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async ({ target, previous, setState }) => {
    const exit = deps.exit;
    if (!exit) {
      setState({
        kind: "failed",
        version: target,
        code: "install",
        message: "This daemon does not own its process and cannot restart itself.",
      });
      return;
    }
    try {
      await deps.install(target);
    } catch (err) {
      const message = failureMessage(err);
      deps.logger?.warn({ target, message }, "update: install failed");
      setState({
        kind: "failed",
        version: target,
        code: classifyInstallFailure(message),
        message,
      });
      return;
    }
    setState({ kind: "updating_extensions", version: target });
    try {
      await deps.updateExtensions();
    } catch (err) {
      deps.logger?.warn({ err: failureMessage(err) }, "update: extensions update failed; going on");
    }
    setState({ kind: "restarting", version: target });
    try {
      deps.spawnHelper(target, previous);
    } catch (err) {
      const message = failureMessage(err);
      deps.logger?.error({ target, message }, "update: the restart helper did not start");
      setState({ kind: "failed", version: target, code: "install", message });
      return;
    }
    await pause(HANDOFF_PAUSE_MS);
    try {
      await deps.shutdown();
    } catch (err) {
      // The helper waits for this process to exit: leaving it running would stall the update.
      deps.logger?.error({ err: failureMessage(err) }, "update: shutdown failed; exiting anyway");
    }
    exit(0);
  };
}

export interface UpdateServiceDeps {
  currentVersion: string;
  /** Finds the install kind once, at `start()`. */
  detectInstallKind(): Promise<DaemonUpdateInstallKind>;
  /** `npm view`: the latest published version, `null` on any failure. */
  fetchLatest(): Promise<string | null>;
  /** A binary's release channel (`latest.json`); read instead of `fetchLatest` for that kind. */
  binary?: BinaryUpdateProbes;
  npmOnPath(): Promise<boolean>;
  /** `npm root -g`, `null` when unavailable. */
  globalFolder(): Promise<string | null>;
  canWriteGlobalFolder(folder: string | null): Promise<boolean>;
  platform: NodeJS.Platform;
  autoCheck: boolean;
  /** Reads and removes `update-result.json`; `undefined` when there is none or it was unreadable. */
  takeLastResult(): Promise<UpdateLastResult | undefined>;
  /** `update-skip.json` (D14); without one the skipped version lives in memory only. */
  skipStore?: UpdateSkipStore;
  /** Writes `daemon.update.autoCheck`; resolves the effective value (env may win). */
  persistAutoCheck(enabled: boolean): Promise<boolean>;
  /** Delivers a changed status to every session. */
  broadcast(status: DaemonUpdateStatus): void;
  pipeline: UpdatePipeline;
  now?: () => number;
  timer?: UpdateTimer;
  intervalMs?: number;
  /** Timer, poll interval and window of the result-file watch (defaults: system timer, 500 ms, 30 s). */
  resultTimer?: UpdateTimer;
  resultPollMs?: number;
  resultWatchMs?: number;
  logger?: Logger;
}

/** True while an apply owns the state: checks leave it alone and apply is refused. */
function isRunning(state: DaemonUpdateState): boolean {
  return (
    state.kind === "installing" ||
    state.kind === "updating_extensions" ||
    state.kind === "restarting"
  );
}

export class UpdateService {
  private installKind: DaemonUpdateInstallKind = "unknown";
  private autoCheck: boolean;
  private state: DaemonUpdateState = { kind: "idle" };
  private checkedAt: number | undefined;
  private checkError: string | undefined;
  private lastResult: UpdateLastResult | undefined;
  private timerHandle: unknown;
  private checking: Promise<DaemonUpdateStatus> | undefined;
  private applying: Promise<void> | undefined;
  private lastBroadcast = "";
  private closed = false;
  private probed: Promise<void> | undefined;
  private resultWatch: unknown;
  private skippedVersion: string | undefined;
  /** When the last check began, whoever asked and however it ended; `undefined` before the first. */
  private lastAttemptAt: number | undefined;
  /** The version the last automatic check offered, `undefined` after any other check outcome. */
  private automaticOffer: string | undefined;

  private readonly pipeline: UpdatePipeline;
  private readonly now: () => number;
  private readonly timer: UpdateTimer;
  private readonly intervalMs: number;
  private readonly resultTimer: UpdateTimer;
  private readonly resultPollMs: number;
  private readonly resultWatchMs: number;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.autoCheck = deps.autoCheck;
    this.pipeline = deps.pipeline;
    this.now = deps.now ?? Date.now;
    this.timer = deps.timer ?? systemUpdateTimer;
    this.intervalMs = deps.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
    this.resultTimer = deps.resultTimer ?? systemUpdateTimer;
    this.resultPollMs = deps.resultPollMs ?? RESULT_POLL_MS;
    this.resultWatchMs = deps.resultWatchMs ?? RESULT_WATCH_MS;
  }

  /** The current wire status. */
  status(): DaemonUpdateStatus {
    return {
      currentVersion: this.deps.currentVersion,
      installKind: this.installKind,
      autoCheck: this.autoCheck,
      ...(this.checkedAt !== undefined ? { checkedAt: this.checkedAt } : {}),
      ...(this.checkError !== undefined ? { checkError: this.checkError } : {}),
      state: this.state,
      ...(this.lastResult ? { lastResult: this.lastResult } : {}),
      ...(this.skippedVersion !== undefined ? { skippedVersion: this.skippedVersion } : {}),
    };
  }

  /** Resolves once the install kind and `lastResult` are known (status answers wait for it). */
  ready(): Promise<void> {
    return this.probe();
  }

  /**
   * After the daemon listens: finds the install kind, loads `lastResult`, then (when `autoCheck`)
   * checks once and starts the timer. Never throws; the caller does not await it.
   */
  async start(): Promise<void> {
    await this.probe();
    if (this.closed) return;
    this.emitIfChanged();
    if (this.lastResult === undefined) this.watchForResult();
    if (this.autoCheck) {
      this.startTimer();
      await this.check("automatic");
    }
  }

  /** Install kind and `lastResult`, found once; a check that races `start()` shares it. */
  private probe(): Promise<void> {
    this.probed ??= (async () => {
      try {
        this.installKind = await this.deps.detectInstallKind();
        this.lastResult = await this.deps.takeLastResult();
        this.skippedVersion = await this.deps.skipStore?.read();
        if (this.lastResult) await this.recordSkip(this.lastResult);
      } catch (err) {
        this.deps.logger?.warn({ err: (err as Error).message }, "update: start-up probe failed");
      }
    })();
    return this.probed;
  }

  /** Clears the timers. A check already in flight finishes silently. */
  close(): void {
    this.closed = true;
    this.stopTimer();
    this.stopResultWatch();
  }

  /**
   * The restart helper writes `update-result.json` only after it has seen this daemon answer with
   * the expected version, i.e. after the start-up read in `probe()` found nothing. Looks for the
   * file again for `resultWatchMs`; the first read takes it (read once, removed) and broadcasts.
   */
  private watchForResult(): void {
    if (this.resultWatch !== undefined) return;
    const startedAt = this.now();
    let reading = false;
    this.resultWatch = this.resultTimer.set(() => {
      if (reading || this.closed) return;
      reading = true;
      void this.deps
        .takeLastResult()
        .then(async (result) => {
          if (result) {
            await this.recordSkip(result);
            // Result and withdrawn offer land in the same step: no status shows one without the other.
            this.lastResult = result;
            this.withdrawSkippedOffer();
            this.stopResultWatch();
            this.emitIfChanged();
          } else if (this.now() - startedAt >= this.resultWatchMs) {
            this.stopResultWatch();
          }
        })
        .catch((err: unknown) => {
          this.deps.logger?.warn({ err: failureMessage(err) }, "update: result watch failed");
        })
        .finally(() => {
          reading = false;
        });
    }, this.resultPollMs);
  }

  /**
   * The helper writes its result once the rolled-back daemon answers, i.e. after this daemon's
   * start check: when that automatic check offered the very version the result says was rolled
   * back, the offer is taken back (an automatic check never offers a skipped version, D14). A
   * manual offer stays: the user asked.
   */
  private withdrawSkippedOffer(): void {
    const { state } = this;
    if (
      state.kind === "available" &&
      state.version === this.skippedVersion &&
      state.version === this.automaticOffer
    ) {
      this.state = { kind: "idle" };
    }
  }

  private stopResultWatch(): void {
    if (this.resultWatch === undefined) return;
    this.resultTimer.clear(this.resultWatch);
    this.resultWatch = undefined;
  }

  /** Resolves when a running apply pipeline has settled (tests, shutdown). */
  whenApplySettled(): Promise<void> {
    return this.applying ?? Promise.resolve();
  }

  /** Whether the check timer is armed. */
  get timerArmed(): boolean {
    return this.timerHandle !== undefined;
  }

  /**
   * Asks npm now. Single flight; a running update owns the state so the check is a no-op then.
   * A manual check broadcasts `checking`; an automatic one does not, and a failed automatic check
   * changes nothing a user sees (not even `checkedAt` or `checkError`).
   */
  check(by: "manual" | "automatic"): Promise<DaemonUpdateStatus> {
    if (isRunning(this.state)) return Promise.resolve(this.status());
    if (!this.checking) {
      this.checking = this.runCheck(by).finally(() => {
        this.checking = undefined;
      });
    }
    return this.checking;
  }

  /**
   * A client has connected: starts one automatic check (`check("automatic")`, so silent: no
   * `checking` state, a failure shows nothing, a skipped version is not offered) unless auto-check
   * is off, a check or an update is running, or the last attempt began less than
   * `UPDATE_CONNECT_CHECK_MIN_AGE_MS` ago. What the check finds reaches the session through the
   * broadcast. Resolves when the check has ended, at once when none was started.
   */
  async checkIfStale(): Promise<void> {
    if (this.closed || !this.autoCheck || this.checking || isRunning(this.state)) return;
    if (
      this.lastAttemptAt !== undefined &&
      this.now() - this.lastAttemptAt < UPDATE_CONNECT_CHECK_MIN_AGE_MS
    ) {
      return;
    }
    await this.check("automatic");
  }

  private async runCheck(by: "manual" | "automatic"): Promise<DaemonUpdateStatus> {
    this.lastAttemptAt = this.now();
    await this.probe();
    const before = this.state;
    if (by === "manual") {
      this.state = { kind: "checking" };
      this.emitIfChanged();
    }
    try {
      const found = await this.lookupLatest();
      if (isRunning(this.state)) return this.status();
      if ("failure" in found) {
        // Silent to every client for an automatic check; the log is the only trace of it.
        this.deps.logger?.info({ by, failure: found.failure }, "update: check found no release");
        this.state = before;
        if (by === "manual") {
          this.checkedAt = this.now();
          this.checkError = found.failure;
        }
      } else {
        await this.dropOlderSkip(found.version);
        const next = await this.resolveState(found.version, by, found.hasAsset);
        // An apply may have started while the probes ran: it owns the state now.
        if (isRunning(this.state)) return this.status();
        this.checkedAt = this.now();
        this.checkError = undefined;
        this.state = next;
        this.automaticOffer =
          by === "automatic" && next.kind === "available" ? next.version : undefined;
      }
    } catch (err) {
      this.deps.logger?.warn({ err: (err as Error).message }, "update: check failed");
      if (!isRunning(this.state)) this.state = before;
    }
    this.emitIfChanged();
    return this.status();
  }

  /** The version the release channel offers: npm's `latest`, or `latest.json` for a binary. */
  private async lookupLatest(): Promise<LatestLookup> {
    if (this.installKind === "binary") {
      const probes = this.deps.binary;
      if (!probes) {
        this.deps.logger?.warn("update: a binary install without manifest probes");
        return { failure: "offline" };
      }
      const found = await probes.lookup();
      return found.kind === "ok"
        ? { version: found.version, hasAsset: found.hasAsset }
        : { failure: found.kind };
    }
    const latest = await this.deps.fetchLatest();
    if (latest === null) return { failure: "offline" };
    return PLAIN_VERSION.test(latest)
      ? { version: latest, hasAsset: true }
      : { failure: "bad_answer" };
  }

  private async resolveState(
    latest: string,
    by: "manual" | "automatic",
    hasAsset: boolean,
  ): Promise<DaemonUpdateState> {
    // A repository checkout carries the committed version, which is only a floor under the
    // release's computed one (release.yml), so comparing it with the registry says nothing: never
    // offer an update there. A developer updates with `git pull`.
    if (this.installKind === "source") return { kind: "idle" };
    if (compareVersions(latest, this.deps.currentVersion) <= 0) return { kind: "idle" };
    if (by === "automatic" && latest === this.skippedVersion) return { kind: "idle" };
    const binary = this.installKind === "binary";
    const cannot = (reason: CannotUpdateReason): DaemonUpdateState => ({
      kind: "cannot_update",
      reason,
      version: latest,
      command: binary ? RELEASES_PAGE : MANUAL_UPDATE_COMMANDS[reason],
    });
    const blocker = updateBlocker(this.installKind, this.deps.platform);
    if (binary) {
      if (blocker !== null) return cannot(blocker);
      const probes = this.deps.binary;
      const unmanaged = probes ? await probes.blocker() : "unmanaged_binary";
      if (unmanaged !== null) return cannot(unmanaged);
      return hasAsset ? { kind: "available", version: latest } : cannot("unsupported_platform");
    }
    if (blocker !== null && blocker !== "unsupported_platform") return cannot(blocker);
    if (!(await this.deps.npmOnPath())) return cannot("npm_missing");
    if (!(await this.deps.canWriteGlobalFolder(await this.deps.globalFolder()))) {
      return cannot("not_writable");
    }
    if (blocker !== null) return cannot(blocker);
    return { kind: "available", version: latest };
  }

  /** Remembers a rolled-back or failed version (D14); every install kind. */
  private async recordSkip(result: UpdateLastResult): Promise<void> {
    if (result.outcome !== "rolled_back" && result.outcome !== "failed") return;
    if (!PLAIN_VERSION.test(result.to)) return;
    this.skippedVersion = result.to;
    try {
      await this.deps.skipStore?.write(result.to);
    } catch (err) {
      this.deps.logger?.warn({ err: failureMessage(err) }, "update: skip file not written");
    }
  }

  /** A version newer than the skipped one clears the skip. */
  private async dropOlderSkip(latest: string): Promise<void> {
    if (this.skippedVersion === undefined) return;
    if (compareVersions(latest, this.skippedVersion) <= 0) return;
    this.skippedVersion = undefined;
    try {
      await this.deps.skipStore?.clear();
    } catch (err) {
      this.deps.logger?.warn({ err: failureMessage(err) }, "update: skip file not removed");
    }
  }

  /** Refuses with `in_progress`, `cannot_update` or `not_available`; else runs the pipeline. */
  apply(): ApplyResult {
    const state = this.state;
    if (isRunning(state)) return { ok: false, error: "in_progress" };
    if (state.kind === "cannot_update") return { ok: false, error: "cannot_update" };
    if (state.kind !== "available") return { ok: false, error: "not_available" };

    const target = state.version;
    this.state = { kind: "installing", version: target };
    this.emitIfChanged();
    this.applying = this.runPipeline(target).finally(() => {
      this.applying = undefined;
    });
    return { ok: true };
  }

  private async runPipeline(target: string): Promise<void> {
    try {
      await this.pipeline({
        target,
        previous: this.deps.currentVersion,
        setState: (state) => {
          this.state = state;
          this.emitIfChanged();
        },
      });
    } catch (err) {
      this.deps.logger?.error({ err: (err as Error).message }, "update: pipeline failed");
      this.state = {
        kind: "failed",
        version: target,
        code: "install",
        message: (err as Error).message,
      };
      this.emitIfChanged();
    }
  }

  /** `daemon_update_set_auto_check_request`: persist, start or stop the timer, broadcast. */
  async setAutoCheck(enabled: boolean): Promise<DaemonUpdateStatus> {
    this.autoCheck = await this.deps.persistAutoCheck(enabled);
    if (this.closed) return this.status();
    if (this.autoCheck) this.startTimer();
    else this.stopTimer();
    this.emitIfChanged();
    return this.status();
  }

  private startTimer(): void {
    if (this.timerHandle !== undefined) return;
    this.timerHandle = this.timer.set(() => {
      void this.check("automatic");
    }, this.intervalMs);
  }

  private stopTimer(): void {
    if (this.timerHandle === undefined) return;
    this.timer.clear(this.timerHandle);
    this.timerHandle = undefined;
  }

  private emitIfChanged(): void {
    if (this.closed) return;
    const status = this.status();
    const serialized = JSON.stringify(status);
    if (serialized === this.lastBroadcast) return;
    this.lastBroadcast = serialized;
    this.deps.broadcast(status);
  }
}

/**
 * Reads and removes `update-result.json` once (P8). Missing → `undefined`; unreadable or malformed
 * → removed, logged, `undefined`.
 */
export async function readAndRemoveUpdateResult(
  path: string,
  logger?: Logger,
): Promise<UpdateLastResult | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    logger?.warn({ err: (err as Error).message, path }, "update: result file unreadable");
    await rm(path, { force: true });
    return undefined;
  }
  await rm(path, { force: true });
  try {
    return lastResultSchema.parse(JSON.parse(text));
  } catch (err) {
    logger?.warn({ err: (err as Error).message, path }, "update: result file malformed");
    return undefined;
  }
}

/** The one remembered version (`update-skip.json`, D14); `undefined` when none. */
export interface UpdateSkipStore {
  read(): Promise<string | undefined>;
  write(version: string): Promise<void>;
  clear(): Promise<void>;
}

const skipFileSchema = z.object({ version: z.string().regex(PLAIN_VERSION) });

/** `update-skip.json` store: written atomically; an unreadable or malformed file is removed and logged. */
export function createFileSkipStore(path: string, logger?: Logger): UpdateSkipStore {
  return {
    read: async () => {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        logger?.warn({ err: (err as Error).message, path }, "update: skip file unreadable");
        await rm(path, { force: true });
        return undefined;
      }
      try {
        return skipFileSchema.parse(JSON.parse(text)).version;
      } catch (err) {
        logger?.warn({ err: (err as Error).message, path }, "update: skip file malformed");
        await rm(path, { force: true });
        return undefined;
      }
    },
    write: (version) => atomicWriteJson(path, { version }, skipFileSchema),
    clear: () => rm(path, { force: true }),
  };
}
