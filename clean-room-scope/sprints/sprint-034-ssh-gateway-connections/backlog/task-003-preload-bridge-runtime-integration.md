# Task 003 — Preload bridge and app runtime integration

- **Sprint:** sprint-034-ssh-gateway-connections
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002; task-001 (sprint-013, app shell/host runtime); task-001 (sprint-033, Electron shell/preload)

## Goal

Expose the SSH tunnel manager safely to the renderer through the Electron preload bridge and teach
`HostRuntimeController` to connect SSH profiles by obtaining a tunnel URL before constructing the
existing `DaemonClient`.

## Scope references

- `clean-room-scope/architecture/ssh-gateway-connections.md` § Electron bridge API, § Runtime
  integration, § Tunnel lifecycle, § Threat model
- `clean-room-scope/architecture/client-app-runtime.md` § Connection
- `clean-room-scope/features/desktop-app.md` § Bridge capabilities

## What to build

- Add preload bridge APIs:
  - `sshGateway.testConnection(input)`
  - `sshGateway.openTunnel(input)`
  - `sshGateway.closeTunnel(tunnelId)`
  - `sshGateway.listTunnels()`
  - `sshGateway.getKnownHost(...)`
  - `sshGateway.forgetKnownHost(...)`
  - minimal secret-store methods needed by the UI/runtime (`storeSecret`, `deleteSecret`) with
    redacted return values.
- Validate every IPC input in Electron main before passing it to the tunnel manager.
- Sanitize IPC errors so stack traces and secrets are not exposed to the renderer.
- Integrate `HostRuntimeController.connect(profile)`:
  - for `type:"ssh"`, require Electron bridge;
  - call `openTunnel(profile)`;
  - use returned `wsUrl` with the existing direct WebSocket `DaemonClient` path;
  - close tunnel when host session disconnects or profile is removed;
  - propagate tunnel close/error events into the existing connection-state model.
- Ensure the daemon password, if configured on `remoteDaemon.passwordSecretRef`, is passed only to
  `DaemonClient` auth mechanisms and not included in the SSH tunnel URL.

## Out of scope

- Visual form fields and user-facing copy (task-004).
- Host-key management UI beyond bridge methods (task-004).

## Acceptance criteria

- [ ] Renderer can test/open/close/list SSH tunnels through the preload bridge only in Electron.
- [ ] App runtime connects an SSH host profile by using the returned local `wsUrl`; no WebSocket
      protocol changes are required.
- [ ] Tunnel closure/error transitions the host runtime to disconnected/reconnecting consistently
      with direct/relay connection drops.
- [ ] IPC validation rejects malformed profiles and redacts all secret fields in errors/logs.
- [ ] Non-Electron builds tree-shake or stub SSH bridge calls and show desktop-only behavior.

## Test / verification plan

- Tests: `npx vitest run packages/desktop/.../ssh-bridge.test.ts packages/app/.../host-runtime-ssh.test.ts`
  using fake Electron bridge and fake tunnel manager.
- Cover: connect path, close-on-disconnect, tunnel error propagation, daemon password handling,
  malformed IPC input rejection, non-Electron stub behavior.

## Notes

- Keep the renderer unaware of `ssh2`; all SSH and secret operations stay in Electron main.
