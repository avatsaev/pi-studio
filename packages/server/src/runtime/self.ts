import { dirname, join } from "node:path";

import { resolveBundledPiCli } from "../agent/providers/pi/rpc-transport.js";
import { resolveSkillsCli } from "../resources/skills-cli.js";
import type { HelperParams } from "../update/helper.js";

/**
 * The runtime seam (`swe/architecture/single-binary-daemon.md` § The runtime seam, A3). Every place
 * that starts Pi, the `skills` CLI, the daemon, the relay or the update helper asks this module for
 * the argv, so one module decides for both runtimes:
 *
 * - **Node** (`isBinary` false): `[process.execPath, <script>, …]`, exactly what each site built
 *   before this module existed.
 * - **Binary** (`isBinary` true): `process.execPath` is the compiled `pi-studio`, so the same
 *   program starts again with an internal sub-command first (`__pi`, `__skills`, `__daemon`,
 *   `__relay`, `__update-helper`). The sub-command handlers are the binary's entry, not here.
 *
 * Every function takes the runtime as a trailing parameter (default: the real one) so tests can
 * pin both branches without a build-time define.
 */

/**
 * Build-time define set by the binary build (`--define PI_STUDIO_BINARY=true`); not defined on Node
 * and under tests.
 */
declare const PI_STUDIO_BINARY: boolean | undefined;

/** True in the compiled single binary. */
export const isBinary: boolean = typeof PI_STUDIO_BINARY !== "undefined" && PI_STUDIO_BINARY;

/** What the seam needs to know about the process it runs in. */
export interface SelfRuntime {
  isBinary: boolean;
  execPath: string;
}

/** The real runtime; `execPath` is read per call. */
export function currentRuntime(): SelfRuntime {
  return { isBinary, execPath: process.execPath };
}

/** The sub-command names the binary dispatches on (its first argument). */
export const SUBCOMMAND = {
  daemon: "__daemon",
  relay: "__relay",
  pi: "__pi",
  skills: "__skills",
  updateHelper: "__update-helper",
} as const;

/** `__daemon`'s JSON argument: what `runDaemon` is started with. */
export interface DaemonOpts {
  host: string | undefined;
  port: number;
  home: string;
}

/** `__relay`'s JSON argument: what `startRelayServer` is started with. */
export interface RelayOpts {
  host: string;
  port: number;
  /** The rotating log folder (`$PI_STUDIO_HOME/logs`): the detached child has no stdio. */
  logDir: string;
}

/**
 * The command that runs Pi with `args`. `null` on Node when the bundled Pi package cannot be
 * resolved (each caller has its own fallback: a global `pi`, or skipping the work); never `null` in
 * the binary.
 */
export function piCommand(
  args: readonly string[],
  runtime: SelfRuntime = currentRuntime(),
): string[] | null {
  if (runtime.isBinary) return [runtime.execPath, SUBCOMMAND.pi, ...args];
  const cli = resolveBundledPiCli();
  return cli ? [runtime.execPath, cli, ...args] : null;
}

/** The command that runs the `skills` CLI with `args`; `null` on Node when it is not installed. */
export function skillsCommand(
  args: readonly string[],
  runtime: SelfRuntime = currentRuntime(),
): string[] | null {
  if (runtime.isBinary) return [runtime.execPath, SUBCOMMAND.skills, ...args];
  const cli = resolveSkillsCli();
  return cli ? [runtime.execPath, cli, ...args] : null;
}

/**
 * The `-e` text that boots the daemon on Node: `runDaemon`, never `startDaemon`, so the process
 * exits on a bind failure, shuts down cleanly on SIGINT/SIGTERM and exits after a self-update.
 * `serverUrl` is an absolute module URL: a detached `node -e` child has no module context.
 */
export function daemonStartScript(serverUrl: string, opts: DaemonOpts): string {
  return `import(${JSON.stringify(serverUrl)}).then(m=>m.runDaemon({host:${JSON.stringify(
    opts.host,
  )},port:${JSON.stringify(opts.port)},home:${JSON.stringify(opts.home)}}))`;
}

/** The `-e` text that boots the relay on Node (`relayUrl` is `@av-pi-studio/relay/server`'s URL). */
export function relayStartScript(relayUrl: string, opts: RelayOpts): string {
  return `import(${JSON.stringify(
    relayUrl,
  )}).then(m=>m.startRelayServer({host:${JSON.stringify(opts.host)},port:${JSON.stringify(
    opts.port,
  )},logger:m.createRelayLogger({logDir:${JSON.stringify(opts.logDir)}})}))`;
}

/**
 * The command that boots the daemon detached. On Node `resolveServerUrl` yields the server
 * module's absolute URL, resolved by the caller inside its own module graph (npm may nest the
 * server under the CLI); the binary never calls it.
 */
export function daemonCommand(
  opts: DaemonOpts,
  resolveServerUrl: () => string,
  runtime: SelfRuntime = currentRuntime(),
): string[] {
  if (runtime.isBinary) return [runtime.execPath, SUBCOMMAND.daemon, JSON.stringify(opts)];
  return [
    runtime.execPath,
    "--input-type=module",
    "-e",
    daemonStartScript(resolveServerUrl(), opts),
  ];
}

/** Likewise for the relay; `resolveRelayUrl` yields `@av-pi-studio/relay/server`'s URL. */
export function relayCommand(
  opts: RelayOpts,
  resolveRelayUrl: () => string,
  runtime: SelfRuntime = currentRuntime(),
): string[] {
  if (runtime.isBinary) return [runtime.execPath, SUBCOMMAND.relay, JSON.stringify(opts)];
  return [runtime.execPath, "--input-type=module", "-e", relayStartScript(resolveRelayUrl(), opts)];
}

/**
 * The command that runs the update helper. `script` is the Node helper's self-contained text
 * (`HELPER_SCRIPT`), passed in so this module does not import the helper's value exports.
 */
export function helperCommand(
  params: HelperParams,
  script: string,
  runtime: SelfRuntime = currentRuntime(),
): string[] {
  const json = JSON.stringify(params);
  if (runtime.isBinary) return [runtime.execPath, SUBCOMMAND.updateHelper, json];
  return [runtime.execPath, "-e", script, json];
}

/** The folder holding the binary and its assets (`bun`, Pi's files, `web/`). Binary only. */
export function assetsDir(runtime: SelfRuntime = currentRuntime()): string {
  if (!runtime.isBinary) throw new Error("assetsDir is only defined for the compiled binary");
  return dirname(runtime.execPath);
}

/**
 * The built web UI. In the binary it is `<assetsDir>/web`; on Node `resolveNodeDist` finds the
 * `@av-pi-studio/web-client` package, which the server does not depend on (the CLI does).
 */
export function webDist(
  resolveNodeDist: () => string,
  runtime: SelfRuntime = currentRuntime(),
): string {
  return runtime.isBinary ? join(assetsDir(runtime), "web") : resolveNodeDist();
}
