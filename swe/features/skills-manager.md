# Feature — Skills Manager (Settings → Skills)

> **Status: implemented** (sprints 075 list/toggle, 076 remove/update-all, 077 install; live-verified
> direct and over the relay).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/pi-resource-management.md](../architecture/pi-resource-management.md)
> (backend, wire contract, algorithms), [provider-auth-rpc.md](provider-auth-rpc.md) § web-client
> Settings (category registry + panel pattern), [extensions-manager.md](extensions-manager.md)
> (Phase B superseded)
> Source brief: [../grills/skills-manager.md](../grills/skills-manager.md) — `Dnn` cites decisions,
> `Rn` the post-scope simplifications

## Purpose

Let a Pi-Studio user — including a relay-remote browser with no shell on the daemon host — see every
skill the daemon's Pi loads and **enable, disable, remove, install, and update** them from Settings.
Today this needs the host shell (`npx skills`, `pi install`, `pi config`, hand-edited
`settings.json`); the UI only shows skills inside a live agent's slash-command picker.

Scope: global (user) skills. Changes affect **newly started** agent sessions only (D4).

Non-goals / deferred: browser upload (R4), project-scope skills in any form (R7), per-skill
update check (R5), picking skills out of a Pi package or opting into its extensions (R3 — the
package's extensions/prompts/themes are always disabled when installed from here), direct
SKILL.md/archive URLs, agent restart, `pi-studio skills …` CLI, trust actions, an Extensions panel.

## Public contract

### Wire
[pi-resource-management.md § Wire family](../architecture/pi-resource-management.md):
`skills_list / preview / install / set_enabled / remove / update_all_request` + `skills_changed`.
Feature flag `skills` (`packages/protocol/src/client-capabilities.ts`). `detectSkillSource(input)`
exported from `@av-pi-studio/protocol`.

### Client SDK (`packages/client/src/pistudio-client.ts`)

| Method | Wraps |
|--------|-------|
| `hasSkillsCapability()` | `serverInfo.features.skills` |
| `listSkills()` | `skills_list_request` |
| `previewSkillSource(source)` | `skills_preview_request` (150 s) |
| `installSkills({source, skills?, replace?})` | `skills_install_request` (660 s) |
| `setSkillEnabled(path, enabled)` | `skills_set_enabled_request` |
| `removeSkill({path} \| {packageSource})` | `skills_remove_request` (660 s) |
| `updateAllSkills()` | `skills_update_all_request` (1 300 s) |
| `onSkillsChanged(cb)` | `skills_changed` push; returns unsubscribe |

### Web client

| Surface | Addition |
|---------|----------|
| `features/settings/settings-categories.ts` | `SettingsCategoryCapabilities.skills`; `{ id: "skills", label: "Skills", icon, component: lazy(SkillsPanel), available: (caps) => caps.skills }` after `providers` |
| `features/skills/SkillsPanel.tsx` (+ `.module.css`) | Toolbar, groups, rows, footnote |
| `features/skills/InstallSkillDialog.tsx` (+ css) | Source → (preview & pick for repos) → running → results |
| `features/skills/skills-presentation.ts` (+ test) | Pure: grouping, row state, labels, error-string → message |
| `features/skills/use-skills.ts` | Query + `onSkillsChanged` invalidation + mutations |

No new dependencies.

## Behavior & algorithms

### Panel (D5, D19)

```
Toolbar: [Search…]  [Update all]  [Install skill…]
Groups (collapsible; empty hidden):
    "Pi skills"          origin agent_dir       (<agentDir>/skills)
    "Agent Skills"       origin agents_dir      (~/.agents/skills — shared with other agents on this host)
    "<package source>"   one per package; header: kind badge, [curated] [pinned], Remove package
    "Skill paths"        origin settings_path
Row: name · description (ellipsized) · badges · toggle · [Remove]
    badges: "shadowed by <originLabel>" (toggle disabled, muted), "→ <symlinkTarget>",
            "manual only" (disableModelInvocation), warnings (icon + tooltip), provenance source
    Remove iff removable
Footnote: "Changes apply to newly started agent sessions."
```

Search filters by name/description client-side.

### Data flow

```
useSkills(): query ["skills"] → listSkills(); onSkillsChanged → invalidate
    install/remove/update replace query data with the response (never optimistic);
    toggle is optimistic, rolls back on {ok:false}
```

### Toggle (D10, D24)

`setSkillEnabled(path, enabled)`. First toggle on a `curated` package's skill shows an inline
confirm: "Pi-Studio will stop managing this package's updates." Rows sharing a pattern (same name
under Pi skills and Agent Skills) change together; tooltip: "Pi applies this setting to every
'<name>' skill folder."

### Install dialog (D6, D7)

```
step "source": text field; live label from detectSkillSource:
    "npm package" | "git package" | "Agent Skills repo" | "Folder on daemon host" | "Unrecognized"
    package kinds show: "Installs the package's skills only; its extensions stay disabled.
        Pi packages run with full system access — review the source before installing."
    Next:
        skills_repo | local_path → previewSkillSource → step "pick"
        pi_npm | pi_git          → step "running" directly
step "pick": PreviewSkill rows: checkbox (default checked iff valid), name, description, warnings;
    invalid → disabled with reason; exists → "Already installed — replace" checkbox (sends replace)
    Install button shows the exact source string
step "running": "Installing… this may take several minutes"; cannot submit twice; closing does
    not cancel (queue continues; result arrives via skills_changed)
step "results": per ItemResult ✓/✗ with message and bounded stderr (collapsible)
```

### Remove (D9, D20)

Confirm text by origin: symlink → "Removes the link only; <target> is kept."; Agent Skills with
provenance → "Removes '<name>' for every agent on this machine."; plain dir → "Deletes <path>.";
skill path → "Removes the Pi settings entry that provides <path> (other skills from the same folder stop loading too); files are kept." **Remove package** lists the package's skill
count before calling `removeSkill({packageSource})`.

### Update all (R5)

Toolbar **Update all** → confirm ("Updates every Agent Skills skill and every unpinned Pi package;
may take several minutes") → `updateAllSkills()` → two result rows (Agent Skills, Pi packages) →
re-list. No per-row check or update in v1.

## Data & persistence touchpoints

None owned by this feature. Panel state (search, collapsed groups) is component state.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| `skills` flag absent (old or dev daemon) | Category absent; nothing errors |
| `settings_unreadable` | Error state naming `<agentDir>/settings.json`; actions disabled |
| Toggle fails | Row rolls back; inline error |
| Preview/install/update `timeout` | "Timed out"; list re-fetched |
| Private repo without host credentials | Fails fast with the git error (no hang) |
| Another window or host-side `pi config` / `npx skills` mutates | `skills_changed` → re-list; open dialogs keep their state |
| Two installs from two windows | Second shows "Queued…" |
| Unknown `error`/`origin` strings | Rendered verbatim, neutral styling |
| Relay transport | No special handling |

## Dependencies on other specs

- `architecture/pi-resource-management.md` — every daemon behaviour referenced here.
- `provider-auth-rpc.md` / sprint-065 — Settings registry and dialog conventions.

## Acceptance criteria

Against a production daemon (`npm start`):

- [ ] Settings shows **Skills**, listing every skill Pi would load globally, grouped by origin,
      with name, description, and correct enabled state; against `npm run dev:daemon` the category
      is absent and nothing errors.
- [ ] Disabling a skill writes exactly the filter `pi config` would write; a newly spawned agent's
      `get_commands` no longer lists `/skill:<name>`; `pi config` on the host shows it unchecked;
      re-enabling reverses both.
- [ ] Previewing `vercel-labs/agent-skills` and installing two picked skills puts only those two in
      `~/.agents/skills`, records them in `.skill-lock.json`, and shows them without reload.
- [ ] Installing an `npm:` Pi package that ships skills and an extension: its skills load in a new
      agent; its extension does not; the package row shows `filtered`.
- [ ] A `git:` Pi package installs the same way.
- [ ] An absolute daemon-host path installs as a `settings.skills` entry without copying; Remove
      drops the entry and keeps the files.
- [ ] Removing a symlinked skill unlinks it and keeps the target; removing a lock-tracked skill
      updates `.skill-lock.json`; packaged skills offer no per-skill Remove; Remove package removes
      the `settings.json` entry.
- [ ] A duplicate name shows the loser "shadowed by …".
- [ ] `npx skills add …` or `pi config` on the host updates the panel in every open window.
- [ ] Two clients installing at once both complete (FIFO); a nonexistent package fails within the
      timeout with bounded stderr and the list matches disk.
- [ ] Logs for a git source with embedded credentials show it redacted.
- [ ] Update all brings an outdated Agent Skills skill and an outdated unpinned package current;
      a pinned package is untouched.
- [ ] Gates: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, scoped `oxfmt`; docs
      updated: package `AGENTS.md`s (protocol, client, server, web-client), root `AGENTS.md`
      (protocol overview bullet, Pi-bump checklist adds `toggle-patterns.ts`, Node floor), root
      `package.json` `engines.node` → `>=22.20`, `MAIN-SCOPE.md` index.

## TODO(verify)

- [ ] Measured-by metric — owner: avatsaev (non-blocking).
- Backend: see [pi-resource-management.md § TODO(verify)](../architecture/pi-resource-management.md).
