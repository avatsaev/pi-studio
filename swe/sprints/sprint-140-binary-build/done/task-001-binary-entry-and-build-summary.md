# Task 001 — The binary's entry, sub-commands and `npm run build:binary` — Summary

- **Sprint:** sprint-140-binary-build
- **Completed:** 2026-11-24
- **Status:** done

## What was built
- `packages/cli/src/binary-main.ts` + `binary-dispatch.ts` (pure parsing, tested against what `daemonCommand`/`relayCommand` emit): `__daemon`, `__relay`, `__pi`, `__skills`, `__update-helper` (stub: prints "not implemented in this version", exit 1, until sprint-142/task-004), otherwise the CLI.
- `packages/server/src/daemon/binary-runtime.ts`: `prepareBinaryDaemon()` imports Pi's `dist/bun/runtime-setup.js` then `applyPiOverrides` (no-op on Node); `runBundledPiCli()`, `runBundledSkillsCli()`. Pi's files are imported by relative path (its `exports` map hides `dist/bun/`).
- `install-kind.ts`: `binary` when `isBinary` (after the env override, no npm query); `updateBlocker("binary")` = `unmanaged_binary`.
- `scripts/build-binary.mjs` (+ `build-binary.test.mjs`, `node --test`): `npm run build:binary -- --target <t>` for the four targets, `--external node-pty`, Pi's two workers as entries, assets, the `bun` script, `web/`, tar.gz; `codesign -s -` only on a macOS host.
- `scripts/binary-container-check.sh`: Node-less container check.
- Root `package.json` (`build:binary`), `.gitignore` (`dist-binary/`), `packages/cli/tsconfig.json` (reference to relay); AGENTS/README of cli and server.

## Results (linux-x64)
- Sizes: unpacked 151.2 MiB (executable 120 MB, `web/` 28 MB); tar.gz 64.8 MiB. Cross-compiled but never run: darwin-arm64 132.2 MiB / 54.5 MiB, linux-arm64 151.2 MiB / 64.6 MiB.
- `scripts/binary-container-check.sh` in `debian:bookworm-slim` (no Node, no npm): `--version`, `--json daemon start/status/stop` (health 200), `__pi --version`, `__skills --help`, `ui` serving the SPA (200), `relay start/stop`, and after moving the folder `--version`, a daemon cycle and `__pi` still work. ALL CHECKS PASSED.
- Extra: a daemon left running ~12 s installed its three recommended extensions through the `bun` script with no npm; `settings.json` gained only three entries, no `npmCommand`.
- Narrow gates: vitest cli/update/daemon/runtime 931 tests; `node --test scripts/build-binary.test.mjs` 5 pass. Wave gate: see sprint report (build, typecheck, lint 0 errors, 323 files / 4589 tests).

## Acceptance
- [x] Linux x64 commands from the unpacked folder with no Node. [x] Folder moved still works. [x] Node gates green.

## Follow-ups
- darwin/arm64 binaries are not run here; the darwin build is unsigned and must not ship (sprint-141 signs ad hoc on a macOS runner).
- `daemon stop` returned `still_running` once in a container, not reproduced in ~6 more cycles (possibly PID 1 zombie reaping).
- `build-binary.test.mjs` is not in root vitest; run with `node --test`.
