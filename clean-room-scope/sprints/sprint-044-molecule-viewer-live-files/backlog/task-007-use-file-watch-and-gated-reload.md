# Task 007 — `use-file-watch` hook + edit-gated live reload in the molecule viewer

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-003, task-006

## Goal
Reload an open molecule tab when its file changes on disk, preserving camera/selection — **unless** the
user has unsaved in-viewer edits, in which case leave their work alone.

## Background / why
Client half of task-006's push. The consumer shape is fully precedented by
`use-checkout-status.ts` (verified end to end):
- Subscribe with `client.connection.request("checkout_status_subscribe", { cwd })` (line 49).
- Receive pushes via `client.connection.onSessionMessage(handler)` (line 52), which **returns its own
  unsubscribe function** — there is no separate detach API. Capture it (the precedent names it
  `unsubscribeMessages`) and call it in cleanup. There is no `PiStudioClient` wrapper for this
  family, and none is needed.
- Narrow `unknown` with a local interface + type guard (interface 14-18, guard 20-32).
- On dependency change / unmount: call that returned unsubscriber **and** send the RPC unsubscribe
  (cleanup block 62-67) — its header comment (lines 6-7) notes the POC leaked subscriptions on cwd
  change, so this cleanup is the point.

The gate is pure composition of molviewer's verified API: `onModifiedChange` fires only on the
clean↔dirty transition (`api.d.ts:272-274`), and `sourceMode="update"` swaps geometry while preserving
camera, settings, selection (stable atom count), periodic box, and active tool (`api.d.ts:228-234`).

## Scope references
- `docs/molviewer-integration-scope.md` § 2.7 (hop 3-4), § 3.3 (the gate), § 4.6 (why no
  echo-suppression window)
- `clean-room-scope/features/file-explorer-transfer.md` § file preview freshness
- `clean-room-scope/architecture/websocket-protocol.md` § subscription families
- `packages/web-client/AGENTS.md` § hooks

## What to build
- **`packages/web-client/src/hooks/use-file-watch.ts`** (new), structurally mirroring
  `use-checkout-status.ts`:
  ```ts
  export interface UseFileWatchResult {
    /** Monotonic timestamp of the last `file_changed` push for this path; null if none yet. */
    changedAt: number | null;
  }
  export function useFileWatch(path: string | null): UseFileWatchResult;
  ```
  - No-op when `path` is null or the client is absent (an empty molecule tab must not subscribe).
  - `file_watch_subscribe` on mount/path change; on cleanup, detach the `onSessionMessage` handler
    **and** send `file_watch_unsubscribe` for the previous path.
  - Local `FileChangedMessage { type: "file_changed"; path: string }` + type guard; ignore pushes whose
    `path` !== the subscribed path (the daemon echoes the resolved path — task-006).
  - Ignore late pushes after cleanup via the same `cancelled` flag pattern (line 48/53).
- **`packages/web-client/src/features/files/MoleculeViewer.tsx`** — add the gated reload:
  - `onModifiedChange` → local `modified` state (already introduced in task-003).
  - Effect on `changedAt`: if there is no change yet, or `modified` is true, do nothing. Otherwise
    `download.refetch()`, which mints a fresh object URL → the `source` prop changes → molviewer
    reloads with `sourceMode="update"` (already `"update"` after the first load, per task-003), so the
    camera and selection survive. `useFileDownload` revokes the superseded object URL itself
    (`use-file-download.ts:46-61`) — do not revoke by hand.
  - Extract the decision as a pure helper so it is unit-testable, e.g.
    `shouldApplyRefresh({ changedAt, lastAppliedAt, modified }): boolean`, and keep the effect a thin
    caller of it.
  - Comment the `modified` branch with the § 4.6 reasoning: a future in-viewer "Save" cannot
    self-trigger a clobber, because a save can only happen while `modified === true` and the earliest
    it flips to `false` is after the write completes — at which point a reload is a content no-op.
    **No timestamp/echo-suppression window.**
  - When a reload *is* skipped because of unsaved edits, surface it: a small non-blocking indicator
    ("File changed on disk") so the user knows the tab is stale rather than silently diverging. Reuse
    an existing muted/badge style from the sibling viewers — do not build a new toast system.

## Out of scope
- The file tree's live updates (task-008) — same hook, different consumer, kept separate so each has
  its own verification.
- Any "Save"/write-back action, and therefore any reconciliation UI beyond the stale indicator above.
- Reloading the *empty* molecule tab (nothing is watched there).
- Adding a `PiStudioClient` facade method for `file_watch_*` (the precedent family has none).

## Acceptance criteria
- [ ] With a molecule tab open and no in-viewer edits, modifying the file on disk reloads the structure
      within ~1 s, and the camera position/zoom and selection are visibly preserved.
- [ ] After making an in-viewer edit, modifying the file on disk does **not** reload; the edits remain
      and the stale indicator appears.
- [ ] Undoing back to the loaded structure (molviewer resets `modified` to false) re-enables reloading
      on the next change.
- [ ] Closing the molecule tab or disconnecting stops the subscription (no pushes for a closed tab, no
      server-side watcher left — pairs with task-005/006).
- [ ] An empty ("+"-menu) molecule tab issues no `file_watch_subscribe` at all.
- [ ] Two rapid on-disk writes produce a single reload (daemon-side 150 ms coalescing, task-006).
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/files/MoleculeViewer.test.ts` — the
  `shouldApplyRefresh` helper's truth table: no change yet → false; changed & clean → true; changed &
  modified → false; already-applied `changedAt` → false (no reload loop).
- Unit: `packages/web-client/src/hooks/use-file-watch.test.ts` with a fake client (mock
  `connection.request` + `onSessionMessage`): asserts subscribe on mount, path-change resubscribe
  sends unsubscribe for the **old** path first, `changedAt` bumps only for a matching path, and full
  cleanup on unmount. Follow the `fakeClient({...})` factory pattern in
  `packages/web-client/src/stores/materialize.test.ts` (the repo's existing fake-client convention).
- Manual (the real proof, also folded into task-010): open a `.pdb`, `echo` an extra atom line into it
  from a shell, watch it reload with the camera untouched; then edit in the viewer, touch the file
  again, and confirm no reload plus the stale indicator.

## Notes
- `useFileDownload` uses `staleTime: Infinity`/`gcTime: 0`, so `refetch()` is the only way its data
  changes — exactly the explicit control this gate needs.
- Do not use the `MolViewerHandle.update()` imperative path unless the prop-driven reload proves
  insufficient; one source of truth (the `source` prop) is simpler to reason about. If `update()` does
  end up necessary, say why in the summary.
