# Task 002 — A dialog raised during a session's first turn must be answerable

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** backlog
- **Type:** bugfix
- **Area:** web-client / stores, features/chat
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Guarantee that a dialog raised during a session's very first turn is renderable and answerable —
nothing user-facing may be gated on an RPC promise that cannot resolve until the dialog is answered.

## Context / why
`createAgent` with an `initialPrompt` does not resolve until the agent's whole first turn completes,
dialogs included — sprint-067/task-004 hit that as a real deadlock in the E2E and had to fire
without awaiting, correlate on the `initializing` broadcast, answer the dialog, and only then await
the promise.

**The web-client does not have that shape** — verified during this sprint's review:

- `stores/tab-store.ts` `openNewChat` renders the tab and sidebar row **synchronously** from
  `createSession`/`open`, before any RPC.
- `stores/materialize.ts` `ensureMaterialized` calls `createAgent({ config, labels: {} })` with
  **no `initialPrompt`** — the daemon's deferred-draft branch persists the record without spawning
  a provider process, so that promise never spans a turn.
- The first prompt goes through `Composer.tsx` `submit` → `client.agent(agentId).send(prompt, …)`,
  whose rejection is deliberately swallowed ("the stream is the source of truth").

So the createAgent-shaped deadlock cannot occur here. What has **not** been verified is the same
hazard one seam over: `agent(agentId).send()`'s promise resolves when the daemon's turn handling
replies, and a dialog-blocked turn can outlive the client's default `rpcTimeoutMs`. If anything
user-facing is gated on that promise — composer re-enable, "sending" state, an error toast on
rejection, retry logic that would re-send the prompt — a long-pending dialog would surface as a
spurious failure or a duplicate turn exactly when the user is being asked a question. Root
invariant 6 (`rpcTimeoutMs` ≠ socket death) protects the socket, not the UI's reaction to the
rejected promise.

This task is deliberately **investigate-then-act**: establish what `send()`'s promise actually
gates, then either fix or regression-lock it.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 06 (a pending card must be
  reachable for any session the user can open)
- `swe/sprints/sprint-067-extension-ui-sdk/done/task-004-e2e-and-docs-summary.md` (the
  createAgent deadlock — the SDK-shaped sibling of this hazard)
- `packages/web-client/src/stores/materialize.ts` (`ensureMaterialized`, deferred-draft
  `createAgent`)
- `packages/web-client/src/stores/tab-store.ts` (`openNewChat` — synchronous render, eager
  materialize)
- `packages/web-client/src/features/chat/Composer.tsx` (`submit` — the send path and its catch)
- `packages/client/src/pistudio-client.ts` (`agent(…).send`, the client's `rpcTimeoutMs` default)

## What to build
1. Establish and record in the task summary: when does `agent().send()`'s promise settle relative
   to turn completion, what is the effective `rpcTimeoutMs` on that call, and what — if anything —
   in `Composer.tsx` or the stores changes user-visible state when it resolves, rejects, or times
   out while the turn is still running.
2. If any user-facing behavior degrades while a dialog holds the turn open past the timeout
   (error surfaced, composer stuck in a sending state, prompt re-sent, session marked failed) —
   fix it so a dialog-blocked turn is indistinguishable from any other long turn: the composer
   stays usable, the stream drives all state, and no duplicate send can result.
3. If nothing degrades — add a regression lock (pure-module test over the send-path decision
   logic, extracting it if needed) so a future refactor cannot quietly start trusting the send
   promise for UI state.

Either way the observable contract is: **with a dialog pending in the first turn, the session and
its transcript are fully interactive, no error is shown, and answering the dialog lets the turn
complete normally — even when the dialog is answered minutes later, past the RPC timeout.**

## Out of scope
- Any change to daemon-side turn/RPC semantics, or to `createAgent`'s blocking behavior
  (sprint-067/task-004 raises an SDK early-return option; not this sprint's call).
- Rendering the dialog card itself (tasks 005–007) — this task only guarantees the surface that
  will host it stays healthy while a dialog is pending.
- The deferred-draft materialize path itself — it is verified correct above; do not "fix" it.

## Acceptance criteria
- [ ] The summary records the verified answers to step 1 (promise timing, timeout value, what is
      gated), with file/line references.
- [ ] With the mock provider scripted to raise a dialog in the first turn (`#ui select`, task-001)
      and the dialog left unanswered past the client's `rpcTimeoutMs`: no error toast/banner, no
      composer lockup, no duplicate prompt, and the WebSocket stays connected.
- [ ] Answering the dialog after that timeout completes the turn normally (mock echoes the answer).
- [ ] A genuine send failure (daemon down) still surfaces the existing failure behavior — the fix
      must not swallow real errors along with timeout noise.
- [ ] Whichever branch applied, a test locks the behavior so it cannot silently regress.

## Test / verification plan
- Tests: pure-module coverage of whatever send-path decision logic step 2/3 touches or extracts —
  no jsdom by convention. If the behavior is already safe and fully stream-driven, the lock can be
  a test over the existing pure logic plus an assertion that the composer state machine takes no
  input from the send promise.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Dev daemon (mock provider), new session, first prompt `#ui select timeout=300`. Wait ~90s without
answering (past the default RPC timeout), then answer. Expected: no error appears at any point, the
composer stays usable throughout, and the answer completes the turn with the mock's echo. Before
tasks 005+ land the card is not yet visible, so the interim check is narrower: no error, no lockup,
and the turn completes once the dialog is answered from a second client (e.g. the sprint-067 E2E
harness pattern).

## Notes
The createAgent-with-`initialPrompt` deadlock remains real for SDK/CLI consumers — it is simply not
this client's shape, because materialization is deferred-draft by design (`materialize.ts` module
header). If a future feature adds a combined create-and-run path to the web-client, it inherits the
sprint-067 fire-then-correlate obligation; say so in the summary if you touch anywhere near it.
