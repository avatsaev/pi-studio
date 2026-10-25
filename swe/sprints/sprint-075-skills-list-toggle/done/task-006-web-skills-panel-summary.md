# Task 006 — Web: Settings → Skills panel (groups, rows, toggle, search)

- **Sprint:** sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented

A new Settings → Skills category (slice 1: list + toggle only — Remove/Update all/Install are NOT
rendered, per scope):

- **`settings-categories.ts`**: `SettingsCategoryCapabilities.skills` + a `{id:"skills", label:
  "Skills", icon: Puzzle, component: lazy(SkillsPanel), available: (caps) => caps.skills}` entry
  inserted right after `providers` (before `viewers`); `buildSettingsCategoryCapabilities` reads
  `features.skills`.
- **`skills-presentation.ts`** (pure, fully tested): `buildSkillGroups(skills, packages)` groups
  and orders exactly per spec — Pi skills (`agent_dir`), Agent Skills (`agents_dir`), one group per
  package in `packages[]` order (header from the matching `PiPackageInfo`), then Skill paths
  (`settings_path`); empty groups omitted; a `package`-origin skill whose `packageSource` has no
  matching entry, or any unrecognized `origin` string, still gets its own group appended at the
  end (never silently dropped — the wire's `origin` is an open string). Row state: `muted`/
  `toggleDisabled` on `shadowedBy`, badges (`shadowed by <shadowing entry's originLabel>`, `→
  <symlinkTarget>`, `manual only`, provenance source), `warnings[]` verbatim, and a
  `sharedPatternTooltip` for same-name rows under `agent_dir`/`agents_dir`. `packageHeaderBadges`
  (kind + curated/pinned). `filterSkillGroups` — case-insensitive name/description substring,
  drops groups left empty. `requiresCuratedConfirm` — true only for a `package`-origin skill whose
  resolved `PiPackageInfo.curated` is true. `skillErrorMessage` — the response's own `message` wins,
  else a known `error` code maps to a friendlier string, else the raw code renders verbatim.
- **`use-skills.ts`**: `useSkillsQuery()` — `listSkills()` under `rpcKeys.skillsList()`, with a
  connection-lifetime `onSkillsChanged` subscription that invalidates the query (any window's
  mutation or an external edit re-lists everywhere). `useSkillToggle()` — optimistic
  `setSkillEnabled`: patches the cached list via the exported `applyOptimisticSkillToggle` before
  the RPC resolves, replaces the cache with the daemon's real post-mutation document on success,
  rolls back to the exact prior cached value on a domain `{ok:false}` or a thrown error, surfacing
  the failure as that row's `rowErrors[path]` (inline, dismissible) rather than a toast — matches
  the spec's "Toggle fails | Row rolls back; inline error".
- **`SkillsPanel.tsx` + `.module.css`**: search box (`TextInput`), collapsible groups (local
  `Set<string>` collapse state, chevron rotation — `WorkspaceGroupHeader`'s pattern), package
  group headers show kind/curated/pinned `StatusBadge`s, rows show name/description (ellipsized
  via CSS `text-overflow`)/badges/a warning icon (`title` tooltip, native-title convention)/
  `Switch`, footnote "Changes apply to newly started agent sessions.", a `settings_unreadable` (or
  any other list-level domain failure) error state via `EmptyState` + `skillErrorMessage`, and a
  curated-package first-toggle `window.confirm` ("Pi-Studio will stop managing this package's
  updates.") gated by `requiresCuratedConfirm` + a session-local `confirmedCurated` `Set` so later
  toggles on the same package don't re-prompt. All colors/fonts are design tokens (`rem` font
  sizes, no fallback values); no hardcoded literals.
- **`rpc-keys.ts`**: `skillsList: () => ["skills", "list"]`.
- **`packages/web-client/AGENTS.md`**: Skills category documented in the settings category count
  (now three), a new `skills/` source-layout entry, and a new Invariants entry ("Skills panel
  toggle + curated confirm") documenting the optimistic-rollback + inline-error + curated-confirm
  contract and why it diverges from `viewer-settings-store.ts`'s toast-based rollback.

## Files created/changed

| File | Change |
|---|---|
| `packages/web-client/src/features/skills/skills-presentation.ts` | New — pure grouping/filter/badge/error-message logic |
| `packages/web-client/src/features/skills/skills-presentation.test.ts` | New — 23 tests |
| `packages/web-client/src/features/skills/use-skills.ts` | New — query hook + optimistic toggle hook |
| `packages/web-client/src/features/skills/use-skills.test.ts` | New — 4 tests on `applyOptimisticSkillToggle` |
| `packages/web-client/src/features/skills/SkillsPanel.tsx` | New — the panel component |
| `packages/web-client/src/features/skills/SkillsPanel.module.css` | New — design-token styling |
| `packages/web-client/src/features/settings/settings-categories.ts` | `skills` capability + category entry |
| `packages/web-client/src/features/settings/settings-categories.test.ts` | New capability-gating tests |
| `packages/web-client/src/lib/connection/rpc-keys.ts` | `skillsList()` key |
| `packages/web-client/AGENTS.md` | Source-layout `skills/` entry, settings category count, new Invariants entry |

## How it satisfies the scope

- Category hidden against a daemon without `skills` (capability-gated, mirrors `providers`, unlike
  the capability-independent `viewers`).
- Grouping/ordering/search/badges/mute/disable logic lives entirely in pure, unit-tested
  `skills-presentation.ts` — `SkillsPanel.tsx` only binds it to the DOM, per this package's
  no-jsdom testing convention (root Vitest config only discovers `.test.ts`, not `.test.tsx`).
- Toggle is optimistic with exact-prior-value rollback and an inline per-row error (never a toast),
  verified by `applyOptimisticSkillToggle`'s dedicated tests; the live RPC wiring itself
  (`useSkillToggle`) is a thin, untested (per convention) binding over that pure function plus
  `client.setSkillEnabled`/`queryClient`.
- `onSkillsChanged` is subscribed for the connection's lifetime and invalidates the query — any
  push re-lists with no user action.
- Curated-package first toggle confirms via `requiresCuratedConfirm` + `window.confirm`
  (this package's established confirm pattern — `ModelProvidersPanel.handleLogout`,
  `FileContextMenu`, `SessionContextMenu`, etc., all use `window.confirm` rather than a bespoke
  inline-confirm component).
- Remove/Update all/Install render nothing — no such controls exist in `SkillsPanel.tsx`.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/skills
 Test Files  2 passed (2)
      Tests  27 passed (27)

$ npx vitest run packages/web-client
 Test Files  106 passed (106)
      Tests  1394 passed (1394)
(includes theme/token-integrity.test.ts and theme/font-scale.test.ts — both green)

$ npm run build:web-client
> tsc -b && vite build
(clean typecheck + build; only pre-existing chunk-size warnings from unrelated vendor bundles)

$ npm run typecheck -w packages/web-client
(clean)
```

Also ran `npx oxfmt` and `npx oxlint` on every created/changed file (no diffs beyond the authored
edits; zero warnings after removing one transiently-unused type import caught by lint).

## Acceptance criteria

- [x] Category hidden when the daemon lacks `skills` — `settings-categories.test.ts` "Skills is
      capability-gated: absent without skills, present with it".
- [x] Rows grouped and ordered as specified; search filters across groups —
      `skills-presentation.test.ts`'s `buildSkillGroups`/`filterSkillGroups` describe blocks (group
      order, empty-group hiding, package-group ordering incl. unknown sources, unrecognized-origin
      fallback, name/description search, drop-empty-groups-on-filter).
- [x] Toggle off/on updates the row and survives a re-list; a failed toggle rolls back with an
      inline error — `use-skills.ts#useSkillToggle` patches the cache then replaces it with the
      daemon's real post-mutation document on success (survives the next render / an invalidation
      re-list identically since it's the same cache entry), and reverts to the exact snapshot +
      sets `rowErrors[path]` on `{ok:false}` or a thrown error; the pure optimistic-patch half is
      covered by `use-skills.test.ts`.
- [x] A `skills_changed` push re-lists without user action — `useSkillsQuery`'s connection-lifetime
      `onSkillsChanged` subscription calls `queryClient.invalidateQueries`.
- [x] Curated package: first toggle asks for confirmation — `requiresCuratedConfirm` tests plus
      `SkillsPanel.tsx`'s `confirmedCurated`-gated `window.confirm` call (not independently
      unit-tested per the no-jsdom convention — the gating predicate it calls is).

## Follow-ups/TODO(verify)

None for this task's scope. Remove/Update all/Install controls and their dialogs are sprint
076–077 work, deliberately not started here. Live verification against a production daemon (the
feature doc's own acceptance list — disabling a skill, curated package behavior end-to-end, etc.)
is out of this task's "build/typecheck/lint/test" definition of done and was not run (no running
daemon in this environment).
