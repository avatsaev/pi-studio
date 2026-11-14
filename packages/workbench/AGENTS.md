# `@av-pi-studio/workbench` — AGENTS.md

The Pi-Studio client application as a library, consumed by `packages/web-client` (browser shell)
and the separate-repo desktop app. Spec: `swe/architecture/workbench-package.md`,
`swe/architecture/workbench-host-adapter.md`. Plan: sprints 091–095 in `swe/sprints/PLAN.md`, all on
the `feat/workbench` branch, merged once.

**Current state (sprint 092, in progress):** the application code has moved in from
`packages/web-client/src` with `git mv`, paths unchanged. `src/index.ts` exports the shell
components (`Workbench`, `WorkbenchProvider`, `WorkbenchBoot`, `WorkspaceShell`) and, temporarily,
`attachResumeTriggers` for `web-client`'s `main.tsx`; the full public API is settled in sprint 094. The moved code still contains Vite-only constructs (`__APP_VERSION__`,
`__BRAND_TITLE__`, a `?worker` import, `import.meta.env.BASE_URL`; declared in `src/vite-env.d.ts`)
that work only because `web-client` compiles this package from source with its own Vite config —
sprint 093 routes them through the host. Not yet in `scripts/publish.sh` or the web-client
Dockerfile (sprint 095) — it must not be published before the branch is complete.

Feature-level documentation (stores, hooks, invariants) is still in `packages/web-client/AGENTS.md`
until sprint 094 moves it here.

---

## Source layout

```
src/
  index.ts             Entry (shell components; temporary `attachResumeTriggers`).
  shell/               `Workbench` = `WorkbenchProvider` + `WorkbenchBoot` + `WorkspaceShell`.
    WorkbenchProvider.tsx  ThemeBoundary + QueryClientProvider; imports `global.css`.
    WorkbenchBoot.tsx      Boot hooks in their load-bearing order; renders nothing.
    WorkspaceShell.tsx     Default 3-column shell (+ `.module.css`); mounts ToastViewport/Announcer.
  global.css           Application-wide rules (drag-guard iframe rule; `lib/drag-guard.test.ts` pins it).
  fonts.css  fonts/    Bundled terminal font faces (Cascadia Mono NF, two unicode-range files) + license.
                       `exports["./fonts.css"]` points at `dist/fonts.css`, which the build copies
                       from sprint 094 on; until then only the source alias resolves it.
  features/ stores/ hooks/ timeline/ lib/ viewer-plugins/
                       The application (moved from web-client, layout unchanged).
  test/                Shared test helpers (`reset-stores.ts`).
  design-tokens.test.ts  Token guard over this package's sources.
  css-modules.d.ts     Ambient `*.module.css` / `*.css` typings.
  vite-env.d.ts        TEMPORARY Vite-only ambient declarations (removed in sprint 093).
vite.config.ts         Vite 6 library mode: ES, every dependency/peer external (deep subpaths too),
                       CSS Modules scoped as `piwb-<Component>_<class>_<hash>`, one `styles.css`.
tsconfig.json          Declarations only (`emitDeclarationOnly`), `react-jsx`, tests excluded.
```

## Build

`npm run build:workbench` (= `vite build && tsc -b` in this package) emits `dist/index.js` and
`dist/index.d.ts`. It runs in the root `npm run build` right after `build:ui-library`.

Always build through the package's own `vite` devDependency (Vite 6): the repo root
`node_modules/vite` is 5.x. Packaging rules established by the spike
(`swe/notes/workbench-packaging-spike.md`): any third-party module the workbench imports must be a
`dependency` so it stays external; assets referenced from bundled CSS get inlined as base64, so fonts
are copied verbatim instead (sprint 094).

## Development workflow

`web-client` (Vite + its tsconfig reference) and the root `vitest.config.ts` resolve
`@av-pi-studio/workbench` to `src/index.ts` through an alias, as they do for `ui-library`. The
published `dist` is therefore not exercised by `web-client`; a packed-tarball smoke covers it
(sprint 094).

## Invariants

- Relative imports only inside the package (no `@web-client/*` alias): emitted `.d.ts` files must
  resolve for a consumer.
- Workspace dependencies use `^<lockstep version>` (this package is published). A private workspace
  package would use `*`.
