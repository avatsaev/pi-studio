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
  ├── web-client  → protocol, client, ui-library (devDependency; Vite alias to ../ui-library/src)
  └── ui-gallery  → ui-library (built `dist` via package `exports`; private)
```

`ui-library` emits `dist/` ESM entries + one prebuilt `dist/styles.css` with Vite library mode, and its
declarations with `tsc -b` (`emitDeclarationOnly`). `ui-gallery` consumes that built `dist`, so
`build:ui-library` must run before `build:ui-gallery`. Root `npm run build` order: protocol → relay →
client → ui-library → server → web-client → ui-gallery → cli.

`app` and `desktop` are built by Metro/Electron respectively and are outside this `tsc -b` graph.

## Scripts (root `package.json`)

| Script            | Builds                                               |
| ----------------- | ---------------------------------------------------- |
| `build:protocol`  | `protocol`                                           |
| `build:relay`     | `relay`                                              |
| `build:client`    | `client` (+ protocol via references)                 |
| `build:server`    | `server` (+ protocol)                                |
| `build:cli`       | `cli` (+ protocol, client)                           |
| `build:ui-library` | `ui-library` (Vite library build + declarations)    |
| `build:web-client` | `web-client` (Vite; resolves ui-library from source) |
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
