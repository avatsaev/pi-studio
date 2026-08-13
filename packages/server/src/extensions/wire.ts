import type { ExtensionEntryInfo, ExtensionPackInfo } from "@av-pi-studio/protocol";

import type { CuratedPackCatalog } from "./curated-packs.js";
import type { DescribedEntry, EntryStatus as PlannerEntryStatus } from "./sync-planner.js";

/**
 * Maps `DescribedEntry[]` (the planner's own output, `lastError`-attached) to the wire's
 * `ExtensionPackInfo[]` shape (task-001) — the ONE implementation, shared by the daemon's
 * `extension_packs_list_request`/`_set_request` handlers (`extensions-rpc.ts`) and the CLI's
 * `extensions list --local` (sprint-057/task-005), so the two can never render different data for
 * the same state.
 */

/**
 * Total mapping from the planner's `EntryStatus` to the wire's (plain-string) status. A `Record`
 * keyed by the imported planner type means a build error, not a silent runtime gap, the moment
 * either side gains a value the other doesn't handle.
 */
const ENTRY_STATUS_TO_WIRE: Record<PlannerEntryStatus, string> = {
  installed: "installed",
  pending: "pending",
  failed: "failed",
  user_removed: "user_removed",
  user_modified: "user_modified",
  deprecated: "deprecated",
};

function toWireEntry(entry: DescribedEntry): ExtensionEntryInfo {
  return {
    source: entry.source,
    identity: entry.identity,
    addedIn: entry.addedIn,
    ...(entry.deprecated !== undefined ? { deprecated: entry.deprecated } : {}),
    status: ENTRY_STATUS_TO_WIRE[entry.status],
    ...(entry.lastError ? { lastError: entry.lastError } : {}),
  };
}

/** Groups the planner's flat `entries` by pack, in manifest order, and attaches each pack's
 *  `title`/`description` from the catalog — the wire shape groups by pack, the planner doesn't. */
export function toExtensionPackInfoList(
  catalog: CuratedPackCatalog,
  entries: readonly DescribedEntry[],
): ExtensionPackInfo[] {
  const byPack = new Map<string, DescribedEntry[]>();
  for (const entry of entries) {
    const list = byPack.get(entry.pack);
    if (list) list.push(entry);
    else byPack.set(entry.pack, [entry]);
  }
  return Object.entries(catalog)
    .filter(([slug]) => byPack.has(slug))
    .map(([slug, pack]) => ({
      id: slug,
      title: pack.title,
      description: pack.description,
      packages: (byPack.get(slug) ?? []).map(toWireEntry),
    }));
}
