# Task 003 — Stateless preview: shallow clone or local folder → Pi skill loader — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Implemented `ResourceService.preview(source)` (`packages/server/src/resources/resource-service.ts`)
and wired `skills_preview_request`/`skills_preview_response` through `skills-rpc.ts` and
`daemon/bootstrap.ts`. The daemon's own `detectSkillSource` (protocol, task-002) is authoritative —
a client-sent `kind` is never trusted.

- Queued via `this.queue` directly (not `enqueueMutation`): nothing is ever written to
  `settings.json` by a preview, so it skips `markOwnWrite`/re-list/broadcast entirely.
- `pi_npm`/`pi_git` → `{ok:true, kind, source, skills: []}` immediately — packages install as a
  unit, nothing to pick.
- `local_path` → `expandHome(normalized)`; a missing/non-directory path → `invalid_source`; else
  scanned in place.
- `skills_repo` → `mkdtemp($PI_STUDIO_HOME/tmp/preview-*)` (created first via `mkdir(…, {
  recursive: true })`), then `git clone --depth 1 [--branch ref] <cloneUrl> <scratch>` (120 s,
  `spawnEnv`'s prompt-guard env). `parseSkillsRepoSource` (new, local) derives `cloneUrl`/`ref`/
  `subpath` from the normalized source: a GitHub/GitLab `/tree/<ref>/<path>` URL supplies both;
  bare `owner/repo[@skill]` clones `https://github.com/<owner>/<repo>.git` (the optional `@skill`
  suffix is a post-clone skill-name filter for `skills add`, not a ref — preview deliberately
  ignores it and shows the whole repo); anything else (scp-like, `ssh://`, any `*.git` URL) clones
  the normalized string verbatim. The scratch dir is removed in a `finally`, covering success,
  clone failure, and timeout alike (same code path — `runSpawn` maps a timeout to `ok:false` the
  same as a nonzero exit).
- `buildPreviewResult` scans `root` with Pi's own `loadSkillsFromDir` and combines two sources into
  one flat `PreviewSkill[]`: its loaded `Skill`s (`valid:true` — the loader only returns an entry
  once description validation passes) and its diagnostics for a `SKILL.md` that failed to load at
  all (no description — `valid:false`, name falls back to the parent directory name), so an
  invalid skill still gets its own row instead of silently disappearing. `exists` checks
  `<agentsSkillsDir>/<sanitizeSkillName(name)>/SKILL.md` (new export in `skills-cli.ts`, mirroring
  the `skills` CLI's own `sanitizeName`). No valid row at all → `no_valid_skills`.
- `ResourceServiceDeps` gained an optional `studioHome` (defaults to
  `process.env.PI_STUDIO_HOME ?? ~/.pi-studio`, mirroring `bootstrap.ts`'s own `resolveHome`);
  `bootstrap.ts` now passes its own resolved `home` through.

## Files changed

| File | Change |
|---|---|
| `packages/server/src/resources/resource-service.ts` | `preview()`, `previewLocked`, `previewSkillsRepo`, `buildPreviewResult`, `parseSkillsRepoSource`, `PreviewResult`/`InstallResult` types, `studioHome` dep/constant |
| `packages/server/src/resources/skills-cli.ts` | `sanitizeSkillName` export |
| `packages/server/src/resources/skills-rpc.ts` | `skills_preview_request` handler + shape guard |
| `packages/server/src/daemon/bootstrap.ts` | `studioHome: home` passed to `ResourceService` |
| `packages/server/src/resources/resource-service.test.ts` | `preview` describe block (pi_npm/pi_git, invalid source, local_path incl. missing dir, real local git-repo clone with an invalid skill, clone failure, clone timeout), `studioHome`/`makeGitRepoFixture` fixture additions |
| `packages/server/src/resources/skills-rpc.test.ts` | `skills_preview_request` describe block (malformed, invalid_source, pi_npm, local_path with an untrusted client `kind`) |
| `packages/server/AGENTS.md` | `resources/` tree + prose invariants updated for `preview` |
| `swe/architecture/pi-resource-management.md` | No deviation for preview itself (task-005's summary covers the one `local_path` finding, shared code path) |

## Build & test results

```
$ npx vitest run packages/server/src/resources
 Test Files  6 passed (6)
      Tests  97 passed (97)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean exit)
```

`npx tsc -b --force` (packages/server) and `npx oxlint`/`npx oxfmt` on every changed file: clean.

## Acceptance criteria checked

- [x] A local fixture repo (file:// URL) with three skills, one invalid, previews three rows with
      the invalid one flagged — `resource-service.test.ts`'s `makeGitRepoFixture` + "a
      shallow-cloned skills_repo previews three rows…" test, using a real local git repo and the
      real `git` binary (no spawn fake).
- [x] No `preview-*` dir remains after success, failure, or timeout — three dedicated tests
      (success, clone failure, clone timeout) assert `<studioHome>/tmp` has no `preview-*` entry.
- [x] A host folder previews without being copied — `local_path` test asserts the scanned rows and
      that `studioHome` itself has nothing written under it.

## Follow-ups

None — task-005's `local_path` TODO(verify) resolution (bare vs. `"+"`-prefixed `settings.skills`
entry) is install-only and tracked in that task's own summary/the architecture doc.
