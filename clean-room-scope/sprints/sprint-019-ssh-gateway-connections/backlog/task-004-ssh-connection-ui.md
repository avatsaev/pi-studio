# Task 004 — SSH connection UI and diagnostics

- **Sprint:** sprint-019-ssh-gateway-connections
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-003; task-002 (sprint-013, onboarding/pairing); task-004 (sprint-013, settings/projects/sidebar)

## Goal

Add the Electron-only UI for creating, testing, saving, and connecting SSH gateway profiles, including
host-key prompts, credential method selection, and structured troubleshooting output.

## Scope references

- `clean-room-scope/architecture/ssh-gateway-connections.md` § Public Contract, § `testConnection`,
  § Host key verification, § Error Handling & Edge Cases
- `clean-room-scope/features/app-navigation-screens.md` § Onboarding & device-pairing screens,
  § Settings IA
- `clean-room-scope/features/desktop-app.md` § Bridge capabilities
- `clean-room-scope/architecture/design-system.md`

## What to build

- Extend the add/edit host screen with connection type options:
  - Direct
  - Relay
  - SSH (shown as desktop-only; disabled with explanation on non-Electron platforms)
- SSH form fields:
  - SSH host/address
  - SSH port (default 22)
  - username
  - auth method: password, private key, SSH agent
  - password/passphrase fields with "save securely" checkbox
  - private-key file picker via Electron bridge/native dialog
  - remote daemon host (default `127.0.0.1`) and port (default `6767`)
  - optional daemon password field if remote daemon requires `PI_STUDIO_PASSWORD`
  - host-key policy / fingerprint display for advanced users
- Add `Test connection` flow using `sshGateway.testConnection`:
  - show separate status rows for SSH reachability, auth, host-key verification, remote daemon TCP
    reachability, `/api/health`, and daemon password/WS handshake failures;
  - do not leak secrets in failure details.
- Add host-key prompts:
  - new host under TOFU: show fingerprint and require explicit trust;
  - changed key: block and show warning/recovery actions;
  - strict mismatch: show expected vs actual fingerprint.
- Add saved-profile management in settings: edit, delete, forget host key, rotate saved secret.

## Out of scope

- The underlying tunnel runtime (tasks 002–003).
- CLI SSH support.

## Acceptance criteria

- [ ] Users can create and save an SSH gateway profile from Electron.
- [ ] `Test connection` gives actionable diagnostics for SSH auth vs daemon reachability failures.
- [ ] Host-key TOFU and changed-key prompts are visible, explicit, and cannot be bypassed silently.
- [ ] Non-Electron platforms display SSH as unavailable/desktop-only, not as a broken form.
- [ ] Saving secrets requires explicit user opt-in and shows where/how secrets are stored.
- [ ] Connecting through the saved SSH profile opens a workspace/session using the existing app
      runtime once the tunnel is established.

## Test / verification plan

- Tests: `npx vitest run packages/app/.../ssh-connection-form.test.tsx` with fake Electron bridge.
- Cover: auth method switching, default values, test diagnostics rendering, TOFU accept/reject,
  changed-key blocking, non-Electron disabled state, save-secret opt-in.
- Manual: Electron app → add SSH host → test → trust host key → connect → existing daemon UI loads.

## Notes

- Use existing design-system primitives; avoid one-off platform-specific styling.
- Avoid displaying raw private-key contents. File picker should display only path/filename.
