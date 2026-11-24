# Task 004 — Live check of the binary with a real Pi — Summary

- **Sprint:** sprint-140-binary-build
- **Completed:** 2026-11-24
- **Status:** done

## What was run
In Node-less containers (`debian:bookworm-slim`; older images for glibc), from a freshly built linux-x64 binary, with a throwaway Pi home holding one credential entry (github-copilot, `claude-haiku-5.5`; the anthropic OAuth token had expired and refreshing it could rotate the owner's refresh token). Credentials, containers and scratch dirs deleted. Full commands and outcomes: `packages/server/docs/binary-live-results.md` (Answered/Open per spec question).

| # | Item | Outcome |
|---|---|---|
| 1 | Real turn: shell tool + todo tool | Pass. Boot sync installed rpiv-todo, pi-web-access, rpiv-ask-user-question in ~2.5 s with no npm; shell call and three `todo` calls ran; list read back over the SDK. Same turn passes on glibc 2.17. |
| 2 | `pi install` with no npm | Pass (daemon skills install and `__pi install`); `settings.json` gained only the installed entry, no `npmCommand`; a seeded realistic file kept every other key. |
| 3 | `pi-background-tasks` pre-installed | Pass: agent starts, no `bg-*` commands, others load; the baseline never installs it. |
| 4 | A package that fails to load (P16) | Defect, fixed (below). |
| 5 | `skills` list/add/remove; OAuth to its first prompt | Pass, with one fix. A remote repo needs `git` on the machine. A full login was not completed (per brief). |
| 6 | Oldest glibc | 2.17 (CentOS 7) works incl. a real turn; 2.12 fails `GLIBC_2.14 not found`; Alpine fails (glibc only). |

## Defects fixed
- **P16:** a Pi that exits at start-up left the agent `running` forever (`agent run` timed out at 30 s, the error reached only the daemon log); same on a Node daemon. `rpc-transport.ts`/`agent.ts`: an unexpected non-zero exit fails the transport and `run()` ends the turn with an `error` row carrying Pi's stderr. After: answer in ~0.55 s, agent `error` naming the extension, `agent reload` after removing the package recovers. Tests in `transport-errors.test.ts`, `pi-adapter.test.ts`.
- **OAuth in the CLI binary:** `auth login … --type oauth` failed `Cannot find module './anthropic.js'` (only the daemon ran Pi's Bun runtime setup). New `preparePiRuntime()` in `binary-runtime.ts`, passed as `CliContext.prepareAuth`, runs once before Pi loads (~8 ms). Tests `auth-runtime.test.ts`, `binary-runtime.test.ts`.

## Results
Related vitest 59 files / 862 tests; wave gate: build, typecheck, lint 0 errors, 329 files / 4695 tests; smoke test and `binary-container-check.sh` pass on the rebuilt binary.

## Acceptance
- [x] Every item recorded with commands and outcomes. [x] Defects fixed with tests.

## For the owner
1. `git` is a prerequisite for `skills add owner/repo` and `pi install git:…` (same on npm): recommend documenting it. 2. State glibc 2.17 in install docs and re-check on every Bun bump (the release smoke test would not notice a rise). 3. Left alone: `__skills --version` prints `0.0.0` in the binary; `provider models`, `agent wait`, `agent inspect` fail `no handler`, `provider ls` empty (the Node CLI does the same against this daemon). 4. Whether the server suite should run under Bun: partly tried, mostly fails (vitest interop), not required.
Not tried: full OAuth login, real Mac, arm64, a CPU without AVX2.
