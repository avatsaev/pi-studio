# Task 004 — E2E: SDK + controller against a real daemon, real-Pi smoke, then docs sync — Summary

- **Sprint:** sprint-067-extension-ui-sdk
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

1. **Dev daemon export** — `packages/server/src/daemon/index.ts` now re-exports `dev-bootstrap.js`
   alongside `bootstrap.js`, so `startDevDaemon`/`DevBootstrapHandle`/`MockAgentSession` are
   reachable from `@av-pi-studio/server`'s root, exactly as `packages/server/package.json`'s
   `exports` map (root subpath only) requires. No name collisions with `bootstrap.js`'s own exports.

2. **Cross-package E2E** — `packages/cli/src/agent-ui-sdk-e2e.test.ts` (7 tests): a **real**
   `PiStudioClient` + `AgentUiController` over a **real** WebSocket (`ws`'s `WebSocket` wrapped as a
   `createWebSocketTransport` factory, not the global) against a **real** dev daemon
   (`startDevDaemon`), with only the mock provider scripted (`MockAgentSession.emitUiRequest`). All
   seven scenarios from the task's own `What to build` are covered: capability gate, answer
   round-trip (asserted at the provider via `uiResponses`, not just `{ ok: true }`), first-answer-
   wins across two clients, late-joiner rehydration from the snapshot alone (asserted zero live
   `agent_ui_request` frames reached it), reconnect resync with no consumer-initiated call,
   clear-by-omission, and archive pruning (asserted a genuine `agent_archived` frame drove it and
   **no** `agent_update` frame was involved — the regression this whole family exists to prevent).
   Ran the file three times in a row with zero flakes.

   One real bug found and fixed while writing this: `create_agent_request`'s own RPC handler
   (`agent-service.ts`) `await`s the entire initial turn — including any interactive dialog — before
   replying. A test that `await`s `client.createAgent({ initialPrompt })` before setting up its
   dialog-answer path deadlocks against a turn that is itself waiting on that answer. Fixed by
   creating the agent and immediately continuing (not awaiting the RPC), using the earlier
   `agent_update { status: "initializing" }` broadcast to learn the `agentId`, answering the
   dialog, and *then* awaiting the original `createAgent()` promise (which resolves once the turn,
   answer included, completes). This is a documented gotcha in the test file's own comments, not
   just a fix — anyone writing a second `initialPrompt`-driven interactive-dialog test here will
   need the same shape.

3. **Real-Pi smoke (dialog path only)** — see the full recorded run below. Credentials, `pi`
   binary, and a real production daemon process were all available in this environment; the run was
   executed, not skipped.

4. **Docs sync** — `packages/client/AGENTS.md`, root `AGENTS.md`, `swe/sprints/PLAN.md` (see § Docs
   sync below for the detail).

## Live real-Pi smoke run

Disposable `PI_STUDIO_HOME`/`PI_STUDIO_PI_HOME` at `/tmp/pi-e2e-067/{home,pihome}` (removed after
the run — nothing under `~/.pi-studio` or the real `~/.pi` was touched). `pihome/agent` was copied
from the environment's real Pi home so the daemon-spawned `pi --mode rpc` process had a working
model credential (`litellm.anthropic`/`azure_ai/claude-opus-4-8`, same shape sprint-066/task-006
used) — **no mock anywhere in the model path**. `@juicesharp/rpiv-ask-user-question` was already
present in that home from a prior sprint-066 run but **disabled** (a `-` prefix on its `settings.json`
extension entry, a genuinely-relevant finding — the sprint-066 run had disabled it on completion);
`pi install npm:@juicesharp/rpiv-ask-user-question --no-approve` confirmed it was already installed,
and the `-` prefix was removed from `settings.json` to re-enable it. The real production daemon
(`packages/server/dist/daemon/main.js`) was run as a real OS process on `127.0.0.1:7601` via `hub`.

A standalone Node script drove a real `PiStudioClient` (imported as `@av-pi-studio/client` from
inside the repo, so normal workspace module resolution applied):

1. Connected; `server_info.features.extensionUi` → `true`.
2. `client.createAgent({ config: { provider: "pi", cwd: "/tmp/pi-e2e-067" }, initialPrompt: "Call the
   ask_user_question tool right now …" })` fired without being awaited first (see the deadlock fix
   above); `agentId` learned from the `initializing` `agent_update` broadcast.
3. Real `agent_ui_request` observed:
   ```json
   { "type": "agent_ui_request", "method": "select", "expectsResponse": true,
     "payload": { "title": "[Color] Which color do you pick?",
       "options": ["1. Red — Pick the color red.", "2. Blue — Pick the color blue.",
                   "3. Type something."] } }
   ```
4. Answered **through `PiStudioClient.respondToUi`**, choosing "Type something.":
   `respondToUi(requestId, { value: "3. Type something." })` → `{ ok: true }`; a real
   `agent_ui_resolved { reason: "answered" }` broadcast followed immediately.
5. Real follow-up `input` dialog observed (`"[Color] Which color do you pick?\n\nType your answer:"`),
   answered **through `PiStudioClient.respondToUi`** with `{ value: "Purple" }` → `{ ok: true }`, a
   second `agent_ui_resolved` followed.
6. `createAgent()`'s own RPC then resolved (`{ agentId }`) — it had been blocked on the turn the
   whole time, exactly as expected per the deadlock finding above.
7. `fetch_agent_timeline_request` shows the tool call completing with output
   `"User has answered your questions: \"Which color do you pick?\"=\"Purple\". You can now continue
   with the user's answers in mind."` and the model's final message: `"You picked **Purple** (via
   free text). 🟣"` — direct, observed proof the answer flowed
   `PiStudioClient.respondToUi` → daemon → real Pi process → extension → tool result → model.
8. Cleanup: the agent was archived via the SDK (`client.agent(id).archive()`); daemon log confirms
   `agent archived` immediately followed by `pi process exited non-zero code: 143` (SIGTERM-on-
   archive, the same benign signature sprint-066/task-006 documented). Daemon stopped cleanly
   (`exit 0`). `/tmp/pi-e2e-067` and the two scratch driver scripts removed.

Surfaces were **not** re-attempted against real Pi here — sprint-066/task-006 already established,
live, that this Pi version's TUI-only `ctx.ui.custom(...)`/factory `setWidget` forms never reach RPC
mode as an `extension_ui_request` at all (a confirmed Pi-core limitation, not a bridge bug). Surface
rehydration/clear-by-omission is instead proven against the mock provider in the cross-package E2E
above (late-joiner rehydration, clear-by-omission scenarios), per the task's own explicit allowance.

## Docs sync

- **`packages/client/AGENTS.md`**: added item 7 to § Purpose (Extension UI SDK, "nothing renders it
  yet"); five new rows to the source layout tree (`agent-ui-state.ts`/`.test.ts`,
  `agent-ui-controller.ts`/`.test.ts`, `test-support/scripted-daemon.ts`); five new rows to
  `PiStudioClient`'s Methods table; a new `### Extension UI facade surface` subsection (event meta,
  error-convention split, the four guards and why `isAgentArchived`/`isAgentDeleted` are not
  `onAgentUpdate`, the `extensionUiAvailable()` naming rationale); a new top-level
  `## Extension UI state + controller` section covering both `agent-ui-state.ts`'s pure-module
  design (routing ladder, wholesale snapshot replacement, display-only timeouts) and
  `agent-ui-controller.ts`'s wiring responsibilities (subscribe-then-list, reconnect, generation
  guard, pruning, no optimistic respond); updated § Testing to mention the new test files and the
  one real-socket exception (`packages/cli/src/agent-ui-sdk-e2e.test.ts`).
- **Root `AGENTS.md`**: extended the existing `agent_ui_*` protocol-overview bullet with a closing
  sentence noting sprint-067 gave `packages/client` a consumer (facade + reducer/controller), proven
  against both a real dev daemon and a real `pi --mode rpc` process, but that nothing renders it yet.
- **`swe/sprints/PLAN.md`**: rewrote the `features/extension-ui-client-sdk.md` coverage paragraph
  from "fully planned" to "shipped", adding the real-daemon-E2E and real-Pi-smoke evidence in place
  of the forward-looking description, while preserving the paragraph's existing "non-rendering half
  only" framing and cost statement verbatim (still accurate — the renderer remains unplanned).

## Files created / changed

| File | Change |
|---|---|
| `packages/server/src/daemon/index.ts` | added `export * from "./dev-bootstrap.js"` |
| `packages/cli/src/agent-ui-sdk-e2e.test.ts` | created — 7 E2E tests against a real dev daemon |
| `packages/client/AGENTS.md` | Purpose item 7, source-layout rows, `PiStudioClient` methods table rows, new Extension UI facade + state/controller sections, Testing section update |
| `AGENTS.md` (root) | extended the `agent_ui_*` protocol-overview bullet |
| `swe/sprints/PLAN.md` | `features/extension-ui-client-sdk.md` coverage paragraph: planned → shipped |

(All Extension UI SDK source code — `pistudio-client.ts`'s five members, `agent-ui-state.ts`,
`agent-ui-controller.ts`, and their unit tests — was completed by tasks 001-003; this task added
only the barrel export, the cross-package E2E, the real-Pi smoke run, and the docs sync above.)

## Build & test results (full monorepo gates)

```
$ npm run clean && npm run build      # forced full rebuild
(success — all packages including web-client's Vite bundle)

$ npm run typecheck                   # tsc -b, forced clean beforehand
(success, zero errors)

$ npm run lint
exit 0, 0 errors (pre-existing warnings elsewhere in the repo; none in any file this sprint touched
or created — verified none of packages/client/src/agent-ui-*, test-support/scripted-daemon.ts, or
packages/cli/src/agent-ui-sdk-e2e.test.ts appear in the warning list)

$ npx oxfmt --check packages/client/AGENTS.md AGENTS.md swe/sprints/PLAN.md
packages/client/AGENTS.md: fixed to clean (my edits introduced the issue)
AGENTS.md: pre-existing failure (git-stash confirmed — fails identically before this task's edits)
swe/sprints/PLAN.md: outside oxfmt's scope (swe/** markdown), matching established convention

$ npm test                            # full monorepo suite
Test Files  175 passed (175)
     Tests  2247 passed (2247)

$ npx vitest run packages/cli/src/agent-ui-sdk-e2e.test.ts   # x3, checking for flakes
7/7 passed, all three runs, ~180ms each
```

## Acceptance criteria

- [x] `packages/server/src/daemon/index.ts` re-exports `dev-bootstrap.js`; `startDevDaemon` and
      `MockAgentSession` both import cleanly from `@av-pi-studio/server`'s root in `packages/cli`
      (proven by the E2E file itself importing exactly that way and passing).
- [x] All seven E2E scenarios pass against a real dev daemon over a real WebSocket, only the
      provider scripted.
- [x] The answer round-trip asserts the value reached the **provider** (`session.uiResponses.find(...)
      .response.value === "a"`), not merely that the RPC returned `ok`.
- [x] The two-client test shows `{ ok: false, reason: "not_found" }` from the loser with no throw
      (`.resolves.toEqual`, which fails the test if the promise rejects instead).
- [x] The late-joining client's state is rebuilt from the snapshot alone — asserted zero
      `agent_ui_request` frames reached it.
- [x] Reconnect resync happens with no consumer-initiated `resync()` call in the test body.
- [x] Archive clears both halves against the real daemon; the surface half attributable to a
      genuine `agent_archived` frame (asserted `seenTypes` contains it and does **not** contain
      `agent_update`).
- [x] Real-Pi smoke recorded above with actual observed frames/output — executed, not skipped
      (credentials and the `pi` binary were present in this environment).
- [x] `packages/client/AGENTS.md` documents the surface and states plainly nothing renders it yet;
      root `AGENTS.md` and `PLAN.md`'s coverage paragraph updated.
- [x] No new dependency edge in any `package.json`; no `tsconfig` reference added (verified —
      `packages/cli/package.json`'s `dependencies` is unchanged; `ws`/`@types/ws` were already
      workspace-hoisted transitively via `packages/server`'s existing dependency, imported directly
      in the test file with no new package.json entry anywhere).
- [x] Sprint gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Follow-ups / TODO(verify)

- **The rendering half of `features/extension-ui-client-sdk.md` remains unplanned**, per the
  scope's own explicit decision (see the updated `PLAN.md` coverage paragraph) — dialog components,
  status strip, widget blocks, attention-badge display, Esc-stack integration. Sprint-067 produces
  zero user-visible change; if the renderer does not follow promptly, that cost was paid for
  nothing.
- **`rpiv-todo`'s (and `pi-powerline-footer`'s) TUI-only widget/footer forms remain invisible to
  RPC-mode clients** — reaffirming sprint-066/task-006's finding; not re-investigated here since
  nothing changed in the relevant Pi version between sprints.
- The `create_agent_request`-blocks-on-the-whole-turn behavior documented above (found while writing
  this task's E2E) is pre-existing, intentional daemon behavior (not a defect this task's scope
  covers) — flagged here in case a future SDK-ergonomics task wants to give `createAgent` an
  early-return option for callers that don't want to block on interactive turns.
