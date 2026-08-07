# Task 005 — Tab identity + debounced layout persistence

- **Sprint:** sprint-048-workspace-split-panes-model
- **Status:** done
- **Type:** feature
- **Area:** web-client / stores
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003, task-004

## Goal
Persist the layout record per client against **stable, kind-prefixed tab identities** (never raw tab
ids), written on a trailing debounce, loaded and validated on startup.

## Context / why
Terminal tab ids are not stable across sessions: `openNewTerminal` mints `term-new-<n>`
(`tab-store.ts:230`) with `data.slot: null`, while `use-terminal-restore.ts:61` reopens the same
terminal as `term-<slot>`. Persisting raw ids therefore loses every terminal's pane on reload. The
spec's answer is a per-kind *identity* — and identity keys are **kind-prefixed** so a `file` tab and
a `molecule` tab on the same absolute path can never collide in `placement`.

Two write-trigger subtleties:
- Writes are **debounced trailing** — a divider drag mutates per pointer-frame and must not write
  per frame.
- **Acquiring an identity counts as a mutation**: when `TerminalPanel` reports the daemon slot via
  `updateData` (tab-store.ts:199), the record must be rewritten — otherwise a terminal placed by
  drag and never touched again loses its pane on reload.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Persisted layout record, § Tab identity,
  § Data & Persistence
- `packages/web-client/src/stores/tab-store.ts` — `tabIds` (217–223), `openNewTerminal` (230),
  `updateData` (199)
- `packages/web-client/src/hooks/use-terminal-restore.ts` — slot-derived restored ids (61)
- Create: `packages/web-client/src/lib/pane-layout-persistence.ts`
- Create: `packages/web-client/src/lib/pane-layout-persistence.test.ts`

## What to build
Create `packages/web-client/src/lib/pane-layout-persistence.ts`:

```ts
/** Stable cross-session identity, or null when the tab has none yet. Kind-prefixed. */
export function tabIdentity(tab: Tab): string | null;
// chat      -> `agent:<sessionId>`
// file      -> `file:<absolute path>`
// diff      -> `diff:<staged|worktree>:<absolute path>`
// terminal  -> data.slot != null ? `terminal:<slot>` : null
// molecule  -> data.path != null ? `molecule:<path>` : null

export interface PersistedWorkspaceLayout {
  tree: unknown;                            // parsePaneTree-validated on load
  placement: Record<string, string>;        // identity -> pane id
  activeByPane: Record<string, string>;     // pane id -> identity
  activePaneId: string;
}
export interface PersistedPaneLayout {
  version: typeof PANE_LAYOUT_VERSION;
  workspaces: Record<string, PersistedWorkspaceLayout>;  // keyed by normalized cwd
}

export function loadPaneLayout(): Map<string, ValidatedWorkspaceLayout>;
/** Trailing-debounced (~250 ms); identity-less tabs are simply omitted from placement. */
export function schedulePaneLayoutWrite(): void;
export function flushPaneLayoutWrite(): void;   // for tests and pagehide
```

- Storage: one `localStorage` key (`pi-studio-pane-layout`). Follow the existing client-persistence
  conventions used by the web-client's other persisted stores.
- **Save** — snapshot `layout-store` + `tab-store`: map each placed tab id to its identity (skip
  identity-less tabs), write `activeByPane` as identities, include `focusedPaneId` as
  `activePaneId`.
- **Load** — `version !== PANE_LAYOUT_VERSION` → discard the whole record. Per workspace:
  `parsePaneTree` the tree; `null` → discard that workspace's entry only. Drop placement entries
  naming panes absent from the parsed tree. Never throw on any input (corrupt JSON → empty result).
- **Triggers** — subscribe to `layout-store` (any mutation) AND to `tab-store` for the
  identity-acquisition case: a tab whose `tabIdentity` transitions null → non-null schedules a
  write. Both go through the same debounce.

## Out of scope
- Consuming the loaded record as restore claims, settle point, pruning (task-006).
- Focus/`activePaneId` runtime application (task-006).
- Any UI.

## Acceptance criteria
- [ ] `tabIdentity` returns the five documented shapes; a slot-less terminal and a path-less
      molecule return `null`.
- [ ] A `file` tab and a `molecule` tab on the same path produce distinct identities.
- [ ] Save skips identity-less tabs from `placement` and `activeByPane` without dropping the pane.
- [ ] A rapid burst of mutations produces exactly one write after the debounce window (fake timers).
- [ ] A terminal gaining its slot via `updateData` triggers a scheduled write with the
      `terminal:<slot>` identity present.
- [ ] Load with a wrong `version` returns an empty map.
- [ ] Load with one malformed workspace entry drops only that workspace; others survive.
- [ ] Placement entries naming a pane absent from the tree are dropped at load.
- [ ] Corrupt JSON in the storage key returns an empty map without throwing.
- [ ] Save → load round-trips a two-workspace layout structurally intact (identities, tree,
      `activePaneId`).

## Test / verification plan
- Tests: create `packages/web-client/src/lib/pane-layout-persistence.test.ts` using vitest fake
  timers and a stubbed `localStorage` — one case per acceptance criterion. Run
  `npx vitest run packages/web-client/src/lib/pane-layout-persistence.test.ts`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.

## Notes
- Nothing about panes goes to the daemon — this is strictly client-local presentation state.
- Cross-client sync of arrangements is an open spec TODO(verify); do not design for it here.
