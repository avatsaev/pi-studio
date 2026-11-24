# Feature — Install the daemon on an SSH host

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Status: **specified 2026-11-24, not built.** Desktop roadmap milestone 6, part (c), from the grill
> [../grills/single-binary-daemon.md](../grills/single-binary-daemon.md) (D6, D10, D15, P6, P10–P12).
> R1–R9 are proposed in this document. **Compatibility is not a concern** (owner, 2026-11-22).
> Dependencies: [single-binary-daemon.md](single-binary-daemon.md) (the binary, the pin, the archive
> cache, the version layout), [desktop-relay-ssh.md](desktop-relay-ssh.md) (the SSH entry, its session,
> `run`, the remote supervisor; changed here), [self-update.md](self-update.md) (a binary daemon's own
> updates).
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

An SSH entry today works only when the host already runs a daemon or has the npm CLI; otherwise its
row says "pi-studio is not installed on this host · Install it on the host (it needs Node.js)" with
the npm command. With this feature the row offers **Install**: the app takes the binary pinned in its
build for the host's system, sends it over the SSH connection it already has, unpacks it under the
host's `~/.pi-studio/bin/`, starts the daemon and connects. The host needs no Node, no internet
access and no `curl`.

## Ground truth (checked 2026-11-24)

- `desktop/crates/ssh` opens one connection per SSH entry and gives `run(command, limit)`: the
  command runs in the user's login shell (`"$SHELL" -lic`) on its own channel, between two random
  marker lines; standard output up to 64 KiB is returned, standard error is dropped, at `limit` the
  command is killed. It can also open `direct-tcpip` channels. It cannot send a file.
- The remote supervisor (`desktop/crates/shell/src/remote_supervisor.rs`) runs `pi-studio --version`
  (exit 127 → `not_installed`), `pi-studio --json -H 127.0.0.1:<port> daemon start` and, since
  milestone 5b, `pi-studio -H 127.0.0.1:<port> update 2>&1`. Whether the daemon runs is learned from
  the app's last open of the daemon's channel (`seen_up`).
- `RemoteState`: `unknown`, `checking`, `running`, `stopped`, `not_installed`, `cli_outdated
  {version}`, `starting`, `updating`, `failed {reason, output?}`; reasons `not_healthy`, `timeout`,
  `bad_output`, `exec_failed`, `no_shell`, `update_failed`.
- Engine commands: `daemon.remote.refresh`, `daemon.remote.start`, `daemon.remote.update`.

## Non-goals

- Windows, Alpine (musl) or any other host the four binaries do not cover (D3, D12): such a host shows
  "this system is not supported" and offers nothing (P6).
- The host downloading the file itself (D6).
- Removing a daemon from a host (P7). Resuming a send (P10).
- Running the host's npm CLI: a host's npm daemon is used while it runs, never started or updated by
  the app (D15).
- Installing without a click (D10).

## Decisions

From the grill: D6 the app sends the file over the SSH connection, with progress; D10 an Install
button, nothing installed without the click; D15 a host's running npm daemon is used as it is, and
once it is stopped or too old the row offers Install; P6 unsupported systems; P10 no resume, a
present version is reused, an install unpacks into a temporary folder; P11 never downgrade; P12 a
host's own error is shown, nothing half-installed stays.

### Proposed here

| # | Decision | Why |
|---|---|---|
| R1 | The host's system is read with one `run`: `uname -s`, `uname -m`, and whether the C library is musl (`ldd --version`). `Linux x86_64` → `linux-x64`, `Linux aarch64`/`arm64` → `linux-arm64`, `Darwin arm64` → `darwin-arm64`, `Darwin x86_64` → `darwin-x64`; musl, anything else, or no `uname` (Windows) → unsupported | Cheap, works on every POSIX host; no answer is a clear "not supported" |
| R2 | The host's folder is `${PI_STUDIO_HOME:-$HOME/.pi-studio}` as the login shell sees it, read in the same `run` and used as an absolute path afterwards | A user who moved the folder keeps it |
| R3 | The file goes over a new `send` of the SSH crate: an exec channel running `cat > '<path>'` through `/bin/sh` (not the login shell, so no start-up file can read the data), fed from the archive on disk; progress is bytes accepted by the channel; a stall limit of 60 s, no total limit; the channel's exit status must be 0 | No SFTP subsystem needed (some servers disable it); flow control is SSH's own window |
| R4 | After the send, the host checks the file: its size, and its SHA-256 when `sha256sum` or `shasum` exists. A mismatch deletes it | Catches a full disk or a truncated write; SSH already protects the transfer |
| R5 | Unpacking runs one POSIX `sh` script on the host: `tar -xzf` into `bin/tmp/<random>/`, run the unpacked `pi-studio --version`, move the folder to `versions/<version>`, `ln -sfn` the `current` link, remove the temporary files. Any failure removes what it made and prints the host's own error | One round trip; nothing half-installed stays (P12) |
| R6 | From then on every command on the host runs `<host folder>/bin/current/pi-studio` by its absolute path, never `pi-studio` from `PATH` | The app runs the binary it installed, whatever else is on the host |
| R7 | `RemoteState`: `cli_outdated` becomes `outdated {version}`; new `unsupported {system}` and `installing {stage, done?, total?}` with stages `downloading`, `sending`, `unpacking`, `starting`; `failed` reasons gain `download_failed`, `checksum_mismatch`, `send_failed`, `install_failed`; `update_failed` is removed (Update now installs the pin) | States follow what the app does |
| R8 | New engine command `daemon.remote.install {id}`. `daemon.remote.update {id}` installs the pin and restarts, offered for `outdated`, or `stopped` with a binary older than the pin (P11) | One install path for both |
| R9 | One install per host at a time in the app (the supervisor's gate); two apps installing to one host each use their own temporary folder, and the second finds the version present | P10 |

## Public contract

### SSH crate

| Signature | Inputs | Outputs | Errors |
|---|---|---|---|
| `Session::send(path, source, size, stall, progress)` | an absolute path on the host, a reader, the byte count, the stall limit, a callback of bytes sent | `()` once the channel ends with status 0 | `SendError::Open` (no channel), `SendError::Stalled`, `SendError::Rejected {status}` (the host's `cat` failed: no space, no permission), `SendError::Closed` (connection lost) |

The path is quoted for `sh`; the command is never logged.

### Engine and states

| Command | Effect |
|---|---|
| `daemon.remote.refresh {id}` | probe (below) |
| `daemon.remote.install {id}` | allowed in `not_installed`, `stopped` without a binary, or `failed` from an install; runs Install |
| `daemon.remote.update {id}` | allowed in `outdated`, or `stopped` with a binary older than the pin; runs Install, then a restart |
| `daemon.remote.start {id}` | starts the binary; refused (`not_installed`) when there is none |

```
RemoteState =
  | unknown | checking | running | stopped | not_installed | starting
  | outdated { version }
  | unsupported { system }                        // e.g. "Linux x86_64 (musl)", "Windows"
  | installing { stage: downloading | sending | unpacking | starting, done?, total? }
  | failed { reason, output? }
reason: not_healthy | timeout | bad_output | exec_failed | no_shell
      | download_failed | checksum_mismatch | send_failed | install_failed
```

`output` is the last lines the host printed for `install_failed` and `send_failed`; shown, never
parsed, never logged.

### Daemons screen

The SSH row shows Install for `not_installed`, the stage and a percentage for `installing`, the reason
in words and Retry for an install failure, and "This system is not supported (<system>)" with no
button for `unsupported`. The npm instructions are removed.

## Behavior & algorithms

### Probe (D15, R1, R2, R6)

```
probe(entry):
    facts = run(host facts script, 15 s)          # system, arch, musl, host folder, binary version or none
    if the daemon's channel opens:                # an npm or a binary daemon
        running; outdated when its version (from the handshake) < minDaemonVersion
        return
    if facts.target is unsupported: unsupported(system); return
    if facts.binary_version is none: not_installed; return
    stopped
```

The facts script is one `run` and prints one line per fact. A host with only the npm CLI and no
running daemon is `not_installed` (D15).

### Install (D6, D10, P10–P12, R3–R5)

```
install(entry):                                    # only from a click
    facts = run(host facts script)
    target unsupported → unsupported; stop
    if facts.binary_version >= pin.version: start it (P11); stop
    archive = the app's cached archive for (pin, target), or download it (state downloading;
              checksum against the pin, S8/S9 of single-binary-daemon.md)
    run("mkdir -p <folder>/bin/tmp")
    name = <folder>/bin/tmp/<random>.tar.gz
    state sending; session.send(name, archive, size, 60 s, progress)
    run(check script: size, then SHA-256 when a tool exists) → mismatch: delete; failed(checksum_mismatch)
    state unpacking; run(unpack script R5, 120 s) → non-zero: failed(install_failed, output)
    state starting; run("<folder>/bin/current/pi-studio --json -H 127.0.0.1:<port> daemon start")
    on running: run(remove version folders other than current and the previous)
    connect as today
```

Every failure after the send starts runs `rm -f` of the temporary file before reporting. A lost
connection during the send leaves at most a partial temporary file, removed by the next install's
cleanup of `bin/tmp`.

### Update (R8)

For `outdated` (a running npm or binary daemon older than `minDaemonVersion`): Install, then
`<folder>/bin/current/pi-studio --json -H 127.0.0.1:<port> daemon restart`, which stops the old
daemon through the shared PID file and starts the binary. A daemon at or above the pin is moved
forward only by its own update ([self-update.md](self-update.md)).

## Data & persistence touchpoints

- On the host: `<folder>/bin/{versions/<version>/, current, tmp/}`; nothing else under the folder
  changes (an npm daemon's agents, history and config are used by the binary).
- In the app: the archive cache of [single-binary-daemon.md](single-binary-daemon.md) (S9), shared
  with the local install.
- Nothing new in the app's settings or the entry's fields.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| Windows, musl, an unknown CPU, no `uname` | `unsupported(system)`, no button (P6) |
| The account runs no commands | `failed(no_shell)` as today |
| The app cannot download the archive | `failed(download_failed)`, Retry |
| The connection drops during the send | `failed(send_failed)`; the temporary file is removed at the next attempt (P10) |
| The host's disk is full or the folder is not writable | the host's `cat` fails: `failed(send_failed, output)` |
| The size or checksum on the host differs | the file is deleted; `failed(checksum_mismatch)` |
| No `tar` or `gzip`, a home folder mounted `noexec`, a glibc too old | the unpack script fails: `failed(install_failed, output)`; nothing is left (P12) |
| The pinned version is already in `versions/` | the unpack script finds it and only switches the link (P10) |
| The host's binary is newer than the pin | not replaced; started as it is (P11) |
| An npm daemon runs on the host | used; nothing is installed (D15) |
| It stops | `not_installed`; Install (D15) |
| It is older than `minDaemonVersion` | `outdated`; Update installs the binary and restarts on it |
| The daemon does not start after the install | `failed(not_healthy)` as today; the binary stays installed; Retry starts it |
| Two installs to the same host | each in its own temporary folder; the second finds the version present (R9) |
| A slow link | progress shows; only a 60 s stall stops the send (R3) |

## Dependencies on other specs

- `features/single-binary-daemon.md`: the pin, the archive cache, the layout, `minDaemonVersion`.
- `features/desktop-relay-ssh.md`: the SSH session and the remote supervisor that change here.
- `features/self-update.md`: how an installed binary daemon moves forward.

## Acceptance criteria

Proof is on Linux, live, in containers (D16).

- [ ] An SSH host with nothing installed shows Install; after the click the row shows downloading,
      sending with a percentage, unpacking and starting; the daemon runs from
      `~/.pi-studio/bin/current/pi-studio` and the app connects.
- [ ] A host with no internet access is installed the same way.
- [ ] An Alpine host and a host without `uname` show "not supported" and no button.
- [ ] A connection cut during the send ends in `send_failed`; Retry installs and leaves no temporary
      file behind.
- [ ] A host whose home is mounted `noexec` ends in `install_failed` with the host's error, and
      nothing of the install is left.
- [ ] A host running an npm daemon is used as it is; after `pi-studio daemon stop` on the host the row
      offers Install, and after it the binary runs with the same agents and history.
- [ ] The install's commands and the host's output appear in no log.

## TODO(verify)

- Whether an exec channel running `/bin/sh -c 'cat > …'` gets the data unchanged on the servers the
  test container uses (OpenSSH) and with a `ForceCommand` set (expected: refused, `send_failed`). — agent
- `ldd --version` on musl prints to standard error and exits non-zero; the facts script must merge
  the streams. — agent
