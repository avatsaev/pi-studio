# Task 001 — Linux acceptance run for the registry, and the platform checklist extended

- **Sprint:** sprint-111-desktop-daemon-registry-close
- **Status:** done
- **Type:** test
- **Area:** desktop (app in the WebDriver container), desktop/docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-110/task-007, sprint-106/task-001

## Goal
Every acceptance criterion of the registry spec has a recorded result on Linux, the three native-host criteria that needed a registry are closed, and the platform checklist covers the registry on macOS and Windows.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Acceptance criteria (all), § TODO(verify) (all)
- `swe/features/desktop-native-host.md` § Acceptance criteria (the three marked "needs the registry": separate layouts for entries A and B with a shared theme; a corrupt `daemons.json`; `ui.inspect` returning the registry view)
- `desktop/docs/platform-checks.md` (sprint-106/task-001)
- The summaries of sprint-109/task-006 and sprint-110/task-007

## What to build
- **Linux pass.** Go through the registry spec's acceptance list on the final build. Cite an earlier summary where nothing changed since; re-run what later work could have broken. Run the checks no earlier task made:
  - a corrupt `daemons.json` at launch: the app opens on a registry with only the local entry, the file is kept as `daemons.json.corrupt-*`, one notice is shown;
  - the CLI found without a terminal's `PATH`: launch the app with a minimal environment (`env -i` with only what the display needs) while the CLI is installed where only the shell's start-up files put it on `PATH`; the local state must not be `cli_missing`;
  - the same with `SHELL` pointing at `zsh`, and at `fish` if it can be installed in the check image: record each result.
- **`desktop/docs/platform-checks.md`** gains a registry section for macOS and Windows, each item with steps and the expected result:
  - first launch with the CLI installed through a Node version manager, the app started from the dock or the launcher (not a terminal): the local daemon starts and the workbench connects;
  - no CLI: the Daemons screen explains and shows the install command;
  - the native "Daemons" menu lists the entries and switches; on macOS the Edit menu's copy, paste and select-all still work;
  - `daemons.json`: its location, and on macOS mode 0600;
  - quitting leaves the daemon running;
  - a switch during a transfer asks first;
  - Windows: the local entry shows the explanation and no Start; a `direct` entry to a daemon in WSL2 on `127.0.0.1` connects (spec TODO).

## Out of scope
- Running the checklist on macOS or Windows (task-002).

## Acceptance criteria
- [ ] Each acceptance criterion of the registry spec has "pass", "fail" or "not applicable on Linux" with evidence in the summary.
- [ ] The three native-host criteria that needed the registry have a recorded result.
- [ ] The no-terminal check has a result for `bash`, and for `zsh` and `fish` where they could be installed; a shell that fails is named, with what the app did (fallback, `cli_missing`).
- [ ] The checklist's registry section exists and each item names its expected result.
- [ ] Any failure is reported with a proposed fix; the task is not marked done over a failing criterion.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- The WebDriver container; `env -i` launches; `stat`, `ps`.
- `cargo xtask ci` in `desktop/`.

## Notes
- Run in the orchestrator.
- Depends on sprint-106/task-001 because it created the file this task extends.
