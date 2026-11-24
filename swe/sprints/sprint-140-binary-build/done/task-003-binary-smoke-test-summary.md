# Task 003 — The binary smoke test — Summary

- **Sprint:** sprint-140-binary-build
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`scripts/binary-smoke.mjs` (+ `binary-smoke.test.mjs`, 5 node tests) and root script `test:binary`. With a temporary `HOME`/`PI_STUDIO_HOME`, a free port (`-H 127.0.0.1:<port>`) and every `PI_*` variable stripped: `--version`, `--json daemon start`, `/api/health`, SDK connection, a mock agent turn (`provider: "mock"`), terminal echo, a 1 MiB upload and download with equal sha256, `__pi --version`, `--json daemon stop` and the process gone. One line per step; first failure stops; a `finally` stops then kills a leftover daemon. Needs `npm run build` first (imports `packages/client/dist`).
Differences from the task text: the mock provider is a built-in id, so `config.json` only sets `daemon.update.autoCheck: false`; the port comes from `-H` because `daemon start` has no listen option.

## Results
Real linux-x64 build: all steps ok in about 1.7 s (0.0.130, Pi 1.4.0). Empty folder: `FAIL --version: no executable at …`, exit 1, daemon gone. Stub whose daemon fails: `FAIL --json daemon start: … exited 1: boom`. No stray processes; your daemon on 6767 untouched.

## Acceptance
- [x] Passes on linux-x64; fails clearly on a broken folder.
