# Control protocol

What a frontend or automation can ask of a running Pi Studio. The methods are implemented in
`crates/shell/src/control.rs` (`handle`), which has no transport: the desktop app feeds it from the
webview and from a loopback socket, and tests and the `view` example call it directly.

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

The wire format is JSON lines over TCP: one request per line, one reply per line.

```text
{"id": 1, "method": "auth", "params": {"token": "<64 hex>"}}
{"id": 1, "ok": true, "result": {"authenticated": true}}
{"id": 2, "method": "engine.execute", "params": {"command": "item.add", "params": {"text": "milk"}}}
{"id": 2, "ok": true, "result": {"id": 1}}
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
  '{"id":1,"method":"engine.execute","params":{"command":"item.add","params":{"text":"milk"}}}' \
  '{"id":2,"method":"ui.inspect","params":{}}' | nc -q 2 127.0.0.1 7878
```

## From the webview

The frontend calls the same methods through the Tauri command `control(method, params)`, with no
token: the webview is part of the app. It has one more command, `invoke_command(command)`, for a
menu click or a shortcut. That one may open a native dialog, so it is not offered on the socket.
After any request, from either side, the app sends the webview a `view` event when the value to
draw has changed.

## Methods

| Method | Params | Does |
|---|---|---|
| `engine.execute` | `{"command": string, "params"?: object}` | Runs any command by id, engine commands and shell commands alike. The result is the command's result |
| `engine.commands` | none | Lists the registry: `id`, `label`, `menu`, `shortcut`, `params`, `enabled`, and `reason` when disabled |
| `ui.inspect` | none | Returns the view, exactly what the frontend draws: `{"ui": …, "document": …, "menus": […], "shellCommands": […]}`. `document` is what `document.inspect` returns, or `null`. Each menu has a `label` and `items` with `id`, `label`, `shortcut`, `enabled`, `reason` and `checked` |
| `ui.set` | `{"theme"?: "dark" \| "light", "hideDone"?: bool}` | Changes UI state. Every field is validated before any is applied: an unknown field or a bad value is an error and nothing changes |

An unknown method is an error that lists the methods.

## Keeping this page current

A new control method is an arm in `handle()` and a name in `METHODS`; a new `UiState` field is an
arm in `set()` and a field in `apps/pistudiodesktop/src/lib/types.ts`. Update this page in the same change.
Most needs are better served by a new command, which every frontend gets at once.
