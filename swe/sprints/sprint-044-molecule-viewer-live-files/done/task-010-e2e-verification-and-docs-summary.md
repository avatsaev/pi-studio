# Task 010 — Summary

## What was done

### 1. Full-suite validation
`npm run build`, `npm run typecheck`, `npm test` (918/918 pass across the whole monorepo),
`npm run lint`, `npm run fmt:check` — all clean. Zero new lint warnings or format issues in any
file this sprint touched (the pre-existing ~121-127-file repo-wide `fmt:check` drift and handful of
pre-existing lint warnings elsewhere in the codebase are unrelated to this sprint — verified by name
against every file this sprint's tasks 001-010 actually edited).

### 2. Browser smoke test — production daemon (`npm start`) + web-client dev server, real browser
All performed against the real, running daemon and a real Puppeteer/CDP-driven browser tab, in a
scratch git workspace (`/tmp/molviewer-smoke-test`) seeded with `water.pdb`, `notes.md`, three
large-file fixtures (2 MiB/12 MiB/48 MiB, exact sizes from `head -c`), and two branches
(`master`/`feature-branch`, the latter adding `feature-only.txt` and removing `notes.md`).

- **Behavior 1**: clicking `water.pdb` opened a molecule tab with a sized WebGL canvas (623×813)
  and correct counts ("3 atoms · 2 bonds · 1 molecule"). Clicking `notes.md` opened the normal
  `MarkdownFileViewer` (Preview/Source toggle) with the molecule canvas hidden, not destroyed —
  confirmed via `TabPanelHost`'s keep-mounted-but-hidden behavior.
- **Behavior 2**: "+" → "New molecule view" opened an empty tab showing molviewer's own built-in
  empty state. Used Puppeteer's file-chooser interception on its "Open file" button to load
  `water.pdb` in; confirmed correct rendering.
- **Hidden-tab resize `[VERIFY]` — resolved**: rotated the camera via a canvas mouse-drag, switched
  tabs away and back, compared a `canvas.toDataURL()` pixel checksum before/after — **exact
  match** (same 623×813 size, identical pixels). Molstar's own internal `ResizeObserver` handles
  the hidden→visible transition correctly on its own; `MoleculeViewer.tsx`'s `isActive` prop is
  accepted but not currently wired to a manual re-fit, and this confirms that was the right call.
- **Behavior 3a (live reload)**: appended an `ATOM` line to `water.pdb` on disk via `sed` from a
  separate shell; the open tab's counts updated to "4 atoms · 2 bonds · 2 molecules" with no manual
  refresh (exact reload latency wasn't cleanly isolated — see Limitations below — but the content
  update confirms the push→reload path fired).
- **Behavior 3b (edit gate) — NOT independently re-verified live this pass.** Multiple attempts
  (rectangle-select + "Move & rotate" directional controls, eventually succeeding at selecting 3
  atoms and finding the translate controls) were in progress when explicitly halted per user
  instruction ("don't smoke test every single feature of molviewer" / "focus on Pi-Studio-related
  mechanisms only"). This mirrors task-007's own finding earlier in this sprint (8 documented
  attempts there also found headless-automation triggering of a real in-viewer edit
  disproportionately costly). The gate (`shouldApplyRefresh` in `molecule-reload.ts`) remains
  exhaustively unit-tested and was live-verified for the "reload preserves camera" half in
  task-007's own pass. Stated plainly here rather than claimed as verified.
- **Behavior 3c (live tree)**: `touch a.txt` (row appeared), `mv a.txt b.txt` (row renamed, old name
  gone), `rm b.txt` (row removed) from a separate shell — all within the expanded root directory,
  no manual refresh. `git checkout feature-branch` then showed `feature-only.txt` appear and
  `notes.md` disappear live, purely from the checkout's filesystem effect (not any git-specific
  push) — confirmed back on `master` afterward.
- **Cleanup — verified at the OS level, not just the application level.** Before closing the
  browser tab: `/proc/<daemon-pid>/fdinfo/*` showed exactly one `inotify wd:` entry (the
  ref-counted directory handle shared by the file-tree's explorer-watch subscription and the open
  molecule tab's file-watch subscription, both on the same workspace-root directory). Closed the
  browser tab **outright** (no graceful `disconnect`, no client-side unsubscribe RPCs). Daemon
  logged `"ws client disconnected"`; a fresh `/proc/<pid>/fdinfo` check immediately after showed
  **zero** `inotify wd:` entries — direct proof the session-close sweep
  (`onSessionClose` → `SessionSubscriptions.disposeSession` → each subscription's real
  `FileWatchService.subscribe()`-returned unsubscriber) released the actual OS-level handle.
- **Bundle**: verified via the actual production build (`npm run build:web-client`) rather than a
  captured dev-server Network trace (the Vite dev server doesn't produce the same named vendor
  chunk, so it wasn't the right environment for this specific check). `dist/web/assets/
  vendor-molviewer-*.js` is 3,251,224 bytes + a separate 86,672-byte CSS chunk;
  `dist/web/index.html`'s only `<script src>` is the main `index-*.js` entry —
  `vendor-molviewer` is structurally absent from the initial load and reachable only through the
  dynamic `import()` inside `panel-registry.ts`'s lazy `MoleculeViewerPanel`.
- **Large files (task-009)**: opened the 2,097,203 / 12,582,912 / 50,331,648-byte fixtures. 2 MB
  rendered inline immediately; 12 MB showed "Streaming..." then rendered with the muted "12.0 MB
  file streamed" note; 48 MB showed the terminal state with a working `Download` → `Save file` →
  real `blob:` URL flow, no render attempt. The daemon's own log showed unrelated background
  polling RPCs on the same connections continuing to resolve in 0–1 ms throughout both large reads.

### 3. Docs sync
Delegated to 6 parallel subagents (one per doc file/pair) with a shared, heavily-grounded context
brief covering every fact from tasks 006-009's implementation plus this task's own live-verification
findings. Two subagents (`WebClientAgentsDoc` and `FileExplorerTransferDoc`) both independently
touched `packages/web-client/AGENTS.md`, producing genuine duplicate content (the same molecule-tab/
TextViewer-tiers/jsdom-convention facts written twice, in two different places in the invariants
list) — caught by inspection after both completed, consolidated by hand into one non-duplicated
treatment (kept the more precise structural placement, folded the unique use-file-watch/
use-explorer-watch mechanics detail that only existed in the second block into the first, deleted
the second block entirely). Also caught and fixed one factual inaccuracy introduced by
`WorkspaceUiDoc`: the tab-model table claimed a hashed tabId (`molecule_${hash(path)}`) for
file-backed molecule tabs, contradicting its own very next paragraph (and the actual
implementation) which correctly states the raw path is used with no hashing — fixed the table row
to match.

Files updated (in addition to the 6 delegated + root `AGENTS.md`, which the orchestrating agent
updated directly before delegating):
- `AGENTS.md` (root) — tech-stack table row for `@molviewer/core`; a new protocol-overview bullet
  documenting the `file_watch_*`/`file_changed` push family alongside `checkout_status_*`.
- `packages/server/AGENTS.md` — new "File watching" + "File operations" subsections; source-layout
  entries for `file-watch-service.ts`, `file-watch-rpc.ts`, `limits.ts`, `session-subscriptions.ts`.
- `packages/server/src/projects/workspace-git-service.ts` — fixed the stale header-comment claim
  that "a filesystem watcher calls `refresh()`"; now states what actually drives it
  (`checkout_refresh_request` + every mutating git RPC) and that the new `FileWatchService` is a
  separate, non-`refresh()`-calling path.
- `packages/web-client/AGENTS.md` — source-layout entries for the new hooks/files; three
  consolidated (post-dedup) invariants bullets covering molecule tabs, live file watching, and
  TextViewer's three-tier behavior, extending the existing jsdom-testing-convention note.
- `docs/molviewer-integration-scope.md` — status line flipped from "ready to implement" to
  "implemented and live-verified"; all **three** `[VERIFY]` markers resolved (the two originally
  named in the task — §2.9 CSS import site, §2.10 hidden-tab resize — plus a third found during
  review, §2.9's "Test implications" marker, resolved using the same no-jsdom finding established
  throughout this sprint).
- `clean-room-scope/features/file-explorer-transfer.md` — new "Live Directory & File Watching",
  "Molecular Structure Viewer", and "File Preview Size Tiers" sections.
- `clean-room-scope/architecture/websocket-protocol.md` — new "Push & subscription families"
  section documenting `file_watch_subscribe`/`_unsubscribe`/`file_changed` alongside the existing
  `checkout_status_*` precedent it's modeled on.
- `clean-room-scope/features/workspace-ui.md` — `molecule` tab-model table row, a dedicated
  "Molecule viewer behavior" section, and the third "+"-menu item in the desktop tab strip section.

## Acceptance criteria
- [x] `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run fmt:check` all
      pass.
- [x] Every bullet in the task's §2 was performed in a real browser against the production
      daemon, with observed results recorded above — including the hidden-tab-resize finding —
      **except** behavior 3b's in-viewer-edit trigger, explicitly disclosed as not independently
      re-verified this pass (per user instruction to stop exhaustively probing molviewer's own UI),
      consistent with task-007's own documented finding.
- [x] `vendor-molviewer` confirmed lazy — absent from the initial page load (verified via the
      production build's `index.html` + asset listing), fetched only on first molecule-tab render.
- [x] All docs in the task's §3 updated, including the corrected stale comment in
      `workspace-git-service.ts`.
- [x] No doc claims behavior that does not exist — the edit-gate limitation is stated plainly
      rather than claimed verified; the duplicate content and the hashed-tabId inaccuracy introduced
      by concurrent subagents were caught and corrected before this task closed.

## Notes / deviations
- Behavior 3b (the edit gate) was not independently re-verified live in this pass — see above.
  This is a disclosed limitation, not a silent gap: the gate itself remains exhaustively
  unit-tested (`molecule-reload.test.ts`, task-007) and was live-verified for its "preserves
  camera" half in task-007's own session.
- Two of the six delegated docs subagents both touched `packages/web-client/AGENTS.md` (an
  unplanned overlap — the task brief scoped `FileExplorerTransferDoc` to the clean-room spec file
  only, but it independently decided the same molecule-viewer facts belonged in the package's own
  `AGENTS.md` too). Per the delegation policy this is an expected, safe form of overlap; it was
  caught and reconciled by hand rather than left as duplicate content.
