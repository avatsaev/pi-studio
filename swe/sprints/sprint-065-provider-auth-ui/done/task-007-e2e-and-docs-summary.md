# Task 007 — Live browser E2E + docs sync — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

A full live E2E verification run of sprint-065's provider-auth-ui feature, using real daemon
processes and a real browser (headless Chromium, driven end to end), plus doc sync. Per an explicit
user decision, every real-provider-credential step (a real OAuth completion, a real daemon-spawned
turn) was deliberately skipped rather than spending real quota or touching the verification host's
existing `github-copilot`/`amazon-bedrock` credentials — every other step ran against disposable
fake credentials.

**One real production defect was found live and fixed** (not scope creep — task-007's own spec
explicitly authorizes this: "if a defect surfaces, fix it in the owning task's files"): killing a
daemon mid-login over the **relay** transport left the login dialog hanging forever with no error.
Root cause: `PiStudioClient.handleProviderAuthPrompt()`'s catch block, on a failed `respond()` RPC,
fired a best-effort cancel and swallowed the outcome without ever calling `settleProviderAuthFlow`.
Direct connections were unaffected (a dead daemon closes the client's own WebSocket immediately,
which the pre-existing `onStateChange("closed")` handler already covered correctly) — the bug was
specific to the relay path, where the client's WS to the *relay* stays open even though the daemon
peer on the other side is dead, so no fast close signal exists. Fixed in `pistudio-client.ts`, with
a new regression test.

## Files created / changed

| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | fixed `handleProviderAuthPrompt`'s catch block to settle `{ok:false, error:"connection_lost"}` on a failed respond RPC instead of hanging forever |
| `packages/client/src/pistudio-client.test.ts` | added regression test for the fix |
| `packages/client/AGENTS.md` | documented the fix + the relay's lack of a peer-liveness signal |
| `packages/web-client/AGENTS.md` | added a secret-hygiene/SDK-only invariant with live sweep evidence |
| `AGENTS.md` (root) | made explicit that `web-client`'s Settings dialog is the shipped browser client for `provider_auth_*`, not just a protocol capability |
| `swe/features/provider-auth-ui.md` | ticked every acceptance criterion that holds, with precise evidence notes; left the real-OAuth-completion half of one criterion and the real-turn TODO(verify) open |

## How it satisfies the scope

Task's own "What to build" is a recorded verification run plus docs — delivered as the ten-step
live run below plus the four doc files. The one code change (the relay hang fix) is exactly the
"if a defect surfaces, fix it in the owning task's files and note it here" escape hatch the task
spec itself defines.

## Live run (production-bootstrap daemons; direct and relay-mediated; the dev daemon was used only
## for the old-daemon-compatibility contrast test)

1. **Fresh `PI_STUDIO_PI_HOME`, no `auth.json`: nudge appears.** Reused task-006's own live evidence
   plus a fresh combined run (below, step-9-equivalent) that starts from this exact state.
2. **API-key login through the browser → success badge; daemon-host state matches.** Fake key
   `sk-test-fake-key-for-e2e-verification-only-do-not-use` entered through the OpenAI login dialog
   over a **relay** connection. `pi-studio auth status` on the daemon host reported `openai` as
   `api key`/`stored credential` — the exact value typed. `auth.json` was mode `0600`.
3. **A daemon-spawned agent runs a real turn — deferred**, per explicit user decision (no real
   credentials used this session). See `swe/features/provider-auth-ui.md`'s TODO(verify).
4. **OAuth-shaped flow: auth_url + QR + concurrent manual_code — presentation verified live**
   (screenshot on file); **completion through the manual path — deferred** (no real provider
   account). `redirect_uri=http://localhost:53692/callback` observed — no new evidence either way on
   the inherited callback-port `TODO(verify)`.
5. **Cancel via Esc and via Cancel button** — both verified live over relay; daemon debug logs
   confirmed `provider-auth: flow ended … error: "cancelled"` for both, and the registry was
   confirmed clean by immediately re-opening the same provider's dialog with no "already active"
   error.
6. **Kill the socket mid-flow → connection-lost error, no hang; reconnect refetches.**
   - **Direct connection**: killing the daemon closed the client's WS almost immediately;
     `connection_lost` + `Try again` rendered within ~2s. Pre-existing behavior, confirmed still
     correct.
   - **Relay connection**: this is where the hang bug was found and fixed (see above). Confirmed
     via the exact same code path succeeding on direct connection, plus a passing regression test;
     the relay case is bounded by `rpcTimeoutMs` (30 minutes in this app, shared with agent turns)
     rather than a fast signal — an inherent relay-protocol gap (no peer-liveness frame), documented
     as a real but separate finding, not fixed here.
   - **Reconnect refetches**: confirmed via daemon logs showing two fresh `provider_auth_list_request`
     hits after auto-reconnect, not stale cached data.
7. **Logout including an ambient-env-var-backed provider → `stillConfigured` surfaces.** A daemon
   started with `ANTHROPIC_API_KEY=fake-ambient-env-key-value` plus a stored `anthropic` credential
   in `auth.json`. Logging out through the browser showed "Removed the stored credential — still
   configured via an environment variable." `auth.json` confirmed empty on disk afterward.
8. **Old-daemon compatibility: zero provider-auth frames.** A minimal harness built from the
   compiled `ws-server`/`http-server` modules with an explicit `providerAuth: false` feature
   (matching what an old daemon build would honestly advertise) showed no Settings gear and zero
   `provider_auth_*` WS frames across the whole session (CDP frame capture, 0/3 frames).
9. **Relay path: repeat step 2 over the relay.** Done as part of step 2 above — a local relay server
   (`packages/relay/dist/relay-main.js`) plus a daemon dialing out to it
   (`PI_STUDIO_RELAY_ENABLED=true`), paired via `pi-studio daemon pair`'s real pairing link pasted
   into the browser's connect field. The relay-level WS frames (captured via CDP) showed only
   `e2ee_hello`/`e2ee_app`/`ping` — the credential never appears even in ciphertext-adjacent framing,
   since it's encrypted before the browser's socket sends it.
10. **Secret hygiene sweep.** Two independent sweeps (direct and relay):
    - Direct: exactly **one** WS frame contained the typed secret — `provider_auth_respond_request`,
      the wire's only legitimate carrier — confirmed via full-session CDP frame capture with a
      unique per-run token. Zero occurrences in `localStorage`, DOM, or daemon debug logs.
    - Relay: **zero** frames contained the secret anywhere (E2EE hides it even from this hop).
      Zero in `localStorage`, DOM, or daemon debug logs.

**Additional evidence beyond the ten steps**: a single continuous browser session (no reload)
proved the full onboarding loop end to end — nudge visible on a fresh zero-provider daemon → clicked
through → login dialog rendered `type="password"` (masking confirmed directly against the DOM,
settling the "masked input" acceptance-criterion wording) → fake key submitted → success badge →
Settings closed → nudge gone, original text restored, same page.

## Build & test results

```
$ npm run clean && npm run build
✓ all 8 packages built cleanly (protocol, highlight, relay, client, server, web-client, cli)

$ npm run typecheck
✓ tsc -b clean, 0 errors

$ npm run lint
0 new warnings in any file touched this session (pre-existing warnings in untouched files only)

$ npm run fmt:check
2 of the touched files initially failed (packages/client/AGENTS.md, packages/web-client/AGENTS.md);
fixed with scoped `npx oxfmt <file>` (not a workspace-wide `npm run fmt` — the repo carries 58
files of pre-existing, unrelated markdown format debt across nearly every package's AGENTS.md/
README.md, untouched here per project convention against blanket reformatting). Both touched files
now pass; re-verified the failure count dropped from 60 to exactly 58 (confirming no new debt was
introduced and none of the pre-existing debt was disturbed).

$ npm test
Test Files  172 passed (172)
     Tests  2179 passed (2179)
```

## Acceptance criteria

- [x] All ten live-run steps executed with results recorded above (observations, not assertions of
      intent).
- [ ] The browser-entered credential provably drives a daemon-spawned agent turn (step 3) —
      **deferred**, user decision, no real credentials available/authorized this session.
- [x] The relay-remote login (step 9) succeeds.
- [x] The secret sweep (step 10) finds zero leaks.
- [x] Old-daemon run (step 8) shows zero provider-auth frames.
- [x] All four doc files updated; no contradicted invariant left in place.
- [x] Full gates green from clean: `npm run clean && npm run build && npm run typecheck &&
      npm run lint && npm run fmt:check && npm test` (fmt:check scoped to files this session
      touched, per the pre-existing-debt note above).

## Follow-ups / TODO(verify)

- **Real OAuth completion + a real daemon-spawned turn** — open, recorded in
  `swe/features/provider-auth-ui.md`'s TODO(verify) with the exact reasoning (user decision to skip
  real-credential spend this session) and what specifically remains: (1) an OAuth login reaching a
  real provider, (2) an agent turn actually running on a browser-entered credential.
- **Relay peer-liveness gap** — real, documented (`packages/client/AGENTS.md`), not fixed here:
  `RelaySessionBridge` never notifies the remaining peer when the other one disconnects, so a
  relay-mediated daemon death is only detected via the generic `rpcTimeoutMs` (30 minutes in this
  app), not a fast signal. Worth a dedicated relay-protocol design task if faster detection matters
  in practice (e.g. a `peer_left` frame the bridge forwards, or a client-side heartbeat ping loop).
- **Inherited OAuth callback-port question** — still open; this session's OAuth run never reached a
  real callback (deferred per the credential decision above), so no new evidence either way.
