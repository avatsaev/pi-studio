# Build layering

Pi-Studio is an npm-workspaces monorepo built with TypeScript **project references** and `tsc -b`.
Packages are compiled in **dependency order**, and downstream packages consume the **emitted
declaration files** (`dist/*.d.ts`) of their dependencies — not the source.

## Dependency order

```
protocol   (depends on no workspace package)
  ├── relay       (standalone)
  ├── client      → protocol
  ├── server      → protocol
  └── cli         → protocol, client
ui-library (depends on no workspace package; built by Vite + `tsc -b`, not plain `tsc -b`)
  ├── workbench   → protocol, client, ui-library (built by Vite + `tsc -b`; the application as a library)
  │     └── web-client → workbench, ui-library (devDependencies; Vite aliases to the packages' `src`)
  └── ui-gallery  → ui-library (built `dist` via package `exports`; private)
```

`ui-library` emits `dist/` ESM entries + one prebuilt `dist/styles.css` with Vite library mode, and its
declarations with `tsc -b` (`emitDeclarationOnly`). `ui-gallery` consumes that built `dist`, so
`build:ui-library` must run before `build:ui-gallery`. The workbench has the same two-step build
(`vite build && tsc -b tsconfig.json tsconfig.vite.json`, then `scripts/check-dist.mjs`, which fails the
build if a dependency was bundled, a font inlined or a lazy chunk merged); it needs the built
declarations of protocol, client and ui-library. Root `npm run build` order: protocol → relay →
client → ui-library → workbench → server → web-client → ui-gallery → cli.

`web-client` is built by Vite (`build:web`, one `dist/web` target) on top of `tsc -b`. It does **not**
consume the workbench's or ui-library's built `dist`: `vite.config.ts` and the root `vitest.config.ts`
alias them to their sources (fast HMR, no library build needed to run dev or tests), so their built
`dist` is not consumed by web-client. `workbench`, `ui-library` and `web-client` are private workspace
packages (never published to npm; only protocol, relay, client, server and cli are). The desktop client
(`desktop/`) is outside this build; it also aliases workbench and ui-library to their sources.

## Scripts (root `package.json`)

| Script            | Builds                                               |
| ----------------- | ---------------------------------------------------- |
| `build:protocol`  | `protocol`                                           |
| `build:relay`     | `relay`                                              |
| `build:client`    | `client` (+ protocol via references)                 |
| `build:server`    | `server` (+ protocol)                                |
| `build:cli`       | `cli` (+ protocol, client)                           |
| `build:ui-library` | `ui-library` (Vite library build + declarations)    |
| `build:workbench` | `workbench` (Vite library build + declarations + `check-dist`) |
| `build:web-client` | `web-client` (Vite; resolves workbench + ui-library from source) |
| `build:ui-gallery` | `ui-gallery` (needs built ui-library `dist`)         |
| `build`           | all of the above, **in dependency order**, fail-fast |
| `clean`           | removes all `dist/` and `*.tsbuildinfo`              |

`npm run build` chains the per-package scripts with `&&`, so a type error in an upstream package
stops the build before any downstream package compiles.

## The hard rule

> **Always build owning packages before diagnosing cross-package type errors.**

A stale or missing `dist/*.d.ts` makes downstream type errors misleading. If you change a public
type in `protocol`, run `npm run build:protocol` (or `npm run build`) before trusting errors
reported in `client`/`server`/`cli`. Build layering is scripted (not manual) so this ordering is
always reproducible.
