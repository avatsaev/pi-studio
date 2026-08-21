/**
 * `promptLines` — turns a raw `title`/`message` string into renderable lines (visual spec § 02,
 * § 03, § 12). `\n` is a hard break; a run of consecutive blank lines collapses to a single blank
 * line, so an extension cannot inflate its own vertical space by repeating newlines. A bracketed
 * extension prefix (e.g. `[Color]`) is preserved **verbatim** — never parsed, stripped, or
 * restyled, since there is no reliable way to tell an extension's own namespacing from ordinary
 * prose (§ 00, § 03).
 *
 * Wrapping and the 4-line-then-scroll cap (§ 12) are a CSS concern (`max-height` + `overflow`) —
 * they depend on rendered width/font metrics this module has no access to and does not need:
 * providing the correctly-split, collapsed line array is the whole of this module's job.
 *
 * `confirmPromptParts` returns `title` and `message` as distinct line arrays, per § 03: a `confirm`
 * with a message weights the title differently (heavier, to separate it from the message below)
 * than a `confirm` with none (ordinary weight, and nothing reserved where the message would sit).
 */

export function promptLines(text: string): string[] {
  const rawLines = text.split("\n");
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const rawLine of rawLines) {
    const isBlank = rawLine === "";
    if (isBlank) {
      if (prevBlank) continue;
      prevBlank = true;
      collapsed.push("");
    } else {
      prevBlank = false;
      collapsed.push(rawLine);
    }
  }
  return collapsed;
}

export interface ConfirmPromptParts {
  title: string[];
  /** Absent (not an empty array) when no message was sent — the component reserves no space. */
  message?: string[];
}

export function confirmPromptParts(title: string, message?: string): ConfirmPromptParts {
  return {
    title: promptLines(title),
    ...(message !== undefined ? { message: promptLines(message) } : {}),
  };
}
