import { type AppUpdateState, type HostUpdates } from "@av-pi-studio/workbench";

import { isRecord } from "./daemons-view.js";
import { type Ipc, type IpcEvents } from "./ipc.js";

/** The event the app emits after every change of the update state; its payload is the state. */
export const UPDATE_EVENT = "update_changed";

const IDLE: AppUpdateState = { state: "idle" };

const REASONS: readonly string[] = ["development_build", "not_writable", "read_only_location", "no_pkexec"];
const CODES: readonly string[] = [
  "offline",
  "manifest_invalid",
  "no_target",
  "signature",
  "download",
  "install",
  "refused",
];

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The state the app sent, or `idle` when it is not one of the known shapes. */
export function parseUpdateState(value: unknown): AppUpdateState {
  if (!isRecord(value)) return IDLE;
  const { state, version, releaseUrl } = value;
  switch (state) {
    case "idle":
    case "checking":
      return { state };
    case "up_to_date":
      return isCount(value.checkedAt) ? { state, checkedAt: value.checkedAt } : IDLE;
    case "available":
      return isString(version) && isString(releaseUrl) ? { state, version, releaseUrl } : IDLE;
    case "downloading": {
      if (!isString(version) || !isCount(value.received)) return IDLE;
      if (value.total === undefined) return { state, version, received: value.received };
      return isCount(value.total) ? { state, version, received: value.received, total: value.total } : IDLE;
    }
    case "restart_needed":
      return isString(version) ? { state, version } : IDLE;
    case "cannot_install": {
      const { reason } = value;
      return isString(version) && isString(releaseUrl) && isString(reason) && REASONS.includes(reason)
        ? { state, version, releaseUrl, reason: reason as Extract<AppUpdateState, { state: "cannot_install" }>["reason"] }
        : IDLE;
    }
    case "failed": {
      const { code } = value;
      if (!isString(code) || !CODES.includes(code)) return IDLE;
      if ((version !== undefined && !isString(version)) || (releaseUrl !== undefined && !isString(releaseUrl))) {
        return IDLE;
      }
      return {
        state,
        code: code as Extract<AppUpdateState, { state: "failed" }>["code"],
        ...(version !== undefined && { version }),
        ...(releaseUrl !== undefined && { releaseUrl }),
      };
    }
    default:
      return IDLE;
  }
}

/** The app's self-update: the state from `boot`, kept current by `update_changed`; the actions are registry commands. */
export function createDesktopUpdates(
  bootState: AppUpdateState,
  ipc: Ipc & IpcEvents,
  log: (message: string, error: unknown) => void,
): HostUpdates {
  let state = bootState;
  const listeners = new Set<() => void>();
  ipc
    .listen(UPDATE_EVENT, (payload) => {
      state = parseUpdateState(payload);
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => log("listen update_changed failed", error));

  const run = async (id: string): Promise<void> => {
    try {
      await ipc.invoke("engine_command", { id });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: () => run("update.check"),
    install: () => run("update.install"),
    restart: () => run("update.restart"),
  };
}
