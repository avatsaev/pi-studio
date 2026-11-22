# Task 001 — Linux acceptance run for milestone 2, and the checklist's new items — Summary

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Completed:** 2026-11-22
- **Status:** done

## Setup
`pi-desktop-xvfb` on the Docker bridge with `--cap-add NET_ADMIN` (the dummy interface stayed in the container); a production daemon with a password on `172.17.0.1:6890`; the app with `--secret-store=file`; a `WebSocket` Proxy and a `MutationObserver` in the page recorded its sockets, pings and pongs. Container, daemons, relay, the dummy interface and the scratch directory were removed afterwards; `~/.pi-studio` and the real keychain were not touched.

## The runs new in this task
- **Resume through the proxy** (processes stopped 30,005 ms, daemon restarted with `kill -9` at +9.15 s): `wake` 0 to 1; the old page socket closed 1006 at +38 ms; a new socket on another port with another token opened at +95 ms; the bar `disconnected` (+43 ms), `connecting…` (+46 ms), `connected` (+100 ms); `transports` held exactly one `open` entry, `lastError` `upstream_lost` for the old one; the page's marker, `performance.timeOrigin` and history length unchanged (no reload).
- **Frozen daemon** (app and daemon both `kill -STOP`, app continued after 30,064 ms, daemon 12.06 s later): `wake` 1 to 2; the page's `ping` at +44 ms, no `pong`; `disconnecting…` at +5.05 s (the 5 s probe); the socket closed 4000 at +7.05 s (Rust waits up to 2 s for the frozen daemon's close answer); `connecting…` at +7.48 s, the reconnect's `transport_open` waited for the daemon; the new socket opened at +12.11 s, `connected` at +12.12 s, 6 ms after the daemon continued; transports `open`, `closing`, none, `connecting`, `open`, never two at once.
- **The `network` reason** (dummy interface `dum0`, address added with the session open): `network` 0 to 1; one `ping` from the page 4.96 s after (5 s reading plus settling), its `pong` 3 ms later; no new socket, no change in the bar (same transport, counters up by one); removing the address and interface gave one more event, ping and pong, no reconnect.
- **Secrets:** a version 1 `daemons.json` (direct entry with a password, relay entry with a pairing link) migrated in the real webview: version 2, mode 600, `hasPassword` true on the direct entry only, no secret in `daemons.json`; `secrets.json` mode 600 with `<id>/password` and `<id>/pairingLink`; the direct entry `connected` with one `open` transport; the relay entry `connected` with no transport and a paired connection logged by the relay; no control reply held a secret. In `pi-desktop-keyring` with no option `secretStore` was `keychain` (scope `4a0f65026599eeca`); `secret-tool search` showed the password item appear on add, change on edit, go on clearing, return, go on remove, the link item the same, a rename changed nothing; `daemons.json` held no secret, no `secrets.json`.
- `cargo test -p pistudiodesktop-shell --test secret_guard`: 1 test passed.

## Commands run
- `cargo xtask ci` in `desktop/`: all 8 steps passed. Root `npm run build && npm run typecheck && npm run lint && npm test`: exit 0, 291 files, 4,134 tests.

## One line per spec criterion
Benchmark: [x] results table (not re-run; sprints 112–114 stand). [x] gate stated failed (not re-run).
Bridge: [x] direct entry through the proxy, password not exposed (116/t005; re-seen: one `open` transport, `framesIn` 7, only `ws://127.0.0.1:<port>/<64 hex>` with no protocols). [x] 100 MiB terminal output (116/t005). **[ ] 1 GiB**: open for the `bufferedAmount` pause, not shown on Linux (checklist M6 for a Windows run). [x] relay entry (116/t005). [x] error messages and Retry (116/t005). [x] reload and switch (116/t005; re-seen: old socket 1006, new one opened). [x] command list (116/t001, t005). [x] strangers refused (115/t002 tests, 116/t005 live).
Secrets: [x] version 1 migration (run above). **[ ] keychain**: Linux passed; macOS and Windows not run (117/t002, t003). [x] no keychain gives `file` (113/t008; mode 600 and `file` re-seen). [x] secret guard: the test passes; the clause "token only in the answer of `transport_open`" rests on the guard test (marker in the view's hook), the app tests (no token in `ui.inspect` or the captured log), `net`'s marker test, and the live scans of 116/t005 together; ticked with that said in the spec.
Resume: [x] stop 30 s with a daemon restart (run above). [x] network change (counter 114/t004; the page's reaction above). **[ ] five-minute sleep on a real machine**: not run; step M1 of the checklist, 117/t003.
Gates and documents: [x] `cargo xtask ci`, root gates. [ ] the documents: `platform-checks.md` and `development.md` done here; the others are 117/t004's.

## Files changed
`desktop/docs/platform-checks.md`: new section "Milestone 2: the daemon connection in Rust", steps M1–M7 (M1 five-minute sleep, M3 unsigned macOS build after an update, M4 a daemon behind an HTTP proxy is not reachable (P6), M5 firewall or security-software prompt and `local_connection`, M6 the `bufferedAmount` pause, M7 runner check marked not automated because the workflow's scripts do not read `connection` or connect through the proxy yet), each marked automated or manual with the result to expect and an empty results row per machine, plus a table of the Linux results. `desktop/docs/development.md`: "The resume signals through the proxy" (the recipe: control socket through `docker exec`, the page-side recorder, the three runs). The agent edited a paragraph of `development.md` with a script instead of the edit tool; the result is correct.
Spec edited by the orchestrator: criteria for the keychain (Linux re-run), the secret guard, both Resume criteria; TODO(verify) below.

## TODO(verify)
- Answered: the frozen daemon (a probe fails within 5 s, reconnect once the daemon continues); the page's reaction to `network` (a probe, no reconnect); the keychain on Linux.
- Open: the `bufferedAmount` pause (macOS/Windows); an unsigned macOS build after an update; the firewall prompt; a daemon behind an HTTP proxy (P6; not run on Linux); the 16 s backoff cap and the 0.8 s early page events seen in 114/t004 (not looked at); a CA certificate used as a server certificate (message unchanged).
- Seen, expected: after a frozen-daemon probe failure the bar sits in `disconnecting…` for about 2 s because Rust waits for the close answer (spec close table); `lastError` keeps `upstream_lost` after a successful reconnect (newer wins; may read oddly).
