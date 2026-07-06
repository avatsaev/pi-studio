# Task 004 — Security, run scripts, and end-to-end verification (real Pi LLM)

- **Sprint:** sprint-035-production-daemon
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003

## What to build
- **Security**: honor `PI_STUDIO_PASSWORD` (bcrypt bearer), host allowlist (`PI_STUDIO_HOSTNAMES`),
  reuse `daemon-keypair.json` + `server-id`; PID lock via the identity module. Dev-only affordances
  (allow-all hostnames, no auth) must NOT be the production default.
- **Run scripts**: `npm start` → build server + run `daemon/main.js` (already scripted); confirm the
  Vite `/daemon-ws` proxy still targets `127.0.0.1:6767`. Make `mock` provider strictly opt-in
  (e.g. only when a workspace explicitly requests `provider: "mock"`), never the default.
- **Verification**: full manual E2E against the running production daemon with the real `pi` provider.

## Acceptance criteria
- [ ] With `PI_STUDIO_PASSWORD` set, unauthenticated WS connect is rejected; with the bearer it works.
- [ ] Creating a `pi` agent and sending a prompt yields a **real streamed LLM response** (not `echo:`).
- [ ] File explorer, git panel, and terminal all work against a real project through the app.
- [ ] Sessions persist across a daemon restart.
- [ ] `npm run build` (all) + full test suite pass.

## Test / verification plan
- Manual E2E with the real provider (documented commands + results in the summary).
- Confirm no mock/dev fallback remains on the default path.
