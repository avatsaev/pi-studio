import { type HostUsageData, type UsageBlockedReason, type UsageDataView } from "@av-pi-studio/workbench";

import { isRecord } from "./daemons-view.js";
import { type Ipc } from "./ipc.js";

const BLOCKED: readonly string[] = ["build", "do_not_track", "ci", "scripted"];

/** The view the app sent, or `null` when it is not the expected shape. */
export function parseUsageDataView(value: unknown): UsageDataView | null {
  if (!isRecord(value)) return null;
  const { enabled, sending, blocked, id } = value;
  if (typeof enabled !== "boolean" || typeof sending !== "boolean") return null;
  if (blocked !== undefined && (typeof blocked !== "string" || !BLOCKED.includes(blocked))) return null;
  if (id !== undefined && typeof id !== "string") return null;
  return {
    enabled,
    sending,
    ...(blocked !== undefined && { blocked: blocked as UsageBlockedReason }),
    ...(id !== undefined && { id }),
  };
}

/** The usage-data switch: the view from `boot`; the switch is the `shareUsageData` setting. */
export function createDesktopUsageData(boot: UsageDataView, ipc: Ipc): HostUsageData {
  let view = boot;
  return {
    current: () => view,
    async setEnabled(enabled) {
      try {
        await ipc.invoke("engine_command", { id: "settings.set", params: { key: "shareUsageData", value: enabled } });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      view = { ...view, enabled, sending: enabled && view.blocked === undefined };
    },
  };
}
