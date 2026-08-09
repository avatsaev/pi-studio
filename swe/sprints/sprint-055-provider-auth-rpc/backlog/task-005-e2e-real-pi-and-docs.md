# Task 005 — Live E2E over a real daemon with real Pi + docs sync

- **Sprint:** sprint-055-provider-auth-rpc
- **Status:** backlog
- **Type:** test + docs
- **Area:** packages/server (daemon E2E), AGENTS.md (root, protocol, server)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003, task-004

## Goal

Prove the family works end-to-end against a **real daemon, real WebSocket, and the real Pi runtime**
— a credential logged in over the wire must be the credential a daemon-spawned agent uses — then
bring the docs in line.

## Context / why

Every prior task tests against fakes. The failure this sprint most needs to exclude is a *path
parity* bug: a credential written to a different `auth.json` than spawned agents read would pass
every unit test and be useless in production. Sprint-054 caught two real bugs (secret echo, SIGINT
handling) only at this stage — unit tests structurally could not see them.

## Scope references

- `swe/features/provider-auth-rpc.md` § Acceptance Criteria, § Data & Persistence
- `packages/server/src/daemon/bootstrap.test.ts` — the real-daemon + real-WebSocket harness to reuse
- `swe/sprints/sprint-054-provider-auth-cli/done/task-006-*` — the CLI sibling's live-run sequence
- Docs: root `AGENTS.md` (protocol section, config/env table if touched),
  `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`

## What to build

**A. Live verification sequence** (real `startDaemon` on a temp `PI_STUDIO_HOME` + temp `piHome`,
real client socket, real Pi runtime — no mocks). Record every command and result in the summary:

1. `provider_auth_list_request` on an empty `piHome` lists the real login-capable providers, all
   unconfigured, no stray files created beyond what Pi itself writes.
2. api_key login over the wire against a real api-key-capable provider (sprint-054 used `openai`
   with a fake key): `login` → `provider_auth_flow_event` with a `secret` prompt →
   `provider_auth_respond_request` → terminal `done { ok: true }`.
3. Inspect `<piHome>/agent/auth.json`: contains the credential, mode is `0600`.
4. Re-run `provider_auth_list_request`: that provider now reports `configured: true`,
   `configuredType: "api_key"`.
5. **Path-parity proof (the point of this task):** start an agent through the same daemon+config and
   confirm the spawned Pi child resolves the credential just written — i.e. the daemon's auth path
   and the spawn path agree. If a full agent turn needs credentials this environment lacks, fall
   back to asserting the spawned child's resolved `PI_CODING_AGENT_DIR` equals the service's
   `authPath` directory, and say so explicitly in the summary rather than implying a stronger claim.
6. `provider_auth_logout_request` removes it; `list` shows unconfigured again.
7. Cancel path: start a flow, send `provider_auth_cancel_request` at the pending prompt → terminal
   `done { ok: false, error: "cancelled" }`.
8. Disconnect path: start a flow, **drop the socket** at the pending prompt → daemon logs show the
   flow cancelled and its registry entry gone; daemon stays healthy and serves a subsequent
   connection.
9. Old-client compatibility: a client that never sends an auth RPC is unaffected; `server_info`
   carries `features.providerAuth === true`.
10. Scan the whole captured frame log and daemon log for the fake key — it must appear nowhere.

**B. Docs sync** (required by the repo's doc-sync rule, same-change):

- Root `AGENTS.md` — protocol overview: add the provider-auth family to the RPC/push description;
  note that the daemon now runs Pi's auth engine in-process (lazily) and writes `auth.json` on the
  daemon host.
- `packages/protocol/AGENTS.md` — new message family + the `providerAuth` server feature flag; state
  explicitly that `provider_auth_flow_event` is a passthrough push with no union entry (so nobody
  "fixes" it later).
- `packages/server/AGENTS.md` — source-layout entries for `agent/provider-auth/*`, the
  `resolvePiAgentDir`/`resolvePiAuthPaths` export, the domain-error `{ ok, error }` convention for
  this family, and the disconnect-cancels-flow invariant via `SessionSubscriptions`.
- Update `swe/features/provider-auth-rpc.md`'s `TODO(verify)`: close or re-state the OAuth
  localhost-callback-port question with whatever this run establishes.

## Out of scope

- Client SDK and web UI (`features/provider-auth-ui.md`, a later sprint).
- Any `packages/cli` change — the CLI's own `auth` group is sprint-054's and stays independent.
- Completing a real third-party OAuth login (needs live provider credentials).

## Acceptance criteria

- [ ] All ten steps above executed against a real daemon, with commands and outputs recorded
      verbatim in the summary; any step downgraded for environmental reasons is stated as such, not
      papered over.
- [ ] `auth.json` written by the wire flow is at the daemon-resolved path with mode `0600`.
- [ ] The path-parity claim is backed by observed evidence (agent run, or resolved-dir equality with
      an explicit note that it is the weaker form).
- [ ] Cancel and disconnect both produce a terminal `done ok:false` and leave no flow registered.
- [ ] The fake credential appears in no captured frame and no log line.
- [ ] All four docs are updated and truthful against the shipped code; no aspirational statements.
- [ ] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
      `npm test`.

## Test / verification plan

- Build: `npm run build`.
- Typecheck: `npm run typecheck`.
- Lint/format: `npm run lint`, `npm run fmt:check`.
- Tests: `npm test` (full suite) — this is the sprint-closing gate.
- Live run: the ten-step sequence above; clean up temp dirs afterward.

## Notes

- Use a clearly fake key (e.g. `sk-test-...`) and a temp `piHome`; never touch the developer's real
  `~/.pi`.
- Sprint-054's summaries are the model for the evidence standard expected here: exact commands,
  exact outputs, explicit statements about what was *not* provable in this environment.
- Coordinate on root `AGENTS.md` if sprint-054's task-006 is still open — it edits the same file
  (different sections: CLI command tree vs protocol/daemon). Re-read before editing.
