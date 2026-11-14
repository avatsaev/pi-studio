# Summary — sprint-088 task-005 rename-alias

## What was built
web-client's internal alias `@pi-studio-ui/*` is now `@web-client/*` in one cut (no shim): `vite.config.ts` alias, `tsconfig.json` `paths`, root `vitest.config.ts`, and 452 import specifiers in 151 files, rewritten with `ast_edit` (one exact-string-literal op per distinct specifier, 91 ops, so comments/prose could not be touched by accident). `docs/MOLVIEWER_DECOUPLING.md` alias mentions updated (its barrel example now re-exports the primitives from `@av-pi-studio/ui-library`).

## Commands run
- `grep -rn "pi-studio-ui"` over the repo excluding `node_modules`, `dist`, `.git`, `swe/` → no hits
- `npx tsc -b` + web-client `tsc -b` clean; `npx vitest run` 257 files / 3522 tests passed; `npx oxlint` warnings only (pre-existing); `npm run fmt:check` clean; `npm run build` ok (web-client `dist/web` 26529752 B)

## Acceptance criteria
- [x] Zero `@pi-studio-ui` references outside historical `swe/` docs. [x] build/typecheck/tests green.

## Follow-ups
- `web-client/AGENTS.md`/`README.md` still describe the old layout and alias — s090/task-005 (docs) owns the full pass.
