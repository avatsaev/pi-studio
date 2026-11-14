# `@av-pi-studio/workbench` — AGENTS.md

The Pi-Studio client application as a library, consumed by `packages/web-client` (browser shell)
and the separate-repo desktop app. Spec: `swe/architecture/workbench-package.md`,
`swe/architecture/workbench-host-adapter.md`. Plan: sprints 091–095 in `swe/sprints/PLAN.md`, all on
the `feat/workbench` branch, merged once.

**Current state (sprint 093 done):** the application code lives here (moved from
`packages/web-client/src` with `git mv`, paths unchanged). `src/index.ts` exports the shell
components (`Workbench`, `WorkbenchProvider`, `WorkbenchBoot`, `WorkspaceShell`), the host types
and `createBrowserHost`; the
full public API is settled in sprint 094. All browser-bound code is behind the host adapter (see
"Host adapter" below; `src/host/host-guard.test.ts` fails the build if `localStorage`,
`window.confirm`, `navigator.clipboard`, `new WebSocket(` and the like reappear outside
`host/browser-*.ts`); no source uses a Vite-only construct (`?worker`, `import.meta.env`,
build-time `define`s). Not yet in `scripts/publish.sh` (sprint 095) — it must not be published
before the branch is complete.

Feature-level documentation (stores, hooks, invariants) is still in `packages/web-client/AGENTS.md`
until sprint 094 moves it here.

---

## Host adapter

Spec: `swe/architecture/workbench-host-adapter.md`. `src/host/`:

- `types.ts` — `WorkbenchHost`. Members so far: `app` (`{title, version}`, shown in the connection
  bar), `storage` (ui-library's **synchronous** `KeyValueStore`), `clipboard.writeText` (rejects on
  failure), `dialogs.confirm/alert/prompt` (promises; dismissal → `false`/`null`),
  `links.openExternal?`, `launch` (`initialConnect()` → `ConnectIntent | null`, read once at
  boot; `agentDeepLink.{current, subscribe, consume}`), `connection`
  (`createTransport(target, {password})` → `Transport | undefined`, called once per `connect()`;
  `timers` for `ReconnectionManager`; `onResume(listener)`) and `files` (`upload(dir, source)`,
  `saveToDisk(path)`, `openForView(path)` → `ViewableFile {url, mimeType?, fileName?, release()}`,
  optional `pickUploads()`; `UploadSource` = `{name, size?}`, a `File` satisfies it) and the
  optional `pdf` (`createWorker()`, `assetBaseUrl`; absent → `PdfUnavailableError` → the PDF
  viewer's error state). The browser host takes `pdf` as a `createBrowserHost` option because only
  the application bundle can build the worker.
- `browser-files.ts` — the browser `files` (today's in-memory paths: `File` bytes for upload,
  download + anchor click for save, `Blob` object URL + idempotent revoke for view), reaching the
  live connection only through `lib/connection/live-file-transfer.ts`'s `currentFileTransfer()`.
  Every viewer, `lib/inline-image-cache.ts` and every "Download" action (`features/files/
  SaveFileButton.tsx`, the explorer menu, the PDF toolbar) go through it; the explorer's upload
  flow is `features/files/upload-sources.ts`. Only in-memory *byte reads* (HTML preview assets)
  still call `FileTransferClient.download` directly.
- `browser-connection.ts` — the browser `connection`: relay transport for a relay pairing link,
  `pi-studio.bearer.<pw>` subprotocol socket with a password, else `undefined`; `timers` from
  `browser-worker-timers.ts` (worker-backed, `setTimeout` fallback); `onResume` = `visibilitychange`
  (to visible) + `online`. `WorkbenchBoot` subscribes once with
  `lib/connection/resume-handler.ts`'s `createResumeHandler()` (probe/reconnect decision unchanged).
  A throwing `createTransport` fails that `connect()` and sets the store's `error`.
- `browser-launch.ts` — the browser `launch`: `parseBrowserConnectIntent` (pure; `?host=&password=
  &cwd=&connect=1`, `?pair=` and an own-URL `#offer=` always connect) and `#agent=<id>` via
  `hashchange`, consumed with `history.replaceState`. `hooks/use-connection.ts`'s
  `applyConnectIntent` pre-fills the bar and connects to its fields (no password with a pairing
  link); `hooks/use-agent-deep-link-boot.ts`'s `startAgentDeepLinkBoot` feeds the pending-target store.
- `install.ts` — `installHost` (first install wins; the same host again is silent, a different one
  is ignored with one dev-only warning), `getHost()` (the installed host, else a lazily created
  browser host), `onHostInstalled` (for module-level stores that read storage at module load),
  `resetHostForTests`.
- `browser-host.ts` — `createBrowserHost({ app })`: `localStorageKvStore`, `copyText` from
  `browser-clipboard.ts` (Clipboard API with the `execCommand` fallback), `window.confirm/alert/prompt`
  wrapped in promises, no `openExternal`. Default app `{title: "Pi-Studio", version: ""}` (the bar
  hides an empty version).
- `external-link.tsx` — `ExternalAnchor` (an `<a target="_blank">` whose click goes to
  `links.openExternal` when the host has one; middle-click/copy-link stay native) and
  `routeExternalLinkClick`.

Dialog-gated actions call `await getHost().dialogs.*` in their (async) handlers; message texts are
unchanged. The sidebar's rename and workspace-delete flows live in
`features/sessions/session-actions.ts` so they are testable outside React. Tests use
`test/test-host.ts`'s `createTestHost` (in-memory storage, scripted dialog answers, recorded calls).

Rules: non-React code reads the host with `getHost()` **at call time**, never captures it at module
load. `WorkbenchProvider` installs its `host` prop (or the fallback) synchronously in a `useState`
initializer, before children render, and hands `host.storage` to `ThemeBoundary`. Storage keys:
`pi-studio-pane-layout`, `pi-studio-agent-todos-ui` (re-read on install via `onHostInstalled`),
`pi-studio-appearance` (ThemeBoundary).

---

## Source layout

```
src/
  index.ts             Entry (shell components, host types + `createBrowserHost`).
  host/                Host adapter: types, install/getHost, browser host + `browser-*` members
                       (clipboard, launch, connection, worker timers), `external-link.tsx`, tests.
  env.d.ts             Ambient `process.env.NODE_ENV` (dev-only warnings; the consumer's bundler replaces it).
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
vite/pdfjs-assets.ts   `pdfjsAssetsPlugin()` — Node-side Vite plugin serving/emitting pdf.js data
                       under `<base>/pdfjs/`; typed structurally (no `vite` type import). Becomes
                       the `./vite` entry in sprint 094; web-client imports it by relative path.
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
