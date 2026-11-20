# Feature — Desktop Native Host

> **Status: specified (2026-11-15), planned (2026-11-20, sprints 102–106, 25 tasks), not built.**
> Milestone 1 of the desktop client, with [desktop-daemon-registry.md](desktop-daemon-registry.md).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (the contract implemented and amended here), [../architecture/workbench-package.md](../architecture/workbench-package.md),
> [desktop-daemon-registry.md](desktop-daemon-registry.md) (the `daemons` member and its commands),
> [file-explorer-transfer.md](file-explorer-transfer.md) and
> [desktop-client-protocol-followups-2.md](desktop-client-protocol-followups-2.md) § 1 (download),
> [html-file-preview.md](html-file-preview.md) (the sandbox this must not weaken)
> Source of decisions: [../grills/desktop-native-shell.md](../grills/desktop-native-shell.md)
> (D-numbers below are that brief's)
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

The desktop window draws the workbench through the workbench's **browser** host, so it behaves
like a web page in a frame: settings live in the webview's storage, dialogs are the webview's,
a link in a message navigates the whole window away, saving a file depends on the webview's
download handling, and scripts in the HTML preview are blocked by the window's policy. The Rust
side is still the template's sample checklist application.

This feature gives the app a **desktop host**: a `WorkbenchHost` whose members are backed by Rust
where a browser does the job badly, and deletes the sample. It does not move sockets, large-file
transfer or secrets handling into Rust; those are milestones 2 and 3.

## Decisions

| # | Decision |
|---|---|
| D1 | Everything the workbench stores through `host.storage` is kept in files owned by Rust |
| D2 | The checklist sample (`doc`, `ops`, `format` crates, item, undo and file commands) is deleted. The command registry, the control socket and the app's CLI stay and carry the app's real commands |
| D6 | Tauri's own handling of dropped files is turned off; drops reach the page as HTML5 drag and drop, as in the browser |
| D7 | The HTML preview is served from an origin of its own, after a spike on the three webviews. A platform whose webview cannot do it shows that scripts are disabled |
| D9 | Confirm and alert are native dialogs. Session rename becomes an in-app dialog, in the web client too, and `dialogs.prompt` leaves the host contract |
| D20 | A settings or state file that cannot be read is set aside and defaults are used |
| D21 | One instance: a second launch focuses the open window |
| D25 | Quitting during a file transfer asks first |
| D26 | Only `http`, `https` and `mailto` links open outside the app |

Decided at scope, for the engineer to confirm:

- **No native upload picker in this milestone.** The upload button's file input already opens the
  operating system's picker inside a webview. A picker that returns paths (`files.pickUploads`)
  only helps once Rust does the upload, so it comes with milestone 3, like native drops (D6).
- **The webview calls only the app's own commands.** Tauri plug-ins (dialog, opener, single
  instance) are used from Rust. The window's capability file grants no plug-in permission, so
  every call from the page is validated by this app's code.

## Public contract

### 1. Boot snapshot

The page asks Rust for one value before the workbench first renders, and builds the host from it.

```
boot() -> {
  app:      { title, version, platform: "desktop", minDaemonVersion },
  storage:  { [key]: string },          # global keys plus the current entry's keys
  daemons:  { currentId, entries, local },   # desktop-daemon-registry.md § 2, `daemon.list`
  notices:  [ { kind: "file_reset", file, keptAs } ]
}
```

`host.storage` is synchronous, and the workbench reads it during its first render; that is why the
snapshot is fetched before rendering and not from an effect.

### 2. The desktop host, member by member

| Member | In this milestone | Backed by |
|---|---|---|
| `app` | Title, the Cargo workspace version, `platform: "desktop"`, `minDaemonVersion` | Boot snapshot |
| `storage` | § Storage | Rust files |
| `clipboard.writeText` | The webview's clipboard, as in the browser host | Webview (see TODO) |
| `dialogs.confirm`, `dialogs.alert` | Native dialogs titled with the app's name | Rust |
| `dialogs.prompt` | Removed from the contract (§ 4) | |
| `links.openExternal` | Opens the system's default application for the URL, after the scheme check (D26) | Rust |
| `launch.initialConnect` | Always `null`: the registry decides what to connect to (`daemons.resolveCurrent`) | |
| `launch.agentDeepLink` | No source: `current()` is `null`. Links into the app are milestone 5 | |
| `connection.createTransport`, `timers`, `onResume` | The browser host's: the webview opens the socket | Webview (milestone 2 replaces them) |
| `files.upload` | The browser host's: the page reads the `File` and the SDK sends it | Webview (milestone 3) |
| `files.saveToDisk` | § Save to disk | Rust writes the file |
| `files.openForView` | The browser host's `blob:` URLs | Webview (milestone 3) |
| `files.pickUploads` | Absent: the file input is used | |
| `pdf` | As today: the worker built by this application, data files from the workbench's plug-in | Webview |
| `daemons` | [desktop-daemon-registry.md](desktop-daemon-registry.md) § 3 | Rust |
| `preview` | § HTML preview origin | Rust |

The desktop frontend builds this host in one module; that module is the only place in the package
allowed to call Tauri. Members listed as "the browser host's" are taken from `createBrowserHost()`
unchanged.

### 3. New and changed host members

```ts
// AppIdentity gains:
minDaemonVersion?: string;

// HostDialogs loses prompt():
interface HostDialogs {
  confirm(message: string): Promise<boolean>;
  alert(message: string): Promise<void>;
}

// New, optional:
type HostPreview =
  | { kind: "origin"; mount(html: string): Promise<{ url: string; release(): void }> }
  | { kind: "inert" };          // scripts cannot run on this platform; the viewer says so

interface WorkbenchHost {
  /* ...existing members... */
  daemons?: HostDaemons;        // desktop-daemon-registry.md
  preview?: HostPreview;        // absent: the srcdoc frame, as today
}
```

The browser host changes only by losing `prompt`.

### 4. Workbench changes visible to both clients

| Change | Contract |
|---|---|
| Session rename | An in-app dialog with one text field, pre-filled with the current title and selected. Enter or the Rename button confirms; Escape, Cancel or a click outside dismisses. A dismissed or blank answer changes nothing, as today. Focus returns to where it was |
| External links in messages and Markdown files | Every link the workbench classifies as external is activated through the host: with `links.openExternal` it is called and the default action is suppressed; without it the link opens in a new tab (`target="_blank"`, `rel="noreferrer"`). Today such a link has no target and replaces the page, in both clients |
| HTML preview | Uses `host.preview` when present (§ HTML preview origin); otherwise unchanged |

### 5. Rust side after the sample is removed

| Part | Becomes |
|---|---|
| Crates `doc`, `ops`, `format` | Deleted, with their rows in the layering table |
| Model | The daemon registry and the settings. Plain data, validated in one place with a cap on every size; changed only by commands; no undo |
| Engine commands | `item.*`, undo/redo and file open/save are deleted. New: the `daemon.*` commands, and `settings.get` (query) / `settings.set { key, value }` for the keys of § Settings |
| Shell state (`ui.inspect`) | What automation should see: the current entry id, the entries without secrets, the local daemon state, and the settings. The sample's theme field goes: the theme belongs to the workbench |
| Control protocol | Unchanged methods (`engine.execute`, `engine.commands`, `ui.inspect`, `ui.set`), carrying the new commands. No answer contains a secret |
| App CLI (`pistudiodesktop-cli`) | Runs the same commands without a window |
| Services | The platform hooks the engine needs: running a process (the `pi-studio` CLI), reading and writing the app's files, the clock. File and process access stay behind them so the core still builds for wasm32 |
| Tauri commands for the page | One per host member that Rust backs: boot, storage write, confirm, alert, open external, the save-to-disk steps, preview mount and release, and one that runs an engine command (for `daemons`). Each validates its input in Rust |
| Events to the page | Registry or local-state changed; "open the Daemons screen" |

The golden rules of `desktop/AGENTS.md` keep holding: no panics, layering checked by
`cargo xtask layers`, nothing below the app binary depends on Tauri, every command has tests and
is in the adversarial command test.

### 6. Window and security configuration

| Setting | Value |
|---|---|
| Dropped-file handling | Off (D6) |
| Instances | One; a second launch focuses and un-minimises the window (D21) |
| Navigation | The main frame may only load the app's own origin; any other navigation is refused in Rust |
| Capabilities | The app's own commands only; no plug-in permission |
| Content-Security-Policy | As today, plus the preview origin in `frame-src` when the preview is served from it |
| Closing the window | Quits the app. A tray icon or running in the background is milestone 5 |

## Behavior & algorithms

### Storage

```
host.storage.get(key):   read the in-memory map filled from the boot snapshot
host.storage.set(key, value):
    update the map
    send { key, value } to Rust at once; never wait for it, never throw

Rust, on a storage write:
    scope = "global" when key is in the global list, else the current entry
    no current entry and scope is an entry -> keep in memory only
    write the scope's file within 1 s (coalescing), and before the app exits
```

| Scope | Keys | File |
|---|---|---|
| Global | `pi-studio-appearance` | `settings.json`, under `workbench` |
| Per daemon entry | Every other key. Today: `pi-studio-pane-layout`, `pi-studio-agent-todos-ui` | `daemon-state/<entry id>.json` |

A key the app does not know is per entry: a new workbench key is never shared between daemons by
accident. Values are opaque strings to Rust, at most 4 MiB each; a larger write is dropped.
Removing an entry deletes its state file.

The pane layout is keyed by workspace path inside its own record, and two daemons can have the
same path; keeping the record per entry is what stops one daemon's layout from being applied to
another.

### Settings

`settings.json` in the app's configuration directory:

```
{
  version: 1,
  autoStartLocalDaemon: boolean,     # default true
  cliPath: string | null,            # default null
  workbench: { [global key]: string }
}
```

Both settings are edited in the Daemons screen and through `settings.set`. Unknown fields are
kept on rewrite. Writes are atomic.

### Files that cannot be read (D20)

```
on reading settings.json, daemons.json or a daemon-state file:
    missing            -> defaults, no notice
    unreadable, not JSON, wrong shape, or a `version` this build does not know
                       -> rename it to <name>.corrupt-<timestamp>, use defaults,
                          add a notice { kind: "file_reset", file, keptAs }
```

The app always starts. Notices are shown once, as non-blocking messages in the window. A reset
`daemons.json` leaves only the local entry; a reset state file costs that entry its layout only.

### Dialogs

`confirm` shows a native dialog with two buttons and resolves `true` only for the affirmative
one; closing it resolves `false`. `alert` shows a native message dialog and resolves when it is
closed. Both are modal to the window. The 21 confirm and alert call sites in the workbench do not
change.

### External links (D26)

```
openExternal(url):                 # in Rust
    parse the URL; scheme not in { http, https, mailto } -> ignore, log the scheme only
    longer than 8,192 characters -> ignore
    hand it to the system's default application
```

The check is in Rust, because what arrives from the page is untrusted (a link written by an
agent). Independently, the navigation rule in § 6 stops the window itself from leaving the app.

### Save to disk

```
saveToDisk(path):
    ask Rust to show a native save dialog
        suggested name: the file's name; folder: the one used last, else Downloads
        cancelled -> resolve, nothing saved
    Rust creates a temporary file beside the destination and returns an opaque handle
    download the file with the SDK, and for each chunk, in order:
        send (handle, chunk) to Rust and wait for the answer before sending the next
    on the last chunk: finish(handle) -> flush, then rename over the destination
    on a download error, a write error or an abort: discard(handle) -> temporary file removed; reject
```

The page never names a path on the user's machine: the destination comes from the dialog and the
page holds only the handle, which is valid for that one save. An existing file is replaced only
after the user agreed in the dialog, and only by the final rename, so a failed save leaves the
old file intact. Memory use does not grow with the file's size.

This milestone makes saving correct, not fast: each chunk crosses the webview-to-Rust channel.
Milestone 3 replaces the byte path with Rust's own connection behind the same member.

### Transfers in flight (D25)

The desktop host counts its unfinished `upload` and `saveToDisk` calls and reports the count to
Rust when it changes. A close or quit request with a count above zero shows a native confirm
naming the number; "no" keeps the window. A daemon switch asks the same question
([desktop-daemon-registry.md](desktop-daemon-registry.md) § Switching). Quitting never asks about
running agents and never stops a daemon (D4).

### HTML preview origin (D7)

```
HtmlViewer, with host.preview.kind == "origin":
    document = assembleHtmlPreview(...)          # unchanged, including the "block remote" policy tag
    { url, release } = await host.preview.mount(document)
    <iframe src=url sandbox="allow-scripts">     # same tokens as today; never allow-same-origin
    on a new document or unmount: release()

Rust, preview origin (a custom scheme of the app, distinct from the app's own origin):
    mount(html)  -> keep it in memory under an unguessable id; return the URL for that id
    GET that URL -> the document, with headers:
                      Content-Type: text/html; charset=utf-8
                      Content-Security-Policy: sandbox allow-scripts
                      Cache-Control: no-store
                      X-Content-Type-Options: nosniff
    any other URL or method -> 404
    release(id), or the page reloading -> the document is dropped
    at most 32 mounted documents and 32 MiB in total; a mount beyond that is refused
```

Why an origin of its own: a `srcdoc` frame inherits the window's Content-Security-Policy, whose
`script-src` has no `'unsafe-inline'`, so the previewed page's scripts are blocked. A document
loaded from another origin is governed by its own response headers instead. The `sandbox`
attribute stays the isolation boundary, and the `sandbox` response header repeats it so the
document is isolated even if it were ever loaded outside the frame. The preview origin appears in
no capability, so a previewed page cannot call the app's commands.

With `kind: "inert"` the viewer keeps the `srcdoc` frame and shows a one-line notice that scripts
are disabled in the desktop app on this platform; "Source" still works.

Which platforms get `"origin"` is decided by the spike (§ TODO(verify)).

### Removing the sample

Order matters, so the tree builds and the gate passes after each step: add the registry and
settings model beside the checklist; move the commands over; delete the checklist commands, then
the three crates and their rows in `xtask/src/layers.rs`; update `desktop/docs/` (architecture,
control protocol, contributing), the golden rules in `desktop/AGENTS.md` that still describe the
sample, and the handoff document.

## Data & persistence touchpoints

All under the app's per-user configuration directory for `com.avatsaev.pi-studio`:

| File | Content | Mode |
|---|---|---|
| `settings.json` | App settings and the workbench's global keys | default |
| `daemons.json` | The registry, with secrets ([desktop-daemon-registry.md](desktop-daemon-registry.md) § 1) | 0600 |
| `daemon-state/<id>.json` | One entry's workbench keys: `{ version: 1, keys: { [key]: string } }` | default |
| `*.corrupt-<timestamp>` | A file that could not be read, kept for the user | as it was |

The webview's own storage is no longer used by the app. Nothing is migrated: the app has no users.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| The boot call fails or the snapshot is malformed | The page shows a plain error with the reason and a Retry; the workbench is not mounted with half a host |
| A storage write fails on disk | Logged; the value stays in memory for this run. The workbench is not told (`set` never throws) |
| A storage value over 4 MiB | Dropped with a log line |
| A state file with an unknown `version` | Set aside like a corrupt file (D20) |
| Save dialog cancelled | `saveToDisk` resolves; nothing is written and no message is shown |
| Save fails midway (connection lost, disk full, file changed on the daemon) | Temporary file removed, the destination untouched, the explorer shows the failure as today |
| The app quits during a save | The temporary file is removed on the next launch |
| A link with another scheme (`file:`, `javascript:`, a custom scheme) | Ignored |
| A page script tries to navigate the window | Refused by the navigation rule |
| A dropped file from the OS | Uploads through the workbench's existing HTML5 drop handling, on all three platforms |
| A previewed page calls the app's command channel, reads the parent document, or opens a popup | All fail: no capability for that origin, an opaque origin, no `allow-popups` |
| More than 32 previews mounted | The mount is refused and that tab shows the viewer's error state |
| A second launch of the app | The first window is focused; the second process exits |
| Confirm or alert requested while the window is hidden | The dialog brings the window forward |

## Dependencies on other specs

- [desktop-daemon-registry.md](desktop-daemon-registry.md): supplies the `daemons` member and the
  commands this feature's engine holds; uses this feature's boot snapshot, storage and settings.
- [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md): amended
  with `daemons`, `preview`, `app.minDaemonVersion` and the removal of `dialogs.prompt`.
- [html-file-preview.md](html-file-preview.md): its two invariants (never `allow-same-origin`; the
  policy tag is a network policy, not the isolation boundary) hold unchanged.
- [desktop-client-protocol-followups-2.md](desktop-client-protocol-followups-2.md) § 1: the
  chunked, cancellable download `saveToDisk` reads from.

## Acceptance criteria

- [ ] The desktop frontend mounts the workbench with a desktop host built from the boot snapshot;
      `createBrowserHost()` supplies only the members the table in § 2 marks as the browser host's.
- [ ] Given a pane layout arranged while on entry A, when the app is quit and started again, then
      the layout is restored from `daemon-state/<A>.json`; the webview's own storage holds none
      of the workbench's keys.
- [ ] Given entries A and B with a workspace at the same path, then each keeps its own layout,
      and a theme change made on A is in effect on B.
- [ ] Given a corrupt `settings.json`, `daemons.json` or state file, when the app launches, then
      it starts with defaults, the file is kept as `*.corrupt-<timestamp>`, and a notice says so.
- [ ] Given a destructive action (delete a file), then the confirmation is a native dialog, and
      declining it leaves the file in place.
- [ ] Given a session rename, then an in-app dialog is shown in the desktop app and in the web
      client; Escape changes nothing; no code calls `dialogs.prompt`, and the host guard test
      rejects it.
- [ ] Given an `https` link in a chat message, when it is clicked in the desktop app, then it
      opens in the system browser and the window stays on the workbench. In the web client it
      opens in a new tab and the app's tab is not replaced.
- [ ] Given a `file:` or `javascript:` link, then nothing opens.
- [ ] Given "Download" on a 1 GiB file, then a native save dialog chooses the destination, the
      file there is byte-identical, and the app's memory use stays flat during the save.
- [ ] Given the save dialog is cancelled, or the save fails midway, then no file and no temporary
      file is left at the destination.
- [ ] Given a file dragged from the OS onto the file explorer, then it uploads, on Linux, macOS
      and Windows.
- [ ] Given an HTML file with an inline script, when it is previewed on a platform with the
      `"origin"` preview, then the script runs; a script in it that tries the app's command
      channel, the parent document or a popup fails; and "Block remote resources" still blocks.
- [ ] On a platform with the `"inert"` preview, the viewer shows the notice and the page's markup.
- [ ] Given a transfer in progress, when the window is closed, then a native confirm is shown and
      "no" keeps the app open.
- [ ] Given the app is running, when it is launched again, then the existing window is focused and
      there is one process.
- [ ] The crates `doc`, `ops` and `format` and the item, undo and file commands are gone;
      `cargo xtask ci` passes; `ui.inspect` returns the registry view and settings without secrets.
- [ ] The window's capability file grants only the app's own commands.
- [ ] The web client's build and tests pass; its only visible changes are the rename dialog and
      external links opening in a new tab.

## TODO(verify)

- **The preview spike (D7).** Not known for any of the three webviews (WebKitGTK, WKWebView,
  WebView2): whether a sandboxed frame loaded from a custom scheme runs its scripts, whether the
  window's `frame-src` accepts that scheme in each platform's URL form, and whether the app's
  command channel is really unreachable from it. Run it first; each platform gets `"origin"` or
  `"inert"` from the result. Linux can be tried on the development machine; macOS and Windows
  need a person or a CI job. *Linux, 2026-11-20 (sprint-105/task-001,
  `swe/notes/desktop-preview-origin-spike.md`): **"origin"** — scripts run, the frame is isolated
  (opaque origin, no parent, no storage, no popups, no `__TAURI_INTERNALS__`; `ipc://` answers
  "missing Tauri-Invoke-Key" when the blocking tag is off). Needs `frame-src pi-preview:` and the
  scheme admitted by the navigation rule (WebKitGTK runs `on_navigation` for subframes). macOS and
  Windows not measured → "inert".*
- **Clipboard in the webview.** `navigator.clipboard.writeText` needs a secure context and, in
  some webviews, a user gesture. The browser host's fallback may cover it. If it fails on a
  platform, back `clipboard` with Rust on that platform. *Linux, 2026-11-20: "Copy Absolute Path"
  works in WebKitGTK.*
- **Native confirm and alert from an asynchronous call.** The workbench awaits them inside event
  handlers; check that nothing depends on the dialog blocking the page's event loop. *Linux,
  2026-11-20 (sprint-104/task-008): delete-confirm, alert and the close confirm behave; the page
  and the owner thread keep answering while a dialog is open.*
- **The file input in each webview.** Assumed to open the OS picker everywhere. *Linux,
  2026-11-20 (sprint-104/task-008, Xvfb container, no window manager, no portal): clicking Upload
  opened nothing. HTML5 drops upload. Recheck on a real Linux desktop (sprint-106 checklist); if it
  still opens nothing, add a native open-file command like `save_begin`.*
- **Save dialog starting folder.** Downloads per the spec; in the container (no XDG user dirs) the
  dialog opened at `/`. Recheck on a real desktop.
- **Dropped-file handling off on macOS and Linux.** The documented reason to turn it off is
  Windows; confirm HTML5 drops keep working on the other two with it off. *Linux, 2026-11-20
  (sprint-103/task-004): a page-dispatched HTML5 drop on the file explorer uploads with it off;
  a real drag from the desktop is still unchecked.*
- **Chunk-by-chunk save throughput.** *Linux, 2026-11-20 (sprint-104/task-008): 1 GiB in 6.5 s
  (~160 MiB/s) from a local dev daemon, SHA-256 equal, the app's processes (Rust + WebKit) grew
  from 738 to 854 MiB at peak — flat, not proportional to the file.*
- **`pagehide` on reload and on close.** The workbench flushes its debounced layout write on
  `pagehide`. Whether each webview fires it when the page is reloaded for a daemon switch and when
  the window closes is not known; if not, the last 250 ms of layout changes can be lost.
  *Linux, 2026-11-20 (sprint-103/task-004): on reload the change survives; on a window close
  (`WM_DELETE_WINDOW`) 27 ms after a split, the split is lost — the page's flush does not reach
  Rust before exit. Proposed fix (not done): on `CloseRequested`, hold the close, ask the page to
  flush (evaluate a script that runs the `pagehide` handlers and then `storage.settled()`), and
  close when it answers or after a short timeout.*
- **Configuration directory on each platform**, and whether mode 0600 survives the atomic rename.
  *Linux: `~/.config/com.avatsaev.pi-studio`.*
- **macOS and Windows.** Nothing here has run on either.
