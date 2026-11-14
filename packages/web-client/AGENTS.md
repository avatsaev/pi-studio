# `@av-pi-studio/web-client` — AGENTS.md

The **browser shell** for Pi-Studio: a Vite SPA that renders `@av-pi-studio/workbench` with a
browser host. The application itself (connection, sessions, chat/timeline, composer, files and
viewers, git, terminals, settings) lives in **`packages/workbench`** — read
`packages/workbench/AGENTS.md` for its layout, stores, hooks and invariants. The design system lives
in `packages/ui-library` (`packages/ui-library/AGENTS.md`, `packages/ui-library/DESIGN_SYSTEM.md`).

One Vite build target (`build:web` → `dist/web`); the unused `electron` target was removed in
sprint-092. The desktop client is a Tauri app in a separate repository that consumes the workbench
(`docs/desktop-client-handoff.md`).

---

## Dependency graph

```
web-client  →  @av-pi-studio/workbench  (the application — devDependency, resolved from source via Vite alias)
web-client  →  @av-pi-studio/ui-library (reset.css — devDependency, resolved from source via Vite alias)
```

`vite.config.ts` also aliases `@av-pi-studio/protocol`/`client` to their sources, so the whole SPA
builds from workspace sources with no package build in between. Must **not** import
`@av-pi-studio/server` or `@av-pi-studio/cli`, and must not gain Node-only runtime code.

**Packaging: every entry in `package.json` is a `devDependency`.** This package has no `main`, no
`exports`, no `bin` — it ships only the prebuilt static assets (`files: ["dist", ...]`), which the
CLI (`pi-studio ui`) and `docker/web-client.Dockerfile` serve. Keeping build tools as
`dependencies` once made every `npm install @av-pi-studio/cli` pull a 627 MB build-only tree.

---

## Source layout

```
index.html                 Vite entry (mounts #root); title/favicon rewritten by brandHtmlPlugin
public/                    favicon.svg and other static files copied as-is
vite.config.ts             the web build (dist/web): React plugin, brandHtmlPlugin, the workbench's
                           pdfjsAssetsPlugin (imported by relative source path,
                           ../workbench/vite/index.ts), `define`s for __APP_VERSION__/__BRAND_TITLE__,
                           worker format es, source aliases, manualChunks, /daemon-ws dev proxy
tsconfig.json              app config (DOM libs, react-jsx, noEmit), references ui-library + workbench
tsconfig.node.json         config for vite.config.ts
src/
  main.tsx                 imports workbench fonts.css → ui-library reset.css → ./global.css; builds
                           `createBrowserHost({ app: { title: __BRAND_TITLE__, version: __APP_VERSION__ },
                           pdf: { createWorker, assetBaseUrl: `${BASE_URL}pdfjs/` } })` and renders
                           `<StrictMode><Workbench host={host} /></StrictMode>`
  global.css               the `#root` rule only
  css-modules.d.ts         ambient CSS-module typings
  vite-env.d.ts            `vite/client` reference + ambient `__APP_VERSION__`/`__BRAND_TITLE__`
  brand/                   build-brand.ts (+ test) — build-time title/favicon override
                           (`PI_STUDIO_BRAND_TITLE`/`PI_STUDIO_BRAND_ICON`)
```

---

## Commands

```bash
npm run dev -w @av-pi-studio/web-client            # Vite dev server (WS proxy to daemon)
npm run typecheck -w @av-pi-studio/web-client      # tsc --noEmit
npm run build:web -w @av-pi-studio/web-client      # browser build (dist/web, absolute base)
```

Dev-server WS proxy env: `PI_STUDIO_DAEMON_HOST` / `PI_STUDIO_DAEMON_PORT` (default `127.0.0.1:6767`),
dev host/port via `WEB_CLIENT_DEV_HOST` / `WEB_CLIENT_DEV_PORT` (default `0.0.0.0:5173`).

Build-time brand override (both build:web and `npm run dev`, `src/brand/
build-brand.ts` — title + favicon only, unset ⇒ byte-identical default Pi-Studio output):
`PI_STUDIO_BRAND_TITLE` (default "Pi-Studio" — `index.html`'s `<title>` and `ConnectionBar.tsx`'s
brand label) and `PI_STUDIO_BRAND_ICON` (unset ⇒ the default `public/favicon.svg`; a path to a
`.svg`/`.png`/`.ico` file replacing the favicon — an unsupported extension or a missing file fails
the build).

Docker: `docker/web-client.Dockerfile` builds the `build:web` output into an `nginx:alpine` static
image (SPA fallback + optional same-origin `/daemon-ws` proxy set by `PI_STUDIO_DAEMON_UPSTREAM`);
`docker/docker-compose.yml` serves it on `:8080` alongside the daemon/relay. The daemon URL is
entered at runtime, never baked into the image.

Production builds (`build:web`) set `sourcemap: false` in `vite.config.ts` and run
`vite build` under `NODE_OPTIONS=--max-old-space-size=6144` — the largest vendor chunks (`vendor`,
`vendor-molviewer`) generate 8–18 MB sourcemaps each; with sourcemaps on, Rollup's chunk-rendering
phase blew past the default V8 old-space heap and OOM-killed every `.github/workflows/release.yml`
run from 2026-08-17 onward (`node --max-old-space-size` default is ~2 GB regardless of the runner's
actual RAM). Nothing in this repo consumes `.map` files (no Sentry/error-tracking upload) — they
were ~68% of `dist/web`'s total size for zero benefit. `npm run dev`'s dev-server sourcemaps are
unaffected (Vite's dev transform is separate from this `build.sourcemap` option).


---

## Invariants

- **Library CSS before app CSS.** `main.tsx` imports `@av-pi-studio/workbench/fonts.css`, then
  `@av-pi-studio/ui-library/reset.css`, then `./global.css`, so app rules win the cascade.
- **Resolved from source, not `dist/`.** The workbench, ui-library, protocol and client are
  aliased to their `src` in `vite.config.ts` (and the root `vitest.config.ts`), so HMR works across
  packages and no package build is needed for dev. Consequently web-client does not exercise the
  workbench's published `dist`; `packages/workbench/scripts/pack-smoke.sh` does.
- **One `pdfjs-dist` range.** The pdf.js worker is built here (`?worker` import in `main.tsx`) and
  the API runs in the workbench; `packages/workbench/src/host/pdf.test.ts` fails if the two
  packages' `pdfjs-dist` ranges differ.
- **No raw WebSockets** and **no Node-only APIs** — both are enforced inside the workbench (host
  seam guard); this shell only builds the browser host.
- **Build-time brand override (title + favicon only).** `PI_STUDIO_BRAND_TITLE`/
  `PI_STUDIO_BRAND_ICON` (`src/brand/build-brand.ts`, wired into `vite.config.ts`'s
  `brandHtmlPlugin`) rewrite `index.html`'s `<title>`/favicon `<link>` and bake
  `ConnectionBar.tsx`'s brand label via the `__BRAND_TITLE__` define, in both `npm run dev` and
  every build target. Both are optional and independent — unset ⇒ byte-identical default
  Pi-Studio output. This is intentionally narrower than the ui-library's accent-only
  `brandConfig` prop on `ThemeBoundary` (a runtime accent override; web-client wires none today):
  that seam has no build-time loader wired to it and is out of scope until a colors/logo
  override is actually requested — do not conflate the two or wire one through the other.
