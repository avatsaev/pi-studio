# Summary — sprint-090 task-001 ui-gallery

## What was built
`packages/ui-gallery` (private, never published): Vite + React 19 app, **no `resolve.alias`** — it imports `@av-pi-studio/ui-library` through the package `exports` (built `dist`). Entry imports `reset.css` then `styles.css` before its own CSS, wraps in `<ThemeBoundary storageKey="pi-ui-gallery-appearance">`, mounts `ToastViewport` + `Announcer`. One page: a six-button theme switcher and a section per primitive family (Button, IconButton/Icon/ShortcutHint, StatusDot/StatusBadge/Avatar/Spinner, TextInput/TextArea/Checkbox/Switch/Select/Combobox, Surface×5/Panel/Divider/ScrollArea/EmptyState, Dialog/Popover/Menu, toast + announcer). Thin token-guard test over gallery src (`design-tokens.test.ts`) — it caught a typo (`foreground-muted` vs `foregroundMuted`) on first run. Root: workspace, `build:ui-gallery`, and `build` now runs it after web-client; excluded from `publish.sh` (not in its package lists).

## Library change made to enable the switcher (not in the brief)
Consumers had NO way to change the theme: `ThemeBoundary` owns the controller privately and `useAppearance` is read-only (web-client itself never calls `setMode`). Added `useAppearanceControls()` → `{ setMode, updateSettings }` (+ `AppearanceControls` type), root barrel only (React). Needed for D5/AC4's "switching restyles live".

## Verification
- `npm run build:ui-gallery` ok (tsc + vite); gallery bundle has no `ui-library/src` reference and neither production warning string.
- `npx vitest run packages/ui-gallery` 2/2.
- Browser (`vite preview`, headless): all 7 sections render; clicking each of the six theme buttons changes `--pi-color-background` and the computed body background (light `#ffffff`, dark `#181B1A`, zinc `#18181b`, midnight `#161820`, claude `#1f1f1e`, ghostty `#282c34`); toast appears and shows "Saved"; appearance persisted under `pi-ui-gallery-appearance` while `pi-studio-appearance` stays untouched (D15); sentinel `--piui-stylesheet` = 1; **0 console warnings, 0 page errors** (closes s089/task-004's deferred browser check). Per-theme screenshots in `/tmp/gallery-<theme>.png` (not committed).

## Acceptance criteria
- [x] AC4: builds from `dist` with no alias, renders every exported primitive family, six themes switch live, toast works.

## Follow-ups
- `Menu` is only half exported: `MenuContent/Item/Group/Separator` ship, but the Radix `DropdownMenu.Root/Trigger` do not, so a consumer must also install `@radix-ui/react-dropdown-menu` (the gallery does, as web-client does). Left as is; the README should say so (noted to s090/task-005).
- `ScreenTitle` exists in `primitives/` but is not exported from the barrel (pre-existing).
