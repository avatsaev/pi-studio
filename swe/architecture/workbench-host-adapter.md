# Architecture — Workbench Host Adapter

> **Status: built on `feat/workbench` (sprint 093, 2026-11-14); released with the workbench package**

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [workbench-package.md](workbench-package.md) (the package this seam belongs to),
> [client-app-runtime.md](client-app-runtime.md) (`Transport`, `DaemonClient`,
> `ReconnectionManager`), [../features/connection-resilience.md](../features/connection-resilience.md)
> (worker timers, resume triggers), [../features/file-explorer-transfer.md](../features/file-explorer-transfer.md),
> [../features/web-ui-agent-deep-link.md](../features/web-ui-agent-deep-link.md)
> Consumer brief: [../../docs/desktop-client-handoff.md](../../docs/desktop-client-handoff.md)

## Purpose

The application code calls browser APIs directly in a small number of places. A Tauri shell needs
to replace exactly those calls: storage, clipboard, dialogs, links, the launch URL, socket
creation, reconnect timing, file transfer and the pdf.js runtime.

The host adapter is one object, supplied by the embedding shell, that the workbench uses for all of
them. `web-client` passes a browser implementation that behaves as the code does today. The desktop
app passes one backed by Tauri and Rust. Nothing else in the workbench knows which shell it runs in.

## Current state (verified in code, pi-studio 0.0.117)

Every browser-bound call site in the code that moves:

| Concern | Call sites |
|---|---|
| Key/value storage | `lib/pane-layout-persistence.ts` (`pi-studio-pane-layout`), `features/chat/todos/agent-todos-store.ts` (`pi-studio-agent-todos-ui`), `ThemeBoundary` in `ui-library` (`pi-studio-appearance`). All go through `localStorageKvStore` / the synchronous `KeyValueStore` interface from `ui-library` |
| Clipboard | `lib/clipboard.ts` (`copyText`, with an `execCommand` fallback for insecure contexts) |
| Blocking dialogs | `window.confirm` ×10, `window.alert` ×10, `window.prompt` ×1, in `features/files/`, `features/sessions/`, `features/skills/`, `features/provider-auth/` |
| External links | `features/provider-auth/LoginDialog.tsx`: an anchor with `target="_blank"` |
| Launch parameters | `hooks/use-connection.ts`: `?host=&password=&cwd=&connect=1`, `?pair=`, `#offer=` |
| Agent deep link | `hooks/use-agent-deep-link-boot.ts` (`#agent=<id>`, `hashchange`), `features/sessions/apply-agent-deep-link.ts` (`history.replaceState`) |
| Socket creation | `lib/connection/connection-store.ts`: direct `WebSocket` with the `pi-studio.bearer.<password>` subprotocol, or `createRelayTransport` for a pairing link |
| Reconnect timing | `lib/connection/worker-timers.ts` (passed to `ReconnectionManager`), `lib/connection/resume-triggers.ts` (`visibilitychange`, `online`; attached in `main.tsx`) |
| Upload | `hooks/use-file-transfer.ts`: `File.arrayBuffer()` then `FileTransferClient.upload` (at 0.0.117; now the `File` itself is the SDK's chunk source) |
| Save to disk | `hooks/use-file-transfer.ts`: download to memory, `Blob`, synthetic anchor click |
| View URL for a remote file | `hooks/use-file-download.ts`: download to memory, `Blob`, object URL. Used by the image, video, PDF, molecule and binary-fallback viewers |
| pdf.js runtime | `features/files/pdfjs-runtime.ts`: `?worker` import, `import.meta.env.BASE_URL` |
| App identity | `features/connection/ConnectionBar.tsx`: `__BRAND_TITLE__`, `__APP_VERSION__` |

In-memory byte downloads for text, HTML assets and inline images (`use-file-text.ts`,
`html-asset-loader.ts`, `inline-image-cache.ts`) call `FileTransferClient.download` directly and
are bounded by existing size ceilings. They are **not** part of the host.

## Public contract

### Shape

```ts
interface WorkbenchHost {
  app: { title: string; version: string };
  storage: KeyValueStore;                       // from @av-pi-studio/ui-library, synchronous
  clipboard: { writeText(text: string): Promise<void> };
  dialogs: {
    confirm(message: string): Promise<boolean>;
    alert(message: string): Promise<void>;
    prompt(message: string, initial?: string): Promise<string | null>;
  };
  links: { openExternal?(url: string): void };
  launch: {
    initialConnect(): ConnectIntent | null;
    agentDeepLink: {
      current(): string | null;
      subscribe(listener: (agentId: string) => void): () => void;
      consume(): void;
    };
  };
  connection: {
    createTransport(target: ConnectTarget, options: { password?: string }): Transport | undefined;
    timers: { setTimer(cb: () => void, ms: number): unknown; clearTimer(handle: unknown): void };
    onResume(listener: () => void): () => void;
  };
  files: {
    upload(dir: string, source: UploadSource, options?: UploadOptions): Promise<void>;
    saveToDisk(path: string): Promise<void>;
    openForView(path: string): Promise<ViewableFile>;
    pickUploads?(): Promise<UploadSource[]>;
  };
  pdf?: { createWorker(): Worker; assetBaseUrl: string };
}

createBrowserHost(overrides?: Partial<BrowserHostOptions>): WorkbenchHost
```

Supporting types:

| Type | Meaning |
|---|---|
| `ConnectIntent` | `{ url: string; password?: string; cwd?: string; connect: boolean }`. `url` may be an address or a pairing link |
| `ConnectTarget` | The result of today's `resolveConnectTarget`: `{ mode: "direct" \| "relay"; url; daemonPublicKey? }` |
| `UploadSource` | `{ name: string; size?: number }` plus host-private data. The browser host wraps a `File`; a native host wraps a local path. Opaque to the workbench |
| `ViewableFile` | `{ url: string; mimeType?: string; fileName?: string; release(): void }` |

### Member contracts

| Member | Contract |
|---|---|
| `app` | Shown in the connection bar. Static for the lifetime of the page |
| `storage` | **Synchronous** `get`/`set`. Never throws; a failed write is dropped. A host with asynchronous storage must load into memory before the first render and write behind |
| `clipboard.writeText` | Rejects on failure. Callers report the failure to the user |
| `dialogs.*` | Resolve when the user answers. `confirm` resolves `false` and `prompt` resolves `null` on dismissal |
| `links.openExternal` | Optional. When present, activating an external link calls it and suppresses the default navigation. When absent, the anchor behaves natively |
| `launch.initialConnect` | Read once at boot. `null` means "no intent": show the connection fields. `connect: true` connects immediately; a pairing link always connects |
| `launch.agentDeepLink.current` | The pending agent id at boot, or `null` |
| `launch.agentDeepLink.subscribe` | Fires for each later deep-link request while the app is open |
| `launch.agentDeepLink.consume` | Called after a target is applied or rejected, so it is not applied again. The browser host strips `agent=` from the URL fragment |
| `connection.createTransport` | Returns the transport `DaemonClient` uses, or `undefined` for the SDK default. Called once per `connect()`. The transport must honour the `Transport` contract: frames in wire order, binary delivered as `ArrayBuffer` |
| `connection.timers` | Passed to `ReconnectionManager`. Must keep firing when the window is hidden |
| `connection.onResume` | Fires when the host believes a stale connection may need checking: the window became visible, the network came back, the machine woke. The workbench decides what to do (`resolveResumeAction`, unchanged) |
| `files.upload` | Stores `source` at `<dir>/<source.name>` on the daemon. Resolves when the daemon has confirmed the file is written (`fileTransferAck`; an older daemon resolves when the bytes have left the machine); rejects with the daemon's reason. `options.onProgress(sent, total?)` is optional. The browser host passes the `File` to the SDK as the chunk source (sprint-096/task-005). The workbench then refreshes the explorer listing |
| `files.saveToDisk` | Saves a daemon file to the user's machine. Where it lands is the host's business. Rejects on failure; resolves without saving if the user cancels a native dialog |
| `files.openForView` | Returns a URL a media element, `fetch` or pdf.js can read. The workbench calls `release()` when the URL is superseded or the viewer unmounts |
| `files.pickUploads` | Optional. When present, the explorer's upload action calls it instead of opening an `<input type="file">` |
| `pdf` | Optional. `createWorker` returns a pdf.js worker; `assetBaseUrl` is where the pdf.js data directories are served (trailing slash) |

### Browser host

`createBrowserHost()` reproduces today's behaviour exactly:

| Member | Implementation |
|---|---|
| `storage` | `localStorageKvStore` |
| `clipboard` | Today's `copyText` |
| `dialogs` | `window.confirm` / `alert` / `prompt`, wrapped in resolved promises |
| `links` | No `openExternal` |
| `launch` | Today's query and fragment parsing; `hashchange` subscription |
| `connection.createTransport` | Today's branch: relay transport, bearer-subprotocol socket, or `undefined` |
| `connection.timers` | Worker timers with the plain-timer fallback |
| `connection.onResume` | `visibilitychange` (hidden to visible only) and `online` |
| `files` | Today's in-memory paths over `FileTransferClient` |
| `pdf` | Not provided by default; `web-client` passes it in `overrides` because only an application can import a `?worker` |
| `app` | Required override (`title`, `version`) |

### Amendment — desktop native shell (specified 2026-11-15, not built)

[../features/desktop-native-host.md](../features/desktop-native-host.md) and
[../features/desktop-daemon-registry.md](../features/desktop-daemon-registry.md) change this
contract. Until they are built, the shape above is what the code has.

| Change | Kind | Contract |
|---|---|---|
| `dialogs.prompt` | **Removed** | Session rename, its only caller, becomes an in-app dialog in both clients. Every host loses the member; the host guard test forbids `window.prompt` and `dialogs.prompt` |
| `app.minDaemonVersion?: string` | Added, optional | When set and the connected daemon's `server_info.version` is lower or absent, the workbench shows one non-blocking notice per connection. The browser host does not set it |
| `daemons?: HostDaemons` | Added, optional | A daemon registry with a local daemon. When present, the connection bar becomes a switcher, a Daemons screen exists, and connection boot calls `daemons.resolveCurrent()` instead of reading `launch.initialConnect()`. Shape and rules: desktop-daemon-registry.md § Public contract 3 |
| `preview?: HostPreview` | Added, optional | Where the HTML preview's document is loaded from: `{ kind: "origin", mount(html) }` gives a URL on an origin of its own, `{ kind: "inert" }` says scripts cannot run. Absent: the `srcdoc` frame, as today. desktop-native-host.md § HTML preview origin |
| External links | Behaviour | Every link the workbench classifies as external goes through `links.openExternal` when the host has it, and opens in a new tab otherwise. Today only the login dialog's link does; links in messages replace the page |

The desktop host is assembled from `createBrowserHost()` plus its own members; the table of which
member comes from where is desktop-native-host.md § Public contract 2.

## Behavior & algorithms

### Installation

```
WorkbenchProvider(host):
    on first render, synchronously:
        if a host is already installed and differs: dev-warn once, keep the first
        else install host as the module-level current host
    render ThemeBoundary(store = host.storage) > QueryClientProvider > children
```

The host is a module-level singleton because most of its callers are not React code: zustand
stores, persistence helpers and the connection store read it directly. It must be installed before
any store touches storage, which is why installation happens during the first render and not in an
effect. Replacing the host after installation is unsupported.

Code that runs before any provider (tests, mostly) gets the browser host lazily.

### Dialog call sites

The 21 `window.confirm`/`alert`/`prompt` call sites become awaited host calls. Each already sits in
an event handler that is, or can become, asynchronous. Behaviour in the browser is unchanged: same
text, same blocking native dialog.

### View URLs

```
useFileDownload(path):
    viewable = await host.files.openForView(path)
    return { objectUrl: viewable.url, mimeType, fileName }
    on supersede or unmount: viewable.release()
```

The hook's public shape and its caching rules (never refetch behind the caller, release on
supersede) stay as they are. Only the source of the URL changes.

### pdf.js

```
loadPdfjs():
    if host.pdf is absent: throw PdfRuntimeUnavailable
    pdfjs.GlobalWorkerOptions.workerPort ??= host.pdf.createWorker()
asset URLs: cmaps/, standard_fonts/, wasm/, iccs/ under host.pdf.assetBaseUrl
```

## Data & persistence touchpoints

Storage keys and value formats do not change. Only the backing store becomes host-supplied.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| `host.pdf` absent and a PDF tab opens | The PDF viewer shows its existing error state with a download action; no crash |
| `host.files.openForView` rejects | The viewer shows its existing download-failed state |
| `host.files.upload` rejects | The explorer shows the failure in its status line, as it does today |
| `host.files.saveToDisk` resolves after a user cancel | No message is shown |
| `host.connection.createTransport` throws | `connect()` fails with that error; the connection bar shows it |
| `host.launch.initialConnect` returns an intent with `connect: false` | Fields are pre-filled; no connection is attempted |
| A deep link arrives while disconnected | Stored as pending; applied after restore settles, as today |
| A second, different host is passed after mount | Ignored; one dev warning |
| `host.storage.get` returns malformed data | Existing per-key validation discards it (unchanged) |

## Dependencies on other specs

- [workbench-package.md](workbench-package.md): the host types and `createBrowserHost` are part of
  its root entry.
- [../features/connection-resilience.md](../features/connection-resilience.md): the timers and
  resume triggers move behind the host without changing what they do.
- [../features/pdf-file-preview.md](../features/pdf-file-preview.md): the worker and asset base
  become host-supplied.
- [../features/desktop-client-protocol-followups.md](../features/desktop-client-protocol-followups.md):
  upload backpressure changes what the browser host's `files.upload` does internally; the only
  contract change is the optional `UploadOptions.onProgress` (sprint-096/task-005).

## Acceptance criteria

Checked in sprint 093 task-007 (2026-11-14); evidence in that task's summary and in
`swe/sprints/sprint-093-workbench-host/done/`.

- [x] Outside the browser host implementation, no workbench source file references
      `localStorage`, `navigator.clipboard`, `window.confirm`, `window.alert`, `window.prompt`,
      `window.location`, `window.history`, `import.meta.env` or a `?worker` import. A test
      enforces this by scanning the sources. (`src/host/host-guard.test.ts`; also forbids
      `sessionStorage`, `window.open` and `new WebSocket(`.)
- [x] With `createBrowserHost()`, every behaviour in the "Browser host" table matches the
      pre-change behaviour. The existing tests for connection boot, deep links, pane-layout
      persistence, resume action and worker timers pass against it.
- [x] A test host with in-memory storage and recorded calls can drive: boot with an initial
      connect intent, a deep link delivered through `subscribe`, a confirm that resolves `false`
      (the action does not run), an upload, a save, and a view URL that is released on unmount.
      (`src/test/test-host.ts`. Release on *unmount* lives in a React effect and this package has
      no DOM test environment: the pure supersede path is unit-tested, and unmount release was
      checked in the browser — 20 image tabs opened and closed, 20 URLs created and 20 revoked.)
- [x] `ReconnectionManager` receives `host.connection.timers`.
- [x] `host.connection.onResume` firing while the socket is stale triggers the existing probe or
      reconnect path.
- [x] With `host.pdf` absent, opening a PDF shows the error state; with it present, the PDF
      renders in `web-client` as before.
- [x] `host.files.pickUploads`, when provided, is used by the explorer's upload action instead of
      a file input. (Checked in the browser with a temporary picker: no file-input click, file
      uploaded.)
- [x] The host contract is documented in `packages/workbench/README.md`, including the
      synchronous-storage rule and the transport ordering rule. (Sprint 094 task-004.)

## TODO(verify)

- **Dialogs in a Tauri webview.** Whether `window.confirm`/`alert`/`prompt` work in the system
  webviews Tauri uses is not verified. The host seam is needed either way; verify in the desktop
  repository.
- **`target="_blank"` in a Tauri webview.** Not verified to open the system browser. This is why
  `links.openExternal` exists.
- ~~**`UploadSource` for drag-and-drop.**~~ Resolved in sprint 093 (task-005): the explorer has one
  upload path, `features/files/upload-sources.ts`'s `uploadSources(dir, sources, deps)`, fed by
  the file input and a DOM drop (both `File`s) or by `files.pickUploads()`. A native host that
  receives drop paths outside the DOM needs one more entry point into that same function (a
  host-to-workbench "dropped" signal, not part of this contract yet); the feature code does not
  fork.
- **`openForView` for large media in the browser host.** It still downloads into memory. That is
  today's behaviour and is accepted here; the native host is what removes the limit.
- ~~**Host installation and React StrictMode.**~~ Resolved in sprint 093 (task-001): the install
  runs in a `useState` initializer, `installHost` is idempotent for the same host, and the dev
  server runs under StrictMode with no second-host warning.
