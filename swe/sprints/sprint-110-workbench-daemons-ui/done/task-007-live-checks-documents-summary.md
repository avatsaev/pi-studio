# Task 007 — Live checks of the switcher and the Daemons screen (Linux webview), and documents — Summary

**Sprint:** sprint-110-workbench-daemons-ui · **Completed:** 2026-11-20 · **Status:** done. Checks 1–16 pass after two fixes made during the run (below).

## How it was run
`pi-desktop-xvfb` container (host network), WebKitGTK webview, X-display screenshots and XTest input. Real CLI as the local daemon (scratch `PI_STUDIO_HOME`); a direct daemon with a password on 6893; a local relay on 7000 with a relay-paired daemon on 6894; a daemon of version 0.0.100 (a copy of the server build with its version changed) on 6895; a fake model server so an agent could run. Everything was stopped and the scratch directories removed afterwards.

## Evidence
1. **First launch, nothing typed:** window, then connected to the local daemon in 2.1 s (start 1.2–2.1 s, far under the 90 s limit). The "Starting…" frame was seen on later starts, not on this one.
2. **Adoption:** daemon started first, app launched: connected, one daemon process (also in sprint-109/task-006).
3. **No CLI:** the Daemons screen opened by itself with the reason and `npm i -g @av-pi-studio/cli`. After fixing the path, the screen's Retry re-probes (state `stopped`, the card shows Start); Start then connects. Retry does not connect by itself: that is the presentation's design (`call: "refresh"`), recorded as a deviation from the task text.
4. **Auto-start off:** the screen opened with "The local daemon is stopped. Start it to connect." and no error styling. **Failed first**: Start started the daemon but the window stayed disconnected. Fixed (see Fixes); Start now connects in 1.5 s.
5. **Add and switch:** `127.0.0.1:6893` was accepted and normalised; "not an address !!" was refused in the form ("This is not a valid daemon address."); "box b" refused ("Another daemon already has this name."). Opening the direct and the relay entry reloaded and connected. Three different layouts (1, 2 and 3 panes) were kept through a switcher/menu cycle after the fix; the theme was the same on all (it lives in `settings.json`).
6. **Last used:** quit on the direct entry and relaunch: it opened there. With that daemon down the window showed "connection failed" and Retry, and the switcher still switched.
7. **Secrets in the form:** the edit form shows "Saved" with an empty field (placeholder "Leave empty to keep it"); neither the DOM nor any input contained the password. Clear → "Will be removed" → Save: `hasPassword: false`, and the next connection failed with the generic "connection failed" (no authentication-specific text).
8. **Remove:** removing the current (relay) entry asked in a native confirm; afterwards `lastUsedId` was null, its state file was gone, the pairing link was not in `daemons.json`, and the screen stayed open ("No daemon selected").
9. **Stop while connected:** the native menu's Stop asked ("Agents running on this daemon will stop."), then the window was "Stopped", stayed so for 14 s with no reconnect attempt, and the screen opened. (The same Stop action is the screen's button; the screen path was not separately driven.)
10. **Restart:** `Starting…` then connected again by itself, new daemon pid.
11. **Daemon killed (`kill -9`):** the local state became `stopped` ("This machine · Stopped"); nothing was started during the next 25 s.
12. **Relay:** connected through the relay entry. After `daemon rotate-key` and a restart the SDK reported `daemon_offline` ("The daemon is not connected to the rela…"), **not** `wrong_key`, so the "link no longer valid" marker did not apply here; it stays covered by the unit test of task-005. After Edit → Replace link with the new link, Retry connected and the name and 3-pane layout were kept. **Flag for sprint-111/task-003:** the spec's D23 note should say a rotated key looks like `daemon_offline` through this relay.
13. **Transfer:** a real 1 GiB download from the Files tree (GTK save dialog) was under way; a menu switch showed "1 file transfer is still running. Switch anyway?"; Cancel left the marker, the current entry and the download alone, and the file finished with a matching SHA-256.
14. **Outdated daemon:** connected, one notice: "This daemon is 0.0.100; this app expects 0.0.119 or newer. Update it with `npm i -g @av-pi-studio/cli`, then restart the daemon."
15. **Quit with an agent running** (a fake model server kept a turn streaming): after the app quit, the daemon and the agent's `pi` processes were still running.
16. **Web client:** in a browser, the connection bar is the address field, the password field and Connect; no "Daemons" text and no "Manage daemons".

## Fixes made during the run
- **Layout of the entry left was written onto the entry switched to** (reopens sprint-109/task-003): the page being left sends its layout as it unloads, after the registry had switched. `Request::SwitchEntry` now runs `daemon.switch` and then drops `storage_set` until the next `boot` (`AppShell::awaiting_boot`). Regression test `a_key_the_old_page_sends_while_unloading_is_not_stored_on_the_new_entry` fails without the guard. Live: layouts stay disjoint.
- **Start did not connect** (reopens sprint-110/task-004/005): `lifecycleReactions` has a `connect` reaction for `starting → running` while the status is `idle`; `connectCurrent` runs one resolution at a time so boot, Retry and the reaction cannot double up. Tests added; live: 1.5 s.

## Findings, not fixed
- The tooltip of the switcher pill overlays the first row of the open list while the pointer is on the pill (cosmetic).
- With the CLI missing, the connection-bar error text runs behind the Retry button (cosmetic).
- After removing the current entry, the sidebar kept the old workspace row.
- `pi-studio daemon rotate-key` restarts the daemon and then tried to bind 6767 (the app's local daemon).
- `daemon start` always listens on 6767 (`PI_STUDIO_LISTEN` does not apply).

## Documents
`packages/workbench/README.md` and `AGENTS.md` (host rows no longer "from sprint-110"; the registry invariants), `docs/desktop-client-handoff.md` (milestone 1 state), `desktop/docs/architecture.md` (the drop-until-boot rule). Gates: `cargo xtask ci` (8 steps), `tsc -b`, workbench tests (1,720), root lint with no new warnings.
