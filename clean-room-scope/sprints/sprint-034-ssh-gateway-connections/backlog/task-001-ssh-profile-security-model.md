# Task 001 — SSH gateway profile and security model

- **Sprint:** sprint-034-ssh-gateway-connections
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (sprint-013, app shell/host runtime); task-001 (sprint-033, Electron shell/preload)

## Goal

Add the desktop-only SSH gateway connection profile model, validation, known-host metadata model,
and secret-reference conventions needed before implementing the tunnel runtime.

## Scope references

- `clean-room-scope/architecture/ssh-gateway-connections.md` § Public Contract, § Data & Persistence,
  § Credential handling, § Host key verification
- `clean-room-scope/architecture/client-app-runtime.md` § App runtime concepts, § Connection
- `clean-room-scope/features/desktop-app.md` § Bridge capabilities

## What to build

- Extend the app host profile model with `type: "ssh"` / `SshGatewayHostProfile` as specified:
  SSH host, port, username, auth method, host-key policy, remote daemon host/port, optional daemon
  password secret ref, timestamps.
- Add schema validation and default normalization:
  - `ssh.port` default `22`
  - `remoteDaemon.host` default `127.0.0.1`
  - `remoteDaemon.port` default `6767`
  - keepalive and ready timeout defaults
- Add known-host entry shape and persistence helpers in Electron main storage:
  `host`, `port`, `algorithm`, canonical fingerprint, first/last seen timestamps.
- Add secret-reference types and redaction helpers so exported/logged profiles never contain raw
  passwords, private keys, or passphrases.
- Add platform gating: non-Electron runtimes may display SSH profiles but cannot connect; they must
  return a clear desktop-only error.

## Out of scope

- Opening real SSH connections (task-002).
- Renderer UI forms (task-004).
- OS keychain implementation beyond typed secret refs and test doubles (task-003/task-005).

## Acceptance criteria

- [ ] SSH host profiles validate and normalize defaults without raw secrets in persisted JSON.
- [ ] Known-host entries can be added/read/removed with atomic writes and unknown-field tolerance.
- [ ] Profile redaction removes all secret values and preserves only `secretRef` identifiers.
- [ ] Non-Electron connection attempts to `type:"ssh"` fail with a deterministic desktop-only error.

## Test / verification plan

- Tests: `npx vitest run packages/app/.../host-profile.test.ts packages/desktop/.../known-hosts.test.ts`
  covering profile validation/defaults, redaction, known-host persistence, non-Electron gating.

## Notes

- Keep the model independent from the `ssh2` library so tests and future CLI support can reuse it.
- Do not add SSH details to `@av-pi-studio/protocol`; this is client/desktop connection metadata,
  not daemon wire protocol.
