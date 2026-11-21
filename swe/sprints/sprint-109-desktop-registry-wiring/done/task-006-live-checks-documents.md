# Task 006 — Live checks of the wiring (Linux webview) and documents

- **Sprint:** sprint-109-desktop-registry-wiring
- **Status:** done
- **Type:** test
- **Area:** desktop (app in the WebDriver container), desktop/docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004, task-005

## Goal
The registry, the local daemon supervisor, the switch and the native menu are observed working in the real app before any workbench screen is built on them, and the desktop documents describe them.

## Context / why
The workbench does not read `host.daemons` yet, so the window still shows the old connection bar. That is the right moment to check the layer underneath on its own: through the control socket, the native menu, and host calls made from the page.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 2, 5, 7, § Switching, § Acceptance criteria (0600 and no secret; every command from the control socket and the CLI)
- `desktop/docs/development.md` (WebDriver container, control socket), `desktop/docs/control-protocol.md`, `desktop/docs/architecture.md` § The webview boundary
- `packages/cli` built from this repository (`npm run build:cli`), for the real CLI

## What to build
No product code unless a check fails. In the container, with `--config-dir <tmp>`:

1. **Real CLI, scratch home.** `cliPath` set to the repository's built CLI, `PI_STUDIO_HOME` and `PI_STUDIO_LISTEN` (a free port) in the environment. Launch: `daemon.list` over the control socket reaches `stopped`. `daemon.local.start`: it reaches `running` with that port, and `pi-studio --json daemon status` agrees. `daemon.local.stop`: `stopped`, and the daemon process is gone.
2. **Adoption.** Start the daemon with the CLI in a shell, then launch the app: `running`, and no second daemon process.
3. **Failures**, with the fake CLI of sprint-108/task-004: `not_healthy`, garbage output, and a sleep past a shortened limit each give `failed` with the right reason; version 0.0.118 gives `cli_outdated`.
4. **No CLI.** `cliPath` pointing at a missing file: `cli_missing` naming the path.
5. **Registry.** Add a direct entry with a password and a relay entry; `daemons.json` is 0600 and holds them; `ui.inspect` shows the views.
6. **Menu.** An X-display screenshot of the open "Daemons" menu: three entries, the current one checked, the local actions enabled as its state says. Click another entry: the page reloads (a marker set on `window` before the click is gone) and `lastUsedId` changed.
7. **Per-entry layout.** Store a distinct layout key on each of two entries through the page's host storage, switching between them: each `boot` returns its own entry's value.
8. **Transfers.** With the transfer count set to 1 from the page, a menu switch shows the confirm; "no" leaves everything as it was.
9. **Secrets.** Search the app's whole log output and every control answer captured in this run for the password and the pairing link: no hit.
10. **Quit.** With the local daemon running and started by the app, quit the app: the daemon process is still running.

Then the documents: `control-protocol.md` (the `daemon.*` commands, `ui.inspect`'s new field, with outputs that were actually run), the webview boundary section (the four page commands and two events added in this sprint), `development.md` (the files in the configuration directory, how to point the app at a scratch CLI and home).

## Out of scope
- The workbench's switcher and Daemons screen (sprint-110/task-007).
- macOS and Windows (sprint-111).

## Acceptance criteria
- [ ] Checks 1–10 pass, each with its evidence in the summary.
- [ ] The measured time of a first `daemon.local.start` with the real CLI is recorded (spec TODO: the 90 s limit).
- [ ] The documents listed match the code, and every command line shown in them was run.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- WebDriver session plus X-display screenshots and keyboard or pointer input in the `pi-desktop-xvfb` container.
- `stat -c %a`, `ps`, `rg` over the captured logs.
- `cargo xtask ci` in `desktop/`.

## Notes
- Run in the orchestrator: ports, the shared container, a daemon.
- The daemon started in check 1 uses a scratch `PI_STUDIO_HOME`; stop it and remove the directory afterwards. Never point these checks at the developer's real `~/.pi-studio`.
