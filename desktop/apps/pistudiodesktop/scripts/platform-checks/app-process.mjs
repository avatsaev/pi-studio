// Starting the app with its output in a file, and ending it.

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";

import { parseControlPort } from "./control-client.mjs";
import { Abort, waitFor } from "./wait.mjs";

/**
 * Start `command` with exactly `env` (nothing is inherited) and its standard output and error in
 * `logPath`. A launch that fails to start is an `exited` result with `error`, not a throw.
 */
export function launch(command, args, env, logPath) {
  const log = openSync(logPath, "w");
  const child = spawn(command, args, { env, stdio: ["ignore", log, log] });
  closeSync(log);
  let startError = null;
  const exited = new Promise((resolve) => {
    child.once("error", (error) => {
      startError = error;
      resolve({ code: null, signal: null, error });
    });
    child.once("exit", (code, signal) => resolve({ code, signal, error: startError }));
  });
  return {
    child,
    exited,
    logPath,
    pid: child.pid,
    log: () => readFileSync(logPath, "utf8"),
    running: () => child.exitCode === null && child.signalCode === null && startError === null,
  };
}

/** The control port of a launched app, once it has bound it. */
export function waitForControlPort(app, timeoutMs = 60_000) {
  return waitFor(
    "the app's control server",
    () => {
      const port = parseControlPort(app.log());
      if (port !== null) return port;
      if (!app.running()) throw new Abort(`the app exited before it served the control socket:\n${app.log().slice(-1500)}`);
      return null;
    },
    { timeoutMs, intervalMs: 200 },
  );
}

/** Wait for the app to end; kill it when it does not within `timeoutMs`. Returns `{ code, signal, killed }`. */
export async function waitForExit(app, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const ended = await Promise.race([app.exited, timeout]);
  clearTimeout(timer);
  if (ended) return { ...ended, killed: false };
  app.child.kill("SIGKILL");
  return { ...(await app.exited), killed: true };
}
