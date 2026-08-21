/**
 * `optionLayout` — how a `select` dialog's `options: string[]` lay out (visual spec § 03, § 12).
 * Pure decision over the array alone: a `select` card never gets custom ids, labels, ordinals, or
 * descriptions on the wire (§ 00), so length and count are the only signals available.
 *
 * - **Stack** (full-width, vertically listed buttons) when there are five or more options, or when
 *   any single label is longer than roughly 40 characters (§ 12 "EXACT STACKING THRESHOLD" pins
 *   this with a two-option case: one 95-character option forces the stack even though there is only
 *   one other, four-character option). Otherwise **row** (side-by-side) — the exception, not the
 *   default (§ 03).
 * - **Scroll** once there are more than six options (§ 12 "NINE OPTIONS · SCROLLS AT SIX" — nine
 *   options scrolls, six does not).
 * - **No ordinals, no dedup.** Real extensions already number their own options in the label text
 *   (§ 03); adding a second, local numbering scheme would collide with or duplicate that, or
 *   falsely imply this surface can disambiguate identical labels when it cannot (§ 12 "DUPLICATE
 *   OPTION LABELS"). This module is a pure pass-through of the layout decision — it never
 *   reorders, merges, or annotates `options` itself.
 */

const STACK_MIN_OPTIONS = 5;
const LONG_LABEL_THRESHOLD = 40;
const SCROLL_AFTER_OPTIONS = 6;

export interface OptionLayout {
  mode: "row" | "stack";
  scrolls: boolean;
}

export function optionLayout(options: readonly string[]): OptionLayout {
  const stacks =
    options.length >= STACK_MIN_OPTIONS || options.some((o) => o.length > LONG_LABEL_THRESHOLD);
  return {
    mode: stacks ? "stack" : "row",
    scrolls: options.length > SCROLL_AFTER_OPTIONS,
  };
}
