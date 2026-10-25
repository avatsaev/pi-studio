# Grill — Skills Manager (Settings → Skills)

> Status: grilled
> Started: 2026-10-25   Last updated: 2026-10-25   Rounds: 8
> Engineer: avatsaev   Agent: Claude Code (claude-opus-5-5)

## Raw idea
i want to be able to manage installed skills from pi-studio ui settings, enable, disable, remove and install from different sources like npm skills and other

## Codebase context
| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Pi version | `node_modules/@earendil-works/pi-coding-agent/package.json` | Pi 1.4.0 (repo range `^1.4.0`). |
| Pi skill discovery | `.../dist/core/package-manager.js:1999-2063`, `docs/skills.md:61` | Order: project `.pi/skills` → project `.agents/skills` (cwd up to repo root) → `<agentDir>/skills` → `~/.agents/skills` → packages → `settings.skills` paths / `--skill`. First name wins; later duplicates dropped with a `collision` diagnostic. |
| Pi skill format | `.../dist/core/skills.d.ts`, `docs/skills.md:53,79` | Frontmatter `name`, `description`, `disable-model-invocation` (+ unknown keys). Invoked as `/skill:<name>`. `enableSkillCommands` (global setting) only hides `/skill:` entries from command discovery. |
| Pi native enable/disable | `.../dist/modes/interactive/components/config-selector.js:410-521`, `docs/settings.md` § Resources | No per-skill boolean. `pi config` toggles by writing `-<path>` / `+<path>` into `settings.skills` (top-level resources, path relative to agentDir) or `packages[i].skills` (package resources, relative to package root; string entry converted to object form). Real user `~/.pi/agent/settings.json` already carries such entries (e.g. `"-skills/clean-room-scope/SKILL.md"`). |
| Pi SDK surface | `.../dist/index.d.ts:17,22,23`, `dist/core/package-manager.d.ts:2-55` | Exports `DefaultPackageManager` (`resolve()` → `ResolvedPaths.skills: {path, enabled, metadata:{source, scope, origin:"package"\|"top-level", baseDir, packageRoot}}[]`, `installAndPersist`, `removeAndPersist`, `listConfiguredPackages`), `SettingsManager` (`get/setSkillPaths`, `setPackages`, project variants), `loadSkills`/`loadSkillsFromDir`. This is exactly what `pi config` uses. |
| Pi reload | `docs/rpc-commands.md`, `docs/slash-commands.md:49` | Resources load at process start; `/reload` is interactive-only, no RPC reload. A running `pi --mode rpc` agent sees skill changes only after respawn. |
| Pi trust | `docs/security.md`, `dist/core/trust-manager.js` | Project `.pi/*` and project `.agents/skills` need a trust decision (`~/.pi/agent/trust.json`); untrusted → silently not loaded. `~/.agents/skills` always trusted. |
| Pi packages | `docs/packages.md` | `pi install/remove npm:… \| git:… \| https://… \| <path>` write user `settings.json` (`-l` = project). A package can ship skills (`package.json#pi.skills` or auto `skills/`). Packages run with full system access. |
| skills CLI (skills.sh) | https://github.com/vercel-labs/skills/blob/main/docs/commands.md | `npx skills add <owner/repo \| git URL \| tree URL \| SKILL.md/archive URL \| local path> -g -s <name> -a <agent> -y`; installs to `~/.agents/skills/` (canonical copy, symlinked into per-agent dirs); records `~/.agents/.skill-lock.json` (source, sourceUrl, skillPath, folder hash, timestamps); has `list`/`remove`/`update`/`check`/`find`. The engineer already uses it (lock file present; `~/.pi/agent/skills/*` symlinks into `~/.agents/skills`). |
| Existing extensions subsystem | `packages/server/src/extensions/` (`extensions-service.ts`, `sync-executor.ts`, `extensions-state.ts`, `curated-packs.ts`, `extensions-rpc.ts`) | Curated packs + `pi install` spawn seam (`InstallSpawn`/`defaultInstallSpawn`, bundled pi CLI, `PI_CODING_AGENT_DIR` from `effectivePiHomeKey`, 180s/600s timeouts, tree-kill). `readPiSettingsPackages()` reads the raw `packages` array. Production bootstrap only (`bootstrap.ts:506`); dev daemon does not register it. |
| Unbuilt extensions-manager spec | `swe/features/extensions-manager.md` | Designed, not implemented, no sprint: Settings "Extensions" category; Phase A renders curated packs; Phase B `pi_packages_list/install/remove_request` + `piPackages` flag, global pi-home only, all mutations via spawned `pi install/remove`, never writes `settings.json` directly. Overlaps this feature's install/remove. |
| Session-scoped skill listing | `packages/server/src/agent/slash-command-operations.ts:545-561`, `providers/pi/agent.ts:573-585` | Skills are visible today only via `agent_list_commands_request` → Pi `get_commands` (`source: "skill"`, `scope`, `path`) — needs a live/resumable agent. No daemon-level skills listing. |
| Settings dialog | `packages/web-client/src/features/settings/settings-categories.ts`, `SettingsDialog.tsx` | Category registry `{id,label,icon,component(lazy),available(caps)}`; today `providers` (gated `providerAuth`) and `viewers`. Adding a category = one registry entry + capability. |
| Broadcast precedent | `packages/server/src/viewers/viewer-settings-rpc.ts` | Serialized read-modify-write queue + `*_update` broadcast to every session before the response. |
| In-process Pi SDK precedent | `packages/server/src/agent/provider-auth/pi-auth-runtime.ts`, `session-hydration.ts` | Daemon already imports Pi SDK in-process (lazily for auth). |
| Pi home | `extensions-state.ts:100-109` (`effectivePiHomeKey`), root `AGENTS.md` (`PI_STUDIO_PI_HOME`) | Agent dir = `PI_STUDIO_PI_HOME/agent` or `~/.pi/agent`. `~/.agents/skills` is NOT under pi-home — it is shared host-wide regardless of `PI_STUDIO_PI_HOME`. |
| Projects/workspaces | `swe/features/projects-workspaces.md`, `persistence/entity-stores.ts:192` | Daemon knows workspace `cwd`s, so project-scope skills (`<cwd>/.pi/skills`, `<cwd>/.agents/skills`) are resolvable per workspace. |

## Problem & outcome
- **Who:** a Pi-Studio user driving the daemon from the browser UI — including relay-remote clients with no shell on the daemon host (confirmed round 8).
- **Today:** skills are managed only on the daemon host's shell: `npx skills add/remove`, `pi install/remove`, hand-editing `settings.json`, or the interactive `pi config` TUI. The UI shows skills only inside a live agent's slash-command picker.
- **Done means:** Settings → Skills lists every skill the daemon's Pi would load globally (plus a workspace's project skills read-only), and lets the user enable, disable, remove, update, and install skills from npm/git Pi packages, skills.sh/GitHub repos, a daemon-host path, or a browser upload.
- **Measured by:** TODO(verify) — owner: avatsaev (no metric given; acceptance criteria stand in).

## Goals
- Manage global (user-scope) skills from Settings: list, enable, disable, remove, install, check for updates, update.
- Install from: Pi package `npm:`, Pi package `git:`, skills.sh / GitHub repo, local path on the daemon host, upload from the browser.
- Show a selected workspace's project skills read-only.
- One shared package-install backend that supersedes extensions-manager Phase B (`pi_packages_*`).

## Non-goals
- Mutating project-scope skills (enable/disable/install into `<cwd>/.pi` or `<cwd>/.agents`) — read-only in v1 (D3).
- Direct URL installs (SKILL.md / archive URL) — not selected (D2).
- Restarting or reloading running agents after a change (D4).

## Happy path
User-visible flow as decided across rounds 1–8.

**Browse & toggle**
1. User opens Settings → **Skills** (category present only when the daemon advertises the feature flag).
2. Panel shows skills **grouped by origin** (D5): Pi-home skills dir (`<agentDir>/skills`), `~/.agents/skills` (skills.sh), one group per Pi package (header shows package source), explicit `settings.skills` paths, and — after picking a workspace — a read-only `Project: <workspace>` group with its trust state (D3).
3. Each row: skill name, description, enabled toggle. Loose (non-package) rows also have **Remove**; packaged rows are toggle-only (D9).
4. User flips a toggle → daemon persists the change → row reflects the post-write state. Footnote: "Changes apply to newly started agent sessions." (D4)

**Install**
5. User clicks **Install skill…** → dialog with one source field + an **Upload** tab (D6).
6. User types `npm:<pkg>`, `git:<url>[@ref]`, `owner/repo` / `https://github.com/…`, or an absolute daemon-host path; the dialog shows the detected kind.
7. **Preview**: daemon fetches/inspects the source and returns its skills (and, for Pi packages, its other resources) (D7).
8. User ticks which skills to install/enable; for a Pi package, non-skill resources (extensions/prompts/themes) are listed as checkboxes, default off, with the full-system-access warning (D8).
9. Confirm → daemon installs; long-running state in the dialog ("may take several minutes").
10. Done → list refreshes from post-install disk state; new skills appear in their origin group with the chosen enabled state.

**Upload** (Upload tab)
6′. User drops a skill folder or zip from the client machine → same preview (7) → pick (8) → install.

**Remove**
11. On a loose skill row → confirm dialog → daemon removes it via the mechanism matching its origin → row disappears.
12. Pi packages are removed from the package group header, not from a skill row (D9).

**Update** (D34)
13. User clicks **Check for updates** → daemon checks skills.sh rows (`skills check`) and unpinned Pi packages (`checkForAvailableUpdates()`).
14. Rows / package headers with an available update show **Update** → queued like an install → per-item result → list re-reads.

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Relationship to unbuilt `extensions-manager.md` Phase B (`pi_packages_*`) | Absorb Phase B: build one shared package backend now; the Skills panel is its first consumer; the future Extensions panel reuses it | Avoids two installers over the same `settings.json` `packages` array; a skill can arrive via a package | 1 |
| D2 | scope | v1 install sources | Pi package `npm:`, Pi package `git:`, skills.sh / GitHub repo, local path on daemon host, upload from browser. Not: direct SKILL.md/archive URL | Engineer's selection | 1 |
| D3 | scope | Global vs project | Manage global (user) skills; show project skills of a selected workspace read-only (with trust state) | Daemon has workspace cwds but no single project; per-workspace mutation is a bigger surface | 1 |
| D4 | scope | Running agents after a change | Notice only: "Applies to newly started sessions." No restart/reload action | Pi has no RPC reload; matches extensions-manager posture | 1 |
| D5 | happy path | List layout | Grouped by origin: Pi-home skills dir, `~/.agents/skills`, each Pi package, `settings.skills` paths, read-only project group | Origin decides what Remove/toggle can do; mirrors `pi config` grouping | 2 |
| D6 | happy path | Install dialog shape | One source field with kind auto-detection (`npm:`, `git:`, `owner/repo`, GitHub URL, absolute path) + a separate Upload tab | Single entry point; detected kind shown before confirm | 2 |
| D7 | happy path | Multi-skill sources | Preview & pick: daemon lists the source's skills before installing; user selects | Repos like `vercel-labs/agent-skills` ship many skills | 2 |
| D8 | happy path | Non-skill resources in a Pi package | Ask per install: confirm dialog lists the package's extensions/prompts/themes as checkboxes, **default off**, with the full-system-access warning | Installing "a skill" must not silently activate extension code | 2 |
| D9 | happy path | Remove for packaged skills | No per-skill remove for packaged skills — toggle only; whole package removed from the package group header | A single skill cannot be deleted out of a package; keeps one obvious story | 2 |
| D10 | data | How enable/disable persists | In-process Pi `SettingsManager`, writing the same `-<path>`/`+<path>` filters `pi config` writes (`settings.skills` for top-level skills, `packages[i].skills` for packaged skills), under Pi's own `proper-lockfile` lock. **Amends extensions-manager's tenet** from "never write `settings.json` directly" to "never hand-edit `settings.json`; mutate only through Pi's own code (spawned CLI or in-process `SettingsManager`/`DefaultPackageManager`)" | No CLI verb exists for toggling; reusing Pi's code keeps the host's plain `pi` and Pi-Studio agents in agreement and survives format changes | 3 |
| D11 | data | Source of the skill list | In-process Pi `DefaultPackageManager.resolve()` with `onMissing → "skip"` (never installs on list); name/description from Pi's skill loader. Project group = resolve against the workspace cwd | Exact Pi semantics (filters, precedence, package manifests, `~/.agents` discovery) with no re-implementation | 3 |
| D12 | data | Where uploads land | `~/.agents/skills/<name>/` (host-wide Agent Skills dir) | Engineer's choice: one shared location with skills.sh installs, visible to other agents on the host | 3 |
| D13 | data | Pi-Studio-owned skills state | None. Everything derives from Pi's `resolve()`, `settings.json`, and `~/.agents/.skill-lock.json` | No new `$PI_STUDIO_HOME` file, no migrations, no drift from disk truth | 3 |
| D14 | integration | Node floor vs skills CLI (requires Node ≥22.20) | Raise the daemon's Node floor to **≥22.20** (root `package.json` engines, docs). Grounding: Pi 1.4.0 already declares `node >=22.19.0` and Docker images use `node:22-bookworm`, so the effective floor moves 22.19 → 22.20, not 20 → 22.20 | Removes the per-source runtime gate; near-zero practical breakage | 4 |
| D15 | integration | Preview of a Pi package before install (D7/D8) | Fetch into a temp dir with no lifecycle scripts (`npm pack` / shallow `git clone`), scan with Pi's package resolution, discard; on confirm run the real install and persist the chosen per-resource filters | No package code runs before the user consents; costs a second download | 4 |
| D16 | integration | Browser upload transport | Reuse the existing chunked `file_upload_request` + file-transfer binary frames to a **daemon-chosen staging path** (returned by a skills RPC), then install-from-staging. Zip extracted server-side; folder drops zipped client-side | Existing, relay-safe binary channel; no base64 JSON bloat | 4 |
| D17 | integration | Wire shape & registration | New flat RPC families `skills_*` (list / preview / install / set_enabled / remove, + staging) and `pi_packages_*` (list / install / remove — D1); feature flags `skills` + `piPackages`; registered in `bootstrap.ts` only (dev daemon answers `unknown_message_type`, like `extension_packs_*`); a `skills_changed` broadcast to every session after any mutation (viewer-settings precedent: before the response) | Multi-window consistency; dev daemon must not mutate a developer's real `~/.pi`/`~/.agents` | 4 |
| D18 | edge cases | How the skills CLI is invoked | Exact-pinned `skills` dependency in `packages/server`; bin resolved like `resolveBundledPiCli()` (from its own `package.json` `bin`), run with `process.execPath`; always `-g -a pi -y` | Reproducible, offline-capable after install; bumps are deliberate | 5 |
| D19 | edge cases | Same skill name in several origins | Show shadowed duplicates greyed — "shadowed by <origin>", toggle disabled; symlinked entries labelled as links to their target | Pi silently drops losers (first-wins); the user's host already has agentDir symlinks into `~/.agents/skills` | 5 |
| D20 | edge cases | What Remove deletes | Origin-aware, never through symlinks: symlink → unlink only; `~/.agents` skill with a `.skill-lock.json` entry → `skills remove -g <name> -y` (confirm states it is host-wide); plain dir in agentDir or `~/.agents` → recursive delete; `settings.skills` path entry → remove the entry, never the files | Prevents deleting shared targets; keeps the skills CLI lock consistent | 5 |
| D21 | edge cases | Concurrent mutations | One skills/packages mutex (separate from curated `ExtensionsService` sync); installs/removes queue FIFO; toggles take Pi's settings file lock and apply immediately; every response re-reads disk | No lost updates; a queued second client sees "queued" then its result | 5 |
| D22 | edge cases | Upload validation | Reject path traversal, absolute paths, and symlinks inside the archive; caps 10 MiB upload / 25 MiB extracted / 1000 files (skills CLI defaults); must contain ≥1 `SKILL.md` with Pi-valid frontmatter (preview lists each, invalid ones with the reason); existing target name → refused unless the user confirms **Replace** | Untrusted bytes from a remote client; mirrors skills CLI limits | 5 |
| D23 | edge cases | Authorization for install/remove/toggle | Same trust as terminals: any authenticated client (password / pairing, direct or relay) may do everything; confirm dialogs carry Pi's security warning; no new config key | An authenticated client can already run a shell on the host; an extra gate adds config without adding security | 6 |
| D24 | edge cases | Toggling a skill in a curated package | Allowed; the first toggle on a curated package shows an inline note: "Pi-Studio will stop managing this package's updates" (planner ⇒ `user_modified`). Planner unchanged | Respects user control; keeps the curated planner's invariant intact | 6 |
| D25 | edge cases | Partial failure | Per-item result (ok/failed + bounded stderr) for every picked skill/resource; no rollback of successful parts; list re-read from disk | skills CLI / npm side effects are not reliably reversible | 6 |
| D26 | edge cases | Timeouts, network, credentials | Preview 120 s; install/remove 600 s; tree-kill on timeout, then re-read; `GIT_TERMINAL_PROMPT=0` + non-interactive npm so credential prompts fail fast; private repos work iff host git/gh credentials already exist | Never hang a queued mutex on an invisible prompt | 6 |
| D27 | edge cases | Changes made outside Pi-Studio | Daemon watches `<agentDir>/settings.json`, `<agentDir>/skills`, `~/.agents/skills` (and `.skill-lock.json`) and broadcasts `skills_changed` (debounced) to every session; clients re-list | Engineer's choice: panel stays live when `pi config` / `npx skills` run on the host | 6 |
| D28 | non-functional | Untrusted project in the read-only group | Rows shown greyed with "Not loaded — project untrusted"; no trust action in v1 | Explains why a project skill isn't active without adding a trust surface | 7 |
| D29 | non-functional | Observability | Info log per mutation (kind, source, outcome, duration); warn on failure with bounded stderr (2 KB, `sync-executor` precedent); URL userinfo/tokens redacted in logs **and** responses; no metrics | Debuggable without leaking credentials embedded in git URLs | 7 |
| D30 | non-functional | List performance | Daemon caches the resolved list; invalidated by mutations and watcher events (D27); client-side search box; collapsible groups | `resolve()` + frontmatter parsing over every dir/package is not free; watcher already gives the invalidation signal | 7 |
| D31 | scope | CLI parity (`pi-studio skills …`) | Deferred — UI only in v1 | Host-shell users already have `pi config` / `npx skills` | 7 |
| D32 | happy path | Which workspace the project group shows | Dropdown of registered workspaces, defaulting to the workspace focused in the UI; "None" hides the group | Daemon has many workspaces; Settings is not workspace-scoped | 7 |
| D33 | acceptance | Acceptance bar | The 14 drafted criteria accepted as the bar, including "an unticked package extension never loads, not even transiently" and the relay-upload criterion | Engineer accepted as drafted | 8 |
| D34 | scope | Updating installed skills | **In v1.** On-demand "Check for updates" in the panel, then per-row / per-package **Update**: skills.sh rows via `skills check` / `skills update -g <name>`; Pi packages via Pi `DefaultPackageManager.checkForAvailableUpdates()` / `update(<source>)` (pinned specs are never updated). Uploaded, agentDir, and settings-path skills have no update source and show none | Engineer added it at the acceptance round; Pi and the skills CLI both expose check+update primitives | 8 |
| D35 | edge cases | Agent-derived cases (corrupt `settings.json`; missing workspace cwd) | Confirmed as written in Edge cases | Engineer confirmed | 8 |

## Data & state
**No new Pi-Studio persisted state** (D13). The feature reads and mutates files that Pi (and the skills CLI) own:

| File | Owner | Read | Written by this feature |
|------|-------|------|-------------------------|
| `<agentDir>/settings.json` (`skills`, `packages`) | Pi | via `DefaultPackageManager.resolve()` / `SettingsManager` | toggles via in-process `SettingsManager` (D10); package add/remove via Pi package install/remove; local-path installs append to `skills` |
| `<agentDir>/skills/<name>/` | Pi (auto-discovered) | via `resolve()` | remove only (loose skill) |
| `~/.agents/skills/<name>/` | Agent Skills convention / skills CLI | via `resolve()` | skills.sh installs; browser uploads (D12); remove |
| `~/.agents/.skill-lock.json` | skills CLI | provenance (source, sourceUrl, installedAt) for skills.sh rows | only by the skills CLI itself |
| `<cwd>/.pi/settings.json`, `<cwd>/.pi/skills`, `<cwd>/.agents/skills`, `~/.pi/agent/trust.json` | Pi | project group + trust state (read-only, D3) | never |

Derived per skill row (not stored): `name`, `description`, `path`, `enabled`, `origin` (agentDir dir / `~/.agents` / package `<source>` / settings path / project), `scope` (user/project), `disableModelInvocation`, provenance (from lock file when present), and whether Remove is allowed (loose only, D9).

Notes:
- `~/.agents/skills` is resolved from `$HOME`, **not** from `PI_STUDIO_PI_HOME` (`package-manager.js:83,2023`). A daemon with a custom pi-home still loads and lists host-wide `~/.agents/skills`, and uploads/skills.sh installs go there (D12) — they are visible to every agent on the host, not isolated per pi-home.
- Uploaded skills are not in `.skill-lock.json`, so the skills CLI does not know their provenance; the UI shows them as "uploaded/unknown source".
- Disabling a skill inside a **curated** package converts its `settings.json` entry to object form, which the curated sync planner classifies as `user_modified` — permanently user-owned (`sync-planner.ts:150,164`). See Edge cases.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `swe/features/extensions-manager.md` | Phase B (`pi_packages_*`, `piPackages` flag, `packages-service.ts`) is superseded by this feature's shared package backend (D1); `scope` must rewrite that spec's Phase B section to point here | supersedes | Phase A (curated-pack panel) stays as-is, unbuilt |
| Pi SDK `SettingsManager`, `DefaultPackageManager` (`@earendil-works/pi-coding-agent` index exports) | Imported in-process by the daemon for list (D11) and toggle (D10) | consumes | Couples the daemon to Pi SDK API; add both to the "re-check after a Pi bump" list in root `AGENTS.md` § Pi dependency posture |
| `<agentDir>/settings.json` | Toggle filters + package entries | reads / writes | Shared with any `pi` process on the host; Pi's file lock serializes writers |
| `~/.agents/skills`, `~/.agents/.skill-lock.json` | Install target for skills.sh + uploads; provenance read | reads / writes | Host-wide, outside pi-home isolation |
| `packages/server/src/files/file-transfer.ts` (`file_upload_request` + binary frames), `packages/client/src/file-transfer-client.ts#upload` | Browser uploads stage a zip into a daemon-chosen path (D16) | consumes | Staging path must be daemon-minted, never client-chosen (see Security) |
| `packages/server/src/extensions/sync-executor.ts` (`InstallSpawn`, `defaultInstallSpawn`) | Reused for `pi install/remove` spawns of the shared package backend (D1) | consumes | Same timeout/tree-kill/stderr-capture semantics |
| `skills` CLI (vercel-labs, v1.7.x, Node ≥22.20) | Runs skills.sh/GitHub installs, `add --list` previews, removes into `~/.agents/skills` with `-g -a pi -y` | spawns | Invocation (dependency vs `npx`) — round 5 |
| `packages/protocol` (`messages.ts`, `client-capabilities.ts`) | `skills_*`, `pi_packages_*` schemas; `skills`, `piPackages` flags; `skills_changed` push | emits | Append-only, `.passthrough()` |
| `packages/client/src/pistudio-client.ts` | Facade methods for both families + `onSkillsChanged` | exposes | |
| `packages/web-client/src/features/settings/settings-categories.ts` | New `skills` category gated on `caps.skills` | consumes | |
| `packages/server/src/daemon/bootstrap.ts` | Registers both families (production only) | wires | `dev-bootstrap.ts` untouched |
| Root `package.json` engines, root/cli README + `AGENTS.md` tech stack | Node floor → ≥22.20 (D14) | changes | Docs say Node ≥20 today |
| `packages/server/src/extensions/sync-planner.ts` | Object-form entries ⇒ `user_modified` | consumed by | Toggling a skill in a curated package ends curated management of that package |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| state | Same name in several origins (incl. agentDir symlink → `~/.agents/skills`) | Winner listed normally; losers greyed "shadowed by …", toggle disabled | D19 |
| state | Remove a symlinked skill | Unlink only; target untouched | D20 |
| state | Remove a skills.sh-installed skill | `skills remove -g <name> -y`; confirm warns it removes it for every agent on the host | D20 |
| state | Remove a `settings.skills` path entry | Entry removed from settings; files never deleted | D20 |
| state | Remove a packaged skill | Not offered; toggle only; package removed from its group header | D9 |
| state | Upload whose skill name already exists in `~/.agents/skills` | Refused unless the user confirms Replace | D22 |
| inputs | Archive with traversal / absolute paths / internal symlinks | Rejected before extraction completes | D22 |
| inputs | Archive over 10 MiB, extracted over 25 MiB, or > 1000 files | Rejected with the limit named | D22 |
| inputs | Archive / repo with no valid `SKILL.md`, or some invalid ones | Preview lists invalid skills with Pi's validation reason; nothing installable ⇒ install disabled | D22 |
| timing | Two clients mutate concurrently | FIFO queue under one mutex; toggles apply immediately under Pi's file lock; post-op re-read | D21 |
| identity & access | Any authenticated client (incl. relay) installs/removes/toggles | Allowed — same trust as terminals; confirm dialogs show the security warning | D23 |
| state | Toggle a skill inside a curated `core` package | Allowed; inline note that Pi-Studio stops managing that package's updates (`user_modified`) | D24 |
| timing | One of several picked skills fails; or package installs but filter write fails | Per-item results; successful parts kept; post-op re-read | D25 |
| timing | Install/preview exceeds its timeout | Process tree killed; `{ok:false, error:"timeout"}`; list re-read (disk truth) | D26 |
| dependencies | Network down / npm or GitHub slow / erroring | Fails within the timeout with bounded stderr; queue proceeds | D26 |
| dependencies | Private repo, no host credentials | Fails fast (no credential prompt hang) with the git/npm error | D26 |
| state | `pi config` / `npx skills` / manual edits on the host while panel is open | File watcher → debounced `skills_changed` broadcast → clients re-list | D27 |
| state | Project skills of an untrusted project | Greyed, "Not loaded — project untrusted" | D28 |
| state | Workspace cwd no longer exists on disk | Project group shows an empty-state "workspace path not found"; global list unaffected | D32, D35 |
| state | Update on a pinned package (`npm:x@1.2.3`, `git:…@tag`) | Not offered; row badge "pinned" | D34 (agent-derived; mirrors Pi: pinned specs are skipped by `pi update`) |
| state | Update on an uploaded / agentDir / settings-path skill | No update affordance (no source to update from) | D34 |
| timing | Update fails or times out | Same per-item result + 600 s timeout + re-read as install (D25, D26); queued under the same mutex (D21) | D34 |
| scale | Tens → hundreds of skills / many packages | Cached list (D30), client-side search, collapsible groups; no pagination | D30 |
| inputs | Malformed `settings.json` (corrupt JSON) | List responds `{ok:false, error:"settings_unreadable"}` (extensions-manager precedent); toggles/installs refused until fixed; never rewritten by Pi-Studio | D10/D11, D35 |
| dependencies | Pi SDK or skills CLI contract drift on upgrade | Pi SDK symbols added to root `AGENTS.md` bump checklist; skills CLI exact pin bumped deliberately | D18, Integration points |
| dependencies | Old daemon (no `skills` flag) + new client; dev daemon | Settings → Skills category absent; nothing errors | D17 |
| data lifecycle | Skills installed before this feature (by hand, `pi config`, skills CLI) | Listed like any other — everything derives from disk (D13); existing `-path` filters shown as disabled | D13 |
| data lifecycle | Feature removed / rolled back | Nothing to migrate: every change is a Pi-native `settings.json` filter or files Pi/skills CLI own; host `pi` keeps honoring them | D10, D13 |
| observability & ops | Mutation outcomes | Logged with redacted sources; failures warn with bounded stderr | D29 |
| observability & ops | Feature flag off | n/a — no config switch (D23); absence of the capability flag (old/dev daemon) hides the category | D17, D23 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | Cached resolved list invalidated by mutations + debounced watcher (D27, D30). Installs serialized FIFO (D21). Preview 120 s / install-remove 600 s (D26). |
| Security & authorization | Same trust as terminals (D23). Upload staging paths are daemon-minted (D16). Archive validation per D22. Spawns use argv arrays, never a shell string. |
| Privacy | URL userinfo/tokens redacted in logs and responses (D29). Uploaded bytes live only in a daemon-minted staging dir, deleted after install or abort. |
| Backward compatibility | Append-only new RPC families + `skills`/`piPackages` flags; old daemons hide the category. Node floor raised to ≥22.20 (D14) — effective floor was already 22.19 via Pi. extensions-manager tenet amended (D10). |
| Rollout / feature flag | Capability flags only; production bootstrap only; no runtime config switch (D17, D23). |
| Observability | Per-mutation info logs, failure warns with bounded stderr, redaction (D29). |
| Rollback | Code rollback leaves only Pi-native state (settings filters, skill dirs, skills lock) that the host `pi` keeps honoring; no Pi-Studio data to migrate (D13). |
| Package extension safety | Unchosen extensions/prompts/themes must never be enabled, even transiently: the package entry and its filters reach `settings.json` atomically (D8). |

## Deferred
- Direct URL installs (SKILL.md or `.zip`/`.tgz` URL via skills CLI) — not selected in round 1 (D2).
- Mutating project-scope skills — round 1 (D3).
- Agent restart/reload after skill changes — round 1 (D4).
- `pi-studio skills …` CLI commands — round 7 (D31).
- Trust actions for untrusted projects — round 7 (D28).
- ~~Skill updates~~ — moved into v1 at round 8 (D34).

## Open questions — TODO(verify)
None blocking. Implementation-level unknowns for `scope`/`implement` to resolve:
- [ ] Update check trigger: on demand only (button), or also on panel open? Brief assumes on demand only. — owner: scope (non-blocking)
- [ ] Whether updating a **curated** package from the panel conflicts with the curated planner or `self-update.md`'s `pi update --extensions` step. — owner: scope
- [ ] Pi's toggle-pattern derivation (`getResourcePatternForScope`, `getPackageResourcePattern`) lives in `modes/interactive/components/config-selector.js`, **not** an index export. Confirm whether a public equivalent exists; otherwise mirror it (like `thinking-levels.ts`) and add it to the Pi-bump checklist. — owner: scope
- [ ] Atomic install-with-filters for D8: whether `DefaultPackageManager.install()` (no persist) + one `SettingsManager.setPackages()` write with the object-form entry is viable, versus spawned `pi install` followed by a filter write (leaves a window where all extensions are enabled — violates the constraint). — owner: scope
- [ ] Whether `DefaultPackageManager.resolve()` with `onMissing → "skip"` stays fully offline (no git fetch / npm lookups). — owner: scope
- [ ] skills CLI machine-readable preview: does `skills add <src> --list` have stable/JSON output? Fallback: shallow clone + Pi `loadSkillsFromDir`. — owner: scope
- [ ] skills CLI flags for D20: exact `remove -g` behaviour with `-a pi` vs all agents when other agents symlink to the canonical `~/.agents/skills` copy. — owner: scope
- [ ] Measured-by metric for the feature, if any. — owner: avatsaev

## Acceptance criteria (draft)
- [ ] Given a production daemon, when Settings opens, then a **Skills** category lists every skill Pi would load globally, grouped by origin (agentDir skills, `~/.agents/skills`, each package, settings paths), with name, description, and correct enabled state; against `npm run dev:daemon` the category is absent and nothing errors.
- [ ] Given a listed skill, when the user disables it, then `settings.json` gains exactly the filter `pi config` would write, a newly spawned agent's `get_commands` no longer lists `/skill:<name>`, and `pi config` on the host shows it unchecked; re-enabling reverses both.
- [ ] Given `vercel-labs/agent-skills`, when the user previews then installs two picked skills, then only those two land in `~/.agents/skills`, `.skill-lock.json` records them, and the list shows them without reload.
- [ ] Given an `npm:` Pi package shipping skills and an extension, when installed with the extension unticked, then its skills load in a new agent and the extension never loads — not even between install and filter write.
- [ ] Given a `git:` Pi package source, the same preview → pick → install flow succeeds.
- [ ] Given an absolute daemon-host path to a skill dir, install adds it as a `settings.skills` entry without copying; Remove deletes the entry, never the files.
- [ ] Given a zip uploaded from the browser over the **relay**, preview lists its skills and install places them in `~/.agents/skills/<name>`; an archive with `../` paths, an internal symlink, or > 25 MiB extracted is rejected with the reason; an existing name requires Replace.
- [ ] Removing a symlinked skill unlinks it and leaves the target intact; removing a lock-tracked skill updates `.skill-lock.json`; packaged skills offer no per-skill Remove.
- [ ] A duplicate skill name shows the loser greyed "shadowed by …"; an untrusted project's skills show greyed "Not loaded — project untrusted".
- [ ] Running `npx skills add …` or `pi config` on the host while the panel is open updates the panel in every open window without a manual refresh.
- [ ] Two clients installing at once both complete (FIFO); a nonexistent package fails within the timeout with bounded stderr and the list still matches disk.
- [ ] Logs for a git source with embedded credentials show the URL redacted.
- [ ] Given an outdated skills.sh skill and an outdated unpinned Pi package, when the user clicks Check for updates, then both show an available update; Update brings each to the latest version (lock / installed version changes) and the list re-reads; pinned packages and uploaded/path skills show no update action.
- [ ] Gates: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, scoped `oxfmt`; docs updated (package `AGENTS.md`s, root `AGENTS.md` protocol overview + Pi bump checklist + Node floor, `extensions-manager.md` Phase B superseded, `MAIN-SCOPE.md` index).

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem & outcome + scope boundary (merged: problem given by the raw idea) | D1–D4: absorb extensions-manager Phase B; 5 install sources; global manage + project read-only; notice-only for running agents |
| 2 | happy path | D5–D9: grouped-by-origin list; one-field auto-detect + Upload tab; preview & pick; per-install opt-in for package extensions (default off); packaged skills toggle-only, package removed at group level |
| 3 | data & state | D10–D13: toggles via in-process Pi `SettingsManager` (tenet amended); list via Pi `resolve()`; uploads → `~/.agents/skills`; no Pi-Studio state |
| 4 | integration points | D14–D17: Node floor → 22.20 (Pi already needs 22.19); package preview via script-free temp fetch; uploads via existing file-transfer channel to daemon-minted staging; `skills_*`/`pi_packages_*` prod-only with `skills_changed` broadcast |
| 5 | edge cases (state, inputs, concurrency) | D18–D22: pinned `skills` dependency; shadowed duplicates shown greyed; origin-aware remove that never follows symlinks; serialized FIFO mutations; strict upload validation with Replace confirm |
| 6 | edge cases (access, timing, dependencies, external changes) | D23–D27: same trust as terminals; curated toggles allowed with note; per-item results, no rollback; 120 s/600 s timeouts with prompt guards; file watcher + `skills_changed` |
| 7 | non-functional | D28–D32: untrusted project rows greyed; mutation logs with URL redaction; cached list + search; CLI deferred; workspace dropdown defaulting to the focused workspace. Acceptance criteria drafted. |
| 8 | acceptance | D33–D35: acceptance accepted as drafted; **updates added to v1** (check + per-row update via skills CLI and Pi `DefaultPackageManager`); agent-derived edge cases confirmed; problem framing confirmed; grill closed |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/skills-manager.md` (new; feature spec) | Problem & outcome, Goals, Non-goals, Happy path, Decisions D1–D35, Edge cases, Acceptance criteria |
| `swe/architecture/pi-resource-management.md` (new; the shared package/skill backend: in-process Pi `SettingsManager`/`DefaultPackageManager`, spawned `pi`/`skills` CLIs, mutex/queue, watcher + cache, staging) | Data & state, Integration points, D10–D11, D14–D22, D26–D27, D30, Non-functional constraints |
| `swe/features/extensions-manager.md` (edit) | D1, D10 — mark Phase B superseded by the shared backend; amend the "never write `settings.json` directly" tenet |
| `swe/architecture/websocket-protocol.md` (edit, if it enumerates families) | D17 — `skills_*`, `pi_packages_*`, `skills_changed`, `skills`/`piPackages` flags |
| `swe/MAIN-SCOPE.md` (edit) | Index rows for the new spec(s); Node floor ≥22.20 (D14) wherever stated |

`scope` must resolve the *Open questions* owned by `scope` before tasks depend on them — especially the atomic install-with-filters question (it gates the D8 / "never transiently" guarantee in D33).

## Post-scope review (2026-10-25)

After `scope`, an architecture review found the accretion around the sound core (Pi as source of
truth, toggle mirror, FIFO queue, watcher, pinned `skills` CLI) roughly doubled the surface for
marginal gain. The engineer applied all eight calls; the specs reflect them. Decisions they
override are listed; everything else stands.

| # | Simplification | Overrides | Rationale |
|---|----------------|-----------|-----------|
| R1 | Drop the `pi_packages_*` family and `piPackages` flag; `skills_remove` takes `packageSource` | D1 (wire shape), D17 | Speculative API for a panel that doesn't exist; `skills_list`/`skills_install` already cover packages |
| R2 | Preview is stateless (`preview {source}` → scan; `install {source, picks}` re-fetches) | D7 (mechanics) | Pi's `install()` and the `skills` CLI re-download regardless; the preview handle only served uploads |
| R3 | Pi packages install as a unit with `extensions: [], prompts: [], themes: []` always; no preview/pick for packages, no resource checkboxes | D7 (for packages), D8, the "never transiently" clause of D33 | A Skills panel installs skills; cherry-picking out of a package and opting into its extensions belongs to a future Extensions panel; removes the manifest-mirror TODO |
| R4 | Browser upload deferred to v2 | D2 (upload), D12, D16, D22 | Staging RPC + two deps + archive validation for the rarest path; workaround: push to a repo or use a host path |
| R5 | "Update all" (`skills update -g -y` + `pi update --extensions`) replaces check + per-row update | D34 | `skills check` mutates and nothing is machine-readable; a native hash-check replicated CLI internals for the sake of a badge |
| R6 | No list cache; compute per request | D30 | `resolve()` + ~30 frontmatters is milliseconds |
| R7 | Project read-only group deferred | D3 (project part), D28, D32 | Read-only, needs a workspace picker + trust plumbing; the info is in the agent's slash picker already |
| R8 | Package installs spawn `pi install` (killable) then write the skills-only entry in one locked write | D15, the in-process-install option | A hung in-process npm install can't be tree-killed; the unfiltered window is one file write — accepted and documented |

Deferred additions from this review: upload (R4), project group (R7), per-row update check (R5),
Extensions-panel package API (R1).
