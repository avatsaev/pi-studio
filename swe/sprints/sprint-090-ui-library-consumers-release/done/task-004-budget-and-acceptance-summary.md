# Summary — sprint-090 task-004 budget-and-acceptance

## Results (clean `npm run clean && npm run build`)
- AC8: web-client `dist/web` 26530220 B vs baseline 26532061 B (−0.007%, ±2% budget); hash-stripped asset names identical to the 457-entry baseline. Recorded in `swe/notes/ui-library-baseline.md`.
- AC1: `npm run build` (incl. ui-library Vite build and ui-gallery), `npx tsc -b` + web-client `tsc -b` clean; `npx vitest run` 259 files / 3534 tests passed; `npx oxlint` only pre-existing warnings; `oxfmt --check` clean on all changed files.
- AC2: no primitive/ui/theme(except `fonts.css`)/brand(except `build-brand`)/platform/provider-kv/toast-announcer store files under `packages/web-client/src`; `@pi-studio-ui` appears only in historical `swe/` documents (sprint files, grill brief, PLAN, and `swe/architecture/viewer-plugin-system.md`, a spec whose alias mentions were not rewritten).
## Not covered here
- D34 visual parity of web-client — engineer sign-off before merge.
