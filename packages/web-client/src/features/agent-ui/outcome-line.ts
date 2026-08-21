/**
 * `outcomeLine` — the collapsed-card outcome string a resolved dialog shows (visual spec § 04).
 * Pure decision over data: never reads the DOM, never touches CSS clamping (the truncation flag
 * only signals "the CSS should clamp this one" — actual ellipsis-at-40%-width is a style concern,
 * task-005).
 *
 * Two rules exist to prevent a specific, already-identified failure (§ 04):
 * - **Never invent a claim the wire cannot support.** `timed out` never says which default value
 *   the extension acted on (§ 04: "the default is empty for select/input/editor and 'no' for
 *   confirm, and the card can't know which the extension acted on"). "Resolved elsewhere" never
 *   claims *which* of a lost race / stale id / swept agent happened — the daemon returns the same
 *   signal for all three (`extension-ui-rpc.md`).
 * - **Never echo a typed value.** `input`/`editor` show a neutral fixed confirmation ("answered" /
 *   "submitted") regardless of who answered or what was typed — the SDK already makes a typed
 *   answer unrepresentable in state (`agent-ui-state.ts`'s `answerFromResponse`), and this module
 *   must not reintroduce it by any other means.
 *
 * "No longer pending" (§ 04) applies only to `select`/`confirm`: those two methods retain
 * `answer.value`/`answer.confirmed` on the resolved entry **only when THIS client submitted it**
 * (`agent-ui-state.ts` module header); an `answer === undefined` on a `reason: "answered"` entry
 * for one of those two methods therefore means another client (or a race this client lost) is what
 * actually resolved it. `input`/`editor` never retain an answer regardless of who answered — for
 * those two, `reason: "answered"` unconditionally means "✓ answered"/"✓ submitted"; there is no
 * "elsewhere" variant to distinguish (nothing on the wire would let it be distinguished).
 */

import type { AgentUiResolvedEntry } from "@av-pi-studio/client";

export type OutcomeTone = "success" | "muted";

export interface OutcomeLine {
  tone: OutcomeTone;
  /** Present only for a genuine "answered here" outcome — a checkmark. */
  glyph: "check" | null;
  text: string;
  /** True only for the one case where `text` is an arbitrary, extension-chosen string that may run
   *  long (the `select` answer) — the CSS clamps/ellipsises only when this is set. */
  truncate: boolean;
}

function line(
  tone: OutcomeTone,
  glyph: "check" | null,
  text: string,
  truncate = false,
): OutcomeLine {
  return { tone, glyph, text, truncate };
}

export function outcomeLine(entry: AgentUiResolvedEntry): OutcomeLine {
  if (entry.reason === "answered") {
    if (entry.method === "input") return line("success", "check", "answered");
    if (entry.method === "editor") return line("success", "check", "submitted");

    if (entry.method === "select") {
      if (entry.answer?.value === undefined) return line("muted", null, "no longer pending");
      return line("success", "check", entry.answer.value, true);
    }

    if (entry.method === "confirm") {
      if (entry.answer?.confirmed === undefined) return line("muted", null, "no longer pending");
      return entry.answer.confirmed
        ? line("success", "check", "Yes")
        : line("muted", null, "declined");
    }

    // An unrecognised method that somehow both expects a response and got answered: no wire
    // vocabulary exists to show a value for it (`answerFromResponse` only ever retains one for
    // select/confirm), so this is the same neutral confirmation as input/editor.
    return line("success", "check", "answered");
  }

  if (entry.reason === "cancelled") return line("muted", null, "declined");
  if (entry.reason === "timeout") return line("muted", null, "expired");

  // Anything else (e.g. "aborted") — printed verbatim, never relabelled, never mapped to a claim
  // about another device (§ 04's own rule: "the rows above are the common cases, not an
  // enumeration").
  return line("muted", null, entry.reason);
}
