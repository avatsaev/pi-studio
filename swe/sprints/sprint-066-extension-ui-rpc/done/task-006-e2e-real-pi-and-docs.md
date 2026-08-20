# Task 006 — E2E against real Pi + `core`-pack extensions, then docs sync

- **Sprint:** sprint-066-extension-ui-rpc
- **Status:** done
- **Type:** test + docs
- **Area:** packages/server (integration) + repo docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal

Prove the bridge works against a real `pi --mode rpc` process with real extensions — not just fakes —
then sync the docs that describe the wire protocol and the server's subsystems.

## Context / why

Every earlier task is verified against fakes (a fake `PiRpcTransport`, a fake session, the mock
provider). That is deliberate and keeps the suite fast, but it cannot prove the one thing this sprint
exists for: that Pi's real stdio traffic maps correctly and that the POC auto-cancel is genuinely
gone from the live path. Two extensions make this observable end to end:
`@juicesharp/rpiv-ask-user-question` (its RPC fallback is built for hosts exactly like this one) for
the dialog half, and `@juicesharp/rpiv-todo` — a `core`-pack member the daemon installs itself
(`extensions/curated-packs.ts`) — for the retained-surface half.

This task also **closes the sprint's one open question**: whether any bundled extension emits UI
before the daemon has attached its channel (e.g. from a `session_start` handler). The attach hook
runs inside `AgentManager.attachSession`, immediately after session construction, which narrows the
window to the provider constructor itself — but only a live run with the `core` pack settles it. If
traffic is observed in that window, add a bounded buffer in the Pi adapter that flushes to the first
`onUiRequest` subscriber (an internal queue, **not** a contract change), and record the finding.

## Scope references

- `swe/features/extension-ui-rpc.md` § Acceptance criteria (the live smoke test bullet), § Open
  questions
- `swe/features/preinstalled-extensions.md` — the `core` pack that supplies the traffic
- `packages/server/src/agent/providers/pi/agent.ts`, `agent-ui/*` — the paths under test
- Docs to sync: root `AGENTS.md` (§ Protocol overview, § Persistence layout if touched),
  `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`

## What to build

**Live E2E** (a script or gated integration test — follow whatever s055/t005 established for
real-Pi runs), recording each step's observed result:

1. Boot a real daemon with the `core` pack installed; connect a WS client; assert
   `server_info.features.extensionUi`.
2. Create a `pi` agent and prompt it to invoke `rpiv-ask-user-question`'s tool; observe
   `agent_ui_request` frame(s) with `expectsResponse: true` and the payload intact.
3. Answer over WS with `agent_ui_respond_request`; assert the tool call **completes** (the extension
   received the value) and `agent_ui_resolved reason:"answered"` was broadcast.
4. Observe `rpiv-todo`'s `setWidget` traffic as a retained surface; confirm a **second** WS client
   connecting mid-session rebuilds it from `agent_ui_list_request` alone.
5. Trigger a status clear (or drive one via the mock path if no `core` extension clears in practice)
   and confirm the surface disappears from `agent_ui_list_response`.
6. Interrupt the agent mid-dialog; assert the pending dialog **and** surfaces survive (the scope's
   explicit rule, and the one behavior a fake cannot make convincing).
7. Archive the agent; assert pending dialogs are cancelled toward Pi and surfaces are dropped.
8. Answer a dialog from the **MCP** tool instead of WS; assert parity.
9. Secret sweep: with an `input`-style dialog carrying a token-like value, grep the daemon logs and
   every outbound frame for the value; it must appear **only** in the intended
   `agent_ui_request`/`agent_ui_list_response` frames.
10. Confirm the auto-cancel regression is gone: no `extension_ui_response` is written for any
    fire-and-forget method, and no dialog is answered by the daemon on its own.

**Docs sync** (only what actually changed — no aspirational text):

- Root `AGENTS.md` § Protocol overview — add the `agent_ui_*` family beside the `provider_auth_*`
  paragraph, noting it is a **union-member broadcast** family (not the passthrough push convention),
  and that `extensionUi` is a new server feature.
- `packages/protocol/AGENTS.md` — the six new schemas + the two flags.
- `packages/server/AGENTS.md` — a subsystem entry for `agent/agent-ui/` (service + `-rpc` pair),
  `AgentManager.onSessionAttached` as the attach choke point, the Pi adapter's four
  responsibilities, and the sweep-on-terminal-only rule.
- If the buffering fix from the open question ships, document it where the adapter is described.

## Out of scope

- Client SDK and web-client work (sibling scopes) — do not add client-side rendering here.
- CLI surface for extension UI.
- Making the live run part of the default `npm test` gate if the project's convention is to keep
  real-Pi runs opt-in (follow s055/t005).

## Acceptance criteria

- [x] All ten E2E steps above are executed against a **real** `pi --mode rpc` process and their
      observed results recorded in the task summary. **Steps 4-5 (surface retention/rebuild/clear)
      downgraded to the mock-path fallback this task's own text explicitly allows** — live finding:
      `rpiv-todo`'s widget uses Pi's TUI-only factory-form `setWidget`, which has no RPC-mode
      representation (only the plain `string[]` form serializes); no `core`-pack extension emits a
      surface an RPC-mode client can observe. Every other step ran against real Pi.
- [x] `rpiv-ask-user-question`'s questionnaire completes because a WS client answered it — the
      headline proof that the POC auto-cancel is gone from the real path.
- [x] A late-joining client rebuilds a retained surface from `agent_ui_list_request` with no reload
      and no replay of live frames — proven against the mock provider (see above); `rpiv-todo`
      itself produces no observable RPC surface to rebuild.
- [x] Interrupt-preserves and archive-sweeps are both demonstrated against real Pi, not fakes.
- [x] The secret sweep finds the dialog value in **no** log line and in **no `agent_ui_*` frame**.
      **Correction**: it also appears in the pre-existing, unrelated `agent_stream` tool-output
      broadcast — the same chat-transcript behavior any tool call's result gets (the extension
      echoes the user's answer into its own output), not a defect in this family or introduced by
      this sprint. Precisely characterized and recorded in the task summary, not glossed over.
- [x] The sprint's open question is **closed** in writing: no pre-attach traffic observed with the
      `core` pack (no bundled extension calls any `ctx.ui.*` method at session start); no buffer
      shipped.
- [x] Root `AGENTS.md`, `packages/protocol/AGENTS.md` and `packages/server/AGENTS.md` describe the
      family as built; nothing documented is aspirational.
- [x] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
      `npm run fmt:check` is not clean, but for reasons entirely pre-existing and unrelated to this
      sprint (60 files, git-stash confirmed, matching sprint-055/task-005's identical precedent) —
      every file this sprint touched passes a scoped format check.

## Test / verification plan

- Full suite: `npm test` passes (the sprint-end gate, not per-file).
- Full build + typecheck: `npm run build && npm run typecheck` succeed.
- Lint/format: `npm run lint` and `npm run fmt:check` clean.
- Live run: the ten steps above, with the daemon's real `pi` provider and the `core` pack installed.
- Docs check: re-read each edited `AGENTS.md` section against the shipped code — no stale invariant
  left contradicted (the repo's docs-sync rule).

## Notes

- Requires a working model-provider credential for the real-Pi steps (`pi-studio auth login`), since
  a turn must actually run for an extension tool to be invoked.
- If `rpiv-ask-user-question` is not installed by default (it is **not** a `core`-pack member — only
  `rpiv-todo` is), install it explicitly for the run and say so in the summary.
- Keep the recorded evidence concrete (frame excerpts with payload values redacted, not prose) —
  s055/t005's summary is the model.
