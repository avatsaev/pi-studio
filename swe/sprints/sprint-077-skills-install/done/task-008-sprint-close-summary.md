# Task 008 — Sprint close: live E2E over direct and relay, docs, full gates — Summary

- **Sprint:** sprints/sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done
Live E2E of every install path against a production daemon, a real local relay (`pi-studio relay start`), real `pi`, real `skills@1.7.4`, real GitHub/npm, in a throwaway `HOME` + `PI_CODING_AGENT_DIR` + `PI_STUDIO_HOME` under `/tmp/s077` (deleted afterwards; real `~/.pi` / `~/.agents` never touched). Window A connected directly, window B through the relay via a real pairing link (`daemon pair`), both in Chromium; further steps driven through `PiStudioClient`. **The E2E found four real bugs that unit tests could not; all are fixed with regression tests.**

## Bugs found live and fixed
1. **Removing a skill that came from a registered host folder was a silent no-op.** `remove({path})` for `settings_path` rows dropped only an entry equal to the skill's own dir, but an installed host folder is a *parent* entry — it answered `ok:true` and the skill stayed. Now drops every `settings.skills` entry (any ± form) that covers the skill (own dir/file or ancestor folder); none ⇒ `not_removable`. The confirm text now says sibling skills from the same folder stop loading too. Test + spec + AGENTS updated.
2. **`skills` CLI failures had no diagnostic.** The CLI prints failures on stdout (stderr empty), and the runner discarded stdout, so a failed repo install showed `install_failed` with an empty detail. `InstallSpawn` now returns a bounded `stdout` tail; `runSpawn` falls back to `cliFailureText(stdout)` (first `■` block, ANSI/spinners/gutter stripped, redacted, capped). Tests include the real CLI output shape.
3. **A failed install/update-all never showed its per-item results.** Both answer `ok:false` when any item failed but still carry `results`; the UI dropped them into an error banner that is not rendered on the source step. `hasItemResults` now routes such answers to the Results step (update-all had the same latent bug from 076).
4. **A failed install reset and remounted the dialog.** The `ok:false` answer was cached verbatim as the list document, so the panel swapped itself for its "could not load" state and the install dialog remounted blank. The cache copy is now always `ok:true` (`asListDocument`). Regression tests for 3 and 4 are pure-helper tests (repo convention: no jsdom).

## E2E results
1. **Repo → preview → pick two → install** — PASS (direct window A, relay window B). `vercel-labs/agent-skills` previewed 9 skills via a real shallow clone; unchecked all but `deploy-to-vercel` and `web-design-guidelines`; install put exactly those two in `~/.agents/skills/`, `.skill-lock.json` lists exactly those two, window A's list and relay window B's list both updated with no action in B. No `preview-*` scratch left.
2. **`npm:pi-subagents` (skills + prompts + extension)** — PASS. `settings.packages` = `{source, extensions:[], prompts:[], themes:[]}` (the three empty arrays); package row `filtered: true`; a newly created agent lists the package's skills (`skill:pi-subagents`, `skill:council-mode`), no prompts, and the extension-command set is identical to the pre-install baseline (`llama`, `mcp`, both preexisting).
3. **`git:github.com/nicobailon/pi-subagents`** (after removing the npm one) — PASS, same object form and same command result.
4. **Host path** — PASS (after fix 1). Entry is the bare path in `settings.skills` (see deviation below), nothing copied into `~/.agents/skills`, a second install does not duplicate it, `settings_path` row appears, Remove drops the entry and keeps the files.
5. **FIFO from two clients** — PASS. Repo install from window A and a host-path install from window B 200 ms later completed in submission order; window B received `mutation` broadcasts. Re-installing an existing name without `replace` → `name_exists` (not spawned); with `replace:true` → ok.
6. **Nonexistent package** — PASS. `npm:` → `install_failed` in ~0.5 s with a bounded npm E404 tail (650 chars); `skills_repo` nonexistent → fails in ~1.7 s with the CLI's own message after fix 2; preview of it → `preview_failed` + git stderr, no scratch left; the list matches disk and settings were untouched.
7. **Private repo without credentials** — PASS. Preview 0.22 s, `git:` install 0.34 s, both `fatal: could not read Username … terminal prompts disabled` — fails fast, no hang, no credential prompt.
- UI: Install dialog states (source with live kind label + package notice, pick list with default-checked rows, running, per-item results with Show/Hide details, Done) screenshot-verified.

## Deviation (recorded by task-005, confirmed live)
The spec's `local_path` pseudocode appended `"+<path>"` to `settings.skills`; Pi treats `±` entries as overrides only, never as new scan roots, so a **bare** path entry is written. Spec, `packages/server/AGENTS.md` and task-005 were amended there.

## Not run / noted
- **Real private repo with credentials, and `npx skills add` of the tracked-CLI beyond the paths above:** only the no-credentials failure was exercised.
- **Upload tab:** deferred by design (R4).
- Over the relay only step 1 (and the broadcast side of step 5) was driven; steps 2–7 were driven through a direct SDK client — the RPCs are transport-agnostic and step 1 proves the relay path for preview, install and `skills_changed`.
- Unrelated and pre-existing: when the relay is not yet accepting connections the daemon logs a burst of ~200 reconnect attempts within milliseconds (no backoff) before connecting; left alone.

## Build & test results
```
npm run build      → exit 0
npm run typecheck  → exit 0
npm run lint       → no diagnostics in touched files (oxlint on resources/, features/skills/, sync-executor.ts clean)
oxfmt --check <touched dirs> → all matched files use the correct format
npm test           → 224 files, 3056 tests passed, 0 failed
```

## Docs
Root `AGENTS.md` (skills_* bullet completed with preview/install), `swe/MAIN-SCOPE.md` (open question resolved), `swe/features/skills-manager.md` (status: implemented), `swe/sprints/PLAN.md` (077 done, release hold lifted), `swe/architecture/pi-resource-management.md` and `packages/server/AGENTS.md` (settings_path removal, stdout fallback), web-client spec text.

## Acceptance criteria
- [x] Every step recorded with observed results
- [x] All feature acceptance criteria satisfied or explicitly not-run with reason (above)
- [x] Full gates green

## Follow-ups
- A package with zero skills still has no panel header, so it can only be removed via SDK/CLI.
- "Queued…" vs "Working…" remains the documented simplification.
