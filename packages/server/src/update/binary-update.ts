import type { PersistedConfig } from "../config/daemon-config.js";
import {
  defaultInstallSpawn,
  type InstallSpawn,
  updateInstalledExtensions,
} from "../extensions/sync-executor.js";
import type { SelfRuntime } from "../runtime/self.js";
import { PACKAGE_NAME } from "../version.js";
import { installBinaryVersion, type BinaryInstallOptions } from "./binary-install.js";
import { versionExecutable } from "./binary-layout.js";
import {
  assetFor,
  binaryTarget,
  daemonUpdateUrl,
  fetchBinaryManifest,
  type BinaryAsset,
} from "./binary-manifest.js";
import { spawnUpdateHelper, type HelperParams, type HelperSpawn } from "./helper.js";
import { binaryBlocker } from "./install-kind.js";
import type { BinaryManifestLookup, BinaryUpdateProbes } from "./update-service.js";

/**
 * A binary daemon's update, assembled from the pieces (features/self-update.md § Check and § Apply,
 * Binary): what the update service asks (`BinaryUpdateProbes`) and the steps of the apply pipeline
 * (`install`, `updateExtensions`, `spawnHelper`). The CLI's `update` uses `lookupBinaryRelease` and
 * `installBinaryRelease` directly.
 */

/** Where the manifest is and which system asks. */
export interface BinaryReleaseSource {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchFn?: typeof fetch;
}

/** What `latest.json` offers this system. */
export type BinaryReleaseLookup =
  | { kind: "ok"; version: string; asset: BinaryAsset | null }
  | { kind: "offline" }
  | { kind: "bad_answer" };

/** Reads `latest.json` (15 s): the newest version and this system's archive of it. */
export async function lookupBinaryRelease(
  source: BinaryReleaseSource = {},
): Promise<BinaryReleaseLookup> {
  const found = await fetchBinaryManifest(
    daemonUpdateUrl(source.env ?? process.env),
    source.fetchFn,
  );
  if (found.kind !== "ok") return found;
  const target = binaryTarget(source.platform ?? process.platform, source.arch ?? process.arch);
  const asset = target === null ? null : assetFor(found.manifest, target);
  return { kind: "ok", version: found.manifest.version, asset };
}

/** What `installBinaryRelease` takes besides the version: where to install, and the test seams. */
export interface BinaryReleaseInstall
  extends BinaryReleaseSource, Pick<BinaryInstallOptions, "runVersion" | "stallMs"> {
  home: string;
}

/**
 * Installs `version` into `bin/versions/<version>`; `bin/current` is not touched. The manifest is
 * read again and must still name `version` (a newer release in between is a new check, not a
 * surprise install). Returns the new executable.
 */
export async function installBinaryRelease(
  version: string,
  options: BinaryReleaseInstall,
): Promise<string> {
  const release = await lookupBinaryRelease(options);
  if (release.kind !== "ok") {
    throw new Error(
      release.kind === "offline"
        ? "download failed: cannot read latest.json"
        : "download failed: latest.json is not a manifest",
    );
  }
  if (release.version !== version) {
    throw new Error(`latest.json now names ${release.version}, not ${version}; check again`);
  }
  if (release.asset === null) throw new Error(`latest.json has no archive for this system`);
  return installBinaryVersion({
    home: options.home,
    version,
    asset: release.asset,
    fetchFn: options.fetchFn,
    runVersion: options.runVersion,
    stallMs: options.stallMs,
  });
}

export interface BinaryUpdateOptions extends BinaryReleaseInstall {
  /** This process's executable (default `process.execPath`). */
  execPath?: string;
  /** The address the daemon is bound to now (`host:port`), for the helper. */
  listen(): string;
  /** Starts the helper (default `child_process.spawn`); tests pass a fake. */
  helperSpawn?: HelperSpawn;
}

/** The binary's update, as the daemon wires it. */
export interface BinaryUpdate {
  probes: BinaryUpdateProbes;
  /** The pipeline's install step: `bin/versions/<version>`, `current` untouched. */
  install(version: string): Promise<void>;
  /** The NEW binary's `__pi update --extensions`; call after `install`. */
  updateExtensions(deps: { config: PersistedConfig; spawn?: InstallSpawn }): Promise<void>;
  /** Starts the NEW binary's `__update-helper` detached. */
  spawnHelper(target: string, previous: string): void;
}

/** `base` with the command's program replaced by `executable` (the running binary's name). */
export function redirectSpawn(base: InstallSpawn, executable: string): InstallSpawn {
  return (request) => base({ ...request, command: [executable, ...request.command.slice(1)] });
}

export function createBinaryUpdate(options: BinaryUpdateOptions): BinaryUpdate {
  const { home } = options;
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  let installed: string | undefined;
  return {
    probes: {
      lookup: async (): Promise<BinaryManifestLookup> => {
        const found = await lookupBinaryRelease(options);
        return found.kind === "ok"
          ? { kind: "ok", version: found.version, hasAsset: found.asset !== null }
          : found;
      },
      blocker: () => binaryBlocker(execPath, home),
    },
    install: async (version) => {
      installed = await installBinaryRelease(version, options);
    },
    updateExtensions: ({ config, spawn }) => {
      if (installed === undefined) throw new Error("no new binary was installed");
      return updateInstalledExtensions({
        config,
        spawn: redirectSpawn(spawn ?? defaultInstallSpawn, installed),
      });
    },
    spawnHelper: (target, previous) => {
      const params: HelperParams = {
        oldPid: process.pid,
        target,
        previous,
        listen: options.listen(),
        home,
        packageName: PACKAGE_NAME,
      };
      const runtime: SelfRuntime = { isBinary: true, execPath: versionExecutable(home, target) };
      spawnUpdateHelper(params, env, options.helperSpawn, runtime);
    },
  };
}
