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
  port. The server binds the loopback interface only.
- `--control-token-file <FILE>` (or `PISTUDIODESKTOP_CONTROL_TOKEN_FILE`): the file holding the token, 64
  hexadecimal characters. It is created with a fresh token when missing, readable by its owner
  only. Without this option a token for the launch is printed on standard error.
- `--secret-store <keychain|file>`: where daemon passwords and pairing links are kept. Without it the
  app takes the keychain when it answers (within 2 s, and takes a throwaway test item) and the file
  `secrets.json` otherwise. `keychain` with no usable keychain fails the launch with a message that
  names the option. Scripts and live runs pass `file`, so they never write to a person's keychain.

The wire format is JSON lines over TCP: one request per line, one reply per line.

```text
{"id": 1, "method": "auth", "params": {"token": "<64 hex>"}}
{"id": 1, "ok": true, "result": {"authenticated": true}}
{"id": 2, "method": "engine.execute", "params": {"command": "settings.set", "params": {"key": "autoStartLocalDaemon", "value": false}}}
{"id": 2, "ok": true, "result": {"autoStartLocalDaemon": false, "cliPath": null}}
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
| `engine.execute` | `{"command": string, "params"?: object}` | Runs any command by id: `command.list`, `settings.get`/`settings.set` or one of the `daemon.*` commands below. The result is the command's result |
| `engine.commands` | none | Lists the registry, as `command.list` does: `id`, `label`, `menu`, `shortcut`, `params`, `enabled`, and `reason` when disabled |
| `ui.inspect` | none | Returns the view: `{"ui": {"status": …}, "settings": {…}, "daemons": {"currentId", "entries", "local", "settings", "secretStore"}, "connection": {"secretStore", "resumeSignals": {"wake", "network"}}, "menus": […]}`. `daemons` is the registry view the page boots with (no password or pairing link) and `menus` the generated menu model, which the native "Daemons" menu is drawn from: one `daemon.entry:<id>` item per entry (the current one `checked`), `daemons.manage`, then the local daemon's start, stop and restart. `connection` is what an agent reads about how the app reaches daemons; it holds `secretStore` and `resumeSignals`, and later fields (transports) are added to the same object. `resumeSignals` counts the `connection_resume` events sent to the page since launch, by reason: `wake` when a 2 s tick found 10 s or more unaccounted for (the machine slept, the process was stopped and continued, or the clock was set forward), `network` (always 0 until the network watcher exists). At most one is sent per 5 s for every reason together, and a dropped one is not counted |
| `ui.set` | `{}` | Changes UI state. It has no field yet: `{}` succeeds with `null`, and any field is an error with nothing changed |

An unknown method is an error that lists the methods.

## Daemon commands

All are run through `engine.execute`. The registry lives in `<config dir>/daemons.json` (mode 0600).

| Command | Params | Answers |
|---|---|---|
| `daemon.list` | none | `{currentId, entries, local}`; an entry is `{id, kind: "local"\|"direct"\|"relay", name, hasPassword, address?}` and never carries the password or the pairing link |
| `daemon.add` | `{kind: "direct", name, address, password?}` or `{kind: "relay", name, pairingLink}` | the new entry |
| `daemon.update` / `daemon.remove` | `{id, name?, address?, password?, pairingLink?}` / `{id}` | the entry / `{"removed": true}` (plus `notices`, see below) |
| `daemon.switch` | `{id}` | null. Records `lastUsedId` and flushes the entry left; the page reload is done by the app, not the command |
| `daemon.local.start` / `.stop` / `.restart` / `.refresh` | none | `{"accepted": true}` at once; the work runs in the background, and an error `busy` is the answer while another request is running. Read the outcome in `daemon.list`'s `local` |

`local` is one of `{"state": "stopped"}`, `{"state": "running", "host", "port"}`, `{"state": "failed", "reason": "not_healthy" | "bad_output" | "timeout" | …}`,
`{"state": "cli_outdated", "version"}` or `{"state": "cli_missing", "path"?}`; while a request runs it is `checking`, `starting` or `stopping`.

**The secret store.** Passwords and pairing links are never in `daemons.json`, in a control answer, in `boot` or in `ui.inspect`; they are in the secret store the launch chose (`architecture.md` § Decisions, "Which secret store a launch uses"). Its kind is told in three places, and only its kind: `secretStore` in the registry view (`daemons` of `ui.inspect`, the `boot` answer and the `daemons_changed` event) and `connection.secretStore` in `ui.inspect`, each `"keychain"`, `"file"` (`secrets.json` in the configuration directory, mode 0600) or `"memory"` (a session without a configuration directory). `daemon.list` does not carry it. Errors of the secret store, as the page and `engine.execute` get them: `secret_missing` (a dial finds no item in the store for the entry), `secret_unavailable` (the store could not be read) and `secret_store_failed` (`daemon.add` / `.update` could not store a secret, nothing was written; also answered by `daemon.add`, `.update` and `.remove` while a version 1 file's secrets are held back). Notices, each handed out once in `boot`: `secrets_not_moved` (a version 1 registry's secrets the store would not take), `secret_store_fallback` (`reason`: `unavailable`, `denied` or `failed`: the keychain could not be used at launch and no `--secret-store` was given), and `file_reset` with `file` `secrets.json` (`keptAs` is `null` when the unreadable file could not be renamed). A `daemon.remove` whose store would not delete an item answers `{"removed": true, "notices": [{"kind": "secret_not_removed", "entry": <id>}]}`; the entry is removed all the same, and the page tells the person in a toast.

Run against the real CLI (`cliPath` set, auto-start off), then `ui.inspect`:

```text
{"id":12,"ok":true,"result":{"address":"ws://127.0.0.1:6893","hasPassword":false,"id":"2586e9a9-2707-4e4b-8a0f-cadba6868eac","kind":"direct","name":"Box B"}}
{"id":13,"ok":true,"result":{"currentId":"local","entries":[{"hasPassword":false,"id":"local","kind":"local","name":"This machine"},{"address":"ws://127.0.0.1:6893","hasPassword":false,"id":"2586e9a9-2707-4e4b-8a0f-cadba6868eac","kind":"direct","name":"Box B"}],"local":{"state":"stopped"}}}
{"id":14,"ok":true,"result":{"accepted":true}}
{"id":15,"ok":true,"result":{"daemons":{"currentId":"local","entries":[…],"local":{"host":"127.0.0.1","port":6767,"state":"running"},"settings":{"autoStartLocalDaemon":false,"cliPath":"/tmp/live/fake/realcli"}},"menus":[…]}}
```

## Keeping this page current

A new control method is an arm in `handle()` and a name in `METHODS`; a new `UiState` field is an
arm in `set()`. Update this page in the same change.
Most needs are better served by a new command, which every frontend gets at once.
