# Task 005 — Tab identity + debounced layout persistence — Summary

- **Sprint:** sprint-048-workspace-split-panes-model
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented

`packages/web-client/src/lib/pane-layout-persistence.ts` — the versioned, client-local layout record,
keyed against stable tab identities rather than tab ids.

| Export | Contract |
|---|---|
| `tabIdentity(tab)` | Kind-prefixed stable identity, or `null` when the tab has none yet |
| `PersistedPaneLayout` / `PersistedWorkspaceLayout` | On-disk shape (`tree` typed `unknown` — untrusted) |
| `ValidatedWorkspaceLayout` | Post-load shape: parsed tree, pane refs known to exist, `activePaneId: string \| null` |
| `loadPaneLayout()` | `Map<cwd, ValidatedWorkspaceLayout>`; never throws |
| `schedulePaneLayoutWrite()` / `flushPaneLayoutWrite()` | Trailing-debounced / immediate write |
| `installPaneLayoutPersistence()` | Wires both write triggers, returns teardown |
| `PANE_LAYOUT_WRITE_DEBOUNCE_MS = 250` | |

Identities: `agent:<sessionId>`, `file:<path>`, `diff:<staged|worktree>:<path>`,
`terminal:<slot>` (null without a slot), `molecule:<path>` (null when path-less).

**Two write triggers, one debounce.** `installPaneLayoutPersistence` subscribes to `layout-store`
for structural mutations, and to `tab-store` for identity acquisition — a terminal reporting its
daemon slot through `updateData` changes no layout state at all, yet its record entry must be
rewritten or a drag-placed terminal loses its pane on reload. The tab subscription compares an
identity signature, so label/order churn does not trigger writes.

**Load is layered by blast radius**, matching the spec's edge-case table: a `version` mismatch
discards the whole record; a structurally damaged tree (via `parsePaneTree`) discards only that
workspace's entry; individual placement/`activeByPane` entries naming panes absent from the parsed
tree are dropped one by one; `activePaneId` becomes `null` when it names a dead pane, leaving the
fallback choice to task-006's install step.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/lib/pane-layout-persistence.ts` | created (245 lines) |
| `packages/web-client/src/lib/pane-layout-persistence.test.ts` | created — 16 tests |
| `sprint-048/.../task-005…md`, `task-006…md`, `sprint-049/.../task-006…md` | storage-key reference corrected (see deviations) |

## Deviations from the task file

1. **Storage key is `pi-studio-pane-layout`, not `pi-studio.pane-layout`.** The repo's only existing
   key is `pi-studio-appearance` (`theme/appearance-store.ts`); matching that convention beat matching
   the task's prose. The three task files that named the dotted form were updated in the same change.
2. **Storage goes through `localKvStore`** (`providers/kv-store.ts`) rather than raw `localStorage`,
   which is the established DI boundary — Electron substitutes a bridge-backed store at the same seam,
   and it already swallows quota/unavailable errors.
3. **`installPaneLayoutPersistence()` is explicit, not an import side effect.** Subscribing at module
   load would make the module untestable and would fire in any consumer that only wants
   `tabIdentity`. Sprint-049 calls it once at bootstrap.
4. **The debounce holds a canceller closure, not a timer handle.** `let t: ReturnType<typeof
   setTimeout>` is banned by the repo's `ts-no-return-type` rule, and a plain `number` annotation
   fails to compile — despite web-client's `"types": []`, Node's `setTimeout` overload (returning
   `Timeout`) still reaches this file through a transitive dependency's declarations. Holding
   `() => clearTimeout(handle)` keeps the handle's type inferred and works in both environments.

## How it satisfies the scope

- § Persisted layout record — one versioned record, an entry per workspace with `tree`, `placement`,
  `activeByPane`, `activePaneId`, keyed by normalized cwd.
- § Tab identity — the five kind-prefixed shapes; identity-less tabs omitted from `placement`.
- § Data & Persistence — trailing debounce rather than per-drag-frame writes; identity acquisition
  counts as a mutation; sizes renormalized on load; nothing sent to the daemon.

## Build & test results

```
$ npx vitest run packages/web-client/src/lib/pane-layout-persistence.test.ts
✓ packages/web-client/src/lib/pane-layout-persistence.test.ts (16 tests) 9ms
Test Files  1 passed (1)
     Tests  16 passed (16)

$ npm run build:web-client          # tsc -b && vite build
✓ built in 7.72s

$ npx oxlint <the two new files>
lint-exit:0   (no warnings)

$ npx oxfmt <the two new files>
Finished in 99ms on 2 files
```

An intermediate `tsc -b` failure (`Type 'Timeout' is not assignable to type 'number'`) is what
surfaced deviation 4; it is fixed, and the build above is the post-fix run.

## Acceptance criteria

- [x] `tabIdentity` returns the five documented shapes — one assertion per kind, both `diff` variants.
- [x] A slot-less terminal and a path-less molecule return `null`.
- [x] A `file` tab and a `molecule` tab on the same path produce distinct identities.
- [x] Save skips identity-less tabs from `placement`/`activeByPane` without dropping the pane — the
      slot-less terminal's pane id is still asserted present in the written tree.
- [x] A burst of 20 `resizeDivider` mutations produces exactly **one** `setItem` after the debounce
      window, and none before it (fake timers).
- [x] A terminal gaining its slot via `updateData` triggers one write containing `terminal:9`.
- [x] Load with a wrong `version` returns an empty map.
- [x] Load with one malformed workspace entry (a split with a single child) keeps only the good one.
- [x] Placement and `activeByPane` entries naming absent panes are dropped; `activePaneId` naming a
      dead pane becomes `null`.
- [x] Corrupt JSON returns an empty map without throwing — asserted over seven hostile payloads
      (`"not json"`, `null`, a string, a number, `[]`, `{}`, a version-only object).
- [x] Save → load round-trips a two-workspace layout structurally intact (tree identity, both
      placements, both actives, `activePaneId`).

Plus two cases beyond the criteria: a non-identity tab change (label rename) writes nothing, and
teardown stops writes.

## Follow-ups / TODO(verify)

- `installPaneLayoutPersistence()` has no caller yet — sprint-049 task-001/002 wires it into app
  bootstrap alongside a `pagehide` → `flushPaneLayoutWrite()` handler, so a reload mid-debounce does
  not lose the last mutation.
- Still inert: nothing imports this module in the running app.
