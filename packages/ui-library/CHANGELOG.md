# Changelog

Breaking changes get a dated entry here. Versions move in lockstep with the other
`@av-pi-studio/*` packages (0.0.x).

## 2026-11-14 — 0.0.115 (initial release)

Extracted from `@av-pi-studio/web-client`.

### Public surface

- `@av-pi-studio/ui-library` — components (`Button`, `IconButton`, `Dialog`, `Menu*`, `Popover*`,
  `Panel`, `Select`, `Switch`, `Checkbox`, `TextInput`, `TextArea`, `Icon`, `Spinner`, `StatusDot`,
  `StatusBadge`, `Avatar`, `EmptyState`, …), `ThemeBoundary` (`store`, `storageKey` default
  `pi-studio-appearance`, `brandConfig`), `useAppearance`, `ToastViewport`, `Announcer`,
  `useToastStore`, `speak`, `localStorageKvStore`.
- `/theme` (incl. `findTokenProblems`), `/ui`, `/brand`, `/breakpoints` subpath entries.
- CSS entries: `/styles.css` (tokens + component styles, `piui-` class prefix) and `/reset.css`.
  Import library CSS before your own.
- Peer dependencies: `react`, `react-dom` ^19. Targets Vite web SPAs and Electron renderers
  (no SSR, no React Native). Dev-only console warnings rely on the consumer's bundler folding
  `process.env.NODE_ENV`.
- One `ThemeBoundary` per document; one copy of the library per app (toast/announcer stores are
  module singletons).
