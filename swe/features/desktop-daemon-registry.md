# Feature — Desktop Daemon Registry and Local Daemon

> **Status: specified (2026-11-15), not planned, not built.**
> Milestone 1 of the desktop client, with [desktop-native-host.md](desktop-native-host.md).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [desktop-native-host.md](desktop-native-host.md) (boot snapshot, storage, the
> desktop host), [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (the host contract this adds a member to), [cli.md](cli.md) and
> [desktop-client-protocol-followups-2.md](desktop-client-protocol-followups-2.md) § 3 (the
> `--json` output of `pi-studio daemon`), [relay-multi-client.md](relay-multi-client.md)
> (`RelayConnectError` reasons), [connection-resilience.md](connection-resilience.md) (reconnect)
> Source of decisions: [../grills/desktop-native-shell.md](../grills/desktop-native-shell.md)
> (D-numbers below are that brief's)

## Purpose

The desktop app keeps the daemons a person works with in a registry, opens on the one used last,
and lets them switch from the native menu. One entry is always "this machine": the app finds an
installed `pi-studio` CLI and starts, stops and restarts its daemon through it.

Today the window is the web client in a frame: the address and password are typed into the
connection bar after every launch (nothing saves them), and the app knows nothing about a daemon
on the same machine.

Not in this feature: sockets in Rust and the OS keychain (milestone 2), several windows or several
daemons connected at once (D16), a bundled daemon, a daemon on Windows, more than one local daemon.

## Decisions

| # | Decision |
|---|---|
| D8, D12 | A registry owned by Rust. Three kinds of entry: `local` (this machine, through the CLI), `direct` (address, optional password), `relay` (pairing link) |
| D13, D27 | Passwords and pairing links are stored in the registry file, readable by the user only. The OS keychain replaces this in milestone 2 |
| D14, D15 | Entries are managed in a Daemons screen drawn by the workbench when the host has a registry. The connection bar becomes a switcher. The web client has no registry and is unchanged |
| D16 | One window, one daemon at a time. Each entry has its own stored layout |
| D17, D19 | Launch opens the entry used last, even when it is unreachable. First run opens the local entry |
| D3 | Opening the local entry starts its daemon when it is not running; a setting turns that off. Opening a remote entry never starts the local daemon |
| D4 | Quitting never stops a daemon |
| D5 | A daemon older than the app expects still connects; the app shows a notice |
| D10 | The CLI is found through the user's shell environment, then common install locations; a setting holds an explicit path |
| D11 | On Windows the local entry explains that a local daemon needs macOS, Linux or WSL |
| D18 | A local daemon that cannot start opens the Daemons screen with the reason; nothing blocks |
| D22 | Removing an entry deletes its secret and stored layout. The local entry cannot be removed |
| D23 | A relay entry whose link stopped working gets a new link in place |
| D24 | Names are unique; addresses may repeat |
| D25 | Switching during a file transfer asks first |

## Public contract

### 1. Registry file

`daemons.json` in the app's configuration directory (the platform's per-user directory for
`com.avatsaev.pi-studio`). Mode 0600 on macOS and Linux; default profile permissions on Windows.
Written atomically (temporary file, then rename).

```
{
  version: 1,
  lastUsedId: string | null,
  entries: [
    { id: "local", kind: "local",  name: string, password?: string },
    { id: uuid,    kind: "direct", name: string, address: string, password?: string },
    { id: uuid,    kind: "relay",  name: string, pairingLink: string }
  ]
}
```

| Rule | Value |
|---|---|
| The `local` entry | Always present, exactly one, id `local`, default name "This machine". Created when missing |
| `name` | 1–64 characters after trimming; unique among entries, compared without case |
| `address` | At most 2,048 characters. Stored as typed; the workbench normalises it when connecting, as it does for the connection bar today |
| `password` | At most 1,024 characters. Absent means none |
| `pairingLink` | At most 4,096 characters. Checked by the workbench's existing pairing-link parser before it is saved |
| Number of entries | At most 64 |
| Unknown fields | Kept on rewrite |
| `lastUsedId` | Set when an entry is opened (at switch time, not on a successful connection) |

Secrets are `password` and `pairingLink`. They are never logged, never returned by a control
method, and reach the webview only through `resolveCurrent` (§ 3), for the entry being opened.

### 2. Engine commands

Every action is a command in the Rust engine's registry, callable from the native menu, the
webview, the control socket and the app's CLI.

| Command | Params | Result | Errors |
|---|---|---|---|
| `daemon.list` (query) | none | `{ currentId, entries: EntryView[], local: LocalState }` | none |
| `daemon.add` | `{ kind: "direct", name, address, password? }` or `{ kind: "relay", name, pairingLink }` | `EntryView` | `invalid_name`, `name_taken`, `invalid_address`, `invalid_link`, `too_many` |
| `daemon.update` | `{ id, name?, address?, password?: string \| null, pairingLink? }`. `password: null` clears it; an absent field is unchanged | `EntryView` | as `add`, plus `not_found`, `wrong_kind` (a field the kind does not have) |
| `daemon.remove` | `{ id }` | `{ removed: true }` | `not_found`, `local_not_removable` |
| `daemon.switch` | `{ id }` | `{ currentId }` | `not_found` |
| `daemon.local.start` / `.stop` / `.restart` | none | `{ accepted: true }`; the outcome arrives as a `LocalState` change | `unsupported`, `cli_missing`, `cli_outdated`, `busy` |
| `daemon.local.refresh` | none | `LocalState` after probing | `unsupported` |

`EntryView` is an entry without its secrets: `{ id, kind, name, address?, hasPassword }`.

`LocalState`:

| State | Meaning |
|---|---|
| `unsupported` | Windows: no local daemon |
| `cli_missing` | No CLI found. Carries the configured path when one was set and is not an executable file |
| `cli_outdated` | A CLI older than 0.0.119, which has no `--json` on `daemon start`. Carries its version |
| `stopped` | The CLI reports no healthy daemon |
| `starting` / `stopping` | An action is running |
| `running` | Carries `host` and `port` from the CLI |
| `failed` | The last action failed. Carries `reason`: `not_healthy` \| `timeout` \| `bad_output` \| `spawn_failed` |

Local daemon actions run in the background: the command returns once accepted, and a second
action while one runs is refused with `busy`.

### 3. Host member `daemons`

A new optional member of `WorkbenchHost`. Present in the desktop host, absent in the browser host.

```ts
interface HostDaemons {
  /** Current registry and local daemon state. Synchronous: the host keeps it in memory. */
  snapshot(): { currentId: string | null; entries: DaemonEntryView[]; local: LocalDaemonState };
  /** Fires after any change to the registry or to the local daemon's state. */
  subscribe(listener: () => void): () => void;
  /** What to dial for the current entry. Starts the local daemon when the rules in § Behavior
   *  say so. Rejects with a DaemonError (a code from the tables above, plus `no_current`,
   *  `local_stopped`). */
  resolveCurrent(): Promise<ConnectIntent>;
  add(input: NewDaemon): Promise<DaemonEntryView>;
  update(id: string, patch: DaemonPatch): Promise<DaemonEntryView>;
  remove(id: string): Promise<void>;
  /** Opens another entry. The window's page is reloaded; the promise does not resolve on success. */
  switchTo(id: string): Promise<void>;
  local: { start(): Promise<void>; stop(): Promise<void>; restart(): Promise<void>; refresh(): Promise<void> };
  /** Fires when the native menu asks for the Daemons screen. */
  onManageRequest(listener: () => void): () => void;
}
```

`AppIdentity` gains an optional `minDaemonVersion: string`. The desktop host sets it; the browser
host does not.

### 4. Workbench surfaces (drawn only when `host.daemons` exists)

| Surface | Contract |
|---|---|
| Connection bar | The address field, password field and Connect button are replaced by a switcher: the current entry's name and the connection status, opening a list of entries (pick one to switch) and "Manage daemons…". Disconnect and Retry stay |
| Daemons screen | A modal screen listing entries with their kind and, for the local entry, its state and Start / Stop / Restart. Add (direct or relay), edit, remove. Also holds the two settings of § 6. Opens from the switcher, from the native menu, and by itself in the cases listed under § Behavior |
| Edit form | Never shows a stored secret. The password field is empty with a "saved" marker; leaving it empty keeps the password, a Clear action removes it. A relay entry has a "Replace link" field |
| Outdated notice | When connected to a daemon whose `server_info.version` is lower than `app.minDaemonVersion`, or absent: one non-blocking notice per connection naming both versions and how to update. Features stay gated by the daemon's feature flags as they are today |

With `host.daemons` absent the workbench is unchanged, including the connection bar.

### 5. Native menu

A top-level "Daemons" menu, rebuilt after every registry or local-state change:

- one item per entry, in registry order, with a check mark on the current one; the local entry's
  item shows its state when it is not `running` (for example "This machine (stopped)");
- "Manage Daemons…";
- "Start Local Daemon", "Stop Local Daemon", "Restart Local Daemon", each enabled only in the
  states where the action applies.

Choosing an entry runs `daemon.switch`.

### 6. Settings

In the settings file of [desktop-native-host.md](desktop-native-host.md) § Settings:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `autoStartLocalDaemon` | boolean | `true` | Opening the local entry starts its daemon when it is stopped |
| `cliPath` | string or null | `null` | An explicit path of the `pi-studio` executable; null means "find it" |

### 7. What the app expects from the CLI

The app runs these and reads the last non-empty line of standard output as JSON. This output is
now a contract between `packages/cli` and the desktop app.

| Command | Used fields | Time limit |
|---|---|---|
| `pi-studio --version` | A semantic version on standard output | 5 s |
| `pi-studio --json daemon status` | `up`, `host`, `port` | 5 s |
| `pi-studio --json daemon start` | `up`, `host`, `port`, `error` | 90 s |
| `pi-studio --json daemon restart` | as `start` | 90 s |
| `pi-studio --json daemon stop` | `stopped` | 15 s |

`start` on a healthy daemon reports `up: true` with `error: "no_keypair"` when the CLI's home has
no key file. The app treats that as running: a key file matters for pairing, not for a connection
on the same machine. `pairingUrl` in the output is a credential; the app discards it without
storing or logging it.

## Behavior & algorithms

### Finding and running the CLI (D10)

```
shellEnvironment():                      # once per app run; again on Retry
    run the user's shell as a login, interactive shell and read its environment (5 s limit)
    on failure: the app's own environment

findCli():
    if settings.cliPath is set:
        return it when it is an executable file, else cli_missing (with that path)
    look up "pi-studio" on shellEnvironment().PATH
    else try the usual per-user and system install directories for npm and Node version managers
    else cli_missing
    if `pi-studio --version` < 0.0.119: cli_outdated

runCli(args):                            # one call at a time, queued
    spawn the CLI with shellEnvironment()   # so `node` is found and PI_STUDIO_* apply as in a terminal
    kill it when the time limit passes -> failed(timeout)
    last non-empty stdout line is not JSON -> failed(bad_output)
```

An app started from the dock or the launcher does not inherit the terminal's `PATH`. The CLI is a
Node script, so both `pi-studio` and `node` must be found: that is why the whole shell environment
is used, not only the location of the CLI.

On Windows none of this runs: the local state is `unsupported`.

### Local daemon state

```
probe():                                 # at launch, after each action, when the Daemons screen
                                         # opens, and when a connection to the local entry drops
    findCli() failed            -> cli_missing | cli_outdated
    status.up                   -> running(host, port)
    else                        -> stopped

start():   starting -> runCli(daemon start)  -> up ? running(host, port) : failed(not_healthy)
restart(): starting -> runCli(daemon restart) -> same
stop():    stopping -> runCli(daemon stop)    -> stopped
```

A daemon started outside the app (by the CLI in a terminal) is adopted: `start` on it reports
`up: true` and no second daemon is started. The address to dial is `ws://<host>:<port>` from the
CLI's answer; an unspecified bind address (`0.0.0.0`, `::`) is dialled as the loopback address.

Stopping the local daemon while the window is connected to it is confirmed first (a native
confirm that says agents will stop), then the workbench disconnects without retrying and opens
the Daemons screen. Restart keeps the connection: the workbench's reconnect covers the gap.

### Launch

```
Rust, before the page loads:
    read the registry (corrupt -> desktop-native-host.md § Files that cannot be read)
    make sure the local entry exists
    current = lastUsedId when that entry exists, else "local"
    probe the local daemon in the background

Workbench connection boot, when host.daemons exists:
    intent = await host.daemons.resolveCurrent()
        resolved -> connect(intent)
        rejected -> open the Daemons screen showing the error; do not connect
```

The window appears before the local daemon has started; the switcher shows "starting".

```
resolveCurrent():
    no current entry                      -> reject no_current
    direct                                -> { url: address, password, connect: true }
    relay                                 -> { url: pairingLink, connect: true }
    local:
        unsupported | cli_missing | cli_outdated -> reject with that code
        running                           -> { url: ws://host:port, password, connect: true }
        stopped and autoStartLocalDaemon  -> start(); running ? intent : reject with the failure
        stopped otherwise                 -> reject local_stopped
```

No reachability check is made for `direct` and `relay` entries: the workbench connects and, when
that fails, shows its normal connecting and error states with the switcher still usable (D19).

### Switching (D16)

```
switchTo(id):
    id is the current entry and the connection is up -> nothing
    file transfers running -> native confirm (D25); "no" stops here
    make sure pending storage writes have reached Rust
    lastUsedId = id; write the registry
    reload the window's page                 # boot runs again, on the new entry
```

The page is reloaded on purpose. Every workbench store (sessions, tabs, timelines, caches) holds
one daemon's data and was written for one connection per page; a reload guarantees none of it
crosses to another daemon, and the new entry's stored layout is in place before the first render.
A switch from the native menu follows the same steps.

### Adding, editing, removing

- **Add.** The form checks the address or the pairing link with the workbench's existing parsers;
  Rust checks sizes, the name and the entry count. A new entry is not opened automatically.
- **Edit the current entry.** A changed address, password or link takes effect on the next
  connection; the screen offers "Reconnect now".
- **Remove (D22).** A native confirm. The entry, its secret and its stored state are deleted. When
  it was the current entry: the workbench disconnects, `lastUsedId` becomes null, and the Daemons
  screen opens. The local entry has no Remove.
- **Relay link no longer valid (D23).** A connection failure with the SDK reason `wrong_key` marks
  the entry "pairing link no longer valid". `daemon_offline` shows the SDK's own message, which
  already names both causes (offline, or key replaced). "Replace link" is available on every relay
  entry at any time; the name and the stored layout are kept.

## Data & persistence touchpoints

| Data | Where | Lifecycle |
|---|---|---|
| Registry, including secrets | `daemons.json`, app configuration directory | Created on first launch; rewritten on every change |
| Stored state per entry | [desktop-native-host.md](desktop-native-host.md) § Storage | Deleted with the entry |
| Shell environment, CLI location, local state | Memory | Per app run |
| Daemon's own state | The daemon's `PI_STUDIO_HOME`, untouched by the app | The app only runs the CLI |

No existing desktop users: nothing to migrate. The web client's storage is untouched.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| First launch, CLI installed, no daemon running | The local daemon is started and the workbench connects; nothing is typed |
| First launch, no CLI (or Windows) | The Daemons screen opens with the reason and, for a missing CLI, the install command (`npm i -g @av-pi-studio/cli`, which needs Node) and Retry. Adding a remote entry works |
| The local daemon was started by the CLI | Adopted; no second daemon |
| `daemon start` reports `not_healthy`, times out or prints something else | Local state `failed` with the reason; Daemons screen with Retry. Other entries stay usable (D18) |
| The local daemon needs a password and none is saved, or it is wrong | The workbench's existing authentication error; the entry's password is edited in the Daemons screen |
| The last-used remote entry is unreachable at launch | The window opens on it in the reconnecting state; the switcher works (D19) |
| `lastUsedId` names an entry that no longer exists | Treated as first run: the local entry |
| `autoStartLocalDaemon` off and the local daemon stopped | Daemons screen with the local entry showing Start; no error styling |
| A name already in use, an empty name, a malformed address or link, a 65th entry | Refused in the form with the matching message; nothing is written |
| Removing the current entry | Disconnect, Daemons screen, layout and secret deleted |
| The local daemon dies while connected | The workbench's reconnect runs as for any dropped connection; a probe updates the local state. The app does not restart the daemon by itself |
| Quit | No daemon is stopped (D4), whatever started it |
| The app is newer than the daemon | Connects; the outdated notice is shown (D5) |
| The CLI is older than 0.0.119 | `cli_outdated` with the update command; remote entries stay usable |
| The shell environment cannot be read in 5 s | The app's own environment is used; the CLI may then be `cli_missing`, and `cliPath` is the way out |
| A control-socket caller lists daemons | It gets `EntryView`s; no secret is ever returned |

## Dependencies on other specs

- [desktop-native-host.md](desktop-native-host.md): the boot snapshot that carries the registry
  view to the page, per-entry storage, the settings file, corrupt-file handling, the transfer
  count used by the D25 confirm, and the engine that holds these commands.
- [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md): gains
  `daemons` and `app.minDaemonVersion`.
- [desktop-client-protocol-followups-2.md](desktop-client-protocol-followups-2.md) § 3: the CLI's
  `--json` output, consumed here.
- [relay-multi-client.md](relay-multi-client.md): the `RelayConnectError` reasons used by D23.

## Acceptance criteria

- [ ] Given the CLI is installed and no daemon runs, when the app launches for the first time,
      then a local daemon is started and the workbench is connected to it without typing anything.
- [ ] Given a local daemon started from a terminal, when the app launches, then it connects to
      that daemon and the CLI reports `started: false`.
- [ ] Given the app is connected to the local daemon with an agent running, when the app quits,
      then the daemon process and the agent are still running.
- [ ] Given no CLI on the machine, when the app launches, then the Daemons screen shows why and
      how to install it, and a `direct` entry can be added and connected to.
- [ ] Given a CLI installed through a Node version manager and the app started without a
      terminal, then the CLI is found.
- [ ] Given `cliPath` points at a file that does not exist, then the local state is `cli_missing`
      naming that path.
- [ ] Given three entries (local, direct with a password, relay), when each is chosen in the
      native menu, then the window reloads, connects to it, and shows the layout last used with
      that entry.
- [ ] Given the app was last used on entry B, when it launches, then it opens on B; with B
      unreachable it shows the reconnecting state and the switcher still switches.
- [ ] Given an entry is removed, then its secret and its stored state are gone from disk; the
      local entry offers no Remove and `daemon.remove` on it answers `local_not_removable`.
- [ ] Given a second entry is added with an existing name in another letter case, then it is
      refused with `name_taken`.
- [ ] Given a file transfer is running, when another entry is chosen, then a native confirm is
      shown, and "no" leaves the connection and the transfer untouched.
- [ ] Given a relay entry whose connection fails with `wrong_key`, then the entry shows "pairing
      link no longer valid", and after a new link is pasted it connects with its name and layout kept.
- [ ] `daemons.json` has mode 0600 on macOS and Linux. No log line, and no control-socket answer,
      contains a password, a pairing link or a `pairingUrl`.
- [ ] Given a daemon older than `minDaemonVersion`, then the connection succeeds and one notice
      names both versions.
- [ ] On Windows the local entry shows the explanation and no Start; `daemon.local.start` answers
      `unsupported`.
- [ ] In the web client the connection bar is unchanged and no Daemons screen exists.
- [ ] Every command of § 2 can be run from the control socket and the app's CLI, with tests, and
      the engine's adversarial command test covers them.

## TODO(verify)

- **`minDaemonVersion` value.** Proposed 0.0.119, the release that changed downloads to
  `file_download_request`; a relay entry needs 0.0.121 in any case (the relay reports
  `daemon_outdated` itself). Confirm when the app is first released.
- **Reading the shell environment.** The login-and-interactive approach is what other desktop
  editors use; it was not tried here. A shell whose start-up files print to standard output, or
  that takes longer than 5 s, must not break it. Fish and other non-POSIX shells need a check.
- **The 90 s limit for `daemon start`.** The CLI polls health 40 times at 150 ms, each request with
  a 1.5 s limit, so about 66 s at worst. Confirm against a slow first start.
- **`daemon status` and other homes.** A daemon started with another `PI_STUDIO_HOME` or
  `--pi-home` is invisible to the app unless that variable is in the shell environment. Several
  local daemons are out of scope (D12).
- **WSL2.** A daemon inside WSL2 reached as a `direct` entry on `127.0.0.1` is expected to work and
  was not tried.
- **macOS and Windows.** Nothing in this spec has run on either; PR #57's builds are the first.
  The Windows and macOS criteria need a person at those machines.
