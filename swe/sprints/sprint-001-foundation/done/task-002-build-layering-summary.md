# Task 002 — Layered build + cross-package declarations — Summary

- **Sprint:** sprint-001-foundation
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Established the layered build using TypeScript project references and `tsc -b`. Each buildable
package emits `.d.ts` declarations into its `dist/`, and downstream packages consume those emitted
declarations via `references`. Root scripts `build:protocol`, `build:highlight`, `build:relay`,
`build:client`, `build:server`, `build:cli` are composed into `build`, which runs them in
dependency order and fails fast. The "build owning packages before diagnosing cross-package type
errors" rule is documented in `docs/build-layering.md`.

## Files created / changed
| File | Change |
|------|--------|
| `package.json` | modified — added `build:*`, `build`, `clean` scripts |
| `docs/build-layering.md` | created — documents order + the hard rule |
| `packages/*/tsconfig.json` | (from task-001) project references already wired: client→protocol, server→protocol+highlight, cli→protocol+client |

## How it satisfies the scope
- **MAIN-SCOPE §7 (Build):** layered `build:protocol → build:client → build:server` (plus
  highlight/relay/cli) composed into one `build` that runs in dependency order; scripted, not
  manual.
- **MAIN-SCOPE §3 (dependency arrows):** `protocol` builds with zero workspace dependencies
  (verified: no `@av-pi-studio/*` entries in its `package.json`). Downstream packages import
  `protocol` types from its emitted `dist/index.d.ts`.

## Build & test results
```
$ npm run build:protocol
tsc -b packages/protocol → exit 0; emits dist/index.{js,d.ts,*.map}

$ npm run build
build:protocol → highlight → relay → client → server → cli  (exit 0)
All six packages emit dist/index.d.ts.

# Fail-fast proof: temporarily added `export const BAD_NUMBER: number = "..."` to protocol
$ npm run build
packages/protocol/src/index.ts(8,14): error TS2322: Type 'string' is not assignable to type 'number'.
BUILD_EXIT:1   # chain stopped at build:protocol; downstream never ran
# (reverted; clean rebuild → exit 0)

$ npx oxlint        → exit 0
$ npx oxfmt --check → exit 0
```

## Acceptance criteria
- [x] `npm run build` builds packages in order and fails fast on a real type error (verified with a
      temporary TS2322 in protocol; chain halted at `build:protocol`).
- [x] `protocol` builds with zero dependencies on other workspace packages (verified via its
      `package.json`).
- [x] Downstream packages import `protocol` types from its emitted declarations (client/server/cli
      reference protocol and build against `dist/*.d.ts`; all emit their own `dist/index.d.ts`).

## Follow-ups / TODO(verify)
- Metro/web/desktop builds remain out of scope (handled in app/desktop sprints); `app` and
  `desktop` use `noEmit` typecheck configs and are excluded from the `tsc -b` graph.
