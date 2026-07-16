# PI Studio Gateway

> Design spec for **`pi-studio-gateway`** — a single, self-contained, installable package that
> bundles everything needed to run the Pi-Studio daemon on a Linux server as a systemd-managed
> background service. This document is the brainstorm + specification; it precedes implementation.

## 1. Goals

- **One artifact** to download and run — no monorepo checkout, no `npm workspaces`, no manual
  dependency wiring.
- **Trivial install**: a single terminal command turns a bare Linux box into a running,
  reachable-on-reboot Pi-Studio daemon.
- **Trivial uninstall**: one command fully removes the service, binaries, and (optionally) data —
  leaves no orphaned systemd units, files, or processes.
- **Runs as a proper background service** (systemd), not a `screen`/`tmux`/`nohup` hack — starts on
  boot, restarts on crash, has real logs via `journalctl`.
- **Easily configurable** — a first-run wizard for humans, flags/env for automation, and a small
  `config` subcommand for changing settings later without hand-editing JSON.
- **Consistent with the existing daemon** — reuses the real `$PI_STUDIO_HOME/config.json` schema,
  env-var overlay, password-auth/pairing model, and PID-lock/identity mechanisms already implemented
  in `packages/server`. The gateway is a *packaging and lifecycle* layer on top of the existing
  daemon, not a rewrite of it.

## 2. Non-goals

- Not a multi-tenant / multi-user server product. One gateway install = one daemon = one
  `$PI_STUDIO_HOME`, matching Pi-Studio's local-first, single-operator model.
- Not a container image (Docker/Podman) in v1 — plain Linux + systemd only. (A container image can
  be a later, separate artifact; it does not need systemd and is out of scope here.)
- Not a Windows/macOS service manager integration in v1 (launchd/Windows services). Linux-only.
- Does not manage TLS termination / reverse proxy — that's left to the operator (nginx/Caddy in
  front, or the existing relay for remote access). The gateway binds plain WS by default.

## 3. Distribution model — self-contained tarball + `install.sh`

**Decision:** primary distribution is a **prebuilt, self-contained release tarball**, fetched and
installed via a single shell command. No npm registry access is required on the target machine.

```bash
curl -fsSL https://molagent.ai/install-gateway.sh | bash
# or, pinned to a version:
curl -fsSL https://molagent.ai/install-gateway.sh | bash -s -- --version 1.4.0
# or, fully offline:
tar xzf pi-studio-gateway-linux-x64.tar.gz && ./pi-studio-gateway-linux-x64/install.sh
```

### 3.1 Why a tarball instead of `npm install -g`

- The daemon depends on **`node-pty`**, a native module. A tarball can vendor a **prebuilt
  binary per architecture** (`linux-x64`, `linux-arm64`) so the target server never needs a C/C++
  toolchain, `python3`, or `node-gyp`.
- No dependency on npm registry reachability, `npm login`, or private registry credentials on the
  server (relevant for locked-down / air-gapped production boxes).
- The monorepo's `protocol`/`highlight`/`server` packages are `"private": true` today; publishing
  them (even just internally) is extra release surface we don't need if we can ship a single
  archive instead.

### 3.2 Release artifact contents

```
pi-studio-gateway-<version>-linux-<arch>.tar.gz
└── pi-studio-gateway/
    ├── install.sh                 # installer entry point (idempotent)
    ├── uninstall.sh                # thin wrapper -> `bin/pi-studio-gateway uninstall`
    ├── VERSION                    # plain semver string
    ├── bin/
    │   └── pi-studio-gateway      # Node shebang script (CLI: install/uninstall/config/...)
    ├── dist/                      # bundled, pre-built JS (see §4) — daemon + gateway CLI
    │   ├── daemon/main.js
    │   └── gateway-cli/main.js
    ├── node_modules/              # vendored runtime deps, incl. prebuilt node-pty/<arch>.node
    └── systemd/
        ├── pi-studio-gateway.service.tmpl       # system-mode unit template
        └── pi-studio-gateway.user.service.tmpl  # user-mode unit template (default)
```

- Built once per architecture by CI (`linux-x64`, `linux-arm64`); `install.sh` detects `uname -m`
  and downloads the matching archive when used via the `curl | bash` one-liner.
- `dist/` is produced by bundling (esbuild) `protocol` + `highlight` + `server` + a new
  `gateway-cli` package into two entry bundles (daemon, gateway CLI), so there is no
  `@av-pi-studio/*` workspace resolution needed at runtime (see §4).
- `node_modules/` contains only what can't/shouldn't be bundled: **`node-pty`** (native), and any
  other native/binary deps. Pure-JS deps are bundled directly into `dist/`.

### 3.3 Secondary distribution: npm package (later / optional)

An **unscoped** package `pi-studio-gateway` may additionally be published to npm for users who
prefer `npm install -g pi-studio-gateway`. It is the *same* `bin/pi-studio-gateway` CLI; `npm`
becomes just another way to place that CLI on `$PATH` and fetch the version-matched runtime bundle
on first run (falling back to the tarball fetch internally for the native/prebuilt parts). This is
explicitly **out of scope for v1** — ship the tarball installer first, revisit npm publishing once
the tarball flow is proven.

## 4. Build: turning the monorepo into one runtime bundle

New workspace package: **`packages/gateway-cli`** (name TBD to avoid clashing with the published
CLI name — working name for the *source* package inside the monorepo; the *published artifact* is
unscoped `pi-studio-gateway`, see §3 naming note).

```
packages/gateway-cli/
├── src/
│   ├── cli.ts              # commander entry: install|uninstall|start|stop|restart|status|
│   │                        # logs|config|update
│   ├── installer/
│   │   ├── systemd.ts       # render + install/remove unit files, systemctl calls
│   │   ├── wizard.ts        # interactive first-run prompts
│   │   ├── paths.ts         # install/data/config path resolution (system vs user mode)
│   │   └── uninstall.ts
│   └── config-cmd.ts        # `config get/set/show/edit`, thin wrapper over daemon-config.ts
└── package.json
```

**Build pipeline** (new root script `npm run build:gateway-release`):

1. `tsc -b` the normal workspace graph (protocol, highlight, server, gateway-cli) for typechecking.
2. `esbuild` bundle two entry points to CJS or ESM-single-file, `platform: node`, `target: node20`,
   marking `node-pty` (and any other native module) as `external`:
   - `packages/server/src/daemon/main.ts` → `release/dist/daemon/main.js`
   - `packages/gateway-cli/src/cli.ts` → `release/dist/gateway-cli/main.js`
3. Copy `node_modules/node-pty` (with its prebuilt `.node` binary for the target arch) and any other
   externalized native deps into `release/node_modules/`.
4. Copy `systemd/*.tmpl`, `install.sh`, `uninstall.sh`, `bin/pi-studio-gateway`, `VERSION`.
5. `tar czf pi-studio-gateway-<version>-linux-<arch>.tar.gz release/`.

This keeps the existing monorepo/workspace source layout and `tsc -b` project-reference build
completely intact (per `docs/build-layering.md`) — bundling is an **additional** release step, not
a replacement for the normal dev build.

## 5. Install locations & filesystem layout

Two modes, chosen at install time (default: **user mode**, see §6).

### 5.1 User mode (default)

| Purpose | Path |
|---|---|
| Installed application (immutable-ish, replaced on upgrade) | `~/.local/share/pi-studio-gateway/<version>/` + `current` symlink |
| CLI on PATH | `~/.local/bin/pi-studio-gateway` (symlink into the versioned dir) |
| Data / state (`$PI_STUDIO_HOME`) | `~/.pi-studio/` (unchanged default from the existing daemon) |
| systemd unit | `~/.config/systemd/user/pi-studio-gateway.service` |
| Logs | `journalctl --user -u pi-studio-gateway` (systemd captures stdout/stderr); the daemon's
own rotating file logs remain at `~/.pi-studio/logs/` as today |
| Gateway's own small install-state file | `~/.config/pi-studio-gateway/gateway.json` (records install path, version, mode — used by uninstall/update) |

### 5.2 System mode (`--system`, opt-in)

| Purpose | Path |
|---|---|
| Installed application | `/opt/pi-studio-gateway/<version>/` + `current` symlink |
| CLI on PATH | `/usr/local/bin/pi-studio-gateway` |
| Data / state | `/var/lib/pi-studio-gateway` (`$PI_STUDIO_HOME` override) |
| systemd unit | `/etc/systemd/system/pi-studio-gateway.service` |
| Environment file | `/etc/pi-studio-gateway/gateway.env` |
| Service account | existing user supplied via `--user <name>` (installer does **not** create a
new restricted system account by default — see §7 rationale), or `--user $(whoami)` running the
install as root on someone's behalf |
| Logs | `journalctl -u pi-studio-gateway` + `/var/lib/pi-studio-gateway/logs/` |

Both modes write the **same** daemon config format; only the *location* and the *systemd scope*
differ. `pi-studio-gateway status` prints which mode is active.

## 6. Service scope: per-user systemd by default

**Decision:** default install target is a **per-user systemd service** (`systemctl --user`), not a
system-wide service with a dedicated account.

**Rationale:** Pi-Studio's whole model is "the daemon runs *as you*, on *your* machine, driving an
agent that touches *your* projects with *your* git identity, *your* SSH agent, *your* npm/node
setup, and (per the earlier bundled-CLI work) *your* installed `pi` credentials." A dedicated
low-privilege system account breaks that by default — it can't read your SSH keys, can't see
`~/.pi/agent/auth.json`, can't `cd` into arbitrary project directories you own without explicit ACL
work. Per-user mode has none of that friction: the service *is* your login session's daemon.

- Install: `pi-studio-gateway install` (no `--system`) →
  - writes `~/.config/systemd/user/pi-studio-gateway.service`
  - `systemctl --user daemon-reload`
  - `systemctl --user enable --now pi-studio-gateway`
  - `loginctl enable-linger $(whoami)` (requires one sudo-gated call — the installer explains this
    single privileged step: "so the gateway keeps running after you log out/reboot even before you
    log back in") — if the user declines/lacks permission, the service still runs, but only while
    a session for that user is active, and the installer prints a clear warning to that effect.
- System mode remains available (`--system`, needs root) for shared/managed servers where an
  operator has already planned out a dedicated account and directory permissions; this is
  documented as the advanced path with the tradeoffs above spelled out, not the default.

## 7. systemd unit design

### 7.1 User-mode unit (`pi-studio-gateway.service`, template)

```ini
[Unit]
Description=Pi-Studio Gateway daemon
Documentation=https://molagent.ai/docs/gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart={{INSTALL_DIR}}/current/bin/pi-studio-gateway run
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=2
TimeoutStopSec=10
EnvironmentFile=-{{CONFIG_DIR}}/gateway.env
WorkingDirectory={{HOME_DIR}}

# Hardening that does NOT restrict filesystem access (the agent must reach arbitrary project
# dirs the user owns) — only restricts things that are safe defaults regardless:
NoNewPrivileges=true
ProtectClock=true
ProtectHostname=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=default.target
```

- `Type=notify`: the daemon calls `sd_notify(READY=1)` once the HTTP/WS listener is up (a small,
  optional integration — falls back to `Type=simple` if the `sd-notify` dependency is unavailable,
  no hard requirement on systemd internals leaking into the daemon's core).
- Deliberately **no** `ProtectHome`, `ProtectSystem=strict`, or `ReadWritePaths` allow-listing in
  user mode — the whole point is unrestricted access to the user's own files, matching what the
  agent already does when you just run `pi` yourself in a terminal.
- `EnvironmentFile=-...` (leading `-` = optional, missing file is not an error) supplies
  `PI_STUDIO_LISTEN`, `PI_STUDIO_PASSWORD`, `PI_STUDIO_HOME`, `PI_STUDIO_HOSTNAMES` — the exact env
  vars the daemon already reads (`daemon-config.ts`, `bootstrap.ts`), so no new env-var surface is
  invented.

### 7.2 System-mode unit differences

Same template with `User={{SERVICE_USER}}`, `Group={{SERVICE_GROUP}}`, an absolute
`EnvironmentFile=/etc/pi-studio-gateway/gateway.env` (required, not optional), and a note in the
generated file listing which directories the service account needs read/write access to (left as
an operator follow-up, not automated in v1).

## 8. The `pi-studio-gateway` CLI

Single binary, subcommands:

| Command | Purpose |
|---|---|
| `pi-studio-gateway install [--system] [--yes] [--listen H:P] [--password ...] [--home DIR]` | First-time setup: runs the wizard (or non-interactive with flags), writes config, installs + starts the systemd unit. Idempotent — re-running detects an existing install and offers `update`/`reconfigure` instead. |
| `pi-studio-gateway uninstall [--purge]` | Stops + disables + removes the systemd unit, removes the installed application directory and PATH symlink. **Without** `--purge`, `$PI_STUDIO_HOME` (config + persisted agent/session data) is left untouched. **With** `--purge`, prompts for confirmation (or `--yes`) and deletes `$PI_STUDIO_HOME` too. |
| `pi-studio-gateway start` / `stop` / `restart` | Thin wrappers over `systemctl [--user] {start,stop,restart} pi-studio-gateway`. |
| `pi-studio-gateway status` | Service state (active/enabled), mode (user/system), version, listen address, data dir, and a live health-check ping against `/api/health`. |
| `pi-studio-gateway logs [-f] [-n N]` | Wraps `journalctl [--user] -u pi-studio-gateway`. |
| `pi-studio-gateway config show` | Prints the effective config (file + env overlay applied), secrets masked. |
| `pi-studio-gateway config set <key> <value>` | Dotted-path set into `config.json` (e.g. `daemon.listen`, `daemon.hostnames`) with Zod validation before write; offers to restart the service to apply. |
| `pi-studio-gateway config edit` | Opens `$EDITOR` on `config.json`, validates on save, refuses to save an invalid file (keeps a `.bak`). |
| `pi-studio-gateway pair [--direct]` | Prints how to connect a client to this gateway. Default output shows a **direct-connect** block (LAN/VPN: `ws://<host>:<port>` + bearer password — what today's reference client, `packages/web-client`, understands) and, once a relay-capable client exists, a **relay pairing** URL + QR code (E2EE, reuses `packages/cli`'s existing `pairing.ts`/`qr.ts` logic) for reaching the gateway from anywhere without opening an inbound port. `--direct` prints only the direct-connect block (host + password, no QR) for scripting/copy-paste into the web client. See §9.3. |
| `pi-studio-gateway update [--version X.Y.Z]` | Downloads the new release tarball, extracts alongside the current version, flips the `current` symlink, restarts the service. Old versions are pruned (keep last 2 by default) so `update` doubles as easy rollback (`--rollback` re-points `current` to the previous version without a download). |
| `pi-studio-gateway run` | **Internal** — the actual `ExecStart` target; not intended for interactive use (no wizard, just boots the daemon with resolved config). Exists as a stable, documented entry point independent of internal file layout changes. |

## 9. Configuration UX

### 9.1 Interactive wizard (`pi-studio-gateway install`, no flags)

```
$ pi-studio-gateway install
Pi-Studio Gateway v1.4.0 — installer

? Install mode: (Use arrow keys)
❯ Per-user (recommended — runs as you, starts on login, no root needed for the daemon itself)
  System-wide (root-managed, needs an existing Linux user to run as)

? Listen address [127.0.0.1:6767]:
? Expose beyond localhost (0.0.0.0)? This lets other devices on your network connect. (y/N)

  You chose to expose beyond localhost — a password is required.
? Password: [leave blank to auto-generate a strong one]
✓ Generated password: 8f2a1c9e4b7d3f60

? Pi-Studio home directory (data/config) [~/.pi-studio]:

Installing...
✓ Extracted runtime to ~/.local/share/pi-studio-gateway/1.4.0
✓ Wrote ~/.pi-studio/config.json
✓ Installed ~/.config/systemd/user/pi-studio-gateway.service
✓ systemctl --user enable --now pi-studio-gateway
? Keep the gateway running after logout/reboot? Requires one privileged step
  (loginctl enable-linger). (Y/n)
✓ Linger enabled for <user>

Pi-Studio Gateway is running.
  Local:   ws://127.0.0.1:6767
  Network: ws://192.168.1.20:6767

Connect a client:
  Direct (LAN/VPN, e.g. the web client):
    Host:     ws://192.168.1.20:6767
    Password: 8f2a1c9e4b7d3f60
  Relay pairing (E2EE, once a relay-capable client exists):
    pi-studio-gateway pair
    [QR CODE]

Manage it with:
  pi-studio-gateway status | logs -f | config show | uninstall
```

- Binding beyond `127.0.0.1` **forces** a password prompt/auto-generation — the installer will not
  silently expose an unauthenticated daemon to the LAN. This mirrors the "auth is required once you
  leave localhost" spirit already implicit in the daemon's host-allowlist/password-auth design.
- All prompts are skippable with flags (`--system`, `--yes`, `--listen`, `--password`,
  `--no-password` [only allowed with `127.0.0.1`], `--home`, `--no-linger`) for scripted/Ansible
  installs; `--yes` alone applies every default without prompting.
- The `Network:` address and the *direct-connect* Host/Password pair are the same thing printed
  twice for convenience — see §9.3 for exactly how a client (in particular the web client) uses them.

### 9.2 Ongoing configuration

- `config.json` remains the source of truth (same Zod schema as today — `persistedConfigSchema` in
  `packages/server/src/config/daemon-config.ts`); the gateway CLI never invents a parallel config
  format, it only adds convenience commands (`config get/set/show/edit`) around the existing file +
  env-var overlay (`PI_STUDIO_LISTEN`, `PI_STUDIO_PASSWORD`, `PI_STUDIO_HOME`,
  `PI_STUDIO_HOSTNAMES`), which continue to take precedence over the file exactly as they do now.
- `config set` validates the *whole resulting document* against `persistedConfigSchema` before
  writing (atomic temp-file rename, matching the daemon's own persistence style) — an invalid key
  or value is rejected with a clear error, config file is never left half-written.
- Sensitive values (`daemon.auth.password`) are stored the same way the daemon already stores them
  (bcrypt hash via `resolvePasswordHash`), never echoed back in plaintext by `config show`.

## 10. Uninstall behavior

```
$ pi-studio-gateway uninstall
This will stop and remove the Pi-Studio Gateway service and installed application files.
Your data (~/.pi-studio: sessions, agent history, config) will be preserved.
Continue? (y/N) y

✓ systemctl --user disable --now pi-studio-gateway
✓ Removed ~/.config/systemd/user/pi-studio-gateway.service
✓ systemctl --user daemon-reload
✓ Removed ~/.local/share/pi-studio-gateway
✓ Removed ~/.local/bin/pi-studio-gateway

Your data is still at ~/.pi-studio. Run with --purge next time to remove it too,
or delete it manually.
```

- `--purge` additionally deletes `$PI_STUDIO_HOME` after a second, explicit confirmation
  (`Type the home directory path to confirm deletion:` — a deliberate high-friction guard against
  accidental data loss, since this includes agent session history).
- Uninstall is safe to re-run (idempotent) and safe to run even if the install is partially broken
  (e.g. unit file exists but process is already dead) — every step checks current state before
  acting rather than assuming a clean prior install.
- `loginctl disable-linger` is offered but not forced (leaving linger on is harmless if the user has
  other lingering services).

## 11. Security defaults

- Default listen address is `127.0.0.1:6767` — unchanged from today's daemon default; never
  auto-expands to `0.0.0.0` without an explicit choice in the wizard or `--listen 0.0.0.0:...` flag.
- Exposing beyond localhost **requires** a password (enforced by the installer, not just
  documented) — auto-generates a strong random one if the operator doesn't supply one.
- `config.json` and the gateway's own state file are written with `0600`/`0700` permissions.
- The pairing URL/QR carries the key in the URL **fragment** (never sent to any server), consistent
  with the existing `pairing.ts` design — the gateway CLI's `pair` command reuses that exact logic
  rather than reimplementing it.
- systemd hardening flags in §7.1 are applied even in user mode, limited to ones that don't
  interfere with filesystem access the agent legitimately needs.

## 12. Versioning & updates

- `VERSION` file + `pi-studio-gateway --version` report the gateway package version, which is
  tracked independently of (but released alongside) the core daemon version — one release process,
  one version number for the whole tarball for simplicity in v1.
- `pi-studio-gateway update` fetches `https://molagent.ai/releases/gateway/<version>/...`, verifies
  a checksum (published alongside each release), extracts to a new versioned directory, flips the
  `current` symlink, restarts the service. The **previous** version directory is kept (configurable
  retention, default 2) purely as an instant `--rollback` path if the new version fails to start
  (auto-detected via a post-update health check with automatic rollback on failure).
- Config schema changes remain additive/backward-compatible (already a stated protocol principle in
  `MAIN-SCOPE.md`), so updates never require a manual config migration step.

## 13. Telemetry (planned, future — OpenTelemetry; no v1 implementation)

**Decision:** the gateway will eventually emit **operational telemetry** (metrics/traces, and
optionally structured logs) via **OpenTelemetry (OTel)**, so operators — including a future hosted
/ fleet-management view for people running many gateways — can see health, resource usage, and
errors without SSH-ing in to read `journalctl`. This is a **planned direction, not a v1 feature**:
no OTel SDK, exporter, or config surface ships in the first release. This section exists so the
later work has an agreed shape and doesn't get bolted on incompatibly.

- **Scope of what would be instrumented** (gateway/daemon operational signals, not user content):
  - Process/service health: daemon up/down, restart count, uptime, install/update/rollback events.
  - Resource usage: CPU/memory of the daemon process, PTY session count, active WS connections.
  - Request-level metrics: HTTP/WS request counts, latencies, error rates on the daemon's API.
  - Optional traces across a request (WS connect → auth → session start), useful for debugging
    slow pairing/auth or PTY spawn issues.
  - **Explicitly excluded**: prompt/response content, file contents, project paths/names, git
    identity, session transcripts — i.e. nothing from inside the agent's actual work. Telemetry is
    about the *service*, not the *user's data*, mirroring the daemon's existing no-telemetry-on-
    content stance.
- **Why OpenTelemetry specifically:** vendor-neutral (OTLP export works against Prometheus/Grafana,
  Honeycomb, Datadog, or a future first-party molagent.ai collector without re-instrumenting), and
  it's the de facto standard for Node service instrumentation — no bespoke metrics format to
  design or maintain.
- **Off by default, opt-in when it ships:** consistent with §11's security posture and the
  daemon's current no-telemetry default — when this lands, it will require an explicit
  `pi-studio-gateway config set telemetry.enabled true` (or install-time flag/prompt) plus an
  explicit OTLP endpoint (`telemetry.otlpEndpoint`); no telemetry is sent anywhere by default, and
  none is sent to any molagent.ai-operated collector without the operator pointing at it
  themselves.
- **Anticipated shape (subject to change when actually implemented):**
  - A `telemetry` block in `config.json` (`telemetry.enabled`, `telemetry.otlpEndpoint`,
    `telemetry.otlpHeaders`, `telemetry.serviceName`/`resourceAttributes`), validated by the same
    `persistedConfigSchema` Zod schema as everything else — no parallel config file.
  - Instrumentation lives in `packages/server` (the daemon already owns the metrics that matter);
    the gateway CLI only adds `config` support for the new keys and surfaces telemetry status in
    `pi-studio-gateway status`. The gateway installer/CLI itself (install/uninstall/update
    execution) does **not** get separate telemetry — only the long-running daemon process would be
    instrumented, since that's what would actually run continuously in production.
  - Uses the OTel Node SDK's standard OTLP exporters (`@opentelemetry/exporter-trace-otlp-http` /
    `-metrics-otlp-http` or gRPC equivalents); bundled the same way as other pure-JS deps (§4), no
    native module implications.
- **Not planned:** no default/managed collector endpoint baked into the gateway, no telemetry
  enabled by the install wizard by default, no crash-reporting SDK (e.g. Sentry-style automatic
  error upload) — if adopted, error reporting would ride the same OTel traces/logs pipeline rather
  than a separate vendor integration.
- This is tracked as a **post-v1 milestone**; v1 ships with zero telemetry code paths, matching the
  daemon's current stance, and this section is the agreed design to implement against once
  prioritized.

## 14. Open questions / follow-ups (not blocking v1)

- Multi-arch CI build matrix and where release artifacts are hosted (GitHub Releases vs
  `molagent.ai`'s own release storage) — infra decision, not a design one; this spec assumes
  `https://molagent.ai/install-gateway.sh` as the public-facing installer URL (with release
  tarballs served from a matching `molagent.ai/releases/...` path), but either backing store works
  with the same `install.sh`.
- Whether `pi-studio-gateway` should also offer a `--docker` output mode (render just the
  Dockerfile/compose equivalent) for operators who want containers after all — deferred, see §2.
- Whether system-mode should gain a guided "grant this project directory to the service account"
  helper (ACL/bindfs) — deferred until there's real demand for system-mode beyond "I don't want a
  per-user service."
- Telemetry/crash reporting: **see §13** for the planned OpenTelemetry direction; remaining open
  question is *when* to prioritize it and whether a first-party molagent.ai OTLP collector/dashboard
  is ever built, vs. leaving operators to point at their own (Grafana/Honeycomb/etc.) — not decided,
  not blocking.
- Telemetry/crash reporting **for the installer itself** (install/uninstall/update commands, as
  opposed to the daemon covered in §13) — none planned; failures print actionable errors and exit
  non-zero.
