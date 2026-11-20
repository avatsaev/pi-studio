/**
 * The decision behind the rename dialog, kept pure: what title, if any, does this input produce.
 */

/** The trimmed title for a changed input; `null` for a blank, whitespace-only or unchanged one. */
export function resolveRenameTitle(input: string, current: string): string | null {
  const title = input.trim();
  if (title === "" || title === current) return null;
  return title;
}
