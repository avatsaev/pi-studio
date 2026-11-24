import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { SUBCOMMAND } from "../runtime/self.js";
import {
  currentExecutable,
  pruneVersions as pruneVersionFolders,
  switchCurrent as switchCurrentLink,
} from "./binary-layout.js";
import {
  HELPER_EXIT_WAIT_MS,
  HELPER_HEALTH_WAIT_MS,
  HELPER_TRIES,
  type HelperParams,
  type HelperResult,
  type HelperSpawn,
  type StartedDaemon,
} from "./helper.js";
import { waitForProcessExit } from "./process-wait.js";
import { UPDATE_RESULT_FILE } from "./update-service.js";

/**
 * The binary's update helper (features/self-update.md § The helper, Binary helper): the new
 * binary's `__update-helper <json>`, started detached before the old daemon shuts down. It waits for
 * the old daemon to exit, switches `bin/current` to the target, starts that daemon (three tries,
 * each checked on `/api/health` for the target version), and when none answers switches back and
 * starts the previous version. The outcome is left in `update-result.json` exactly like the npm
 * helper's, so the daemon's skip logic applies; after `updated` every version folder but the target
 * and the previous one is removed.
 *
 * Every side effect is a seam (`BinaryHelperSeams`); `realBinaryHelperSeams` is the thin layer over
 * the filesystem and processes.
 */

export interface BinaryHelperSeams {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** One line of `logs/update-restart.log`. */
  log(line: string): void;
  /** Resolves `true` once `pid` is gone, `false` after `timeoutMs`. */
  waitForExit(pid: number, timeoutMs: number): Promise<boolean>;
  /** `bin/current` → `versions/<version>`; throws (leaving the link as it was) when that fails. */
  switchCurrent(version: string): Promise<void>;
  /** Starts `bin/current/pi-studio`'s daemon detached; throws when it cannot spawn. */
  startDaemon(): StartedDaemon;
  /** The `version` `/api/health` answers with, `null` when it does not answer. */
  healthVersion(): Promise<string | null>;
  writeResult(result: HelperResult): void | Promise<void>;
  /** Removes every version folder not in `keep`. */
  pruneVersions(keep: readonly string[]): Promise<void>;
}

const HEALTH_POLL_MS = 250;
const MESSAGE_MAX = 2048;

function tail(text: string): string {
  return text.length > MESSAGE_MAX ? text.slice(text.length - MESSAGE_MAX) : text;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function waitForVersion(
  version: string,
  proc: StartedDaemon,
  seams: BinaryHelperSeams,
): Promise<boolean> {
  const deadline = seams.now() + HELPER_HEALTH_WAIT_MS;
  for (;;) {
    if ((await seams.healthVersion()) === version) return true;
    if (proc.hasExited()) return false;
    if (seams.now() >= deadline) return false;
    await seams.sleep(HEALTH_POLL_MS);
  }
}

/** Switches `current` to `version`, then up to three tries of start + health. */
async function switchAndVerify(version: string, seams: BinaryHelperSeams): Promise<boolean> {
  try {
    await seams.switchCurrent(version);
  } catch (err) {
    seams.log(`cannot switch current to ${version}: ${errorText(err)}`);
    return false;
  }
  seams.log(`current -> versions/${version}`);
  for (let attempt = 1; attempt <= HELPER_TRIES; attempt++) {
    const label = `start ${version}, try ${attempt}/${HELPER_TRIES}: `;
    let proc: StartedDaemon;
    try {
      proc = seams.startDaemon();
    } catch (err) {
      seams.log(`${label}cannot start the daemon: ${errorText(err)}`);
      continue;
    }
    seams.log(`${label}started (pid ${proc.pid})`);
    if (await waitForVersion(version, proc, seams)) {
      seams.log(`${label}answers with version ${version}`);
      return true;
    }
    seams.log(
      `${label}${
        proc.hasExited()
          ? "the daemon exited"
          : `no answer with version ${version} within ${HELPER_HEALTH_WAIT_MS / 1000} s`
      }; stopping it`,
    );
    await proc.stop();
  }
  return false;
}

async function finish(
  params: HelperParams,
  seams: BinaryHelperSeams,
  outcome: HelperResult["outcome"],
  message?: string,
): Promise<HelperResult> {
  const result: HelperResult = {
    from: params.previous,
    to: params.target,
    outcome,
    at: seams.now(),
    ...(message ? { message } : {}),
  };
  await seams.writeResult(result);
  seams.log(`update ${outcome}${message ? `: ${message}` : ""}`);
  return result;
}

/** The whole helper; resolves with the result it wrote. */
export async function runBinaryHelper(
  params: HelperParams,
  seams: BinaryHelperSeams,
): Promise<HelperResult> {
  seams.log(
    `update helper: ${params.previous} -> ${params.target}, old pid ${params.oldPid}, listen ${params.listen}`,
  );
  const gone = await seams.waitForExit(params.oldPid, HELPER_EXIT_WAIT_MS);
  seams.log(
    gone
      ? "the old daemon exited"
      : `the old daemon is still running after ${HELPER_EXIT_WAIT_MS / 1000} s; going on`,
  );

  if (await switchAndVerify(params.target, seams)) {
    const result = await finish(params, seams, "updated");
    try {
      await seams.pruneVersions([params.target, params.previous]);
    } catch (err) {
      seams.log(`old versions not removed: ${errorText(err)}`);
    }
    return result;
  }

  seams.log(`the new version ${params.target} does not start; going back to ${params.previous}`);
  if (await switchAndVerify(params.previous, seams)) {
    return finish(
      params,
      seams,
      "rolled_back",
      `${params.target} did not start on ${params.listen}; back on ${params.previous}.`,
    );
  }
  const command = "Run pi-studio daemon start to start it.";
  const result = await finish(
    params,
    seams,
    "failed",
    tail(`Neither ${params.target} nor ${params.previous} started. ${command}`),
  );
  seams.log(`The daemon is not running. ${command}`);
  return result;
}

const paramsSchema = z.object({
  oldPid: z.number().int().positive(),
  target: z.string().min(1),
  previous: z.string().min(1),
  listen: z.string().regex(/^.+:\d+$/),
  home: z.string().min(1),
  packageName: z.string(),
});

/** `__update-helper`'s JSON argument; throws a readable error when it is not `HelperParams`. */
export function parseHelperParams(json: string | undefined): HelperParams {
  if (json === undefined) throw new Error(`${SUBCOMMAND.updateHelper}: missing JSON argument`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${SUBCOMMAND.updateHelper}: the argument is not valid JSON`);
  }
  const result = paramsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `${SUBCOMMAND.updateHelper}: ${result.error.issues[0]?.message ?? "bad argument"}`,
    );
  }
  return result.data;
}

/** `http://host:port/api/health` of a `host:port` listen address (a wildcard host is local). */
export function healthUrlOf(listen: string): string {
  const idx = listen.lastIndexOf(":");
  let host = listen.slice(0, idx);
  const port = listen.slice(idx + 1);
  if (host === "" || host === "0.0.0.0" || host === "::" || host === "[::]") host = "127.0.0.1";
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `http://${host}:${port}/api/health`;
}

/** Process seams of `realBinaryHelperSeams`; tests replace them. */
export interface BinaryHelperEnvironment {
  spawn: HelperSpawn;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
}

const REAL_ENVIRONMENT: BinaryHelperEnvironment = {
  spawn,
  env: process.env,
  fetch,
};

const STOP_GRACE_MS = 5_000;

function sleepMs(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Real seams over the filesystem and processes. */
export function realBinaryHelperSeams(
  params: HelperParams,
  environment: BinaryHelperEnvironment = REAL_ENVIRONMENT,
): BinaryHelperSeams {
  const { home } = params;
  const logDir = join(home, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, "update-restart.log");
  return {
    now: Date.now,
    sleep: sleepMs,
    log: (line) => appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`),
    waitForExit: (pid, timeoutMs) => waitForProcessExit(pid, { timeoutMs, pollMs: 100 }),
    switchCurrent: (version) => switchCurrentLink(home, version),
    startDaemon: () => {
      const idx = params.listen.lastIndexOf(":");
      const opts = {
        host: params.listen.slice(0, idx),
        port: Number(params.listen.slice(idx + 1)),
        home,
      };
      const child = environment.spawn(
        currentExecutable(home),
        [SUBCOMMAND.daemon, JSON.stringify(opts)],
        {
          detached: true,
          stdio: "ignore",
          env: { ...environment.env, PI_STUDIO_LISTEN: params.listen, PI_STUDIO_HOME: home },
        },
      );
      const state = { exited: false };
      child.on("exit", () => {
        state.exited = true;
      });
      child.on("error", () => {
        state.exited = true;
      });
      child.unref();
      const pid = child.pid;
      if (pid === undefined) throw new Error("spawn failed");
      return {
        pid,
        hasExited: () => state.exited,
        stop: async () => {
          if (state.exited) return;
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            return;
          }
          const end = Date.now() + STOP_GRACE_MS;
          while (!state.exited && Date.now() < end) await sleepMs(100);
          if (!state.exited) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              /* gone */
            }
          }
        },
      };
    },
    healthVersion: async () => {
      try {
        const res = await environment.fetch(healthUrlOf(params.listen), {
          signal: AbortSignal.timeout(1000),
        });
        const body: unknown = await res.json();
        if (typeof body === "object" && body !== null && "version" in body) {
          return typeof body.version === "string" ? body.version : null;
        }
        return null;
      } catch {
        return null;
      }
    },
    writeResult: (result) => {
      const file = join(home, UPDATE_RESULT_FILE);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(result), "utf8");
      renameSync(tmp, file);
    },
    pruneVersions: async (keep) => {
      await pruneVersionFolders(home, keep);
    },
  };
}

/**
 * `__update-helper`'s body: runs the helper with the real seams. A crash is logged and written as
 * `failed` so the next daemon start can show it; the return value is the process exit code.
 */
export async function runBinaryHelperMain(json: string | undefined): Promise<number> {
  const params = parseHelperParams(json);
  const seams = realBinaryHelperSeams(params);
  try {
    await runBinaryHelper(params, seams);
    return 0;
  } catch (err) {
    const message = `the update helper crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
    try {
      seams.log(message);
      await seams.writeResult({
        from: params.previous,
        to: params.target,
        outcome: "failed",
        at: Date.now(),
        message: tail(message),
      });
    } catch {
      /* nothing left to try */
    }
    return 1;
  }
}
