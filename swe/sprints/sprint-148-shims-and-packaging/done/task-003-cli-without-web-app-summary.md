# Task 003 — The CLI package and the single binary stop carrying the web app — Summary

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Removed the `@av-pi-studio/web-client` dependency from `packages/cli/package.json` (one line in `package-lock.json`), the `web/` copy and layout comment in `scripts/build-binary.mjs`, the `ui` block from `scripts/binary-container-check.sh`, `--ui-port`/`--pause` from `scripts/binary-update-check/run.mjs`, `web-client` from the local publish order in `scripts/daemon-update-check/lib.mjs`, and the CLI's AGENTS/README mentions. Deleted stale `packages/cli/dist/web-server.*` and `ui-commands.*` build leftovers. Root `AGENTS.md` dependency graph and the "why cli depends on web-client" paragraph rewritten.

## Build & test results
```
$ npx vitest run packages/cli/src                    -> 295 passed
$ npm pack --dry-run -w @av-pi-studio/cli            -> no SPA files (only the four assets/screenshots/*.webp README images)
$ npm run build:binary -- --target linux-x64 --out-dir /tmp/bin148
   -> pi-studio-0.0.132-linux-x64: 125.8 MiB unpacked (a 0.0.130 build from before this sprint had a web/ folder), 56.0 MiB archive; no web/ in the folder
$ npm run test:binary -- /tmp/bin148/pi-studio-0.0.132-linux-x64
   -> ok: --version, daemon start, /api/health, SDK connection, mock agent turn, terminal echo, 1 MiB upload/download, __pi --version 1.4.0, daemon stop (binary smoke test passed)
$ Wave gate (full tree, once, after tasks 001-003): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 323 files, 4648 tests all passed; `oxfmt --check` on changed files clean; `node --test scripts/release/*-test.mjs scripts/build-binary.test.mjs scripts/binary-smoke.test.mjs` 22 passed.
```

## Acceptance criteria
- [x] `npm pack --dry-run -w @av-pi-studio/cli` lists no SPA files
- [x] `npm run build:binary` then `npm run test:binary` pass on Linux, and the binary has no `web/` (linux-x64 only)

## Follow-ups / TODO(verify)
- `--pause` of the live binary update check is gone with the UI; nothing replaces it.
- The size of the previous binary was not measured side by side (the earlier 0.0.130 folder was stale).
- Publishing `web-client`, `workbench` and `ui-library` is task-004.
