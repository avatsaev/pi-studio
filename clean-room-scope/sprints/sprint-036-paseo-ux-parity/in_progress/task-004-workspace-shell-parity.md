# Task 004 — Workspace shell & header parity (Paseo)

- **Sprint:** sprint-036-paseo-ux-parity
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (tokens)

## Reference (Paseo)
- `screens/workspace/workspace-screen.tsx`, `components/branch-switcher.tsx`, pane chrome in
  `components/git-diff-pane.tsx` / `file-explorer-pane.tsx` (single bottom border header).
- Pi-Studio: `packages/app/src/components/workspace/{WorkspaceHeader,TabStrip,PaneContentRouter}.tsx`,
  `packages/app/src/router/LiveWorkspacePage.tsx`.

## What to build
- **Header**: ScreenTitle-style workspace title; project subtitle + branch via a `<Combobox>` branch
  switcher; pane chrome uses one bottom border, no shadow; right-side actions as `ghost` buttons.
- **Tab strip**: Paseo tab visual (active/idle weight+color, close affordance, trailing new-tab/split
  actions, pinned quick-launch). Surface = `surfaceWorkspace`.
- **Panes**: consistent header bar (single bottom border) across explorer/git/terminal/browser.
- Full-width working surface (not the 720 reading column).

## Acceptance criteria
- [ ] Workspace header/tabs/pane chrome visually match Paseo (weights, borders, spacing).
- [ ] Branch switcher is a Combobox fed by live git branches.
- [ ] App typecheck + vitest + `build:web` pass.

## Test / verification plan
- Visual: screenshot a workspace with 2–3 tabs + a pane; compare to Paseo.
