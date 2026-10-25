# Task 001 — Spike: does `pi install` keep an existing entry's filter arrays? — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Ran the real bundled `pi` CLI (`node_modules/@earendil-works/pi-coding-agent`, bin
`dist/bundle/cli.js`) against a throwaway script that, before importing/spawning Pi, pointed
`HOME` and `PI_CODING_AGENT_DIR` at a temp directory (`/tmp/spike-077-home/.pi-agent`) and set
`PI_STUDIO_HOME` likewise, so the real `~/.pi` and `~/.agents` were never touched.

1. Seeded `settings.json` with an object-form package entry with empty filter arrays:
   ```json
   { "packages": [{ "source": "npm:is-odd", "extensions": [], "prompts": [], "themes": [] }] }
   ```
2. Spawned `node dist/bundle/cli.js install npm:is-odd` (real npm install, network used to fetch
   the tiny `is-odd` package) against that temp `HOME`.
3. Diffed `settings.json` before/after.

**Result: filters are preserved, byte-identical.**

```
=== before ===
{ "packages": [{ "source": "npm:is-odd", "extensions": [], "prompts": [], "themes": [] }] }
=== after ===
{ "packages": [{ "source": "npm:is-odd", "extensions": [], "prompts": [], "themes": [] }] }
```
stdout: `Installing npm:is-odd...\n\nadded 2 packages in 420ms\nInstalled npm:is-odd`, exit 0.

Code read confirms *why*: `DefaultPackageManager.addSourceToSettings`
(`package-manager.js:624-656`) finds the matching entry by identity and replaces it with
`typeof existing === "string" ? normalizedSource : { ...existing, source: normalizedSource }` —
a shallow object spread that only ever overwrites the `source` key. This merge happens after
`parseSource` resolves the type (npm/git/local) but does **not** itself branch on that type, so
the "only `source` changes" guarantee is source-type-agnostic, not npm-specific.

### git: source variant

Attempted a local bare-git-repo (`file://`) source to exercise the same merge for `git:`
packages. This is **not supported by the pi CLI itself**, independent of pi-studio:
`parseGitUrl` (`dist/utils/git.js`) only recognizes `hosted-git-info` providers (GitHub/
GitLab/Bitbucket/etc.) or a generic `https://host/owner/repo` form requiring a real resolvable
host; `file://` URLs fall through `isLocalPath`/`parseGitUrl` and are treated as (nonexistent)
local paths, so `pi install git:file:///tmp/...` fails with `Path does not exist`. Since
`addSourceToSettings`'s merge logic never inspects the parsed source type, the npm finding
generalizes to `git:` sources by code inspection even though it couldn't be exercised
end-to-end with a local repo.

Spec `swe/architecture/pi-resource-management.md` § `TODO(verify)` updated with the full
findings and marked resolved/checked.

## Files changed

| File | Change |
|---|---|
| `swe/architecture/pi-resource-management.md` | Resolved `TODO(verify)` section with spike findings (filters preserved; git: `file://` limitation noted) |
| `swe/sprints/sprint-077-skills-install/in_progress/task-001-spike-pi-install-filters.md` → `done/` | Status `done`, acceptance boxes ticked, moved |

task-004 (`backlog/task-004-install-pi-packages.md`) was **not** amended: filters were not lost,
so no re-apply-after-spawn logic is needed in the server's install path.

## Build & test results

No production code changed; this was an investigation-only spike. Script output captured above
verbatim from the real run. Throwaway scripts (`/tmp/spike-077-script.mjs`,
`/tmp/spike-077-script-git.mjs`) and temp dirs deleted after use.

Real `~/.pi/agent/settings.json` proven untouched:

```
before: mtime=1792935798 size=5234 sha256=716bb4badadb5748550f3215fe30a73391b7355345b89d2ed70b022a5661380e
after:  mtime=1792935798 size=5234 sha256=716bb4badadb5748550f3215fe30a73391b7355345b89d2ed70b022a5661380e
```

Real `~/.agents` mtime unchanged (`1784673637`) before/after.

## Acceptance criteria checked

- [x] Observed settings.json before/after recorded
- [x] Spec TODO(verify) checked off with the answer and, if filters are lost, task-004 updated
      to re-apply them after the spawn — not needed, filters survived

## Follow-ups

- None for task-004/task-002 wiring: no re-apply-filters logic required after `pi install`.
- If a future sprint needs to test `git:` package sources end-to-end, it will need either a
  real reachable git host (e.g. a local HTTP git server, not bare `file://`) or to accept
  testing only via code inspection as done here.
