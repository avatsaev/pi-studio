# Task 004 — The binary update path — Summary

- **Sprint:** sprint-142-binary-self-update
- **Completed:** 2026-11-24
- **Status:** done

## What was built
Server (`packages/server/src/update/`): `binary-layout.ts`, `binary-manifest.ts`, `tar-extract.ts` (refuses `..`, absolute names, escaping symlinks incl. through earlier links, devices, writes through links), `binary-install.ts`, `binary-update.ts`, `binary-helper.ts`; `install-kind.ts` `binaryBlocker` (`unmanaged_binary` unless `realpath(execPath)` is `$PI_STUDIO_HOME/bin/versions/<x.y.z>/pi-studio`; `not_writable`; Windows `unsupported_platform`); `update-service.ts` takes an optional `binary` probe object (manifest 15 s: `bad_answer`, `offline`; no asset = `cannot_update(unsupported_platform)`; commands = releases page; shared skip logic); `helper.ts` `spawnUpdateHelper` takes a `runtime`; `daemon/bootstrap.ts` picks the pipeline by `isBinary`.
Apply: re-read the manifest, download to `bin/tmp` (60 s stall, size cap), SHA-256, unpack, `<new>/pi-studio --version`, move to `bin/versions/<v>`, new binary's `__pi update --extensions`, restart via `<new> __update-helper <json>`; any failure leaves `current` untouched. `__update-helper` (`runBinaryHelper`): waits ≤30 s for the old pid, switches `current` (symlink `current.new` then rename), three start+health tries, on failure switches back and starts the previous, writes `update-result.json` like the npm helper (skip rule applies), logs to `logs/update-restart.log`, after `updated` removes other versions. CLI `update` / `update --check` on a binary. `PI_STUDIO_DAEMON_UPDATE_URL` overrides the manifest URL (tests, self-hosting). Fixtures `test-support/{tar,http}-fixture.ts`.

## Results
`npx vitest run packages/server/src/update packages/cli` (+ client) 767 pass; wave gate 328 files / 4686 tests, typecheck, lint 0 errors. Not run live (task 005).

## Acceptance
- [x] Rule, check (newer, same, malformed, missing asset, offline), apply failures (checksum, `..`, symlink, bad `--version`, not runnable, no binary, size, 503, stall, moved manifest), helper switch and switch-back. [x] Node suite green.

## Slip and follow-ups
- The agent appended tests to `update-commands.test.ts` with a bash heredoc (against the rules); content passed the gate and is oxfmt-clean.
- The CLI's own `pi update --extensions` step still runs through the old binary's Pi.
