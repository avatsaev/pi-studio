# Architecture — Workbench Package (`@av-pi-studio/workbench`)

> **Status: built on `feat/workbench` (sprints 091, 092, 094, 095, 2026-11-14); first npm release with the merge of that branch**

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [workbench-host-adapter.md](workbench-host-adapter.md) (the platform seam this
> package is built around), [design-system.md](design-system.md) and
> [../grills/ui-library.md](../grills/ui-library.md) (the package this one sits on, and the
> packaging precedent), [client-app-runtime.md](client-app-runtime.md) (SDK layers)
> Consumer brief: [../../docs/desktop-client-handoff.md](../../docs/desktop-client-handoff.md)
> Decisions (2026-11-14): name `@av-pi-studio/workbench`; public surface is the whole app plus the
> shell regions; protocol follow-ups are a separate spec
> ([../features/desktop-client-protocol-followups.md](../features/desktop-client-protocol-followups.md));
> the `electron` build target is removed.

## Purpose

`packages/web-client` is an application: it publishes only a built SPA and exports nothing, so a
second client can reuse it only by loading the whole bundle unchanged. Pi Studio Desktop (a Tauri
app in a separate repository) needs the same UI and behaviour with a different shell and different
platform services.

This scope moves the application out of `web-client` into a publishable library,
`@av-pi-studio/workbench`. `web-client` becomes a thin browser shell over it. The desktop app
consumes the same package from npm. No feature is rewritten and no behaviour changes for the
browser client.

## Current state (verified in code, pi-studio 0.0.117)

- `packages/web-client/src`: 227 non-test `.ts`/`.tsx` files, about 31k lines; 109 test files, all
  `.test.ts`.
- The browser shell is `main.tsx` (23 lines), `app.tsx` (38), `providers/AppProviders.tsx` (15) and
  `routes/WorkspacePage.tsx` (62).
- Application code: `features/` (12 feature folders, 22k lines), `stores/` (16 module-level zustand
  stores), `hooks/`, `timeline/`, `lib/`, `viewer-plugins/`.
- Internal imports use the path alias `@web-client/*` → `src/*`: 452 imports in 151 files. The
  alias is configured in `vite.config.ts`, `tsconfig.json` and the root `vitest.config.ts`.
- `web-client/package.json` has only `devDependencies`, no `exports`, and `files: ["dist", …]`.
- `web-client` resolves `@av-pi-studio/ui-library` through an alias to its **source** in Vite and
  vitest, so the web build bundles the library from source.
- Build-time coupling inside application code:
  - `__APP_VERSION__` and `__BRAND_TITLE__` (Vite `define`), read by
    `features/connection/ConnectionBar.tsx`.
  - `import.meta.env.BASE_URL` and a `?worker` import, both in `features/files/pdfjs-runtime.ts`.
  - `import "katex/dist/katex.min.css"` in `timeline/markdown.tsx`.
  - pdf.js data directories are served and emitted by `pdfjsAssetsPlugin` in `vite.config.ts`.
  - The bundled terminal font (`theme/fonts.css`, `assets/fonts/`, about 1.2 MB of woff2).
- Two Vite targets: `VITE_TARGET=web` (`dist/web`) and `electron` (`dist/electron`). Nothing in the
  repository consumes `dist/electron`; the CLI and the Docker image use `dist/web`.
- `scripts/publish.sh` publishes `protocol relay client ui-library web-client server cli` in
  lockstep.

## Public contract

### Package

| Field | Value |
|---|---|
| Name | `@av-pi-studio/workbench` |
| Location | `packages/workbench` |
| Version | Lockstep with every other package |
| Publish order | `protocol relay client ui-library workbench web-client server cli` |
| Module format | ESM only, prebuilt, with `.d.ts` |
| Workspace dependencies | `@av-pi-studio/protocol`, `@av-pi-studio/client`, `@av-pi-studio/ui-library` |
| Peer dependencies | `react`, `react-dom` (`^19.0.0`) |
| Third-party runtime dependencies | Regular `dependencies`, never bundled into `dist` |

Dependency graph after the change:

```
protocol ──► client ──┐
ui-library ───────────┼──► workbench ──► web-client ──► cli
relay ──► client      │
```

`workbench` must not import `web-client`, `server`, `cli` or `relay` directly.

### Entry points (strict `exports` map)

| Export | Contents |
|---|---|
| `.` | The components, hooks and types listed below |
| `./styles.css` | Every CSS Module of the package, one file, class names prefixed `piwb-` |
| `./fonts.css` | Opt-in `@font-face` rules for the bundled terminal font; the font files ship next to it |
| `./vite` | A Vite plugin that serves and emits the pdf.js data directories (Node code, not bundled UI) |
| `./package.json` | |

Anything not listed is private. A deep import must fail to resolve.

### Root entry: components

| Export | Role |
|---|---|
| `Workbench` | The whole application: providers, boot sequence and the default shell. Props: `host?` |
| `WorkbenchProvider` | Providers only (theme, query cache, host). Props: `host?`, `children` |
| `WorkbenchBoot` | Runs the boot sequence. Renders nothing. Must be mounted once inside the provider |
| `WorkspaceShell` | The default three-column shell (today's `WorkspacePage`) |
| `ConnectionBar` | Top bar: brand, status, address and password fields, connect action, panel toggles, settings |
| `SessionList` | Left sidebar content |
| `PaneArea` | The split-pane and tab area (today's `TabPanelHost`) |
| `RightSidebar` | Right sidebar content (files, git) |
| `StatusBar` | Bottom bar |
| `OpenWorkspaceDialog` | Workspace picker dialog |
| `SettingsDialog` | The settings dialog, so a custom top bar can open it |

`Workbench` is exactly `WorkbenchProvider` + `WorkbenchBoot` + `WorkspaceShell`. A consumer that
wants its own layout composes the provider, the boot component and any regions itself; it also
mounts `ToastViewport` and `Announcer` from `@av-pi-studio/ui-library`, as `WorkspaceShell` does.

### Root entry: hooks for a custom shell

A consumer that replaces `ConnectionBar` or `WorkspaceShell` needs what those two read today.

| Export | Returns |
|---|---|
| `useConnection()` | `status`, `serverInfo`, `error`, `connect(options)`, `disconnect()` |
| `useShellLayout()` | Left and right sidebar `collapsed`, `width`, `toggle()`, `resize(delta)` |
| `useSettingsDialog()` | `open`, `openSettings()`, `closeSettings()` |

These are thin, read-mostly views over the existing `connection-store` and `ui-store`. The stores
themselves stay private.

### Root entry: host

`createBrowserHost`, the `WorkbenchHost` type and its member types. Defined in
[workbench-host-adapter.md](workbench-host-adapter.md).

### Stability

The exports above are the supported API. They follow the repository's lockstep versioning; a
breaking change is called out in the package `CHANGELOG.md`. Everything else may change without
notice.

## Behavior & algorithms

### What moves

| From `packages/web-client/src` | To `packages/workbench/src` |
|---|---|
| `features/`, `stores/`, `hooks/`, `timeline/`, `lib/`, `viewer-plugins/` | Same paths |
| `app.tsx` (`Boot`), `providers/AppProviders.tsx`, `routes/WorkspacePage.*` | `WorkbenchBoot`, `WorkbenchProvider`, `WorkspaceShell` |
| `test/reset-stores.ts` | Same path |
| `theme/fonts.css`, `assets/fonts/` | `fonts.css` and the font files |
| The application rules of `global.css` | Part of `styles.css` |
| `design-tokens.test.ts` | Runs over the workbench sources |
| `pdfjsAssetsPlugin` (from `vite.config.ts`) | `./vite` export |

Tests move with the code they test.

### What stays in `web-client`

- `index.html`, `public/`, `main.tsx`.
- `vite.config.ts`: the brand HTML plugin, the `manualChunks` policy, the dev proxy, the size
  ceiling, and a call to the workbench's pdf.js plugin.
- `brand/build-brand.ts` and its test (build-time title and favicon override).
- Construction of the browser host, including the pdf.js worker and the app title and version.

`main.tsx` after the change: import the stylesheets, build the browser host, render
`<Workbench host={…} />`. The resume triggers it attaches today become part of the browser host.

### Boot sequence

`WorkbenchBoot` keeps today's order, which is load-bearing:

```
connection boot            (initial connect intent, from the host)
agent deep-link boot       (pending target, from the host)
viewer settings boot
agent todos boot
pane layout boot           # MUST precede the two restore steps: an arriving tab consumes its pane claim
session restore
terminal restore
terminal exit watch
timeline reset watch
global shortcuts
```

### Imports inside the package

Workbench sources use **relative imports only**. The `@web-client/*` alias is removed everywhere
(Vite, `tsconfig.json`, vitest). Reason: emitted `.d.ts` files would keep the alias specifier, which
a consumer cannot resolve. `ui-library` already follows this rule.

### Build

```
vite build (library mode)
    entries: index
    format: ES
    externals: every dependency and peer dependency, including deep subpaths
    CSS Modules: scoped names `piwb-<Component>_<class>_<hash>`, one `styles.css`
    lazy imports: preserved as separate chunks
tsc: declarations only
copy: fonts.css + font files, verbatim
```

Constraints the build must meet:

- **No third-party code in `dist`.** Markdown, highlighting, diagrams, the terminal, the code
  editor, pdf.js and the molecule viewer stay bare imports for the consumer's bundler to place.
- **Lazy stays lazy.** Every `import()` that exists today (viewers, settings panels, panel
  registry, markdown's diagram block) is still a dynamic import in `dist`.
- **No inlined binary assets.** Vite's library mode inlines assets as base64; the terminal font
  must be copied as files instead, and no other font or worker may end up inlined.
- **No Vite-only constructs in `dist`.** `?worker`, `import.meta.env` and `define` constants must
  not survive into the published code; the host supplies those values (see the host spec).

### Development workflow

`web-client` resolves `@av-pi-studio/workbench` through an alias to the package **source** in Vite
and vitest, exactly as it does for `ui-library`. Consequences:

- Hot reload works across the package boundary.
- `web-client`'s production build bundles the workbench from source, so its output is not affected
  by library-mode packaging.
- The published `dist` is therefore not exercised by `web-client`. A separate smoke check covers it
  (see acceptance criteria).

### `electron` target removal

Remove `build:electron`, the `VITE_TARGET` switch, the relative-base branch and the
`import.meta.env.VITE_TARGET` define from `web-client`. `dist/web` stays the only output and keeps
its path, which `docker/web-client.Dockerfile` depends on.

### Release wiring

- `scripts/publish.sh`: add `workbench` to `PUBLISH_ORDER` (before `web-client`) and to
  `ALL_PACKAGES`.
- Root `package.json`: `build:workbench`, inserted in `build` after `build:ui-library`.
- Root `tsconfig.json` references and `web-client`'s `references`.
- `docker/web-client.Dockerfile`: copy `packages/workbench` (manifest and sources).
- npm: the package needs a placeholder publish and a Trusted Publisher entry for `release.yml`
  before the first release, as `ui-library` did. **This is a manual step by the maintainer.**
- A private, never-published workspace package must depend on workspace packages with `*`, not a
  version range (the 0.0.117 release failed on exactly this).

## Data & persistence touchpoints

No stored data changes shape. Storage keys keep their names (`pi-studio-pane-layout`,
`pi-studio-agent-todos-ui`, `pi-studio-appearance`), so an existing browser profile keeps its
layout across the upgrade. Where the keys are stored becomes a host decision.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| `Workbench` rendered with no `host` | The browser host is used |
| A region rendered outside `WorkbenchProvider` | Throws a clear error naming the missing provider |
| `WorkbenchBoot` mounted twice | Second instance is a no-op; dev builds warn once |
| Two `Workbench` instances in one document | Unsupported: stores are module singletons. Dev builds warn once |
| Consumer omits `styles.css` | Unstyled but functional; documented in the README |
| Consumer omits `fonts.css` | Terminal falls back to the system monospace stack |
| Consumer omits the `./vite` plugin | PDF viewing degrades as defined in the host spec; nothing else is affected |
| Deep import of a private module | Fails to resolve |

## Dependencies on other specs

- [workbench-host-adapter.md](workbench-host-adapter.md): every browser-bound call in the moved
  code goes through the host.
- [../grills/ui-library.md](../grills/ui-library.md): build, CSS naming, strict `exports` and
  dev-alias decisions are reused, not re-decided.
- [viewer-plugin-system.md](viewer-plugin-system.md): `viewer-plugins/` moves unchanged.
- [../features/workspace-ui.md](../features/workspace-ui.md),
  [../features/workspace-split-panes.md](../features/workspace-split-panes.md): behaviour that must
  be identical before and after.

## Acceptance criteria

Checked in sprint 095 task-003 (2026-11-14); evidence per criterion in `swe/notes/workbench-acceptance.md`.
Criterion 5 holds for build, typecheck, lint and tests; `fmt:check` has pre-existing failures outside this branch (see the note).
Criterion 12 is ticked on the rehearsal recorded there.

- [x] `packages/workbench` exists, builds with `npm run build:workbench`, and its `dist` contains
      `index.js`, `index.d.ts`, `styles.css`, `fonts.css`, the font files and the `vite` entry.
- [x] `packages/web-client/src` contains only the shell: `main.tsx`, `brand/`, type declarations.
      No `features/`, `stores/`, `hooks/`, `timeline/`, `lib/` or `viewer-plugins/` directory
      remains there.
- [x] No source file in the repository imports `@web-client/`.
- [x] Every test that existed before the move still exists and passes; the total test count does
      not drop.
- [x] `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.
- [x] `web-client`'s `dist/web` loads and behaves as before: connect to a dev daemon, run a mock
      turn, split a pane, open a terminal, open a file. Total `dist/web` size stays within 1% of
      the pre-change build.
- [x] `dist` of the workbench contains no third-party module code, no base64 font or worker, and no
      `?worker`, `import.meta.env`, `__APP_VERSION__` or `__BRAND_TITLE__`.
- [x] Every dynamic import present in the sources is still a dynamic import in `dist`.
- [x] A consumer built from the **packed tarball** (no alias, outside the workspace resolution)
      renders `Workbench`, connects to a dev daemon and streams a mock turn, with no console
      errors.
- [x] The same consumer can render a custom shell from `WorkbenchProvider`, `WorkbenchBoot`,
      `SessionList` and `PaneArea`, and connect through `useConnection()`.
- [x] `build:electron` and `VITE_TARGET` are gone; the web-client Docker image still builds and
      serves.
- [x] `scripts/publish.sh --dry-run` succeeds on a clean tree with the new package in the order.
- [x] Docs are updated in the same change: `packages/workbench/{README.md,AGENTS.md,CHANGELOG.md}`,
      `packages/web-client/{README.md,AGENTS.md}`, root `AGENTS.md` and `README.md`,
      `docs/build-layering.md`, `docs/desktop-client-handoff.md` (replace "planned" with the real
      API).

## TODO(verify)

Resolved by the packaging spike (2026-11-14, `swe/notes/workbench-packaging-spike.md`):

- ~~katex stylesheet~~ — stays a bare `import "katex/dist/katex.min.css"` in `dist` because `katex`
  is an external `dependency`; nothing is inlined. The consumer's bundler emits katex's fonts.
- ~~Consumer pre-bundling~~ — a plain Vite consumer needs no `optimizeDeps` setting.
- ~~Smoke consumer form~~ — a `pack-smoke.sh` script in the `ui-library` style with file-level
  assertions; the run-time check is a recorded manual or agent-driven browser load (no
  browser-automation dependency is added).
- ~~`SettingsDialog` as a public export~~ — a lazily loaded component exported from the entry keeps
  its own chunk.

Also established by the spike: assets referenced from bundled CSS are inlined as base64 (hence the
verbatim font copy), `process.env.NODE_ENV` stays unreplaced in `dist` and the consumer replaces it,
the workbench `tsconfig.json` must use `"jsx": "react-jsx"`, and the build must use the
package-local Vite 6 (the root `node_modules/vite` is 5.x).

Still open:

- **Region names.** `PaneArea` and `WorkspaceShell` are new public names for `TabPanelHost` and
  `WorkspacePage`. Confirm before the first publish, since names are hard to change afterwards.
