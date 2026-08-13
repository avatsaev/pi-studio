import { identityOf, selectEntries } from "./curated-packs.js";
import type { CuratedPackCatalog } from "./curated-packs.js";
import type { PiHomeState } from "./extensions-state.js";

/**
 * The pure sync planner: a single three-way merge over the manifest, the state file, and pi's live
 * `settings.json` (swe/features/preinstalled-extensions.md § Planner). No filesystem, no process,
 * no clock — this is the one code path behind both "what sync would do" (task 005's executor) and
 * "what we report" (a future `extensions list`, run in dry-run mode), so the two can never drift.
 *
 * The load-bearing rule (tenet 1): sync's only action is installing an identity it has never
 * successfully installed before **and** that isn't already present in `settings.json` under any
 * form — the latter matters because pi's own `pi install` matches an existing entry by
 * version-insensitive identity and rewrites it in place (see `findByIdentity` below), so
 * installing over an entry the user already added themselves — pinned, filtered, or otherwise —
 * would silently destroy it. Once an identity enters `offered`, or is found already present before
 * ever being offered, no future plan ever contains an action for it again — `user_removed`/
 * `user_modified` are terminal, reporting-only statuses.
 */

export type EntryStatus =
  | "installed"
  | "pending"
  | "failed"
  | "user_removed"
  | "user_modified"
  | "deprecated";

export interface PlannedEntry {
  identity: string;
  pack: string;
  source: string;
  addedIn: string;
  deprecated?: boolean;
  status: EntryStatus;
}

export interface SyncPlan {
  /** Installs, in manifest order. */
  actions: { identity: string; pack: string; source: string }[];
  /** Every selected entry, including no-action ones. */
  entries: PlannedEntry[];
}

/** A `PlannedEntry` with its last recorded failure attached, when one exists — shared by
 *  `ExtensionsService.describe()` (the daemon path) and the CLI's `extensions list --local`
 *  (sprint-057/task-005), so the two report identical data from the same state, never a
 *  hand-rolled second derivation. */
export interface DescribedEntry extends PlannedEntry {
  lastError?: { at: string; attempts: number; reason: string; message: string };
}

/** Attaches each entry's `state.failures[identity]`, when present, as `lastError` — one snapshot,
 *  one shape, never a second `loadExtensionsState` read by a caller (that would risk interleaving
 *  with the mutex-guarded sync writing the same file on the daemon path). */
export function attachLastErrors(
  entries: readonly PlannedEntry[],
  state: PiHomeState | "unreadable",
): DescribedEntry[] {
  const failures = state === "unreadable" ? {} : state.failures;
  return entries.map((entry) => {
    const failure = failures[entry.identity];
    return failure
      ? {
          ...entry,
          lastError: {
            at: failure.at,
            attempts: failure.attempts,
            reason: failure.reason,
            message: failure.message,
          },
        }
      : entry;
  });
}

/** Pi's own rule (`getPackageSourceString`, package-manager.js): a settings package entry is
 *  either the source string itself, or an object carrying it under `.source` (the user's own
 *  per-package filter form). */
function packageSourceString(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "source" in entry && typeof entry.source === "string") {
    return entry.source;
  }
  return undefined;
}

/** Find the settings entry matching `identity`, string or object form, without ever touching
 *  entries that don't belong to us (unparseable/local-path entries are simply skipped). */
function findByIdentity(
  settingsPackages: readonly unknown[],
  identity: string,
): { isObjectForm: boolean; sourceString: string } | undefined {
  for (const raw of settingsPackages) {
    const sourceString = packageSourceString(raw);
    if (sourceString === undefined) continue;
    try {
      if (identityOf(sourceString) === identity) {
        return { isObjectForm: typeof raw !== "string", sourceString };
      }
    } catch {
      continue; // Not an npm:/git: spec we understand — not one of ours, never examined.
    }
  }
  return undefined;
}

export function planSync(input: {
  catalog: CuratedPackCatalog;
  /** Selected slugs; `core` is implicit (added by `selectEntries`). */
  packs: readonly string[];
  /** Per-pi-home slice, or the corrupt-state fail-safe sentinel. */
  state: PiHomeState | "unreadable";
  /** Pi's live `settings.json` `packages` array — string or object entries. */
  settingsPackages: readonly unknown[];
}): SyncPlan {
  const { catalog, packs, state, settingsPackages } = input;
  const { entries: selected } = selectEntries(catalog, packs);

  const actions: SyncPlan["actions"] = [];
  const entries: PlannedEntry[] = [];

  for (const { pack, entry } of selected) {
    const identity = identityOf(entry.source);
    const base = { identity, pack, source: entry.source, addedIn: entry.addedIn };

    if (entry.deprecated) {
      entries.push({ ...base, deprecated: true, status: "deprecated" });
      continue; // Tombstone: no action, ever — checked first, ahead of any offered/failure lookup.
    }

    if (state === "unreadable") {
      // Fail-safe: plan zero actions. Statuses are unreliable in this mode by design — report as
      // if everything were already offered (wrong-and-quiet), never as "pending" (which would
      // wrongly imply the next sync retries it).
      entries.push({ ...base, status: "installed" });
      continue;
    }

    const offered = state.offered[identity];
    if (!offered) {
      // Never install over an entry the user already has, even one Pi-Studio never offered: pi's
      // own `addSourceToSettings` matches by version-insensitive identity and rewrites an existing
      // entry in place (package-manager.js's `packageSourcesMatch`/`getSourceMatchKeyForSettings`),
      // so `pi install npm:<name>` against a user's own `npm:<name>@1.2.3` would silently destroy
      // their pin. Adopt it as theirs instead of installing over it — tenet 1, no exceptions for
      // "we never touched this one yet".
      const preexisting = findByIdentity(settingsPackages, identity);
      if (preexisting) {
        entries.push({ ...base, status: "user_modified" });
        continue;
      }
      actions.push({ identity, pack, source: entry.source });
      const failed = Boolean(state.failures[identity]);
      entries.push({ ...base, status: failed ? "failed" : "pending" });
      continue;
    }

    const match = findByIdentity(settingsPackages, identity);
    let status: EntryStatus;
    if (!match) {
      status = "user_removed"; // Offered, absent from settings — a `pi remove` sticks forever.
    } else if (match.isObjectForm || match.sourceString !== offered.installedSpec) {
      status = "user_modified"; // Any edit — repin, object-filter form — permanently theirs.
    } else {
      status = "installed";
    }
    entries.push({ ...base, status });
  }

  return { actions, entries };
}
