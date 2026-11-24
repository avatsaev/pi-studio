# Control protocol

What a frontend or automation can ask of a running Pi Studio. The methods are implemented in
`crates/shell/src/control.rs` (`handle`), which has no transport: the desktop app feeds it from a
loopback socket, and tests call it directly. The webview does not use it; it has its own commands
(`architecture.md` § The webview boundary).

## From outside: the loopback socket

Start the app with a control port:

```sh
cargo run -p pistudiodesktop -- --control 7878 --control-token-file control.token
```

- `--control <PORT>` (or `PISTUDIODESKTOP_CONTROL_PORT`): serve on `127.0.0.1:<PORT>`; `0` picks any free
  port. The server binds the loopback interface only. A port in use is tried again every 50 ms for 10 s
  before the launch fails with `cannot listen on 127.0.0.1:<PORT>: …`: an app restarted by an update
  starts while the process it replaces, which holds the port, is still exiting (macOS `open -n` returns
  only when the new instance is launched). Any other bind error fails at once.
- `--control-token-file <FILE>` (or `PISTUDIODESKTOP_CONTROL_TOKEN_FILE`): the file holding the token, 64
  hexadecimal characters. It is created with a fresh token when missing, readable by its owner
  only. Without this option a token for the launch is printed on standard error.
- `--secret-store <keychain|file>`: where daemon passwords and pairing links are kept. Without it the
  app takes the keychain when it answers (within 2 s, and takes a throwaway test item) and the file
  `secrets.json` otherwise. `keychain` with no usable keychain fails the launch with a message that
  names the option. Scripts and live runs pass `file`, so they never write to a person's keychain.
- `--transfers <engine|page>`: which path file transfers take. `engine` (the default) is the app's own
  transfer engine; `page` is the page's own path. Any other value fails the launch with a message that
  names the option. The mode is fixed for the launch and is `transfers` in the `boot` answer.
- `--update-manifest <URL>`: the address of the update manifest for this launch, in place of the one the
  app was built with (`ui.inspect.update.manifest` then reads `"override"`). It must be `https`: the
  updater refuses any other scheme except in a test build. It still verifies every file's signature
  against the key built into the app and never installs a build that is not newer. A value that is
  not an address fails the launch with a message that names the option.
- `--daemon-pin <FILE>`: a file in place of the daemon pin the app was built with (`desktop/daemon-pin.json`:
  `{version, assets: {<target>: {url, sha256, size}}}`, the one `pi-studio` binary version the app installs,
  for `darwin-arm64`, `darwin-x64`, `linux-arm64` and `linux-x64`), for a check that installs a binary of its
  own. The file is read at launch: one that cannot be read, is longer than 64 KiB or is not a valid pin (a
  `<major>.<minor>.<patch>` version, the four targets, each with an http(s) address, a 64-digit SHA-256 and a
  positive size) fails the launch with a message that names the option and holds no address or path. The log
  says `daemon pin: <version> (built in)` or `(override)` and never an address.

The wire format is JSON lines over TCP: one request per line, one reply per line.

```text
{"id": 1, "method": "auth", "params": {"token": "<64 hex>"}}
{"id": 1, "ok": true, "result": {"authenticated": true}}
{"id": 2, "method": "engine.execute", "params": {"command": "settings.set", "params": {"key": "autoStartLocalDaemon", "value": false}}}
{"id": 2, "ok": true, "result": {"autoStartLocalDaemon": false, "checkForUpdates": true}}
```

- The first line on a connection must be `auth`. Anything else, or a wrong token, gets
  `{"ok": false, "error": "authentication required"}` and the connection is closed.
- A reply carries the request's `id` and either `"ok": true` with `result`, or `"ok": false` with
  `error`.
- A request line is at most 1 MiB. A longer one is an error.
- A request the app has not answered within 60 seconds gets
  `{"ok": false, "error": "timeout: no reply in 60s"}`. It may still be running.

With a netcat that waits for replies (`nc -q 2` on most Linux distributions):

```sh
TOKEN=$(tr -d '\r\n' < control.token)
printf '%s\n' "{\"id\":\"auth\",\"method\":\"auth\",\"params\":{\"token\":\"$TOKEN\"}}" \
  '{"id":1,"method":"engine.execute","params":{"command":"settings.set","params":{"key":"autoStartLocalDaemon","value":false}}}' \
  '{"id":2,"method":"ui.inspect","params":{}}' | nc -q 2 127.0.0.1 7878
```

## Not from the webview

The webview does not use the control protocol: it has its own commands (`docs/architecture.md`
§ The webview boundary) and receives no event. Every method below is socket-only.

## Methods

| Method | Params | Does |
|---|---|---|
| `engine.execute` | `{"command": string, "params"?: object}` | Runs any command by id: `command.list`, `settings.get`/`settings.set`, one of the `daemon.*` commands or one of the `update.*` commands below. The result is the command's result |
| `engine.commands` | none | Lists the registry, as `command.list` does: `id`, `label`, `menu`, `shortcut`, `params`, `enabled`, and `reason` when disabled |
| `ui.inspect` | none | Returns the view: `{"ui": {"status": …}, "settings": {…}, "daemons": {"currentId", "entries", "local", "settings", "secretStore"}, "connection": {"secretStore", "transports": […], "ssh": {…}, "lastError", "resumeSignals": {"wake", "network"}}, "transfers": {…}, "update": {…}, "menus": […]}`. `daemons` is the registry view the page boots with (no password or pairing link) and `menus` the generated menu model, which the native "Daemons" menu is drawn from: one `daemon.entry:<id>` item per entry (the current one `checked`), `daemons.manage`, then the local daemon's start, stop and restart; after it comes the "Help" menu holding `update.check`, "Check for Updates…" (on macOS the app draws that item in the application menu, after About, instead). `update` is described under **The update commands** below. `connection` is what an agent reads about how the app reaches daemons; it holds `secretStore`, `transports`, `ssh`, `lastError` and `resumeSignals` (`transports`, `ssh` and `lastError` are described under **The connections** below). `resumeSignals` counts the `connection_resume` events sent to the page since launch, by reason: `wake` when a 2 s tick found 10 s or more unaccounted for (the machine slept, the process was stopped and continued, or the clock was set forward), `network` (always 0 until the network watcher exists). At most one is sent per 5 s for every reason together, and a dropped one is not counted |
| `ui.set` | `{}` | Changes UI state. It has no field yet: `{}` succeeds with `null`, and any field is an error with nothing changed |

An unknown method is an error that lists the methods.

## Daemon commands

All are run through `engine.execute`. The registry lives in `<config dir>/daemons.json` (mode 0600).

| Command | Params | Answers |
|---|---|---|
| `daemon.list` | none | `{currentId, entries, local, remote}`; an entry is `{id, kind: "local"\|"direct"\|"relay"\|"ssh", name, hasPassword, address?}` (an `ssh` entry also has `ssh: {host, user?, port?, identityFile?, jump?, daemonPort, hasSshPassword, hasPassphrase}` and its `address` is the display text `[user@]host[:port]`) and never carries a password, a passphrase or the pairing link. `remote` is the state of the current entry's daemon when that entry is `ssh`, else `null` |
| `daemon.add` | `{kind: "direct", name, address, password?}`, `{kind: "relay", name, pairingLink}` (`invalid_link` when it does not parse) or `{kind: "ssh", name, host, user?, port?, identityFile?, jump?, daemonPort? (default 6767), password?, sshPassword?, passphrase?}` | the new entry. Field errors: `invalid_host`, `invalid_user`, `invalid_port`, `invalid_path`, `invalid_jump` |
| `daemon.update` / `daemon.remove` | `{id, name?, address?, password?, pairingLink?, host?, user?, port?, identityFile?, jump?, daemonPort?, sshPassword?, passphrase?}` (`null` clears an optional field or a secret; `wrong_kind` for a field the kind does not have) / `{id}` | the entry / `{"removed": true}` (plus `notices`, see below) |
| `daemon.switch` | `{id}` | null. Records `lastUsedId` and flushes the entry left; the page reload is done by the app, not the command |
| `daemon.local.start` / `.stop` / `.restart` / `.refresh` | none | `{"accepted": true}` at once; the work runs in the background, and an error `busy` is the answer while another request is running. Read the outcome in `daemon.list`'s `local` |
| `daemon.local.update` | none | `{"accepted": true}` at once; runs `pi-studio update` (5 min), reads `--version` again, then starts the daemon as `start` does. Enabled only when `local` is `outdated`, `stopped`, or `failed` with reason `download_failed`, `checksum_mismatch` or `install_failed` (the retry) (`command.list` says why not: `unsupported`, `update_not_offered`). While it runs `local` is `updating`; it ends `running`, `outdated` (still below the minimum), or `failed` with reason `install_failed` and the `output`'s last lines (or any start failure's reason) |
| `daemon.remote.start` / `.refresh` | none | `{"accepted": true}` at once; the current SSH entry's daemon is started (`pi-studio --json -H 127.0.0.1:<daemonPort> daemon start` on the host) or probed again in the background. Errors: `wrong_kind` (the current entry is not `ssh`), `no_current`, `busy`; `start` also `not_installed` and `cli_outdated`. Read the outcome in `daemon.list`'s `remote` |
| `daemon.remote.update` | none | `{"accepted": true}` at once; runs `pi-studio -H 127.0.0.1:<daemonPort> update 2>&1` (5 min) on the host over the entry's SSH session (`-H`: the update's restart step then finds this entry's daemon, not whatever listens on the CLI's default port), then `pi-studio --version`, then the daemon start as `daemon.remote.start` does. Enabled only when `remote` is `cli_outdated`, `stopped`, or `failed` with reason `update_failed` (the retry) (`command.list` says why not: `no_current`, `wrong_kind`, `not_installed`, `update_not_offered`); `busy` while another request runs. While it runs `remote` is `updating`; it ends `running`, `cli_outdated` (still below the minimum), `not_installed`, or `failed` with reason `update_failed` and the `output`'s last lines (a timeout says so in `output`; or any start failure's reason). After a successful update the page connects again, as after a start |

`local` is one of `{"state": "stopped"}`, `{"state": "running", "host", "port"}`, `{"state": "failed", "reason": "not_healthy" | "bad_output" | "timeout" | "spawn_failed" | "download_failed" | "checksum_mismatch" | "install_failed", "output"?}` (`output`: the last lines of what a failed update printed, only with `install_failed`; shown to the user, never parsed),
`{"state": "outdated", "version"}`, `{"state": "downloading", "received", "total"}` (bytes) or `{"state": "installing"}`; while a request runs it is `checking`, `starting`, `stopping` or `updating`. `downloading`, `installing`, `download_failed` and `checksum_mismatch` are in the model and are not produced yet; a CLI the supervisor cannot find is `failed` with `spawn_failed`.

`remote` is one of `{"state": "unknown"}`, `checking`, `running`, `stopped`, `not_installed`, `starting`, `updating`, `{"state": "cli_outdated", "version"}` or `{"state": "failed", "reason": "not_healthy" | "timeout" | "bad_output" | "exec_failed" | "no_shell" | "update_failed", "output"?}` (`output`: the last lines `pi-studio update` printed, only with `update_failed`; shown to the user, never parsed). It is in memory only and is reset to `unknown` when another entry is opened.

**The secret store.** Passwords and pairing links are never in `daemons.json`, in a control answer, in `boot` or in `ui.inspect`; they are in the secret store the launch chose (`architecture.md` § Decisions, "Which secret store a launch uses"). Its kind is told in three places, and only its kind: `secretStore` in the registry view (`daemons` of `ui.inspect`, the `boot` answer and the `daemons_changed` event) and `connection.secretStore` in `ui.inspect`, each `"keychain"`, `"file"` (`secrets.json` in the configuration directory, mode 0600) or `"memory"` (a session without a configuration directory). `daemon.list` does not carry it. Errors of the secret store, as the page and `engine.execute` get them: `secret_missing` (a dial finds no item in the store for the entry), `secret_unavailable` (the store could not be read) and `secret_store_failed` (`daemon.add` / `.update` could not store a secret, nothing was written; also answered by `daemon.add`, `.update` and `.remove` while a version 1 file's secrets are held back). Notices, each handed out once in `boot`: `secrets_not_moved` (a version 1 registry's secrets the store would not take), `secret_store_fallback` (`reason`: `unavailable`, `denied` or `failed`: the keychain could not be used at launch and no `--secret-store` was given), and `file_reset` with `file` `secrets.json` (`keptAs` is `null` when the unreadable file could not be renamed). A `daemon.remove` whose store would not delete an item answers `{"removed": true, "notices": [{"kind": "secret_not_removed", "entry": <id>}]}`; the entry is removed all the same, and the page tells the person in a toast.

**The connections.** `connection.transports` lists the connections the page has through Rust (`transport_open`), at most four: `{"entryId", "via", "state", "framesIn", "framesOut", "bytesIn", "bytesOut", "peakHeldIn", "peakHeldOut"}`. `entryId` is the registry entry the connection was opened for. `via` is how it reaches the daemon: `"direct"` (a dial to the daemon's own address: a local or direct entry, or a pairing link with a host hint), `"relay"` (through the relay) or `"ssh"` (a channel of the entry's SSH session). `state` is `"connecting"` from `transport_open` until the page's upgrade is accepted, `"open"` while messages pass and `"closing"` during a close handshake; a connection that has ended is gone from the list. `framesIn` and `bytesIn` count what went from the daemon to the page, `framesOut` and `bytesOut` the other way (text and binary messages and their payload bytes); `peakHeldIn` and `peakHeldOut` are the most payload bytes Rust held for the connection at one moment in each direction. `connection.ssh` is the app's one SSH session as counts, `{"state", "hops", "channels"}`: `state` is `"none"` (no session and none being opened), `"connecting"` (the connect runs) or `"open"`; `hops` is how many jump hosts an open session runs through and `channels` how many channels (the page's daemon socket, the engine's, a remote command) are open on it, both 0 while it is not open. `connection.lastError` is `{"code", "atMs"}` or `null`: the code and the time (milliseconds since the Unix epoch) of the last failed `transport_open` (its error code: `address_mismatch`, `invalid_address`, `limit`, `secret_missing`, `secret_unavailable`, `invalid_link`, `unreachable`, `unauthorized`, the relay's reasons (`relay_unreachable`, `daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_outdated`, `wrong_key`, `protocol_error`, `timeout`) and SSH's (`ssh_config`, `host_key_unknown`, `host_key_changed`, `known_hosts`, `auth_failed`, `passphrase_needed`, `key_unreadable`, `forwarding_refused`, `daemon_not_running`, `ssh_lost`), …) or abnormal end of a connection (`page_refused`: the gate refused an attempt and no page got in in time, or the page's side broke the protocol; `page_timeout`: no page came; `upstream_lost`: the daemon's side ended without a close; `too_large`: a message above the limit), whichever is newer. A page that simply leaves (a reload) records nothing. All three are empty (`[]`, `{"state": "none", "hops": 0, "channels": 0}`, `null`) in a session without the app's hook, and `lastError` is kept until a later error replaces it. No address, user name, key fingerprint, token, password, pairing link or message text is in any of them (the page's local address and its token are only in the answer of `transport_open`).

**The transfers.** `transfers` is the transfer engine's view: `{"mode", "connection": {"state", "entryId", "opens"}, "active": […], "queued", "totals": {"done", "failed", "cancelled"}, "peakHeld", "lastError"}`. `mode` is `"engine"` or `"page"`, the launch's `--transfers`. `connection.state` is `"closed"`, `"connecting"`, `"open"` or `"waiting"`; `entryId` is the entry the bulk connection serves, or `null`; `opens` counts how often it was opened in this run. Each `active` item is `{"id", "kind": "upload"|"save", "state": "running"|"waiting", "bytesDone", "bytesTotal": number|null, "restarts"}`; `queued` counts transfers waiting behind the active ones. `totals` counts transfers that ended in this run. `peakHeld` is the most bytes the engine held for transfers in memory at one moment. `lastError` is `{"code", "atMs"}` or `null`. Without the app's hook the section holds the mode, a closed connection, an empty list, zeros and `null`. It never holds a path, an address, a handle or a secret.

Run against the real CLI (auto-start off; recorded when the CLI was named by a `cliPath` setting, which no longer exists), then `ui.inspect`:

```text
{"id":12,"ok":true,"result":{"address":"ws://127.0.0.1:6893","hasPassword":false,"id":"2586e9a9-2707-4e4b-8a0f-cadba6868eac","kind":"direct","name":"Box B"}}
{"id":13,"ok":true,"result":{"currentId":"local","entries":[{"hasPassword":false,"id":"local","kind":"local","name":"This machine"},{"address":"ws://127.0.0.1:6893","hasPassword":false,"id":"2586e9a9-2707-4e4b-8a0f-cadba6868eac","kind":"direct","name":"Box B"}],"local":{"state":"stopped"}}}
{"id":14,"ok":true,"result":{"accepted":true}}
{"id":15,"ok":true,"result":{"daemons":{"currentId":"local","entries":[…],"local":{"host":"127.0.0.1","port":6767,"state":"running"},"settings":{"autoStartLocalDaemon":false,"cliPath":"/tmp/live/fake/realcli"}},"menus":[…]}}
```

## Update commands

The app's self-update (`swe/features/desktop-self-update.md`). All are run through `engine.execute` and take no params (any are ignored; no address, path or key is ever taken).

| Command | Label | Enabled when | Answers |
|---|---|---|---|
| `update.check` | Check for Updates… (menu: Help) | the state is not `checking`, `downloading` or `restart_needed` | `{"accepted": true}` at once; the check runs in the background |
| `update.install` | Install Update | `available`, or `failed` with an offered `version` | `{"accepted": true}` at once; the download (and, on Linux and macOS, the install: a `.deb`/`.rpm` through `pkexec`, which may wait for the user) runs in the background. Ends in `restart_needed` or `failed` (`signature`, `download`, `offline`, `install`, `refused`) |
| `update.restart` | Restart to Update | `restart_needed` | `{"accepted": true}` at once; with file transfers running the app first asks the close question and stays as it is on Cancel; then the app restarts (on Windows the installer runs and ends the app; if it cannot start the state is `failed` with `install`) |

A command that cannot run fails with ``"`update.x` is unavailable: <reason>"``, and `command.list` and the menu item give the same reason: `updates are not available in this app` (a build with no updater), `an update check is already running`, `an update is downloading`, `the update is installed: restart the app to finish it`, `there is no update to install`, `no update is waiting for a restart`, or `an update action is already starting` (between an accepted command and the app beginning it). Read the outcome in the state.

The state is `update` in the `boot` answer and in `ui.inspect`: `{"state": "idle" | "checking" | "up_to_date" | "available" | "downloading" | "restart_needed" | "cannot_install" | "failed", …}` with the fields of the state in camelCase (`checkedAt`, `version`, `releaseUrl`, `received`, `total?`, `reason`, `code`). In `ui.inspect` it also has `current` (this app's version), `kind` (`appimage`, `deb`, `rpm`, `app`, `nsis`, `msi` or `unknown`), `checksEnabled` (the `checkForUpdates` setting), `manifest` (`"default"` or `"override"`), and, when there are any, `lastCheckAt` (milliseconds since the Unix epoch) and `lastError` (the code of the last failure). The release page's address is the only address in it; there is no file path and no key. The state is in memory only; a launch starts from `idle`.

## Keeping this page current

A new control method is an arm in `handle()` and a name in `METHODS`; a new `UiState` field is an
arm in `set()`. Update this page in the same change.
Most needs are better served by a new command, which every frontend gets at once.
