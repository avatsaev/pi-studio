# Task 002 — Layered build + cross-package declarations

- **Sprint:** sprint-001-foundation
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Establish the layered build order (`protocol → client → server`, plus highlight/relay/cli) and
cross-package generated `.d.ts` so type errors are diagnosed against built outputs.

## Scope references
- `clean-room-scope/MAIN-SCOPE.md` § 7 (Build/Run/Test/Deploy), § 3 (dependency arrows: protocol depends on no one)

## What to build
- Root build scripts: `build:protocol`, `build:client`, `build:server` (and highlight/relay/cli),
  composed into a `build` script that runs them in dependency order.
- Emit declaration files (`.d.ts`) per package; downstream packages consume built declarations.
- Document the rule: always build owning packages before diagnosing cross-package type errors.

## Out of scope
- Metro/web/desktop builds (handled in app/desktop sprints).

## Acceptance criteria
- [ ] `npm run build` builds packages in order and fails fast on a real type error.
- [ ] `protocol` builds with zero dependencies on other workspace packages.
- [ ] Downstream packages import `protocol` types from its emitted declarations.

## Test / verification plan
- Build: `npm run build:protocol` then `npm run build` succeed.
- Manual: introduce a temporary type error in `protocol`, confirm downstream build fails; revert.

## Notes
- Build layering is a hard rule referenced throughout the scope; keep it scripted, not manual.
