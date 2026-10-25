# Task 008 — Sprint close: live E2E, docs, full gates — Summary

- **Sprint:** sprints/sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done
Live E2E of Remove / Remove package / Update all against a production daemon (`daemon/main.js`), real bundled `pi`, real `skills@1.7.4` CLI and real network (`vercel-labs/agent-skills`, npm `is-odd`), in a throwaway `HOME` + `PI_CODING_AGENT_DIR` + `PI_STUDIO_HOME` under `/tmp/s076` (deleted afterwards; real `~/.pi`/`~/.agents` never touched). Driven through two `PiStudioClient`s plus Chromium on `pi-studio ui`. **The E2E found three real bugs that unit tests with a fake spawn could not; all fixed with regression tests.**

## Bugs found live and fixed
1. **`skills add` argv order** (task-002's `skillsArgv`): `-s` is variadic and swallowed the trailing source → CLI answered "Missing required argument: source". Source now precedes the flags; test, docs and spec amended. (Consumer is sprint 077's install; fixed now so it does not ship broken.)
2. **`pi remove <relative local path>` failed** ("No matching package"): Pi resolves a local-path source against its cwd while settings entries are relative to agentDir. `InstallSpawn` gained an optional `cwd` (additive); package removal spawns with `cwd = agentDir`. Regression assertion added.
3. **Credentials leaked on the wire** (sprint-075 gap vs the spec's D29 "every wire source"): `list` returned `git:https://user:tok@…?access_token=sekret` verbatim in `PiPackageInfo.source`/`identity` (logs were already redacted). `wire.ts` now redacts source/identity/packageSource/provenance; `remove({packageSource})` matches on the redacted form and spawns with the real settings entry. Regression test asserts no `sekret`/`user:tok` anywhere in the list response and that remove-by-redacted-source works.

## Files changed (this task)
`AGENTS.md` (Node/`skills` tech-stack row, `skills_*` bullet), `packages/server/AGENTS.md`, `swe/architecture/pi-resource-management.md`, `packages/server/src/resources/{skills-cli.ts,skills-cli.test.ts,spawn-runner.ts,wire.ts,resource-service.ts,resource-service.test.ts}`, `packages/server/src/extensions/sync-executor.ts`.

## E2E results
1. **Symlinked skill** — PASS: link gone, target dir + `SKILL.md` intact.
2. **Lock-tracked skill** (`skills add` of a local git repo, then Remove) — PASS: `~/.agents/skills/demo-a` gone, lock entry gone, spawned without `-a`.
3. **Settings-path skill** — PASS: entry dropped from `settings.skills`, files kept. **Plain dir** — PASS: deleted.
4. **Remove package** — PASS (after fix 2): `settings.packages` emptied, package skills gone from the list. Unknown package → `not_found`.
5. **Update all** — PASS: outdated GitHub skill (lock hash tampered + stale marker file) was reinstalled (marker gone, hash restored); an outdated *unpinned* npm package (`is-odd` 2.0.0) moved to 3.0.1 while the pinned `is-number@6.0.0` stayed untouched; both engine rows reported Succeeded in the UI. A **local-path** skill cannot be checked by `skills update` ("Local path — cannot be checked automatically", exit 0) — expected, reported as success.
6. **FIFO** — PASS: Update all from window A, Remove from window B 100 ms later: completion order `updateAll` then `remove`; window B received `mutation` broadcasts for both. Caveat: update-all took ~1 s here, so the UI's "Queued…" state (documented simplification: shows "Working…") was not visually exercised.
7. **Redaction** — PASS (after fix 3): poisoned `packages` entry `git:https://user:tok@127.0.0.1:1/r.git?access_token=sekret` → wire shows `…?access_token=***` with userinfo stripped; daemon log contains no `sekret`/`user:tok` (grep count 0); remove by the redacted string works.
- UI: Remove (trash) icon per removable row, toolbar Update all, confirm dialogs, result chips with Dismiss — screenshot-verified.

## Build & test results
```
npm run build      → exit 0
npm run typecheck  → exit 0
npm run lint       → no diagnostics in touched files
oxfmt --check <touched dirs> → only 3 untouched pre-existing client files flagged
npm test           → 223 files, 2963 tests passed, 0 failed
```

## Acceptance criteria
- [x] Every step recorded with observed results (above)
- [x] Full gates green

## Follow-ups
- A package with zero skills has no header in the panel, so it cannot be removed from the UI (only via SDK/CLI); revisit with the install dialog (077), which will create such rows.
- "Queued…" vs "Working…" remains the documented simplification.
- Release hold unchanged: do not publish between 076 and 077.
