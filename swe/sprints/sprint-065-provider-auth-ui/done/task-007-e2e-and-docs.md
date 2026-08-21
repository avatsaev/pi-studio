# Task 007 — Live browser E2E + docs sync

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** test + docs
- **Area:** web-client / client / docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006

## Goal
Prove the whole path works against a real daemon and a real browser — including the relay-remote case
this feature exists for — then bring the docs in line with what shipped.

## Context / why
Every earlier task verified its own slice. What none of them can show is the end-to-end claim: a
credential entered in a browser lands in the daemon host's `auth.json` and is the exact file a
daemon-spawned `pi --mode rpc` child reads. Sprint-054/task-006 and sprint-055/task-005 make the same
kind of live proof for the CLI and the wire; this is its browser counterpart.

Docs are a deliverable here, not a follow-up: this sprint adds a new web-client feature directory, a
new web-client dependency, and four SDK methods.

## Scope references
- `swe/features/provider-auth-ui.md` § Acceptance Criteria (this task closes the list)
- `swe/features/provider-auth-rpc.md` § Error Handling & Edge Cases (the daemon-side behaviors being
  exercised from the browser)
- `AGENTS.md` (root — protocol/feature summary, env-var and command tables if touched)
- `packages/client/AGENTS.md` (the four new SDK methods + the flow-correlation contract)
- `packages/web-client/AGENTS.md` (source layout for `features/provider-auth/`, the new `qrcode`
  devDependency, invariants below)

## What to build
A recorded verification run plus doc updates. No new product code — if a defect surfaces, fix it in
the owning task's files and note it here.

**Live run (production-bootstrap daemon; the dev daemon deliberately omits this RPC family):**
1. Fresh `PI_STUDIO_PI_HOME` with no `auth.json`: empty chat shows the nudge (task-006).
2. API-key login through the browser → success badge; `pi-studio auth status` **on the daemon host**
   reports the same provider configured; `auth.json` is mode `0600`.
3. A daemon-spawned agent runs a real turn using that credential (path parity, end to end).
4. OAuth-shaped flow: `auth_url` + QR + concurrent `manual_code`, completed through the manual path.
5. Cancel via Esc and via the Cancel button — daemon log shows the flow terminated, registry empty.
6. Kill the socket mid-flow (stop the daemon or drop the network): dialog shows the connection-lost
   error, no hang; on reconnect the provider list refetches.
7. Logout, including a provider backed by an ambient env var → `stillConfigured` surfaces.
8. Old-daemon compatibility: point the same build at a daemon without the `providerAuth` flag →
   no settings gear, no nudge, **zero** provider-auth frames on the wire.
9. Relay path: repeat step 2 over the relay against a remote/headless daemon — the case CLI login
   cannot serve.
10. Secret hygiene sweep: the entered key appears in no daemon log line, no outbound frame beyond its
    own `provider_auth_respond_request`, no `localStorage`, and nowhere in the DOM after submit.

**Docs:**
- `packages/client/AGENTS.md`: the four methods, the callback contract, the one-flow-per-client rule,
  and the subscribe-before-request/buffering invariant (a future refactor that "simplifies" it
  reintroduces a hang).
- `packages/web-client/AGENTS.md`: `features/settings/` + `features/provider-auth/` source-layout
  entries; `qrcode` as a devDependency and why (no runtime deps, bundled into the lazy chunk);
  invariants — provider-auth goes through SDK methods only (never `connection.request`), no secret
  ever enters a store or `localStorage`, and the settings dialog shell (gear at ConnectionBar
  top-right, category registry) is the settings IA until the routed settings screens land.
- Root `AGENTS.md`: mention the browser-side provider auth surface alongside the existing
  `pi-studio auth` CLI note, so the two halves are discoverable from one place.
- `swe/features/provider-auth-ui.md`: tick the acceptance criteria that now hold; if the settings IA
  or QR decisions changed during implementation, rewrite those sections rather than leaving a
  contradicted resolution.

## Out of scope
- Routed settings screens (`app-navigation-screens.md`'s settings IA renders the same category
  panels when that scope lands).
- CLI `--host` remote login.
- Closing the inherited OAuth callback-port `TODO(verify)` unless step 4 happens to run against a real
  subscription account — in which case record the observation.

## Acceptance criteria
- [ ] All ten live-run steps executed with results recorded in the task summary (observations, not
      assertions of intent).
- [ ] The browser-entered credential provably drives a daemon-spawned agent turn (step 3).
- [ ] The relay-remote login (step 9) succeeds.
- [ ] The secret sweep (step 10) finds zero leaks.
- [ ] Old-daemon run (step 8) shows zero provider-auth frames.
- [ ] All four doc files updated; no contradicted invariant left in place.
- [ ] Full gates green from clean: `npm run clean && npm run build && npm run typecheck &&
      npm run lint && npm run fmt:check && npm test`.

## Test / verification plan
- Gates: the full-from-clean chain above (clean matters — stale `.tsbuildinfo` has masked signature
  errors in this repo before).
- Live: the ten steps, driven manually in a real browser against a production-bootstrap daemon, with
  the daemon at `PI_STUDIO_LOG_LEVEL=debug` so cancels, flow TTLs, and frame contents are observable.
- Docs: re-read each edited section against the shipped code — no aspirational statements.

## Notes
If the relay run (step 9) exposes a flow that only completes via a daemon-host localhost callback, that
is the inherited callback-port question surfacing for real: record it in `provider-auth-rpc.md`'s
`TODO(verify)` with the observed behavior rather than working around it here.
