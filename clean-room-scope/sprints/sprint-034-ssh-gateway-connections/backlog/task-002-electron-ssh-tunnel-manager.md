# Task 002 — Electron SSH tunnel manager

- **Sprint:** sprint-034-ssh-gateway-connections
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; task-001 (sprint-033, Electron shell/preload)

## Goal

Implement the Electron main-process SSH tunnel runtime that authenticates to a gateway host and
forwards an ephemeral local loopback port to the remote daemon's loopback WebSocket listener.

## Scope references

- `clean-room-scope/architecture/ssh-gateway-connections.md` § Tunnel creation, § Tunnel lifecycle,
  § `testConnection`, § Host key verification
- `clean-room-scope/features/desktop-app.md` § Bridge capabilities
- `clean-room-scope/architecture/auth-security.md`

## What to build

- Add an Electron-main-only SSH tunnel manager under `packages/desktop/src/ssh/`.
- Use a structured SSH client library (recommended: `ssh2`) rather than shelling out to `ssh` for v1.
- Implement:
  - `testConnection(input): Promise<SshGatewayTestResult>`
  - `openTunnel(input): Promise<ActiveSshGatewayTunnel>`
  - `closeTunnel(tunnelId)`
  - `listTunnels()`
- On `openTunnel`:
  - resolve credentials from direct input / secret refs;
  - verify host key using TOFU/strict/insecure-dev policies;
  - authenticate via password, private key, or SSH agent;
  - bind a local TCP server on `127.0.0.1:0`;
  - for each local socket, open `forwardOut` to `remoteDaemon.host:remoteDaemon.port`;
  - pipe local socket bytes to/from the SSH channel;
  - return `ws://127.0.0.1:<boundPort>`.
- Implement keepalives and close/error event propagation so the app runtime can enter reconnecting
  state when the SSH session drops.
- Ensure app quit and destroyed `webContents` close associated tunnels.

## Out of scope

- Renderer UI and connection screen (task-004).
- Real OS keychain persistence (task-005); use injected secret resolver/test doubles here.
- CLI `--ssh` support.

## Acceptance criteria

- [ ] `openTunnel` returns a local `ws://127.0.0.1:<port>` URL that forwards to the configured remote
      daemon host/port over SSH.
- [ ] `testConnection` distinguishes SSH connectivity/authentication from remote daemon reachability
      and `/api/health` status.
- [ ] Host-key policies are enforced: TOFU prompt result required for new hosts; strict rejects
      non-matching fingerprints; changed known host is blocked by default.
- [ ] Closing a tunnel tears down local server, SSH channels, and SSH client.
- [ ] Local listeners bind only to `127.0.0.1`, never `0.0.0.0`.

## Test / verification plan

- Tests: `npx vitest run packages/desktop/.../ssh-tunnel-manager.test.ts` with a fake SSH client and
  in-memory TCP target.
- Cover: successful forward, auth failure, host-key new/changed/strict mismatch, remote daemon down,
  local bind retry/cleanup, close on app quit.
- Manual: run a daemon on a remote host bound to `127.0.0.1:6767`, connect via SSH profile, confirm
  `DaemonClient.connect()` reaches `server_info` through tunnel.

## Notes

- Do not log credentials or private-key contents.
- Prefer dependency injection for SSH client factory, `net.createServer`, clock, and secret resolver
  to make tests deterministic.
