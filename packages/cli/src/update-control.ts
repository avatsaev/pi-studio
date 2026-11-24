import { spawn } from "node:child_process";

import {
  type BinaryReleaseLookup,
  type GlobalInstaller,
  type LatestVersionFetcher,
  binaryBlocker,
  currentExecutable,
  daemonCommand,
  installBinaryRelease,
  isBinary,
  lookupBinaryRelease,
  npmGlobalInstall,
  npmLatestVersion,
  pruneVersions,
  switchCurrent,
} from "@av-pi-studio/server";

import type { DaemonStarter } from "./daemon-control.js";
import { PACKAGE_VERSION } from "./version.generated.js";

/**
 * Self-update process control (features/cli.md § Command tree — top-level `update`). The engine
 * itself (npm lookup, version comparison, the global install with its ENOTEMPTY self-heal, and the
 * binary's manifest, install and link switch) lives in `@av-pi-studio/server`'s `update/` modules
 * (features/self-update.md § Where the code lives); this file keeps the CLI's injectable
 * `UpdateRuntime` seam and its own current version.
 */
export { PACKAGE_NAME, RELEASES_PAGE, compareVersions } from "@av-pi-studio/server";
export type { GlobalInstaller, LatestVersionFetcher } from "@av-pi-studio/server";

// This package's own version, generated from its package.json by `scripts/gen-version.mjs`.
export const CURRENT_VERSION: string = PACKAGE_VERSION;

/** What `update` does to a compiled binary (milestone 6); the npm path never touches it. */
export interface BinaryUpdateRuntime {
  /** Why this binary cannot replace itself under `home`, `null` when it can. */
  blocker(home: string): Promise<"unmanaged_binary" | "not_writable" | null>;
  /** Reads `daemon-updates/latest.json`. */
  lookup(): Promise<BinaryReleaseLookup>;
  /** Installs `version` into `bin/versions/<version>`; `bin/current` is not touched. */
  install(home: string, version: string): Promise<void>;
  /** Points `bin/current` at `versions/<version>`. */
  switchCurrent(home: string, version: string): Promise<void>;
  /** Removes every version folder not in `keep`. */
  prune(home: string, keep: readonly string[]): Promise<void>;
  /** Starts the daemon from `bin/current/pi-studio`, i.e. the version just switched to. */
  startDaemon: DaemonStarter;
}

export interface UpdateRuntime {
  getLatestVersion: LatestVersionFetcher;
  installGlobal: GlobalInstaller;
  /** Set when this process is the compiled binary: `update` then works on `bin/versions`. */
  binary?: BinaryUpdateRuntime;
}

/**
 * Detached `<home>/bin/current/pi-studio __daemon <json>`: the daemon of the version `current`
 * points at now, not of the running process (the old binary, until `update` ends).
 */
export const currentBinaryDaemonStarter: DaemonStarter = ({ home, listen, piHome }) =>
  new Promise<number>((resolve, reject) => {
    const idx = listen.lastIndexOf(":");
    const program = currentExecutable(home);
    const command = daemonCommand(
      { host: listen.slice(0, idx), port: Number(listen.slice(idx + 1)), home },
      () => {
        throw new Error("the binary does not resolve a server module");
      },
      { isBinary: true, execPath: program },
    );
    const child = spawn(command[0] ?? program, command.slice(1), {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PI_STUDIO_HOME: home,
        PI_STUDIO_LISTEN: listen,
        ...(piHome ? { PI_STUDIO_PI_HOME: piHome } : {}),
      },
    });
    child.on("error", reject);
    if (child.pid === undefined) {
      reject(new Error("failed to spawn daemon process"));
      return;
    }
    child.unref();
    resolve(child.pid);
  });

export function defaultBinaryUpdateRuntime(): BinaryUpdateRuntime {
  return {
    blocker: (home) => binaryBlocker(process.execPath, home),
    lookup: () => lookupBinaryRelease(),
    install: async (home, version) => {
      await installBinaryRelease(version, { home });
    },
    switchCurrent,
    prune: async (home, keep) => {
      await pruneVersions(home, keep);
    },
    startDaemon: currentBinaryDaemonStarter,
  };
}

export function defaultUpdateRuntime(): UpdateRuntime {
  return {
    getLatestVersion: npmLatestVersion,
    installGlobal: npmGlobalInstall,
    ...(isBinary ? { binary: defaultBinaryUpdateRuntime() } : {}),
  };
}
