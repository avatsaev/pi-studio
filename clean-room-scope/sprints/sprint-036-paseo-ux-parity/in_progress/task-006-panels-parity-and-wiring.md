# Task 006 — Feature panels parity + close wiring gaps

- **Sprint:** sprint-036-paseo-ux-parity
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001 (tokens); benefits from sprint-035 (real daemon) for live data

## Reference (Paseo)
- `components/file-explorer-pane.tsx`, `components/git-diff-pane.tsx`, `docs/file-icons.md`,
  terminal + browser panes.
- Pi-Studio: `packages/app/src/components/panels/*`, `packages/app/src/panels/*`,
  `packages/app/src/components/workspace/PaneContentRouter.tsx`, `packages/app/src/router/LiveWorkspacePage.tsx`.

## What to build
- **File explorer pane**: Paseo styling (file icons per type, indentation, header with one bottom
  border, hover/active). Already wired to live data (`LiveExplorerPane`) — polish visuals.
- **File preview**: markdown/code/image/binary treatments matching Paseo.
- **Git diff pane**: unified/split diff with word-level highlight, header metadata row, Paseo colors.
- **Terminal pane**: xterm styling to match; wire to the real terminal binary stream (sprint-035 t003).
- **Browser pane**: web fallback styling.
- **Wiring gaps**: implement the `?open=` workspace intent vocabulary (`agent:`, `terminal:`,
  `file:<base64>`, `browser:`) so opening files/intents actually opens the right tab; connect Git/
  Terminal/Browser panes to live daemon data (replace remaining static `INITIAL_*` stubs).

## Acceptance criteria
- [ ] Explorer, file preview, git diff, terminal, browser panes visually match Paseo.
- [ ] `?open=file:<base64>` (and other intents) open the correct tab.
- [ ] Git and terminal panes show live data from the real daemon.
- [ ] App typecheck + vitest + `build:web` pass.

## Test / verification plan
- Unit: `?open` intent parsing → tab target.
- Visual: screenshot explorer + a diff + a terminal against a real repo.
