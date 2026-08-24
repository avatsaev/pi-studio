/**
 * Option grouping for the app's menu/picker surfaces — the pure half of the grouped-menu
 * mechanic whose render half is `components/primitives/Menu.tsx`'s `MenuGroup`. Any list of
 * `ComboboxOption`s can be sectioned by whatever its owner puts in `option.group`
 * (`ModelMenu`: the model's own LLM provider; a slash-command menu could use the command's
 * source kind) without either layer knowing what the grouping means.
 *
 * Group order is FIRST APPEARANCE, never alphabetical: every producer in this app already emits
 * a meaningful order (the daemon's own model ordering, `slash-commands.ts`'s ranking), and
 * re-sorting headers would discard it. `priorityGroup` is the one deliberate exception.
 */

import type { ComboboxOption } from "./combobox.js";

/** One rendered section: a header plus the options under it. */
export interface OptionGroup<T> {
  /** Stable React key — the raw `option.group` value, or `""` for the ungrouped bucket. */
  key: string;
  /** Header text; `undefined` renders no header row (see `MenuGroup`). */
  label?: string;
  options: ComboboxOption<T>[];
}

export interface GroupOptionsConfig {
  /** Group hoisted to the front wherever it first appears — e.g. the provider of the model a
   * session is currently on, so the group you are actually using is never buried. Ignored when
   * no option carries it. */
  priorityGroup?: string;
  /** Header for options that carry no `group`. Omit to leave that bucket headerless. */
  ungroupedLabel?: string;
}

/**
 * Section `options` for rendering. Grouping REORDERS: a caller that also owns a highlighted
 * index over a flat list (a menu whose Arrow keys live outside it, like `CommandMenu`) must
 * derive that index from `groups.flatMap((g) => g.options)`, not from the list passed in here —
 * an index into the pre-grouping order would highlight a different row than the user sees.
 */
export function groupOptions<T>(
  options: ComboboxOption<T>[],
  config: GroupOptionsConfig = {},
): OptionGroup<T>[] {
  const byKey = new Map<string, ComboboxOption<T>[]>();
  for (const option of options) {
    const key = option.group ?? "";
    const bucket = byKey.get(key);
    if (bucket) bucket.push(option);
    else byKey.set(key, [option]);
  }

  // `Map` preserves insertion order, so this is first-appearance order for free.
  const ungrouped = byKey.get("");
  byKey.delete("");
  const keys = [...byKey.keys()];
  const { priorityGroup, ungroupedLabel } = config;
  if (priorityGroup !== undefined && byKey.has(priorityGroup)) {
    keys.splice(keys.indexOf(priorityGroup), 1);
    keys.unshift(priorityGroup);
  }

  const groups: OptionGroup<T>[] = keys.map((key) => ({
    key,
    label: key,
    options: byKey.get(key) ?? [],
  }));
  // Ungrouped options always land last: an unlabelled band ABOVE a labelled one reads as if it
  // belonged to whatever header follows it.
  if (ungrouped) groups.push({ key: "", label: ungroupedLabel, options: ungrouped });
  return groups;
}
