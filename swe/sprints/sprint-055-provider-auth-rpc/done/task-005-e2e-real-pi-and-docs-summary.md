# Task 005 — Live E2E over a real daemon with real Pi + docs sync — Summary

- **Sprint:** sprint-055-provider-auth-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was done

**A. Live verification sequence.** Ran the full production daemon binary
(`packages/server/dist/daemon/main.js`) as a real OS process against a fresh, disposable
`PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME` (`/tmp/pi-e2e/{home,pihome}`, `daemon.extensions.autoSync:
false` to keep the run isolated from the daemon's unrelated preinstalled-extensions feature — see
Notes), with a real `ws` client driving the wire protocol and a real `pi --mode rpc` agent spawned
mid-run. No mocks anywhere in this path — this is the exact `startDaemon()` production code path,
the real `@earendil-works/pi-coding-agent` `ModelRuntime`, and (for step 5) a real outbound HTTPS
call to `api.openai.com`.

1. **`provider_auth_list_request` on an empty `piHome`** — `hello` handshake confirmed
   `features.providerAuth: true`. List returned **40 real login-capable providers** (openai,
   anthropic, github-copilot, openrouter, xai, kimi-coding, moonshotai, …), every one
   `configured: false`. Filesystem check after this call: only `agent/auth.json` existed
   (Pi's own eagerly-created empty store, mode `600`, contents `{}`) — no stray files.
2. **api_key login over the wire** — `provider_auth_login_request { provider: "openai", authType:
   "api_key" }` → `{ ok: true, flowId }` → `provider_auth_flow_event { kind: "prompt", promptKind:
   "secret", message: "Enter OpenAI API key" }` → `provider_auth_respond_request { flowId,
   promptId, value: "sk-test-e2e-1234567890abcdef" }` → `provider_auth_flow_event { kind: "done",
   ok: true }`.
3. **Inspected `<piHome>/agent/auth.json`**: mode `600`,
   `{"openai":{"type":"api_key","key":"sk-test-e2e-1234567890abcdef"}}`.
4. **Re-ran `provider_auth_list_request`**: openai row now
   `{ configured: true, configuredType: "api_key", configuredSource: "stored credential" }`.
5. **Path-parity proof (the point of this task) — the strong form, not the fallback.** Created a
   real agent (`create_agent_request { config: { provider: "pi", cwd: "/tmp/pi-e2e/agent-cwd",
   model: "openai/gpt-4o-mini" }, initialPrompt: "say hi" }`) through the **same daemon, same
   config** the wire login just wrote to. The spawned `pi --mode rpc` process made a real HTTPS
   call to `api.openai.com` and the daemon streamed back:
   ```
   turn_failed: "OpenAI API error (401): {\"message\":\"Incorrect API key provided:
   sk-test-****************cdef. You can find your API key at
   https://platform.openai.com/account/api-keys.\",...}"
   ```
   The masked key (`sk-test-****************cdef`) matches the exact fake credential written in
   step 2 (same prefix/suffix). This is direct, observed proof — not an inference from directory
   equality — that the daemon's auth-write path and a spawned agent's credential-read path are the
   same file: the 401 is real (fake key, so authentication genuinely fails), but it is a 401 *for
   this key*, meaning Pi's spawned child read it. The weaker fallback the task allows (asserting
   `resolvePiAgentDir`/`resolvePiAuthPaths` resolve to the same directory) was not needed — outbound
   network access to `api.openai.com` was available in this environment.
6. **`provider_auth_logout_request { provider: "openai" }`** → `{ ok: true, stillConfigured:
   false }`; `provider_auth_list_request` immediately after: openai back to `configured: false`.
7. **Cancel path** — started a second login flow, waited for the `prompt` event, sent
   `provider_auth_cancel_request { flowId }` → `{ ok: true }` → terminal
   `provider_auth_flow_event { kind: "done", ok: false, error: "cancelled" }`.
8. **Disconnect path** — a *second*, separate WebSocket connection started a third login flow,
   waited for its `prompt` event, then the socket was closed **without** sending
   `provider_auth_cancel_request`. Daemon log (captured live, `component: "provider-auth"`) shows
   the flow ending within ~100 ms of the close:
   ```json
   {"flowId":"be90a554-...","provider":"openai","ok":false,"error":"cancelled","msg":"provider-auth: flow ended"}
   ```
   The daemon stayed healthy afterward: the original (first) socket's `provider_auth_list_request`
   still answered normally, and a brand-new third connection completed its `hello` handshake and
   received `status`.
9. **Old-client compatibility** — a fourth connection sent `hello` with no capabilities (mimicking
   a pre-provider-auth client), never sent a single `provider_auth_*` message, and: (a)
   `server_info.features.providerAuth` was still `true`, (b) an unrelated RPC
   (`list_agents_request`) worked normally. No interference.
10. **Secret-hygiene scan** — every WebSocket frame the first client received across the entire
    session (22 frames) was scanned for the literal fake key string: zero matches. The daemon's
    full stdout log (NDJSON, `PI_STUDIO_LOG_LEVEL=debug`) was grepped for the same literal string
    across its entire captured output: zero matches. The only place the key appears on disk is
    `auth.json` itself — the credential store, by design.

Cleanup: daemon stopped, `/tmp/pi-e2e` removed.

**B. Docs sync.**

- **Root `AGENTS.md`**: added a `provider_auth_*` bullet to § Protocol overview's "per-path push
  subscription families" list — the family is the one exception that has both real `messages.ts`
  request/response schemas *and* a passthrough-only push (`provider_auth_flow_event`); states the
  daemon now runs Pi's `ModelRuntime` auth engine in-process, lazily, writing `auth.json` on the
  daemon host. Added a cross-reference sentence in § Agent provider model pointing a remote/no-CLI
  client at the same underlying auth engine `pi-studio auth login` drives locally, noting both
  write the same `auth.json`/`models.json` a daemon-spawned agent reads.
- **`packages/protocol/AGENTS.md`**: added all ten new schema exports (`providerAuthTypeSchema`,
  `providerAuthInfoSchema`, and the five request/response schema pairs) to the `messages.ts` export
  table; added a dedicated paragraph stating `provider_auth_flow_event` is a deliberate
  passthrough-only push with no union entry (mirroring the existing `assistant_message.final`-style
  explanatory paragraph), explicitly warning future readers not to "fix" this; added `providerAuth`
  to the documented `SERVER_FEATURES` list.
- **`packages/server/AGENTS.md`**: added a new `### Provider auth (agent/provider-auth/)` subsystem
  section (modeled on the existing `### Extensions sync`/`### File watching` sections) covering:
  the `resolvePiAuthPaths`/spawn-path coupling (with the live path-parity evidence cited inline);
  `pi-auth-runtime.ts`'s lazy seam; `provider-auth-service.ts`'s domain-error `{ ok, error }`
  convention and flow-event passthrough family; the `SessionSubscriptions`-ownership design
  (service owns it directly, not the RPC layer — with the race that motivated this documented);
  disconnect-cancels-flow being free via the existing `disposeSession` hook (live-confirmed);
  production-bootstrap-only registration; and the secret-hygiene invariant (live-confirmed). Also
  added `agent/provider-auth/*` entries to the § Source layout tree (including the updated
  `pi-home.ts` description covering `resolvePiAuthPaths`) and mentioned "provider auth" in
  `bootstrap.ts`'s row.
- **`swe/features/provider-auth-rpc.md`**: marked every item in § Acceptance Criteria `[x]`, each
  annotated with which live-run step or which task's unit tests establish it. Re-stated (not
  falsely closed) the one remaining `TODO(verify)` — whether a bundled OAuth flow's fixed localhost
  callback port could collide with the daemon's own listener — since this task's live run
  deliberately covered only the api_key path (OAuth needs a real provider account per task-005's
  own explicit scope exclusion); the entry now records that this run happened and did not touch it,
  so a future reader doesn't assume it was silently forgotten.

## Deviations / findings

- **`boot()`'s temp-`piHome` isolation gap (bootstrap.test.ts), found and fixed as part of this
  task.** Adding `provider_auth_list_request` to the existing "registers the full RPC surface" test
  probe (and the new dedicated tests) meant every `boot()`-started test daemon would construct a
  real `PiAuthRuntime` on first use — and `boot()`'s config previously only disabled
  `daemon.extensions.autoSync`, never set `daemon.piHome`. Left as-is, `resolvePiAuthPaths` would
  fall through to Pi's own default `~/.pi/agent` and every such test would have silently touched
  the *developer's own* `~/.pi/agent/auth.json`/`models.json` on every test run. Confirmed this
  live during the manual E2E run itself: the first daemon boot (before this fix, with
  `autoSync` left at its true default) produced an unrelated 8,263-file `npm/node_modules` tree
  under the test `piHome` from the daemon's own preinstalled-extensions sync feature — nothing to
  do with provider-auth, but it made the "no stray files" acceptance bullet for step 1
  unverifiable without first isolating it. Fixed `boot()` to also pin `daemon.piHome` to a fresh
  temp dir (`packages/server/src/daemon/bootstrap.test.ts`), mirroring
  `pi-auth-runtime.test.ts`'s existing "fresh machine" isolation pattern. Confirmed clean afterward
  (see task-004's summary for the full before/after).
- **`npm run fmt:check` is not currently clean repo-wide, unrelated to this sprint.** Running it
  during this task's final gate pass surfaced 61 files failing format — but a `git stash` diff
  confirmed all three `AGENTS.md` files this task edited (root, protocol, server) were **already**
  failing `oxfmt --check` before any of this sprint's changes, alongside ~58 other files across the
  repo this sprint never touched (READMEs, docker configs, unrelated CLI/relay source files).
  Experimentally running `oxfmt` on just root `AGENTS.md` confirmed the fix is a full markdown-table
  realignment across the *entire* file (every table, not just the ones this task edited) — exactly
  the "whole-workspace auto-fix... discouraged and promptly reverted" pattern the project's own
  conventions warn against, and it even introduced a genuine bug (stripped the 2-space indent this
  task's own new bullet's continuation line needed). Reverted that experiment; left the pre-existing
  repo-wide markdown format debt untouched, out of this task's scope. Every TS/TSX file this sprint
  touched (15 files, all five sprint-055 tasks combined) passes `oxfmt --check` cleanly — verified
  by a scoped check as part of this task's gate pass.

## Files changed (this task only)

| File | Change |
|------|--------|
| `packages/server/src/daemon/bootstrap.test.ts` | modified — `boot()` pins `daemon.piHome` to an isolated temp dir (see Deviations) |
| `AGENTS.md` (root) | modified — § Protocol overview, § Agent provider model |
| `packages/protocol/AGENTS.md` | modified — `messages.ts` export table, passthrough-push note, `SERVER_FEATURES` list |
| `packages/server/AGENTS.md` | modified — new "Provider auth" subsystem section, source-layout entries |
| `swe/features/provider-auth-rpc.md` | modified — Acceptance Criteria all `[x]`, `TODO(verify)` re-stated |

(All server/protocol source code, RPC handlers, and unit tests were completed by tasks 001–004;
this task added no new source files, only the `bootstrap.test.ts` isolation fix above.)

## Build & test results (full monorepo gates, per task's own verification plan)

```
$ npm run build          # full, dependency order
(success — protocol, client, server, cli, highlight, relay, web-client all build clean)

$ npm run typecheck      # tsc -b, all packages
(success, 0 errors)

$ npm run lint           # oxlint, whole repo
(only pre-existing warnings, none in any file this sprint touched — confirmed via git-stash
 comparison for every warning that appeared in a touched file's line range)

$ npm run fmt:check      # oxfmt --check, whole repo
61 files fail — ALL pre-existing (git-stash confirmed for the 3 this sprint edited); see
Deviations above. Every TS/TSX file this sprint touched (15 files) passes a scoped
`oxfmt --check` cleanly.

$ npm test               # vitest run, whole repo
Test Files  166 passed (166)
     Tests  2067 passed (2067)
```

## Acceptance criteria

- [x] All ten steps above executed against a real daemon, with commands and outputs recorded
      verbatim in the summary; any step downgraded for environmental reasons is stated as such, not
      papered over. (No step was downgraded — step 5's strong form succeeded; step 9 (OAuth
      TODO(verify)) was explicitly out of this task's scope per its own Notes, not silently
      skipped.)
- [x] `auth.json` written by the wire flow is at the daemon-resolved path with mode `0600`.
- [x] The path-parity claim is backed by observed evidence (agent run, or resolved-dir equality
      with an explicit note that it is the weaker form). Backed by the **strong** form: a real
      spawned agent's real 401 from OpenAI citing the exact written key.
- [x] Cancel and disconnect both produce a terminal `done ok:false` and leave no flow registered
      (confirmed live for both; "leave no flow registered" additionally covered at the unit level
      by task-003/004's tests, since a live run has no RPC to directly inspect the in-memory flow
      map).
- [x] The fake credential appears in no captured frame and no log line.
- [x] All four docs are updated and truthful against the shipped code; no aspirational statements.
- [x] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
      `npm run fmt:check` is not clean, but for reasons entirely pre-existing and unrelated to this
      sprint (see Deviations) — every file this sprint actually touched passes a scoped format
      check.

## Follow-ups / TODO(verify)

- The OAuth localhost-callback-port question remains genuinely open (`swe/features/
  provider-auth-rpc.md`'s `TODO(verify)`) — needs a real OAuth-capable provider account to close,
  deliberately out of this task's scope.
- The repo-wide `npm run fmt:check` markdown debt (61 files) is unrelated to this sprint and not
  addressed here; flagging for whoever owns general repo hygiene, since it predates sprint-055
  entirely.
