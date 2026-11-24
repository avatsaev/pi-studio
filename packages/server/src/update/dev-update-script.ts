import { setTimeout as delay } from "node:timers/promises";

import type { UpdateLastResult, UpdatePipeline, UpdateServiceDeps } from "./update-service.js";

/**
 * Scripted self-update for the dev daemon (`PI_STUDIO_DEV_UPDATE`, features/self-update.md § Public
 * contract). Answers the `daemon_update_*` family without npm, without a helper process and without
 * touching disk, so the workbench UI can be checked against every state. Dev only: production
 * never imports this.
 */

export const DEV_UPDATE_SCRIPTS = ["available", "cannot", "fail", "rollback"] as const;
export type DevUpdateScript = (typeof DEV_UPDATE_SCRIPTS)[number];

/** The version every script offers. */
export const DEV_UPDATE_VERSION = "9.9.9";

/** Pause between the apply steps (installing → updating_extensions → restarting). */
export const DEV_UPDATE_STEP_MS = 1500;

/** `PI_STUDIO_DEV_UPDATE` → script; unset/empty → `undefined`; anything else throws. */
export function parseDevUpdateScript(value: string | undefined): DevUpdateScript | undefined {
  if (value === undefined || value === "") return undefined;
  if ((DEV_UPDATE_SCRIPTS as readonly string[]).includes(value)) return value as DevUpdateScript;
  throw new Error(
    `PI_STUDIO_DEV_UPDATE must be one of ${DEV_UPDATE_SCRIPTS.join(", ")} (got "${value}")`,
  );
}

type ScriptedDeps = Pick<
  UpdateServiceDeps,
  | "detectInstallKind"
  | "fetchLatest"
  | "npmOnPath"
  | "globalFolder"
  | "canWriteGlobalFolder"
  | "platform"
  | "takeLastResult"
  | "pipeline"
>;

export interface DevUpdateScriptOptions {
  script: DevUpdateScript | undefined;
  /** The version the daemon starts as. */
  baseVersion: string;
  stepMs: number;
  /**
   * Simulates the restart inside this process. Called once the pipeline reaches it, after
   * `version` and the pending result are already updated: the host drops every socket and builds
   * a fresh service from `deps()`.
   */
  restart(): void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => delay(ms);

/**
 * Holds what survives the simulated restart (the running version, the result for the "next
 * start") and yields the service seams for the script.
 */
export class DevUpdateScriptRuntime {
  /** The version "running" now: `9.9.9` after a scripted successful update. */
  version: string;
  private pending: UpdateLastResult | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: DevUpdateScriptOptions) {
    this.version = opts.baseVersion;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  /** Seams for a (new) `UpdateService`; `takeLastResult` hands the pending result out once. */
  deps(): ScriptedDeps {
    const { script } = this.opts;
    return {
      // Unset: a repository checkout with nothing newer ("source", the real dev situation).
      detectInstallKind: async () => (script === undefined ? "source" : "npm-global"),
      fetchLatest: async () => (script === undefined ? this.version : DEV_UPDATE_VERSION),
      npmOnPath: async () => true,
      globalFolder: async () => null,
      canWriteGlobalFolder: async () => script !== "cannot",
      platform: "linux",
      takeLastResult: async () => {
        const result = this.pending;
        this.pending = undefined;
        return result;
      },
      pipeline: this.pipeline,
    };
  }

  private readonly pipeline: UpdatePipeline = async ({ target, previous, setState }) => {
    const { script, stepMs } = this.opts;
    await this.sleep(stepMs);
    if (script === "fail") {
      setState({
        kind: "failed",
        version: target,
        code: "permission",
        message: "EACCES: permission denied (scripted dev update).",
      });
      return;
    }
    setState({ kind: "updating_extensions", version: target });
    await this.sleep(stepMs);
    setState({ kind: "restarting", version: target });
    await this.sleep(stepMs);
    if (script === "rollback") {
      this.pending = {
        from: previous,
        to: target,
        outcome: "rolled_back",
        at: this.now(),
        message: "The new version did not come up (scripted dev update).",
      };
    } else {
      this.version = target;
      this.pending = { from: previous, to: target, outcome: "updated", at: this.now() };
    }
    this.opts.restart();
  };
}
