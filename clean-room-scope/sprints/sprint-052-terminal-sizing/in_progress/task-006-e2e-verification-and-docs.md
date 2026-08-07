# Task 006 — Live E2E proof of the size contract + docs sync

- **Sprint:** sprint-052-terminal-sizing
- **Status:** in_progress — docs + automated gates done; live browser pass outstanding (owner: user)
- **Type:** test + docs
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal
Prove the whole size-ownership contract against a real daemon in a real browser, close
`terminals.md`'s acceptance list for it, and bring the docs in line — including correcting three
statements that are wrong today.

## Background / why
Every prior task in this sprint is verified in isolation; none of them individually proves the
user-visible symptom is gone. There is no component-test path for `TerminalPanel` (the root vitest
runner discovers `.test.ts` under a plain Node environment with no jsdom), so a live sequence **is**
the proof, and it is the only place the reported symptoms — ghost characters, scrambled redraws,
misalignment — are directly observable.

Three documentation defects found while scoping this sprint must be fixed here, since they actively
mislead the next reader:

1. `packages/server/AGENTS.md` § Terminal subsystem lists RPC handlers `resize_terminal` ("resize
   PTY") and "close terminal". Neither exists. Resize arrives **only** as binary opcode `0x03`; close
   is `kill_terminal_request`.
2. The same section says `ScreenBuffer` "retains the last ≤64 KiB of output as a snapshot for new
   subscribers". It does not — the 64 KiB ring is `ManagedTerminal.screen` in `TerminalManager`;
   `ScreenBuffer` is the `@xterm/headless` grid used only by `capture()`.
3. `TerminalPanel.tsx`'s comment at `:197-199` says "xterm renders to canvas". xterm 5.x defaults to
   the **DOM** renderer; canvas and WebGL are addons this app does not load.

## Scope references
- `clean-room-scope/features/terminals.md` § PTY size ownership, § Restore / snapshot, § Acceptance
  Criteria
- `clean-room-scope/features/feature-panels-ui.md` § Terminal pane (incl. the Pi-Studio
  implementation contract)
- `packages/web-client/AGENTS.md` (`features/terminal/` entry; the invariants list)
- `packages/server/AGENTS.md` § Terminal subsystem (the three corrections above)
- `packages/web-client/src/features/terminal/TerminalPanel.tsx` (stale renderer comment)

## What to build
No product code beyond fixes for anything the sequence below uncovers. Deliverables:

- **Verification record** in the task summary: each numbered step, what was run, and the observed
  result. `stty size` output and frame counts are the evidence — not "looks right".
- **Docs sync:**
  - `packages/server/AGENTS.md` § Terminal subsystem — remove the non-existent `resize_terminal` /
    "close terminal" handlers, state that resize is binary-only (`0x03`), and separate the 64 KiB
    ring (`TerminalManager`) from the `ScreenBuffer` headless grid (`capture` only). Document
    the escape-safe ring trim from task-005. The same wrong claims are restated in the source-layout
    tree (`AGENTS.md:112-113`: `screen-buffer.ts` described as a "snapshot for new subscribers",
    `terminal-rpc.ts` as handling "resize/…/close terminal") — correct both entries too.
  - `packages/web-client/AGENTS.md` — update the `features/terminal/` description: emulator mounts
    independently of the slot, the three size-claim triggers and the non-triggers, the coalesced
    refit, `terminal-size.ts` as the pure decision module. Add the size-claim rule to the invariants
    list, since it is the kind of thing a future edit silently breaks.
  - `TerminalPanel.tsx` — correct the renderer comment.
- **Close the scope checkboxes** in `terminals.md` § Acceptance Criteria that this sprint satisfies;
  leave tier-2 items for sprint-053.

## Out of scope
- Any tier-2 / reflowable restore work, appearance integration, or exited-terminal state — sprint-053.
- Adding a jsdom/component-test harness for `TerminalPanel` (deliberate: the project has no jsdom and
  the convention is to extract pure logic into `.ts` modules instead, which task-002 did).

## Acceptance criteria
Run in one session against a production daemon (`npm start`) and a real browser:

- [ ] **Fresh open.** `Ctrl+T`; `stty size` matches the rendered grid exactly; `pi-studio terminal ls`
      agrees.
- [ ] **The reported symptom is gone.** Type a command ~1.5× the viewport width, move through it with
      arrows/`Ctrl+A`/`Ctrl+E`, backspace back through the wrap point, and recall it with `↑`: no ghost
      characters, no misplaced cursor, no scrambling, correct wrap column.
- [ ] **Full width used.** `printf '%.0s-' $(seq $COLUMNS)` fills the pane edge to edge.
- [ ] **Divider drag.** One `Resize` frame at rest; `stty size` tracks; no stutter; no ResizeObserver
      console warning.
- [ ] **Splits.** A terminal opened into a narrow split pane spawns at that pane's size; dragging an
      unrelated pane's divider claims nothing until the terminal pane is focused.
- [ ] **Hidden → visible.** Tab away and back with unchanged geometry: zero frames, no reflow artifacts.
- [ ] **Reattach.** Reload with a live terminal: it restores, sends no `Resize` on attach, and one
      click claims the correct size. A terminal created by `pi-studio terminal create` behaves the same.
- [ ] **Reconnect.** Kill and restore connectivity: scrollback intact, no `Resize`, output resumes.
- [ ] **Large-output replay.** After ≫64 KiB of escape-heavy output, a reload renders a coherent
      snapshot from its first line.
- [ ] **Full-screen app.** `less` a large file, quit, reload → normal prompt, no stale scroll region.
- [ ] **Two clients.** Two browser windows at different widths on the same terminal: last-interacting
      wins; the passive one never steals the size back on its own; both render output correctly in their
      own viewport.
- [ ] **Regression sweep.** Terminal create/kill/rename via CLI still work; `pi-studio terminal capture`
      returns sensible text; agent chat, file viewer, and git panels unaffected.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass at the end of the sprint.
- [ ] Docs updated as listed above; no doc statement contradicted by the code remains.

## Test / verification plan
- Full gates: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
- Live: the numbered acceptance sequence above, driven in a browser against `npm start`, with the
  devtools WS frame list open to count binary frames and `pi-studio terminal ls` / `stty size` as the
  independent size oracles.
- Record commands + observed output in `done/task-006-e2e-verification-and-docs-summary.md`.

## Notes
Two known-wrong CLI behaviours were found while scoping and are **deliberately not** in this sprint,
because they are unrelated to sizing and belong to the CLI surface: `pi-studio terminal capture`
renders `payload.text` while the daemon returns `screen` (so it prints an empty string), and
`terminal ls` renders a `title` column while entries carry `name`. Both are in
`packages/cli/src/feature-commands.ts`. Note them in the summary as follow-ups so they are not lost.
