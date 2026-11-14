/**
 * Pure keyboard-ownership logic for a pending `AskCard` (sprint-068/task-008, § 07 "Keyboard
 * affordances"). Nothing here touches the DOM or React — `AskCard.tsx` wires refs/listeners
 * around it, exactly like `outcome-line.ts`/`option-layout.ts` (task-004) separate presentation
 * decisions from rendering.
 */

/** § 07 "the hint line lists only the keys valid for that card's kind" — every kind but `editor`
 *  submits on bare Enter; `editor` reserves bare Enter for a newline (so its own field's
 *  `onKeyDown` never intercepts it) and submits on the modifier chord instead. Both the field's
 *  key handling and the hint's glyph read this one flag, so the two can never drift apart. */
export function submitKeyClaimsShift(method: string): boolean {
  return method === "editor";
}

export interface HintKeySegment {
  key: string;
  label: string;
}

export type Hint =
  | { kind: "keys"; segments: readonly HintKeySegment[] }
  | { kind: "warning"; text: string };

/** § 07 "swaps the hint line for 'Esc again to dismiss — the extension gets an empty answer'" —
 *  shown verbatim once a card is armed, replacing the key hint regardless of which method armed
 *  it (the warning is about the *action*, not the card's kind). */
export const ARM_WARNING = "Esc again to dismiss — the extension gets an empty answer";

export function computeHint(method: string, armed: boolean): Hint {
  if (armed) return { kind: "warning", text: ARM_WARNING };
  return {
    kind: "keys",
    segments: [
      { key: submitKeyClaimsShift(method) ? "⇧↵" : "↵", label: "submit" },
      { key: "Esc", label: "dismiss" },
    ],
  };
}

/** § 07 two-step Esc: the first press arms dismissal (and moves focus to the card's dismissing
 *  control, when it has one); the second resolves it. `resolve: true` tells the caller to send
 *  the cancellation now — the caller decides what that means for its own kind (`{ cancelled:
 *  true }` for every kind here, since `agentUiResponseSchema` accepts it universally). */
export interface EscPressResult {
  armed: boolean;
  resolve: boolean;
}

export function pressEscape(currentlyArmed: boolean): EscPressResult {
  return currentlyArmed ? { armed: false, resolve: true } : { armed: true, resolve: false };
}
