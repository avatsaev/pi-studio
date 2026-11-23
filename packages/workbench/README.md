# @av-pi-studio/workbench

The Pi-Studio client application as a library: connection, sessions, chat and timeline, composer,
files and viewers, git, terminals and settings, for any React 19 shell that talks to a Pi-Studio
daemon. `@av-pi-studio/web-client` (the browser app) and the desktop app are both thin shells over
it.

- ES modules only, React 19 peer, built for **Vite** consumers (lazy chunks, a pdf.js worker built
  by your bundler). No SSR, no React Native.
- **One instance per document.** Application state is module-level; a second `<Workbench>` shares
  it (development builds warn).
- The supported API is exactly the exports listed under [Public API](#public-api). Deep imports are
  rejected by the `exports` map.

## Quickstart (Vite + React)

```bash
npm install @av-pi-studio/workbench @av-pi-studio/ui-library react react-dom pdfjs-dist
```

`vite.config.ts`:

<!-- smoke:vite.config.ts -->
```ts
import react from "@vitejs/plugin-react";
import { pdfjsAssetsPlugin } from "@av-pi-studio/workbench/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), pdfjsAssetsPlugin()],
  worker: { format: "es" },
});
```
<!-- /smoke:vite.config.ts -->

`src/main.tsx`:

<!-- smoke:main.tsx -->
```tsx
import "@av-pi-studio/workbench/fonts.css";
import "@av-pi-studio/ui-library/reset.css";
import "@av-pi-studio/ui-library/styles.css";
import "@av-pi-studio/workbench/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserHost, Workbench } from "@av-pi-studio/workbench";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

const host = createBrowserHost({
  app: { title: "My Pi-Studio", version: "1.0.0" },
  pdf: {
    createWorker: () => new PdfWorker({ name: "pdfjs" }),
    assetBaseUrl: `${import.meta.env.BASE_URL}pdfjs/`,
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workbench host={host} />
  </StrictMode>,
);
```
<!-- /smoke:main.tsx -->

Stylesheets, in this order: `fonts.css` (the bundled terminal font, Cascadia Mono NF, as real
files your bundler emits; omit it and terminals fall back to the system monospace stack), the
design system's `reset.css` (optional) and `styles.css`, then the workbench's `styles.css` (every
class is prefixed `piwb-`). Your own CSS after them. Without the workbench `styles.css` the app is
unstyled but works.

The katex stylesheet is imported by the workbench's markdown renderer as a plain
`katex/dist/katex.min.css` import; your bundler resolves it and emits its fonts. Nothing to do.

## A custom shell

`Workbench` is exactly `WorkbenchProvider` + `WorkbenchBoot` + `WorkspaceShell`. To lay the app out
yourself, compose the provider, the boot component (mount exactly one) and the regions you want:

```tsx
import { createBrowserHost, PaneArea, SessionList, useConnection, WorkbenchBoot, WorkbenchProvider } from "@av-pi-studio/workbench";
import { Announcer, ToastViewport } from "@av-pi-studio/ui-library";

function ConnectButton() {
  const { status, connect } = useConnection();
  return <button onClick={() => void connect({ url: "127.0.0.1:6767" })}>{status}</button>;
}

<WorkbenchProvider host={createBrowserHost({ app: { title: "Mine", version: "1" } })}>
  <WorkbenchBoot />
  <ConnectButton />
  <SessionList />
  <PaneArea />
  <ToastViewport />
  <Announcer />
</WorkbenchProvider>;
```

Every region and hook throws `"<Name> must be rendered inside <WorkbenchProvider>"` outside the
provider. Mount `ToastViewport` and `Announcer` yourself (the default shell does).

## Public API

| Export | What it is |
|---|---|
| `Workbench` | The whole application. Props: `host?` |
| `WorkbenchProvider` | Host installation, theme, query cache. Props: `host?`, `children` |
| `WorkbenchBoot` | The boot sequence (connect intent, deep links, session/terminal restore, shortcuts, resume). Renders nothing; mount one |
| `WorkspaceShell` | The default three-column layout |
| `ConnectionBar` | Top bar: brand, status, address/password, connect, panel toggles, settings |
| `SessionList` | Left sidebar: workspaces and conversations |
| `PaneArea` | Split panes and tabs (chat, files, terminals) |
| `RightSidebar` | Files and git changes |
| `StatusBar` | Bottom bar |
| `OpenWorkspaceDialog` | Workspace picker (opened from the sidebar) |
| `SettingsDialog` | Settings, lazily loaded. Props: `open`, `onOpenChange`; render inside `<Suspense>` |
| `useConnection()` | `{ status, serverInfo, error, connect(options), disconnect() }` |
| `useShellLayout()` | `{ left, right }`, each `{ collapsed, width, toggle(), resize(delta) }` |
| `useSettingsDialog()` | `{ open, openSettings(), closeSettings() }` |
| `createBrowserHost(options?)` | The browser host (`options.app`, `options.pdf`, `options.saveTarget`) |
| Types | `WorkbenchHost` and its member types (below), `WorkbenchProviderProps`, `SettingsDialogProps`, `WorkbenchConnection`, `SidebarLayout`, `ConnectOptions`, `BrowserHostOptions`, `SaveTarget` |

Entries: `.` (the above), `./styles.css`, `./fonts.css`, `./vite` (Node, for `vite.config.ts`).

## The host

Everything browser-bound goes through one object, `WorkbenchHost`, passed as `host`. `web-client`
passes `createBrowserHost(...)`; a desktop shell implements its own. It is installed on the first
render; the first host wins (a later different one is ignored, with a development warning).

| Member | Contract |
|---|---|
| `app` | `{ title, version, platform? }`: shown in the top bar; `platform` is sent as `hello.platform` (the desktop app passes `"desktop"`; a browser omits it) |
| `storage` | `{ get(key): string \| null, set(key, value) }`. **Synchronous**: stores read it while initialising. If your storage is asynchronous, load it into memory before the first render and write behind. Never throws |
| `clipboard.writeText(text)` | Promise; rejects on failure |
| `dialogs.confirm/alert` | Promises. Dismissal resolves `false` / nothing. Session rename is not a host dialog: the workbench draws its own |
| `links.openExternal?(url)` | Optional. When present, every external link (login dialog, messages, Markdown files) calls it and the default navigation is suppressed; when absent the link opens in a new tab (`target="_blank"`, `rel="noreferrer"`) |
| `launch.initialConnect()` | Read once at boot: `{ url?, password?, cwd?, connect } \| null`. `url` may be a pairing link |
| `launch.agentDeepLink` | `{ current(), subscribe(listener), consume() }`: "open this agent" requests |
| `connection.createTransport(target, { password })` | The `Transport` for one connect, or `undefined` for the SDK's WebSocket. `target` is `{ mode: "direct", url }` or `{ mode: "relay", url, daemonPublicKey }`. **A transport must deliver frames in wire order and binary frames as `ArrayBuffer`.** Throwing fails that connect with your message |
| `connection.timers` | `setTimer`/`clearTimer` for reconnect backoff; must keep firing while the window is hidden |
| `connection.onResume(listener)` | Fire on wake, focus or network change; the workbench decides whether to probe or reconnect |
| `files.upload(dir, source, options?)` | Upload `source` (`{ name, size? }`; you must also accept a browser `File`) to `<dir>/<name>`. Resolve only once the daemon has confirmed the write (the SDK does this when the daemon advertises `fileTransferAck`) and reject with the daemon's reason. `options` is a `TransferOptions` (below). The explorer shows a percentage from `onProgress`. The browser host passes the `File` itself to the SDK (no `arrayBuffer()`), so a large upload does not sit in memory |
| `files.saveToDisk(path, options?)` | Copy a daemon file to the user's machine. `options` is the same `TransferOptions`; call neither callback before the user has chosen a destination |
| `TransferOptions` | `{ onProgress?(done, total?), onStateChange?(state), signal? }`. `onProgress` is the bytes done and the total when known (it restarts from 0 after `"waiting"`); `onStateChange` takes `"queued"`, `"running"` or `"waiting"` (a host that never calls it is `"running"`; the browser host never does); aborting `signal` stops the transfer and rejects it with an error named `AbortError`. A host may ignore all three |
| `files.openForView(path)` | `{ url, mimeType?, fileName?, release() }` for viewers; `release` is called when the URL is unused |
| `files.pickUploads?()` | Optional native picker, replacing the file input |
| `pdf?` | Optional `{ createWorker(), assetBaseUrl }`. Without it PDFs show an error with Download |
| `preview?` | Optional `{ kind: "origin", mount(html) → Promise<{ url, release() }> }`: the HTML viewer loads its frame from `url` instead of `srcdoc` (same sandbox; `release` when replaced or unmounted), or `{ kind: "inert" }`: `srcdoc` with a "Scripts are disabled" line. Absent: `srcdoc`, unchanged |
| `daemons?` | Optional daemon registry (`HostDaemons`): `snapshot()` (entries without secrets, current id, local daemon state, the two local-daemon settings, and optionally `secretStore: "keychain" \| "file"`: with `file` the Daemons screen says in one line that secrets are kept in a file only this user can read, because no keychain is available; `keychain` or absent: no line), `subscribe`, `add`/`update`/`remove`, `local.start/stop/restart/refresh`, `setSettings`, `resolveCurrent()`, `switchTo(id)`, `onManageRequest`. Rejections carry a `code` (`DaemonError`, a type only). Absent in a browser. Read by the switcher and the Daemons screen |
| `updates?` | Optional self-update (`HostUpdates`): `current()` gives an `AppUpdateState` (`idle`, `checking`, `up_to_date`, `available`, `downloading`, `restart_needed`, `cannot_install`, `failed`), `subscribe`, `check()`, `install()`, `restart()`. The connection bar shows a pill at its far right ("Update 0.3.1", "Updating 42%", "Restart to update", "0.3.1 available", "Update failed"); a click installs, restarts, retries or opens the release page through `links.openExternal`. Absent in a browser: nothing is drawn |
| `app.minDaemonVersion?` | Optional oldest daemon version the shell expects; an older daemon still connects and gets a notice. Read by the connection bar |

`createBrowserHost({ saveTarget })` lets a shell own where a saved file goes while keeping the
browser host's download logic. `saveTarget(suggestedName)` returns a `SaveTarget`
(`write(chunk)`, `finish()`, `discard()`, all promises) or `null` when the user cancelled (nothing
happens). The file is then fetched in 8 MiB ranges: the first learns its size and modification time,
later ones send them as `ifUnchanged`; each range's chunks go through `write`, awaited in order,
before the next range is asked for, so memory stays bounded however slow the target is. `finish()`
runs after the last range; on any failure `discard()` runs once and the original error is rethrown.
Without `saveTarget`, "Download" builds a `Blob` and clicks an anchor.

## PDF viewing

pdf.js needs a worker and data files that only your application bundle can provide:

- the worker: `import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker"`, passed as
  `pdf.createWorker`. Install the **same `pdfjs-dist` range** as this package's dependency;
- the data (`cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`): `pdfjsAssetsPlugin()` from
  `@av-pi-studio/workbench/vite` serves them in dev and emits them under `<base>/pdfjs/`; pass that
  URL as `pdf.assetBaseUrl`. Omit the plugin and only PDF viewing degrades.

See the quickstart for both.
