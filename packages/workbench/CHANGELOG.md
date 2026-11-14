# Changelog

Breaking changes get a dated entry here. Versions move in lockstep with the other
`@av-pi-studio/*` packages (0.0.x).

## Unreleased — initial release

Extracted from `@av-pi-studio/web-client` (sprints 091–094, branch `feat/workbench`).

### Public surface

- Components: `Workbench`, `WorkbenchProvider`, `WorkbenchBoot`, `WorkspaceShell`, `ConnectionBar`,
  `SessionList`, `PaneArea`, `RightSidebar`, `StatusBar`, `OpenWorkspaceDialog`, `SettingsDialog`
  (lazy).
- Hooks: `useConnection`, `useShellLayout`, `useSettingsDialog`.
- Host: `createBrowserHost` and `WorkbenchHost` with `app`, `storage`, `clipboard`, `dialogs`,
  `links`, `launch`, `connection`, `files` and optional `pdf`.
- Entries: `.`, `./styles.css` (`piwb-` class prefix), `./fonts.css`, `./vite`
  (`pdfjsAssetsPlugin`).
- Peers: `react`, `react-dom` ^19. Vite consumers; one instance per document.
