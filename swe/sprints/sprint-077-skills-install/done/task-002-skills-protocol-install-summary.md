# Task 002 — Protocol: `detectSkillSource`, `skills_preview`, `skills_install` — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

- Added `packages/protocol/src/source-detect.ts`: a pure, zero-dependency `detectSkillSource(input)`
  classifier returning `{ kind, normalized } | null`. `kind` is one of `pi_npm | pi_git |
  skills_repo | local_path` (`SkillSourceKind`), matching every row of
  `swe/architecture/pi-resource-management.md` § Source kinds:
  - `npm:<name>[@<version>]` → `pi_npm`
  - `git:<url>[@<ref>]` → `pi_git`
  - `owner/repo`, `owner/repo@skill`, GitHub/GitLab URLs (incl. `/tree/<ref>/<path>`),
    `git@host:owner/repo[.git]`, `ssh://…`, any scheme'd `*.git` URL → `skills_repo`
  - Absolute or `~`-prefixed path → `local_path` (syntactic only — no filesystem access; existence
    is checked server-side per the architecture doc)
  - Relative paths, bare words, non-git `http(s)` file URLs, empty/whitespace-only input → `null`
  - `normalized` is the whitespace-trimmed input, unchanged otherwise — further parsing (subpath
    extraction, `~` expansion) is left to each consumer, consistent with "pure classifier" from
    the component table.
  - Exported from `packages/protocol/src/index.ts`.
- Added `previewSkillSchema`/`PreviewSkill` (`{name, description?, relPath, warnings?, valid,
  exists}`) and the `skills_preview_request`/`skills_preview_response` and
  `skills_install_request`/`skills_install_response` Zod schemas to `packages/protocol/src/messages.ts`,
  reusing `itemResultSchema`/`skillInfoSchema`/`piPackageInfoSchema` from sprint-075/076. All four
  follow the established `skills_*` idiom: `.passthrough()`, domain `ok`/`error`/`message` fields
  (never `rpc_error`), flat snake_case `type`.
  - `skills_preview_request`: `{source}`.
  - `skills_preview_response`: `{ok, error?, message?, kind, source, skills: PreviewSkill[]}` —
    `kind`/`source` present even on a domain failure.
  - `skills_install_request`: `{source, skills?: string[], replace?: boolean}`.
  - `skills_install_response`: `{ok, error?, message?, results: ItemResult[], skills, packages}`.
  - Registered all four as real `sessionMessageSchema` discriminated-union members (after the
    sprint-076 `skills_update_all_*` entries).
- `packages/protocol/AGENTS.md`: added `source-detect.ts`/`source-detect.test.ts` to the source
  layout tree, a dedicated `### source-detect.ts` export section, and four new rows in the
  `messages.ts` key-exports table (`previewSkillSchema`, `skillsPreviewRequestSchema`/
  `ResponseSchema`, `skillsInstallRequestSchema`/`ResponseSchema`); updated the `itemResultSchema`
  row to note it's also used by `skills_install_response`.

## Files changed

| File | Change |
|------|--------|
| `packages/protocol/src/source-detect.ts` | New — `detectSkillSource`, `SkillSourceKind`, `DetectedSkillSource` |
| `packages/protocol/src/source-detect.test.ts` | New — table test, every source-kind row + rejects |
| `packages/protocol/src/index.ts` | Export `./source-detect.js` |
| `packages/protocol/src/messages.ts` | `previewSkillSchema`, `skills_preview_*`, `skills_install_*` schemas + union registration |
| `packages/protocol/src/session-messages.test.ts` | New `describe("skills preview / install (sprint-077/task-002)")` block + imports |
| `packages/protocol/AGENTS.md` | Source layout tree, new `source-detect.ts` section, key-exports table rows |

## Build & test results

```
$ npx vitest run packages/protocol
 Test Files  11 passed (11)
      Tests  175 passed (175)
   Duration  285ms

$ npm run build:protocol
> tsc -b packages/protocol
(no output — clean)
```

`npx oxlint` and `npx oxfmt` on every changed/new file: clean, no findings.

## Acceptance criteria checked

- [x] Table test: every source-kind row (accept and reject) classified as the spec says —
      `source-detect.test.ts` has 34 cases: one (or more) per accepted row (`npm:` with/without
      version and scoped name, `git:` with/without ref, `owner/repo`, `owner/repo@skill`,
      GitHub/GitLab URLs incl. `/tree/<ref>/<path>`, `git@host:…` with/without `.git`, `ssh://…`,
      generic `*.git`, absolute path, trailing-slash path, `~`, `~/…`, whitespace-trimming) plus
      rejects (empty, whitespace-only, `./`/`../`-relative, deeper relative, bare words, non-git
      `http(s)` file URLs).
- [x] Schemas parse the spec's shapes — `session-messages.test.ts` covers `previewSkillSchema`
      (full + required-only row), `skills_preview_request`/`_response` (package-kind empty-skills
      shape, `skills_repo` shape, and a domain-failure shape still carrying `kind`/`source`),
      `skills_install_request`/`_response` (source-only, source+skills+replace, mixed ok/failed
      `results`), round-trips through `sessionMessageSchema`, and passthrough-preserves unknown
      fields on every new schema.

## Follow-ups

None — out of scope per the task file (server/client behavior lands in sprint-077 tasks 003–007).
