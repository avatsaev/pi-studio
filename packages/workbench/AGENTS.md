# `@av-pi-studio/workbench` — AGENTS.md

The Pi-Studio client application as a library, consumed by `packages/web-client` (browser shell)
and the separate-repo desktop app. Spec: `swe/architecture/workbench-package.md`,
`swe/architecture/workbench-host-adapter.md`. Plan: sprints 091–095 in `swe/sprints/PLAN.md`, all on
the `feat/workbench` branch, merged once.

**Current state (sprint 091):** an empty scaffold. `src/index.ts` exports only
`WORKBENCH_PACKAGE_NAME`. The application code moves in during sprint 092. Not yet in
`scripts/publish.sh` or the web-client Dockerfile (sprint 095) — it must not be published before the
branch is complete.

---

## Source layout

```
src/
  index.ts         Entry (placeholder export).
  index.test.ts    Entry smoke test.
vite.config.ts     Vite 6 library mode: ES, every dependency/peer external (deep subpaths too),
                   CSS Modules scoped as `piwb-<Component>_<class>_<hash>`, one `styles.css`.
tsconfig.json      Declarations only (`emitDeclarationOnly`), `react-jsx`, tests excluded.
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
