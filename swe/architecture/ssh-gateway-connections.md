# SSH Gateway Connections — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [client-app-runtime.md](client-app-runtime.md), [auth-security.md](auth-security.md),
> [daemon-bootstrap.md](daemon-bootstrap.md), [relay-e2ee.md](relay-e2ee.md),
> [../features/desktop-app.md](../features/desktop-app.md)

## Purpose

SSH gateway connections let the Electron desktop app connect to a Pi-Studio daemon running on a
remote workstation/server **without exposing the daemon's WebSocket port to the network** and without
requiring the relay service. The user selects connection type `SSH`, enters SSH host/port/username
and either password or private-key credentials, and the desktop main process opens an SSH tunnel from
a local loopback port to the remote daemon's loopback listener.

SSH gateway profiles are purely **additive**: they add one more remote entry to the desktop app's host
list. They never disable, replace, or require disabling the desktop app's own local embedded daemon
(see [../features/desktop-app.md](../features/desktop-app.md) § Local vs. remote daemon mode, default
`desktopDaemonMode = "embedded"`) — a user can run fully local + isolated, fully remote, or both at
once, with local and SSH-gateway hosts coexisting side by side in the same host switcher.

The daemon protocol does **not** change. Pi-Studio still speaks the existing WebSocket JSON+binary
protocol. SSH is a desktop-only transport wrapper around that protocol:

```
Electron renderer / app runtime
    │
    │  ws://127.0.0.1:<localEphemeralPort>
    ▼
Electron main process local tunnel listener
    │
    │  SSH direct-tcpip channel (encrypted by SSH)
    ▼
remote host:127.0.0.1:6767
    │
    ▼
Pi-Studio daemon WebSocket server
```

This feature is distinct from relay E2EE:

| Connection type | Reachability model | Best for |
|-----------------|--------------------|----------|
| Direct WebSocket | Daemon host/port reachable directly | localhost, LAN, VPN |
| Relay E2EE | Daemon dials outbound to relay; client meets it there | mobile/web, NAT traversal, no SSH account |
| SSH gateway | Client has SSH access to daemon host; daemon remains localhost-only | Electron desktop users connecting to a known workstation/server |

## Non-goals

- Do **not** make the Pi-Studio daemon itself an SSH server.
- Do **not** add SSH support to browser web or React Native mobile apps; raw SSH is not available
  there without a native companion process.
- Do **not** replace the WebSocket protocol or introduce an SSH-specific application framing layer.
- Do **not** expose SSH credentials to app renderer components beyond short-lived form state.
- Do **not** require a daemon password when SSH is the chosen trust boundary, although users may
  additionally configure daemon password auth for defense in depth.

## Public Contract

### Connection profile shape

The app's saved `HostProfile` gains a desktop-only SSH variant. Exact storage implementation lives
in the app runtime/client store layer; the shape below is the cross-package contract.

```ts
type HostProfile = DirectHostProfile | RelayHostProfile | SshGatewayHostProfile;

interface SshGatewayHostProfile {
  id: string;
  name?: string;
  type: "ssh";

  ssh: {
    host: string;              // DNS name or IP address of the gateway host
    port: number;              // default 22
    username: string;

    auth:
      | { method: "password"; passwordSecretRef?: string }
      | {
          method: "privateKey";
          keyPath?: string;             // local path, selected by Electron file dialog
          privateKeySecretRef?: string; // optional stored key material, if supported
          passphraseSecretRef?: string;
        }
      | { method: "agent"; agentSocket?: string };

    hostKeyPolicy:
      | { mode: "trust-on-first-use" }
      | { mode: "strict"; expectedFingerprint: string }
      | { mode: "insecure-skip-verify"; allowOnlyForDevelopment: true };

    keepaliveIntervalMs?: number; // default 30_000
    readyTimeoutMs?: number;      // default 20_000
  };

  remoteDaemon: {
    host: string;              // default "127.0.0.1"
    port: number;              // default 6767
    passwordSecretRef?: string; // optional daemon password, if remote daemon requires one
  };

  createdAt: string;
  updatedAt: string;
}
```

Notes:

- `passwordSecretRef`, `privateKeySecretRef`, and `passphraseSecretRef` point to Electron main
  process secret storage. They are never raw secrets in the persisted profile JSON.
- `remoteDaemon.host` defaults to `127.0.0.1`, not the SSH host. The expected deployment is a daemon
  bound to localhost on the remote workstation.
- `insecure-skip-verify` exists only as an explicit development/testing escape hatch. UI must warn
  loudly and should not offer it in normal production flows.

### Active tunnel shape

When a renderer asks Electron main to open a tunnel, main returns an ephemeral local WebSocket URL.
The renderer passes that URL to the existing `DaemonClient` direct WebSocket transport.

```ts
interface ActiveSshGatewayTunnel {
  tunnelId: string;
  profileId?: string;
  localHost: "127.0.0.1";
  localPort: number;
  wsUrl: string;              // e.g. "ws://127.0.0.1:49152"
  remoteDaemonHost: string;   // usually "127.0.0.1"
  remoteDaemonPort: number;   // usually 6767
  openedAt: string;
}
```

### Electron bridge API

The preload bridge exposes SSH operations only when `getIsElectron()` is true.

```ts
interface SshGatewayBridge {
  testConnection(input: SshGatewayConnectInput): Promise<SshGatewayTestResult>;
  openTunnel(input: SshGatewayConnectInput): Promise<ActiveSshGatewayTunnel>;
  closeTunnel(tunnelId: string): Promise<{ closed: boolean }>;
  listTunnels(): Promise<ActiveSshGatewayTunnel[]>;

  getKnownHost(input: { host: string; port: number; username?: string }): Promise<KnownHostEntry | null>;
  forgetKnownHost(input: { host: string; port: number; fingerprint: string }): Promise<{ removed: boolean }>;

  storeSecret(input: StoreSecretInput): Promise<{ secretRef: string }>;
  deleteSecret(input: { secretRef: string }): Promise<{ deleted: boolean }>;
}
```

Renderer components never call SSH libraries directly. The bridge returns sanitized errors and
runtime metadata only.

### Runtime integration

The app runtime treats SSH profiles as a desktop-only way to obtain a temporary direct WebSocket URL:

```
HostRuntimeController.connect(profile):
    if profile.type == "direct":
        url = profile.url
        transport = directWebSocket(url)
    if profile.type == "relay":
        transport = relayTransport(profile.relay)
    if profile.type == "ssh":
        require getIsElectron()
        tunnel = await electron.sshGateway.openTunnel(profile)
        url = tunnel.wsUrl
        transport = directWebSocket(url)

    daemonClient = new DaemonClient({ url, transport, clientId, capabilities, ... })
    await daemonClient.connect()   # existing hello/status handshake
```

The SSH tunnel is below `DaemonClient`; therefore RPC correlation, binary terminal frames,
ping/pong, timeline resume, and feature flags behave exactly as they do for direct connections.

## Behavior & Algorithms

### Tunnel creation

```
openTunnel(profile):
    validate profile shape and normalize defaults
    reject if not running in Electron main process
    resolve credentials from OS keychain / safe storage if secret refs are used
    create SSH client
    verify host key according to hostKeyPolicy
    authenticate using password, private key, or agent
    bind local TCP server on 127.0.0.1:0
    for each local socket:
        ssh.forwardOut(
            srcIP="127.0.0.1",
            srcPort=localSocket.remotePort,
            dstIP=profile.remoteDaemon.host,
            dstPort=profile.remoteDaemon.port,
        )
        pipe localSocket <-> sshChannel
    return ActiveSshGatewayTunnel with wsUrl="ws://127.0.0.1:<boundPort>"
```

### `testConnection`

`testConnection` validates the entire path without keeping a long-lived tunnel unless explicitly
requested:

1. Establish SSH connection and authenticate.
2. Verify host key.
3. Open a temporary `forwardOut` channel to `remoteDaemon.host:remoteDaemon.port`.
4. Optionally issue an HTTP health request through the tunnel path:
   `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`.
5. Return structured diagnostics.

```ts
interface SshGatewayTestResult {
  ok: boolean;
  sshConnected: boolean;
  authenticated: boolean;
  hostKeyStatus: "trusted" | "new" | "changed" | "rejected" | "not_checked";
  remoteDaemonReachable: boolean;
  daemonHealth?: "ok" | "not_ok" | "unknown";
  message?: string;
  diagnostics?: {
    sshHost?: string;
    sshPort?: number;
    username?: string;
    remoteDaemonHost?: string;
    remoteDaemonPort?: number;
    fingerprint?: string;
    errorCode?: string;
  };
}
```

### Tunnel lifecycle

- Tunnels are reference-counted or owned by one active host runtime session.
- Closing a host runtime session closes its tunnel unless another window/profile reference is using
  the same tunnel.
- On app quit, Electron main closes all local servers, SSH channels, and SSH clients.
- On SSH close/error, main notifies the renderer; the app runtime marks the daemon connection
  dropped and may retry according to reconnect policy.
- Local loopback ports are ephemeral (`127.0.0.1:0`) to avoid fixed-port conflicts.
- Keepalives are enabled by default (`keepaliveIntervalMs` default 30 seconds) to detect dead SSH
  sessions after sleep/wake or network changes.

### Host key verification

Known hosts are stored in Electron main process storage, not in renderer state. Each entry is keyed
by host + port + algorithm, and stores the fingerprint plus first/last seen timestamps.

```ts
interface KnownHostEntry {
  host: string;
  port: number;
  algorithm: string;       // e.g. "ssh-ed25519", "rsa-sha2-512"
  fingerprint: string;     // SHA256 base64 or hex, canonicalized
  firstSeenAt: string;
  lastSeenAt: string;
  label?: string;
}
```

Policy behavior:

| Policy | New host | Matching key | Changed key |
|--------|----------|--------------|-------------|
| `trust-on-first-use` | prompt user, then store if accepted | accept silently | block and show high-severity warning |
| `strict` | reject unless `expectedFingerprint` matches | accept if exact match | reject |
| `insecure-skip-verify` | accept with warning | accept with warning | accept with warning |

A changed host key must never be silently accepted in normal production mode.

### Credential handling

- Passwords and passphrases are submitted from renderer form state to Electron main only for the
  duration of `testConnection`/`openTunnel`, unless the user explicitly chooses to save them.
- Saved secrets use OS-backed storage when available:
  - macOS Keychain via Electron safe storage/keytar equivalent
  - Windows Credential Manager / DPAPI-backed safe storage
  - Linux Secret Service/libsecret when available; otherwise encrypted safe storage with a clear
    warning if OS-level protection is unavailable
- Persisted profiles store only secret references, never raw secret values.
- Secrets are not logged and never included in error messages, URLs, or telemetry.
- Private-key file paths may be stored, but private-key contents should not be stored unless the user
  explicitly imports the key and understands the trade-off.

### Daemon password interaction

SSH authenticates access to the remote host/tunnel. The Pi-Studio daemon may also require its own
password (`PI_STUDIO_PASSWORD`). The product supports both models:

| Model | Behavior |
|-------|----------|
| SSH-only | Remote daemon listens on `127.0.0.1`; no daemon password. SSH account is the access boundary. |
| SSH + daemon password | Tunnel opens after SSH auth; `DaemonClient` also supplies daemon password to the WS handshake/URL/subprotocol. |

Recommended default for single-user localhost-only remote daemons: SSH-only.
Recommended for shared hosts or remote daemons reachable by multiple users: SSH + daemon password.

### Recommended SSH server hardening

For a dedicated gateway user, administrators may restrict SSH access to port forwarding only:

```
# sshd_config Match block example
Match User pi-studio-gateway
  AllowTcpForwarding yes
  PermitOpen 127.0.0.1:6767
  PermitTTY no
  X11Forwarding no
  AllowAgentForwarding no
  ForceCommand /bin/false
```

The app does not require shell access; it only needs direct TCP forwarding to the daemon port.

## Data & Persistence

### Client/app profile store

SSH profiles are stored alongside other app host profiles, but raw secrets are replaced by secret
references. Profiles are safe to sync/export only if secret refs are omitted or redacted.

### Electron main storage

Suggested storage locations:

- Known hosts: Electron app user data directory, e.g. `known-hosts.json`.
- Tunnel runtime state: in-memory only.
- Secrets: OS keychain/safe storage only; no plaintext JSON files.

Known-host writes are atomic (temp file + rename) and tolerant of unknown fields for future
compatibility.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| SSH host unreachable | `testConnection` fails with `sshConnected:false`; renderer shows host/port troubleshooting. |
| Auth rejected | Fail with `authenticated:false`; do not retry passwords silently. |
| Private key passphrase needed | Prompt for passphrase; optionally save if user opts in. |
| Host key new under TOFU | Prompt user to trust fingerprint before connecting. |
| Host key changed | Block connection and show fingerprint comparison + recovery instructions. |
| Remote daemon not listening | SSH succeeds, `remoteDaemonReachable:false`; suggest starting daemon or changing remote host/port. |
| Remote daemon requires password | Tunnel opens, WS handshake/auth fails; prompt for daemon password separately. |
| Local port bind fails | Retry with a new ephemeral port; if repeated, return structured local-bind error. |
| Laptop sleeps / network changes | SSH close/error propagates; app runtime enters reconnecting state and may reopen tunnel. |
| Multiple windows open same SSH profile | Either share one ref-counted tunnel or create independent tunnels; close only when last owner releases. |
| Renderer crash | Main eventually closes orphaned tunnels for destroyed `webContents`. |
| App quit | Close all tunnels before process exits. |

## Security Considerations

### Pros

- The daemon can remain bound to `127.0.0.1:6767`; only SSH is exposed.
- Reuses mature SSH authentication, auditing, bastion/VPN/enterprise workflows, and key management.
- No changes to Pi-Studio's append-only WebSocket protocol.
- Works without a relay server and without opening the daemon port publicly.
- Fits Electron well because Node networking and OS credential APIs are available in main process.

### Cons / risks

- Desktop-only. Browser web and mobile cannot use this connection type directly.
- Credential handling is high-risk; secrets must remain in Electron main/OS keychain.
- Host-key verification is required. Skipping it enables man-in-the-middle attacks.
- SSH users may have broader host access than Pi-Studio needs unless administrators restrict them.
- Adds lifecycle complexity: keepalives, sleep/wake, tunnel teardown, auth prompts, changed host keys.
- Users may be confused by double authentication (SSH auth plus optional daemon password).

### Threat model

| Actor | Capability | Mitigation |
|-------|------------|------------|
| Network observer | Sees SSH connection metadata | SSH encryption hides daemon WS frames. |
| MITM host | Presents different SSH host key | Host-key verification blocks changed/untrusted keys. |
| Compromised renderer | Can request tunnels through bridge | Validate bridge inputs; keep secrets in main; expose least-privilege IPC. |
| Malicious local process | Connects to local ephemeral tunnel while open | Bind only `127.0.0.1`; random ephemeral port; close when unused; daemon password optional for defense in depth. |
| Compromised SSH account | Can reach daemon over localhost | Use restricted SSH account and/or daemon password. |

## Dependencies

- Internal: `@av-pi-studio/client` direct WebSocket transport, app host runtime, Electron preload
  bridge, desktop daemon/runtime shell.
- External: an SSH client implementation for Electron main (recommended: `ssh2`), OS keychain/safe
  storage, Node `net` local TCP server.

`ssh2` is preferred over shelling out to `ssh` for v1 because it gives structured host-key
verification, direct-tcpip channel control, programmatic errors, and cross-platform packaging.
A later fallback can optionally use the system `ssh` binary for advanced enterprise setups.

## Acceptance Criteria

- [ ] Electron desktop can open an SSH-authenticated local tunnel to a remote daemon listening on
      `127.0.0.1:6767`.
- [ ] The renderer connects through the returned `ws://127.0.0.1:<port>` URL using the existing
      `DaemonClient` direct WebSocket path.
- [ ] No raw SSH password, daemon password, private key, or passphrase is persisted in app profile
      JSON or exposed through logs.
- [ ] Host-key TOFU and strict fingerprint verification are implemented; changed host keys are
      blocked by default.
- [ ] `testConnection` distinguishes SSH auth success from remote daemon reachability and daemon
      health/auth failures.
- [ ] Closing the host session/window/app closes associated local servers, SSH channels, and SSH
      clients.
- [ ] Non-Electron platforms reject SSH profiles with a clear "desktop-only" affordance.

## TODO(verify)

- [ ] Exact host-profile storage location/key names in the app runtime store.
- [ ] Preferred OS secret-storage library (`keytar`, Electron `safeStorage`, or platform-specific
      adapters) and fallback policy on Linux without Secret Service.
- [ ] Whether multiple windows share one SSH tunnel per profile or create independent tunnels.
- [ ] Whether CLI should also support SSH profiles in a later sprint (`pi-studio --ssh user@host …`).
