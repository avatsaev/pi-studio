# Architecture — Workbench Host Adapter

> **Status: built on `feat/workbench` (sprint 093, 2026-11-14); released with the workbench package. Extended for the desktop host in sprints 103–110 (2026-11-20): `dialogs.prompt` removed; `preview`, `daemons`, `app.minDaemonVersion` and the `saveTarget` option added; external links go through the host. Milestone 2 (sprints 112–117, 2026-11-22): the desktop host's `connection.createTransport` picks a Rust-owned proxy for `local` and `direct` entries and `onResume` hears the app's resume event, with no change to this contract; the registry view's `secretStore` was added. Checked live in the desktop app on Linux; the contract below is `packages/workbench/src/host/types.ts`.**

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
  app: { title: string; version: string; platform?: string; minDaemonVersion?: string };
  storage: KeyValueStore;                       // from @av-pi-studio/ui-library, synchronous
  clipboard: { writeText(text: string): Promise<void> };
  dialogs: {
    confirm(message: string): Promise<boolean>;
    alert(message: string): Promise<void>;
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
  preview?: HostPreview;
  daemons?: HostDaemons;
}

type HostPreview =
  | { kind: "origin"; mount(html: string): Promise<{ url: string; release(): void }> }
  | { kind: "inert" };

createBrowserHost(overrides?: Partial<BrowserHostOptions>): WorkbenchHost

interface BrowserHostOptions {
  app: AppIdentity;                             // required in practice
  pdf: HostPdf;
  saveTarget?: (suggestedName: string) => Promise<SaveTarget | null>;
}

interface SaveTarget {                          // write per chunk in file order, awaited; then finish once;
  write(chunk: Uint8Array): Promise<void>;      // on any failure discard once instead, never finish
  finish(): Promise<void>;
  discard(): Promise<void>;
}
```

`HostDaemons` and its types (optional; the desktop host supplies them, the browser host does not):

```ts
interface DaemonEntryView { id: string; kind: "local" | "direct" | "relay"; name: string;
                            address?: string; hasPassword: boolean }   // never a secret

type LocalDaemonState =
  | { state: "checking" } | { state: "unsupported" }
  | { state: "cli_missing"; path?: string } | { state: "cli_outdated"; version: string }
  | { state: "stopped" } | { state: "starting" } | { state: "stopping" }
  | { state: "running"; host: string; port: number }
  | { state: "failed"; reason: "not_healthy" | "timeout" | "bad_output" | "spawn_failed" };

type NewDaemon =
  | { kind: "direct"; name: string; address: string; password?: string }
  | { kind: "relay"; name: string; pairingLink: string };
interface DaemonPatch { name?: string; address?: string; password?: string | null; pairingLink?: string }
interface DaemonSettings { autoStartLocalDaemon: boolean; cliPath: string | null }

type DaemonErrorCode = "invalid_name" | "name_taken" | "invalid_address" | "invalid_link" | "too_many"
  | "not_found" | "wrong_kind" | "local_not_removable" | "unsupported" | "cli_missing" | "cli_outdated"
  | "busy" | "no_current" | "local_stopped" | "not_healthy" | "timeout" | "bad_output" | "spawn_failed"
  | "secret_missing" | "secret_unavailable" | "secret_store_failed";   // the last three: the secret store (sprint 113)
interface DaemonError extends Error { readonly code: DaemonErrorCode }   // message is the code; a type only

interface HostDaemons {
  snapshot(): { currentId: string | null; entries: DaemonEntryView[]; local: LocalDaemonState;
                settings: DaemonSettings;
                secretStore?: "keychain" | "file" };                    // synchronous, in memory
  subscribe(listener: () => void): () => void;
  resolveCurrent(): Promise<ConnectIntent>;                             // rejects with a DaemonError
  add(input: NewDaemon): Promise<DaemonEntryView>;
  update(id: string, patch: DaemonPatch): Promise<DaemonEntryView>;
  remove(id: string): Promise<void>;                                    // `local_not_removable` for local
  switchTo(id: string): Promise<void>;                                  // reloads the page; does not resolve on success
  setSettings(patch: Partial<DaemonSettings>): Promise<void>;
  local: { start(): Promise<void>; stop(): Promise<void>; restart(): Promise<void>; refresh(): Promise<void> };
  onManageRequest(listener: () => void): () => void;
}
```

Supporting types:

| Type | Meaning |
|---|---|
| `ConnectIntent` | `{ url?: string; password?: string; cwd?: string; connect: boolean }`. `url` may be an address or a pairing link; every field pre-fills the connection bar. The desktop host's `resolveCurrent` leaves `password` out for a `local` or `direct` entry: Rust reads it |
| `ConnectTarget` | The result of today's `resolveConnectTarget`: `{ mode: "direct"; url } \| { mode: "relay"; url; daemonPublicKey: Uint8Array }` |
| `UploadSource` | `{ name: string; readonly size?: number }` plus host-private data. The browser host wraps a `File`; a native host may accept its own kind. Opaque to the workbench, which reads only `name` and `size`; every host must accept a `Blob`, because the workbench makes `File`s itself |
| `ViewableFile` | `{ url: string; mimeType?: string; fileName?: string; release(): void }` |

### Member contracts

| Member | Contract |
|---|---|
| `app` | Shown in the connection bar. Static for the lifetime of the page. `platform` is sent as `hello.platform` (`"desktop"` for the Tauri app; a browser omits it; informational, nothing branches on it). `minDaemonVersion`: when set and the connected daemon's `server_info.version` is lower or absent, the workbench shows one non-blocking notice per connection naming both versions; the browser host does not set it |
| `storage` | **Synchronous** `get`/`set`. Never throws; a failed write is dropped. A host with asynchronous storage must load into memory before the first render and write behind |
| `clipboard.writeText` | Rejects on failure. Callers report the failure to the user |
| `dialogs.*` | Resolve when the user answers. `confirm` resolves `false` on dismissal. There is no text prompt: session rename is an in-app dialog of the workbench, in both clients, and the host guard test forbids `window.prompt` and `dialogs.prompt` |
| `links.openExternal` | Optional. Every link the workbench classifies as external (login dialog, messages, Markdown files) goes through it when present, and the default navigation is suppressed; when absent the link opens in a new tab (`target="_blank"`, `rel="noreferrer"`). An empty `href` is not external: the label is drawn as text |
| `launch.initialConnect` | Read once at boot. `null` means "no intent": show the connection fields. `connect: true` connects immediately; a pairing link always connects |
| `launch.agentDeepLink.current` | The pending agent id at boot, or `null` |
| `launch.agentDeepLink.subscribe` | Fires for each later deep-link request while the app is open |
| `launch.agentDeepLink.consume` | Called after a target is applied or rejected, so it is not applied again. The browser host strips `agent=` from the URL fragment |
| `connection.createTransport` | Returns the transport `DaemonClient` uses, or `undefined` for the SDK default. Called once per `connect()`. The transport must honour the `Transport` contract: frames in wire order, binary delivered as `ArrayBuffer`. The desktop host returns a proxied transport (Rust owns the socket to the daemon) for a `local` or `direct` current entry, and the browser host's choice otherwise ([The desktop host](#the-desktop-host)) |
| `connection.timers` | Passed to `ReconnectionManager`. Must keep firing when the window is hidden |
| `connection.onResume` | Fires when the host believes a stale connection may need checking: the window became visible, the network came back, the machine woke. The workbench decides what to do (`resolveResumeAction`, unchanged) |
| `files.upload` | Stores `source` at `<dir>/<source.name>` on the daemon. Resolves when the daemon has confirmed the file is written (`fileTransferAck`; an older daemon resolves when the bytes have left the machine); rejects with the daemon's reason. `options.onProgress(sent, total?)` is optional. The browser host passes the `File` to the SDK as the chunk source (sprint-096/task-005). The workbench then refreshes the explorer listing |
| `files.saveToDisk` | Saves a daemon file to the user's machine. Where it lands is the host's business: the browser host builds a `Blob` and clicks an anchor, or, when `saveTarget` is given, streams the file into the `SaveTarget` it returns (`null`: the user cancelled, nothing happens) in 8 MiB ranges, one at a time — the first learns size and modification time, later ones send them as `ifUnchanged` — awaiting each `write` in order, then `finish()`; on any failure `discard()` runs once and the original error is rethrown. Rejects on failure; resolves without saving if the user cancels a native dialog |
| `files.openForView` | Returns a URL a media element, `fetch` or pdf.js can read. The workbench calls `release()` when the URL is superseded or the viewer unmounts |
| `files.pickUploads` | Optional. When present, the explorer's upload action calls it instead of opening an `<input type="file">` |
| `pdf` | Optional. `createWorker` returns a pdf.js worker; `assetBaseUrl` is where the pdf.js data directories are served (trailing slash) |
| `preview` | Optional. Where the HTML viewer's document is loaded from. `origin`: the viewer hands the assembled document to `mount` and loads its frame from the returned `url` (same sandbox tokens, never `allow-same-origin`) instead of `srcdoc`; it calls `release` once a newer document replaces it and on unmount; a `mount` that rejects shows the viewer's error state. `inert`: scripts cannot run on this host; the viewer keeps `srcdoc` and says so. Absent: `srcdoc`, unchanged |
| `daemons` | Optional. A daemon registry with a local daemon. When present, the connection bar becomes a switcher, a Daemons screen exists, and connection boot calls `daemons.resolveCurrent()` instead of reading `launch.initialConnect()`. `snapshot()` is synchronous and never holds a password or a pairing link; its optional `secretStore` (`"keychain" \| "file"`) says where the host keeps them: with `file` the Daemons screen shows one line (kept in a file only this user can read, because no keychain is available), with `keychain` or when absent it shows nothing; `subscribe` fires after any change to the registry, the settings or the local daemon's state; a rejected call carries a `DaemonError` code; `local.*` resolve once the action is accepted and the outcome arrives as a state change; `switchTo` reloads the page. Shape and rules: [../features/desktop-daemon-registry.md](../features/desktop-daemon-registry.md) § Public contract. Absent: the address and password fields, unchanged |

### Browser host

`createBrowserHost()` reproduces today's behaviour exactly:

| Member | Implementation |
|---|---|
| `storage` | `localStorageKvStore` |
| `clipboard` | Today's `copyText` |
| `dialogs` | `window.confirm` / `alert`, wrapped in resolved promises |
| `links` | No `openExternal`: anchors keep their native `target="_blank"` |
| `launch` | Today's query and fragment parsing; `hashchange` subscription |
| `connection.createTransport` | Today's branch: relay transport, bearer-subprotocol socket, or `undefined` |
| `connection.timers` | Worker timers with the plain-timer fallback |
| `connection.onResume` | `visibilitychange` (hidden to visible only) and `online` |
| `files` | Today's in-memory paths over `FileTransferClient`; with the `saveTarget` option, `saveToDisk` streams into it |
| `pdf` | Not provided by default; `web-client` passes it in `overrides` because only an application can import a `?worker` |
| `app` | Required override (`title`, `version`) |
| `preview`, `daemons` | Not provided |

### The desktop host

The desktop app assembles its host from `createBrowserHost({ app, pdf, saveTarget })` plus its own
members (`apps/pistudiodesktop/src/host/desktop-host.ts`): `storage`, `dialogs`, `links`, `launch`,
`preview` and `daemons` are replaced or added, and `files` is wrapped to count unfinished
transfers. Which member comes from where: [../features/desktop-native-host.md](../features/desktop-native-host.md)
§ Public contract 2. Outside Tauri the desktop frontend uses the plain browser host.

`connection` is the browser host's with two changes (`src/host/connection.ts`; built in milestone 2,
[../features/desktop-transport-bridge.md](../features/desktop-transport-bridge.md) § 4):
`createTransport` returns, when the registry's current entry is of kind `local` or `direct` (the
entry's kind decides, not the target's shape), the SDK's WebSocket transport whose `connect(url)`
first calls the app's `transport_open` and connects to the single-use loopback address it answers,
so Rust holds the socket to the daemon and the password (`options.password` is ignored); for a
`relay` entry, or with no current entry, it returns what the browser host returns. `onResume` adds
the app's `connection_resume` event (wake, network change) to the browser triggers. `timers` is
unchanged. The registry view the host reads carries `secretStore` (`"keychain"` or `"file"`; absent
when the app's store is in memory) and the host's `resolveCurrent` answers no password for a
`local` or `direct` entry.

### History — the 2026-11-15 amendment, built

Specified for the desktop native shell on 2026-11-15 and built in sprints 103–110; every row is now
in the contract above. Kept so the reasons are findable.

| Change | Kind | Where it landed |
|---|---|---|
| `dialogs.prompt` | Removed | Sprint-104: session rename became the in-app `RenameSessionDialog` in both clients |
| `app.minDaemonVersion?: string` | Added, optional | Sprint-109 (the app sets it to `0.0.119`); the notice, sprint-110 |
| `daemons?: HostDaemons` | Added, optional | Types and an in-memory test registry sprint-109; consumed by the connection bar, the Daemons screen and connection boot in sprint-110 |
| `HostDaemons.snapshot().secretStore?` | Added, optional | Sprint-113 (task-007): the desktop host reads it from the app's registry view; the Daemons screen draws one line for `file` ([../features/desktop-transport-bridge.md](../features/desktop-transport-bridge.md) § 5) |
| `preview?: HostPreview` | Added, optional | Sprint-105 |
| External links | Behaviour | Sprint-104: through `links.openExternal` when the host has it, a new tab otherwise; before, links in messages had no target and replaced the page |
| `saveTarget` option of `createBrowserHost` | Added (planned later) | Sprint-104 |

### The 2026-11-22 amendment — specified and planned (sprint 119), not built

For the desktop transfer engine ([../features/desktop-transfer-engine.md](../features/desktop-transfer-engine.md)
§ 6, decisions R2 and S7). Nothing above changes until it is built; the rows move into the contract
with sprint-119/task-001. Compatibility is not kept: every host changes in the same change.

| Change | Kind |
|---|---|
| `TransferOptions { onProgress?, onStateChange?, signal? }`, with `TransferState = "queued" \| "running" \| "waiting"` | Replaces `UploadOptions` (renamed, no alias) |
| `files.upload(dir, source, options?: TransferOptions)` | `signal` aborts (the promise rejects with an `AbortError`); `onStateChange` is optional for a host |
| `files.saveToDisk(path, options?: TransferOptions)` | A second argument: progress, state and abort for a save. No callback before the user has chosen a destination |
| `files.pickUploads` | Unchanged in shape. The desktop host supplies it when Rust serves the page's entry, decided once when the host is built |
| Browser host | Passes `signal` and progress through to the SDK for uploads and saves; an aborted save discards its `saveTarget` |
| Desktop host | A picked file is uploaded, and a file saved, by Rust when the engine serves the connection; otherwise the browser host's members |

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

The `window.confirm`/`alert` call sites become awaited host calls. Each already sits in an event
handler that is, or can become, asynchronous. Behaviour in the browser is unchanged: same text,
same blocking native dialog. The one `window.prompt` (session rename) became an in-app dialog.

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

- ~~**Dialogs in a Tauri webview.**~~ Resolved (sprint-104, Linux): the desktop host's `confirm` and
  `alert` are native dialogs (Rust), the page keeps answering while one is open, and rename is an
  in-app dialog. Not run on macOS or Windows (`desktop/docs/platform-checks.md` N5).
- ~~**`target="_blank"` in a Tauri webview.**~~ Resolved by not relying on it: the desktop host's
  `links.openExternal` opens the system browser after a scheme check in Rust (sprint-104, Linux).
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
