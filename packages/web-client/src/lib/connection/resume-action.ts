/**
 * Pure, DOM-free decision core for the resume triggers (clean-room-scope/features/
 * connection-resilience.md § Public Contract, § Decision table). Extracted per this repo's
 * no-jsdom testing convention (see `timeline/text-viewer-state.ts` / `hooks/molecule-reload.ts`).
 */
import type { ConnectionState } from "@av-pi-studio/client";

export type ResumeAction = "none" | "reconnect-now" | "probe";

export interface ResolveResumeActionInput {
  /** Current daemon connection state. */
  status: ConnectionState;
  /** `connection-store`'s `reconnection !== null` — false means the user explicitly
   * disconnected (or never connected); no resume signal may resurrect that. */
  managerActive: boolean;
  /** Whether a resume probe is already in flight (single-probe guard). */
  probeInFlight: boolean;
}

/**
 * Decision table (implement exactly — see the spec for the rationale column):
 *
 * | status                | managerActive | probeInFlight | -> action        |
 * |------------------------|----------------|----------------|-------------------|
 * | closed                | true           | –              | reconnect-now     |
 * | open                  | true           | false          | probe             |
 * | open                  | true           | true           | none              |
 * | connecting / closing   | –              | –              | none              |
 * | any                    | false          | –              | none              |
 * | idle                  | –              | –              | none              |
 *
 * The resume *signal* (`"visible"` / `"online"`) is deliberately not a parameter: no row branches
 * on it, so it stays at the wiring layer (`resume-triggers.ts`) where it is useful for logging.
 */
export function resolveResumeAction(input: ResolveResumeActionInput): ResumeAction {
  if (!input.managerActive) return "none"; // explicit user Disconnect — never resurrect
  if (input.status === "closed") return "reconnect-now";
  if (input.status === "open") return input.probeInFlight ? "none" : "probe";
  return "none"; // connecting / closing / idle
}
