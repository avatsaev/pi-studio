/**
 * Pure, DOM-free decision core for the resume triggers (swe/features/
 * connection-resilience.md § Public Contract, § Decision table). Extracted per this repo's
 * no-jsdom testing convention (see `timeline/text-viewer-state.ts` / `hooks/molecule-reload.ts`).
 */
import type { ConnectionState } from "@av-pi-studio/client";

export type ResumeAction = "none" | "reconnect-now" | "probe" | "connect-again";

export interface ResolveResumeActionInput {
  /** Current daemon connection state. */
  status: ConnectionState;
  /** `connection-store`'s `reconnection !== null` — false means the user explicitly
   * disconnected (or never connected); no resume signal may resurrect that. */
  managerActive: boolean;
  /** `reconnection.isActive`: false while the first connect of this client never opened, so there
   * is no backoff ladder to run (the page shows the error and Retry). */
  managerStarted: boolean;
  /** Whether a resume probe is already in flight (single-probe guard). */
  probeInFlight: boolean;
}

/**
 * Decision table (implement exactly — see the spec for the rationale column):
 *
 * | status                | managerActive | managerStarted | probeInFlight | -> action        |
 * |------------------------|----------------|-----------------|----------------|-------------------|
 * | closed                | true           | true            | –              | reconnect-now     |
 * | closed                | true           | false           | –              | connect-again     |
 * | open                  | true           | –               | false          | probe             |
 * | open                  | true           | –               | true           | none              |
 * | connecting / closing   | –              | –               | –              | none              |
 * | any                    | false          | –               | –              | none              |
 * | idle                  | –              | –               | –              | none              |
 *
 * `connect-again` is a connect that failed before it ever opened (a refused host key, a stopped
 * daemon): a signal that the cause may be gone (the desktop app sends one after Trust and after
 * Start) is the same as the user's Retry.
 *
 * The resume *signal* (`"visible"` / `"online"`) is deliberately not a parameter: no row branches
 * on it, so it stays at the wiring layer (the host's `connection.onResume`) where it is useful for logging.
 */
export function resolveResumeAction(input: ResolveResumeActionInput): ResumeAction {
  if (!input.managerActive) return "none"; // explicit user Disconnect — never resurrect
  if (input.status === "closed") return input.managerStarted ? "reconnect-now" : "connect-again";
  if (input.status === "open") return input.probeInFlight ? "none" : "probe";
  return "none"; // connecting / closing / idle
}
