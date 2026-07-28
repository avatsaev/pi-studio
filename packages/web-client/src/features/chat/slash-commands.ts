/**
 * Pure slash-command logic for the composer's `/` picker (sprint-040 web-client half) — kept out
 * of `Composer.tsx`/`CommandMenu.tsx` so it's unit-testable under the root vitest config (which
 * only discovers `.test.ts` files under a node environment; `.tsx` component files are not
 * picked up there, following `model-menu-sort.ts`'s precedent).
 *
 * Every function here works with Pi's own token grammar
 * (`^\/([^\s]+)(?:\s+([\s\S]*))?$`, `node_modules/@earendil-works/pi-coding-agent/dist/core/
 * prompt-templates.js:221-229`) and its exact, case-sensitive command-name matching
 * (`dist/core/extensions/runner.js:436-438`), so `knownCommandSpan`'s highlight doubles as a live
 * "Pi will recognize this" indicator rather than decoration.
 */

import type { ComboboxOption } from "@pi-studio-ui/ui/combobox.js";

/** The fields of an `agent_list_commands_response` entry this module needs. */
export interface SlashCommand {
  name: string;
  description?: string;
  source?: string;
  scope?: string;
}

/** Leading `/token` of a composer draft; `end` is the index just past the token. */
export interface SlashToken {
  name: string;
  end: number;
  hasArgs: boolean;
}

/** `null` unless the draft's first character is `/`. `name` excludes the slash. */
export function parseSlashToken(text: string): SlashToken | null {
  if (!text.startsWith("/")) return null;
  const match = /^\/(\S*)/.exec(text);
  const name = match?.[1] ?? "";
  const end = 1 + name.length;
  const hasArgs = /\S/.test(text.slice(end));
  return { name, end, hasArgs };
}

/** True while the draft is still just a command name being typed: `/^\/[^\s]*$/`. */
export function shouldOpenMenu(text: string): boolean {
  return /^\/\S*$/.test(text);
}

/**
 * Menu rows in daemon order (no client-side sort — the daemon's order is Pi's order).
 * `running` drops `source === "extension"` entries: Pi rejects extension commands on `steer`/
 * `follow_up` (`agent-session.js` `_throwIfExtensionCommand`), which is the only send path while a
 * turn is in flight, and that rejection is a swallowed `notify` response, i.e. silent.
 */
export function commandOptions(
  commands: SlashCommand[],
  opts: { running: boolean },
): { options: ComboboxOption<string>[]; hiddenExtensionCount: number } {
  let hiddenExtensionCount = 0;
  const options: ComboboxOption<string>[] = [];
  for (const cmd of commands) {
    if (opts.running && cmd.source === "extension") {
      hiddenExtensionCount += 1;
      continue;
    }
    options.push({
      value: cmd.name,
      label: `/${cmd.name}`,
      description: cmd.description,
      kind: cmd.source,
    });
  }
  return { options, hiddenExtensionCount };
}

/** Wrapping highlight movement; returns 0 for an empty list. */
export function moveHighlight(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

/**
 * Replace the draft's leading token with `/name`, keeping any args. With no args, append exactly
 * one space (which also makes `shouldOpenMenu` false, closing the menu by itself). With no leading
 * slash at all, prefix `/name ` to the existing text.
 */
export function applyCommand(text: string, name: string): string {
  const token = parseSlashToken(text);
  if (!token) return `/${name} ${text}`;
  if (!token.hasArgs) return `/${name} `;
  return `/${name}${text.slice(token.end)}`;
}

/**
 * The span to highlight in the textarea: the leading token only when it matches a known command
 * name exactly and case-sensitively — the same test Pi applies, so the highlight doubles as "Pi
 * will recognize this".
 */
export function knownCommandSpan(text: string, names: readonly string[]): { end: number } | null {
  const token = parseSlashToken(text);
  if (!token || !names.includes(token.name)) return null;
  return { end: token.end };
}
