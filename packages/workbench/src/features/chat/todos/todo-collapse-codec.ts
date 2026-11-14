/**
 * Persisted collapse state for the agent todo panel. A sibling localStorage record (not part of the
 * pane layout, which is keyed by tab identity): only COLLAPSED agent ids are stored, since expanded
 * is the default. Pure so the store only does I/O.
 */

export const TODO_COLLAPSE_STORAGE_KEY = "pi-studio-agent-todos-ui";
export const TODO_COLLAPSE_MAX_ENTRIES = 500;

/** Corrupt JSON, a wrong version or any non-string entry yields an empty set; never throws. */
export function parseCollapsed(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return new Set();
    const { version, collapsed } = value as { version?: unknown; collapsed?: unknown };
    if (version !== 1 || !Array.isArray(collapsed)) return new Set();
    if (!collapsed.every((id) => typeof id === "string")) return new Set();
    return new Set(collapsed as string[]);
  } catch {
    return new Set();
  }
}

/** Insertion order is age: past the cap the oldest ids are dropped. */
export function serializeCollapsed(collapsed: ReadonlySet<string>): string {
  const ids = [...collapsed];
  return JSON.stringify({ version: 1, collapsed: ids.slice(-TODO_COLLAPSE_MAX_ENTRIES) });
}
