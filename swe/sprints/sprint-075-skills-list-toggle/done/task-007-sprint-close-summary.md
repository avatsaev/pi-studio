# Task 007 — Sprint close: live E2E, root docs, full gates — Summary

- **Sprint:** sprints/sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was done
Live end-to-end verification of list + toggle against a production daemon (`node packages/server/dist/daemon/main.js`, built from the tree) with real `pi`, a sandboxed `HOME` / `PI_STUDIO_PI_HOME` / `PI_STUDIO_HOME` under `/tmp/s075` (deleted afterwards; the real `~/.pi` and `~/.agents` were never touched), driven through `PiStudioClient` (two clients) and Chromium against `pi-studio ui`. Root `AGENTS.md` updated.

## Files changed
| File | Change |
|------|--------|
| `AGENTS.md` | Pi-bump mirror list now names `resources/toggle-patterns.ts` and the `SettingsManager`/`DefaultPackageManager`/`loadSkillsFromDir` imports in `resources/pi-sdk.ts`; new `skills_*` protocol bullet |

## E2E results
1. **List/grouping** — PASS. Fixture: `alpha`+`gamma` in `<agentDir>/skills`, `alpha`+`beta` in `~/.agents/skills`, five auto-installed curated packages. Panel (screenshot) shows PI SKILLS / AGENT SKILLS / NPM:PI-WEB-ACCESS groups, search box, toggles, `curated`/`npm` badges, footnote. **Amended expectation:** the dev daemon (`dev-main.js`) advertises the `skills` flag (it advertises every `SERVER_FEATURES` key, `ws-server.ts defaultFeatures()`) but registers no handler, so the panel shows the raw error `no handler for skills_list_request` rather than hiding the category. Spec text said "no category"; behaviour is consistent with production-only registration.
2. **Toggle** — PASS. Disable `beta` → `settings.skills = ["-skills/beta/SKILL.md"]`; enable → `["+skills/beta/SKILL.md"]` (replaced, not duplicated; re-disable → `-…`). A freshly created agent's slash commands: beta ON → `skill:alpha, gamma, beta, delta`; beta OFF → no `skill:beta`. **Not run:** `pi config` TUI showing the row unchecked (interactive TUI; covered by the differential fixtures in task-002 generated from Pi's own `ResourceList`). Toggle from the UI (gamma off) wrote `-skills/gamma/SKILL.md`.
3. **Shadowing** — PASS. `alpha` present in both skill dirs → `~/.agents/skills/alpha` row carries `shadowedBy` = the `~/.pi/agent/skills/alpha/SKILL.md` path; UI shows "shadowed by Pi skills" badge with a disabled switch.
4. **Host-side refresh** — PASS. External write of `settings.json`, creating a new skill directory (`delta`) and writing the lock file each produced exactly one `skills_changed("external")` in both connected clients (~650 ms after the write). An open Settings → Skills panel flipped the `beta` switch with no user action after a host-side `settings.json` edit. **Not run:** `npx skills add` itself (no network use in the sandbox); the lock-file and skills-dir events it produces were simulated directly. **Observed edge:** an external edit landing within the 500 ms fold window right after the daemon's own write is folded into the mutation broadcast and produces no separate `external` event (the next list is still correct).
5. **Curated package toggle** — PASS. No shipped curated package contains a skill, so the sandbox copy of `pi-web-access` got `pi.skills: ["./skills"]` and a `websk` skill. Row reported `origin: package`, `curated: true`, `removable: false`; toggle off wrote `{source:"npm:pi-web-access", skills:["-skills/websk/SKILL.md"]}` and the package row became `filtered: true`. In the browser the first toggle raised the `window.confirm("Pi-Studio will stop managing this package's updates.")` dialog (same `window.confirm` convention as the file explorer and provider auth); on accept the entry became `skills:["+skills/websk/SKILL.md"]` — Pi-faithful, object form kept (see task-004's amendment).
- `skills_changed` reached both clients for a mutation made by one of them (broadcast to every session).

## Build & test results
```
$ npm run build            → success
$ npm run typecheck        → success (tsc -b)
$ npm run lint             → no diagnostics in any touched file (only pre-existing warnings elsewhere)
$ npx oxfmt --check <touched dirs> → only 6 pre-existing, untouched files flagged
$ npm test                 → 221 files, 2907 tests passed, 0 failed
```

## Acceptance criteria
- [x] Every E2E step recorded with observed result (above; two parts explicitly not run, with reason)
- [x] Root docs updated
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` green

## Follow-ups / TODO(verify)
- Spec/task text "dev daemon shows no category" is wrong for this repo (flag advertised by default); the panel's raw `no handler …` message against a dev daemon is a UX rough edge, not addressed (out of scope).
- Optionally translate `unknown_message_type` to a friendlier message in `skills-presentation.ts`.
- `pi config` TUI cross-check and a real `npx skills add` remain for a manual pass.
- Release hold: the `skills` flag exposes the category from this sprint; install arrives in sprint 077.
