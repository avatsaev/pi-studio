# Task 005 — Linux live checks for the proxy — Summary

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Completed:** 2026-11-22
- **Status:** done

## Setup
Scratch `PI_STUDIO_HOME`, `PI_STUDIO_PI_HOME`, `--config-dir`, `--secret-store=file`, free ports 6880–6884, 4444, 7979 (never 6767 or 6791); the production daemon (`node packages/server/dist/daemon/main.js`, `PI_STUDIO_PASSWORD` set); the debug app under `PISTUDIODESKTOP_LOG=debug`, driven by WebKitWebDriver in `pi-desktop-xvfb`; the container was recreated before each run; all of it cleaned up afterwards (no leftover listeners or containers; `~/.pi-studio` and the keychain untouched). Screenshots and raw output were kept in `/tmp/BridgeLive-screens/`, outside the repository.

## Defects found and fixed
1. **The connection bar stayed on "connecting…" after any failed open** (55 s with the daemon down, no message, no Retry). The daemon client leaves `connecting` only on a close, and a refused `transport_open` produced none. `src/host/proxied-transport.ts` now calls `inner.onClose(1006, "")` before rejecting (for a refused open and for an answer without an address), as the SDK's own transport does; three regression tests. Owner: 116/t003.
2. **A wrong password and a certificate error read "connection refused".** `shortConnectionReason` tested `refus` before the 401, certificate and host cases. It now tests `ECONNREFUSED`/"connection refused", `certificate`, "does not accept this host", timeout, then 401/403/password, and `refus` last (`packages/workbench/src/features/connection/connection-presentation.ts`, tests, an invariant in `packages/workbench/AGENTS.md`). **This function is shared with the web client** (it changes only messages matching the new patterns): merging releases a workbench version, and the owner's "web-client looks unchanged" confirmation is still to give.

## The runs
**(1) Connect, with 116/t003's and t004's deferred checks.** Direct entry with a password. `ui.inspect`: one transport `open`, `framesIn` 7; the daemon showed one client (`browser`, `platform: "desktop"`, `127.0.0.1`); the page constructed only `ws://127.0.0.1:<port>/<64 hex>` with no protocols, a second one on another port with another token after the daemon was killed and restarted, and still one transport. `daemon_resolve_current` answered `{"connect":true,"url":"ws://127.0.0.1:6880"}`, no password. Memory scan (`/proc/<pid>/mem`, as root in the container): the password 0 times in the web and network processes; the page's own token (positive control) 14 and 11; the Rust process held the password 8 times; the app log (debug) and control replies held neither password nor token.
**(2) Terminal flood.** `seq` of 1,000,000 lines (104.9 MiB) then a checksum line, three runs: no gap, no bad line, printed SHA-256 equals the host's; 1.51, 1.61, 1.62 s (about 70 MiB/s); a key typed every 60 ms echoed at the page after 25 ms median, 36–46 ms at most (5–6 ms idle); `peakHeldIn` at most 550,276 bytes; RSS of app plus WebKit 691 MiB to a peak of 1,094 MiB.
**(3) 1 GiB.** Download 6.17, 6.32, 6.58 s (155–166 MiB/s) against 6.44, 6.63 s on the webview's own socket and sprint 104's 6.5 s; upload 6.27, 6.41 s against 6.40 s; SHA-256 equal both ways. `peakHeldIn` 262,160 and `peakHeldOut` 65,540 bytes (262,160 out with the daemon stopped for 6 s). RSS growth: download +137 to +186 MiB (own socket +137 to +146, sprint 104 +116); upload about +2.08 GiB in both modes (the page, not the proxy). **Not shown:** the pause on `bufferedAmount` — it never exceeded 32,904 bytes, with or without the daemon stopped, in either mode, because WebKitGTK hands the bytes to its network process (it grew by about 890 MiB during the stall).
**(4) Relay.** A scratch relay and a second daemon, an entry from `--json daemon pair`: "connected", `transports` `[]`, `lastError` null, the page's only socket `ws://127.0.0.1:<relay port>`, the relay logged the paired connection; `daemon_resolve_current` still returns the pairing link.
**(5) Errors** (each opened through the switcher, fixed build): wrong password "auth failed" (`unauthorized`); stopped daemon "connection refused" (`unreachable`); untrusted certificate and expired certificate "certificate rejected" (`tls`, the tooltip says which); host not allowed "host not allowed" (`host_not_allowed`); each recovered with one Retry once the cause was fixed (CA added to the container's store; a valid leaf; `PI_STUDIO_HOSTNAMES`). A certificate that is itself a CA gives the vague "was refused" (`TlsReason::Other`).
**(6) Reload and switch**, sampled every 20 ms: never more than one transport; the old client left with 1001; the new one connected 91 ms (reload) and 101 ms (switch within the daemon) later; a switch to the relay entry gave `[]`.
**(7) The local port.** A new listening port of the app appeared 285 ms after the click; strangers with wrong tokens (with the right Origin, no Origin, another Origin, a wrong Host, no path, 20 more) each got a bare 403 and the page then connected; afterwards no process of the app listened on it and a later attempt got `ECONNREFUSED`; the debug log has "refused an upgrade" lines and no token. **Not run live:** a right token with a wrong Origin or Host, and a second use of the token (only the page holds the token): covered by `crates/net/src/proxy/tests/gate.rs`.
Also: `transport_open` to another address or scheme from the page answered "The page asked for an address that is not the current daemon's." (`address_mismatch`); an unlisted command "Command not found".

## Files changed
`desktop/apps/pistudiodesktop/src/host/proxied-transport.ts` + test; `packages/workbench/src/features/connection/connection-presentation.ts` + test; docs `desktop/docs/development.md` (new section "The transport proxy in the real webview", procedure and numbers), `desktop/docs/architecture.md`, `desktop/AGENTS.md`, `packages/workbench/AGENTS.md`.

## Commands run (end of sprint 116, orchestrator, combined tree)
- Root `npm run build && npm run typecheck && npm run lint && npm test`: exit 0; 291 files, 4,134 tests passed.
- `cargo xtask ci` in `desktop/`: all 8 steps passed. App: `npm run check` ok, `lint` clean, `npm test` 132 passed.

## Acceptance criteria
- [x] Each of the seven runs is above with its approach and what was seen (screenshots kept outside the repository).
- [x] The Bridge criteria that Linux can show are ticked in the spec with this evidence; criterion 3 stays open for the `bufferedAmount` clause.
- [x] The download's rate is about the same as direct (155–166 MiB/s against 6.5 s for 1 GiB in sprint 104): the P2 mark is met.
- [x] `cargo xtask ci` passes.

## Follow-ups / TODO(verify)
- The upload's pause on `bufferedAmount`: to look at on the macOS and Windows runs (sprint 117).
- A 1 GiB upload grows the page by about 2 GiB on WebKitGTK in both modes: a subject for milestone 3 (the transfer engine).
- A CA certificate used as a server certificate gives a vague TLS message; `connection.lastError` keeps an old error after a later success (newer wins, may read oddly).
- Handoff: status row for this run (orchestrator, sprint end).
