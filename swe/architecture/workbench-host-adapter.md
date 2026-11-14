# Architecture — Workbench Host Adapter

> **Status: planned (2026-11-14) as sprint 093; not built**

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
| Upload | `hooks/use-file-transfer.ts`: `File.arrayBuffer()` then `FileTransferClient.upload` |
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
    upload(dir: string, source: UploadSource): Promise<void>;
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
| `files.upload` | Stores `source` at `<dir>/<source.name>` on the daemon. Resolves when the upload is complete as far as the host can tell; rejects on failure. Today that means "every frame was sent", because the daemon sends no completion signal; the follow-ups spec adds one. The workbench then refreshes the explorer listing |
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
  upload backpressure changes what the browser host's `files.upload` does internally, not this
  contract.

## Acceptance criteria

- [ ] Outside the browser host implementation, no workbench source file references
      `localStorage`, `navigator.clipboard`, `window.confirm`, `window.alert`, `window.prompt`,
      `window.location`, `window.history`, `import.meta.env` or a `?worker` import. A test
      enforces this by scanning the sources.
- [ ] With `createBrowserHost()`, every behaviour in the "Browser host" table matches the
      pre-change behaviour. The existing tests for connection boot, deep links, pane-layout
      persistence, resume action and worker timers pass against it.
- [ ] A test host with in-memory storage and recorded calls can drive: boot with an initial
      connect intent, a deep link delivered through `subscribe`, a confirm that resolves `false`
      (the action does not run), an upload, a save, and a view URL that is released on unmount.
- [ ] `ReconnectionManager` receives `host.connection.timers`.
- [ ] `host.connection.onResume` firing while the socket is stale triggers the existing probe or
      reconnect path.
- [ ] With `host.pdf` absent, opening a PDF shows the error state; with it present, the PDF
      renders in `web-client` as before.
- [ ] `host.files.pickUploads`, when provided, is used by the explorer's upload action instead of
      a file input.
- [ ] The host contract is documented in `packages/workbench/README.md`, including the
      synchronous-storage rule and the transport ordering rule.

## TODO(verify)

- **Dialogs in a Tauri webview.** Whether `window.confirm`/`alert`/`prompt` work in the system
  webviews Tauri uses is not verified. The host seam is needed either way; verify in the desktop
  repository.
- **`target="_blank"` in a Tauri webview.** Not verified to open the system browser. This is why
  `links.openExternal` exists.
- **`UploadSource` for drag-and-drop.** Browser drops deliver `File` objects; a native host
  receives paths from the shell, outside the DOM event. Verify the explorer's drop handler can take
  its sources from either route without a second code path in the feature.
- **`openForView` for large media in the browser host.** It still downloads into memory. That is
  today's behaviour and is accepted here; the native host is what removes the limit.
- **Host installation and React StrictMode.** Verify the synchronous first-render install is
  idempotent under double rendering.
