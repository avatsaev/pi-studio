# Task 005 — Secret storage hardening, cleanup, and docs

- **Sprint:** sprint-034-ssh-gateway-connections
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-004

## Goal

Harden the SSH gateway feature for production use: OS-backed secret storage, lifecycle cleanup,
security tests, administrator guidance, and final documentation.

## Scope references

- `swe/architecture/ssh-gateway-connections.md` § Credential handling,
  § Recommended SSH server hardening, § Security Considerations, § Acceptance Criteria
- `swe/architecture/auth-security.md`
- `swe/features/desktop-app.md`

## What to build

- Implement the chosen OS-backed secret storage adapter:
  - macOS Keychain or Electron safe-storage-backed secure store;
  - Windows Credential Manager / DPAPI-backed store;
  - Linux Secret Service/libsecret where available;
  - documented fallback behavior if OS-level protection is unavailable.
- Add secret lifecycle management:
  - create/update/delete saved SSH passwords, key passphrases, optional imported private-key
    material, and optional daemon passwords;
  - scrub transient secret values from in-memory objects after use where practical;
  - ensure logs and IPC errors are redacted.
- Add tunnel cleanup hardening:
  - close orphaned tunnels when `webContents` is destroyed;
  - close all tunnels on app quit;
  - handle sleep/wake/network-change reconnect loops without leaking local listeners.
- Add documentation for users/admins:
  - SSH-only vs SSH+daemon-password trade-offs;
  - recommended remote daemon bind (`127.0.0.1:6767`);
  - restricted `sshd_config Match User` example with `PermitOpen 127.0.0.1:6767`;
  - host-key warning explanation and recovery steps;
  - how to rotate/delete saved credentials.
- Add security regression tests for redaction, host-key change blocking, and local bind behavior.

## Out of scope

- New connection modes beyond SSH.
- CLI `--ssh` support unless explicitly added in a later sprint.

## Acceptance criteria

- [ ] Saved secrets use OS-backed storage where available; profiles contain only secret refs.
- [ ] Logs, IPC errors, exported profiles, and diagnostics never include raw secrets.
- [ ] Host-key changed/mismatch scenarios are covered by regression tests.
- [ ] Orphaned tunnels are closed on window destruction and app quit.
- [ ] Documentation explains SSH server hardening and SSH-only vs SSH+daemon-password choices.
- [ ] Full desktop/app test suite for SSH gateway passes.

## Test / verification plan

- Tests: `npx vitest run packages/desktop/.../ssh-secret-store.test.ts packages/desktop/.../ssh-security.test.ts packages/app/.../ssh-connection-form.test.tsx`.
- Manual: save password/key-passphrase, quit/reopen app, connect; delete saved secret; verify profile
  export is redacted; simulate changed host key and confirm connection is blocked.

## Notes

- Prefer least privilege and explicit warnings over convenience shortcuts.
- If Linux secure storage is unavailable, the UI must clearly offer "do not save" rather than
  silently falling back to plaintext.
