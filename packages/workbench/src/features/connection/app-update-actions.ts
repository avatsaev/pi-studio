import type { HostUpdates } from "../../host/types.js";
import type { AppUpdateAction } from "./app-update-presentation.js";

/** The actions a host command answers; `open` is a link to the release page, not a command. */
export type AppUpdateCommand = Exclude<AppUpdateAction, { kind: "open" }>;

/**
 * Runs the host command of a click. The host reports a failure through its update state, so a
 * rejection is dropped rather than left unhandled.
 */
export async function runAppUpdateCommand(
  updates: HostUpdates,
  action: AppUpdateCommand,
): Promise<void> {
  try {
    switch (action.kind) {
      case "install":
        return await updates.install();
      case "restart":
        return await updates.restart();
      case "check":
        return await updates.check();
    }
  } catch {
    // Shown by the state the host publishes.
  }
}
