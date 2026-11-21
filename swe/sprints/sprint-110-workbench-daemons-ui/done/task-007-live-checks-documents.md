# Task 007 — Live checks of the switcher and the Daemons screen (Linux webview), and documents

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** done
- **Type:** test
- **Area:** desktop (app in the WebDriver container), packages/web-client (browser), documents
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-005, task-006, sprint-109/task-006

## Goal
Every surface of this sprint is seen and driven in the real desktop webview with real daemons, the web client is confirmed unchanged, and the workbench documents describe the registry surfaces.

## Context / why
The Daemons screen and the switcher cannot be opened in a browser (the web client has no registry), so until now they were verified only through pure modules. This is their first run as a person would use them.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Acceptance criteria (all but the macOS and Windows ones), § Error handling, § TODO(verify) (the 90 s limit, the shell environment)
- `desktop/docs/development.md` (WebDriver container; the scratch CLI and home of sprint-109/task-006)
- `packages/cli` (`pi-studio relay start`, `daemon pair`, `daemon rotate-key`), `docker/README.md` (a relay locally)
- `packages/workbench/README.md` § The host, `packages/workbench/AGENTS.md`, `docs/desktop-client-handoff.md`

## What to build
No product code unless a check fails. Set-up: the repository's built CLI with a scratch `PI_STUDIO_HOME` as the local daemon; a second daemon on another port with a password, for a direct entry; a local relay with a third daemon paired to it, for a relay entry. Take a screenshot at each step.

1. **First launch, nothing typed.** Empty configuration directory, the CLI reachable, no daemon running: the window appears, the switcher reads "Starting…", then the workbench is connected to the local daemon. Record how long the start took.
2. **Adoption.** With the daemon started from a shell first: connected, and no second daemon process.
3. **No CLI.** `cliPath` at a missing file: the Daemons screen opens by itself with the reason and the install command; Retry after fixing the path connects.
4. **Auto-start off.** The screen opens with the local entry showing Start and no error styling; Start connects.
5. **Add and switch.** Add the direct entry (wrong address form refused in the form; duplicate name in another case refused with the message), open it: the page reloads and connects. Arrange a different pane layout on each of the three entries; switching back and forth, from the switcher and from the native menu, restores each one's layout, and the theme is the same on all.
6. **Last used.** Quit on the direct entry and launch: it opens there. Stop that daemon and launch: the window shows the reconnecting state and the switcher still switches.
7. **Secrets in the form.** Edit the direct entry: the password field is empty with the "saved" marker; the page's DOM does not contain the password. Clear removes it, and the next connection fails with the workbench's authentication error.
8. **Remove.** Remove the current entry: confirm, disconnect, the screen stays open; its state file and its secret are gone from the configuration directory.
9. **Stop while connected.** Stop from the screen: confirm, then disconnected with no reconnect attempts and the screen open. The same from the native menu.
10. **Restart while connected.** The connection comes back by itself.
11. **The daemon dies.** Kill the local daemon's process: the workbench reconnects as usual, the local state becomes `stopped`, and the app starts nothing.
12. **Relay link.** Connect through the relay entry. Rotate the daemon's key and reconnect: record which reason the SDK reports. If `wrong_key`: the entry is marked, and after "Replace link" with a new link it connects with its name and layout kept. If `daemon_offline`: the SDK's message is shown; record that the marker did not apply.
13. **Transfer.** During a large download, choose another entry: the native confirm; "no" leaves the transfer running to completion.
14. **Outdated daemon.** Against a daemon that reports an older version (an older published CLI in a scratch prefix, or the dev daemon with its version overridden): connected, one notice naming both versions.
15. **Quit.** With an agent running on the local daemon, quit the app: the daemon and the agent's process are still there.
16. **Web client.** In a browser: the connection bar is unchanged (address, password, Connect) and no Daemons screen exists.

Then the documents: the workbench README and AGENTS host tables (drop "consumed from sprint-110"), an invariant paragraph for the registry surfaces in `packages/workbench/AGENTS.md`, the handoff document's milestone 1 state.

## Out of scope
- macOS and Windows (sprint-111). A CLI installed through a Node version manager with the app started outside a terminal: on this machine every launch is from a shell, so that criterion is checked as far as possible (an environment without the manager's `PATH`) and completed in sprint-111.

## Acceptance criteria
- [ ] Checks 1–11 and 13–16 pass, each with its evidence in the summary.
- [ ] Check 12 has a recorded result with the reason observed; if the marker path could not be reached, the summary says how it was otherwise covered (the unit test of task-005) and the spec's D23 note is flagged for sprint-111/task-003.
- [ ] The start durations of checks 1 are recorded against the 90 s limit.
- [ ] No screenshot, log line or control answer captured in this run contains a password or a pairing link.
- [ ] The documents listed match the code.
- [ ] The start duration of check 1 is recorded against the 90 s limit.

## Test / verification plan
- WebDriver session, X-display screenshots and input in the `pi-desktop-xvfb` container; `ps`, `stat`, `rg` on the host side.
- A browser for check 16.
- The gates named above.

## Notes
- Run in the orchestrator. Every daemon in this task uses a scratch home and a free port; stop them and remove the directories afterwards.
- A failed check is fixed in the task that owns the code (reopen it in the summary), not patched around here.
