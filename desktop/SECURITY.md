# Security

## Reporting a vulnerability

Report it privately through this repository's private vulnerability reporting (the "Security" tab,
"Report a vulnerability"). Do not open a public issue for a vulnerability. Say what you did, what
happened and which version you used; a file or a command sequence that reproduces it helps most.

## What is treated as untrusted

- **Files.** Anything Pi Studio opens may be malformed or hostile. A file must produce an error, never
  a crash, a hang or an unbounded allocation.
- **Automation input.** Command params and control-protocol requests come from scripts and agents
  and are validated like file contents.
- **The webview.** It is given the least it needs: it may call only the app's own commands
  (`docs/architecture.md` § The webview boundary) and receives no event. It has no `core:` or
  plug-in permissions (`apps/pistudiodesktop/src-tauri/capabilities/default.json`), the content
  security policy allows only the app's own bundled files, and the main window loads no remote
  content. Everything it sends is validated in Rust like any other input: a link leaves the app
  only through `open_external` after a Rust check (http, https and mailto, at most 8,192
  characters), and a save never takes a path from the page — the destination comes from the native
  dialog and stays in Rust.

## The control channel

The control server is off unless the app is started with `--control`. It listens on the loopback
interface only, requires a token on the first line of every connection, and bounds the size of a
request. The token file is a credential: it is created readable by its owner only, and `*.token`
is in `.gitignore`. See `docs/control-protocol.md`.
