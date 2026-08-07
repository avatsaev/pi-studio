# Molviewer integration — technical scope

Status: **implemented and live-verified (sprint-044, tasks 001-009).** Every claim below is
grounded in the current source (file:line cited); §4 records the six resolved decisions and their
rationale. All three `[VERIFY]` markers from the original design phase were resolved during
implementation; see their inline resolutions below.

## 1. What we're building

Five observable behaviors, plus one architectural constraint:

1. Opening a supported molecular file from the file explorer opens a **molecule viewer** tab
   (built on `@molviewer/core`'s `<MolViewer>`) instead of `TextViewer`.
2. The TabStrip's trailing "+" menu gets a third item, "New molecule view", opening an **empty**
   `<MolViewer>` (no `source` prop — its own built-in `FirstRunCard` empty-state handles
   drag-drop/file-pick, nothing to build there).
3. When the file backing an open molecule tab changes on disk, the tab reloads it via
   `sourceMode="update"` (preserves camera/selection) — **but only if the user made no in-viewer
   edits** (`isModified()` / `onModifiedChange`). This requires the daemon to push a live
   file-change notification, which **does not exist today in any form** (confirmed below) — it is
   the one genuinely new subsystem this feature needs.
4. **The file tree updates live too.** Today it does not: `useExplorerTree(expanded)` is only
   refreshed by `invalidateAfterToolCompletion` (`files-changed.ts:34–49`), a client-side 500 ms
   debounce that fires when an **agent tool** completes — so a file created/deleted by a terminal
   command, an external editor, `git checkout`, or a build step is invisible until something else
   invalidates the cache. The same watcher covers it: `FileWatchService` already watches
   *directories* internally (that is how it survives atomic-rename saves), and the tree already
   fetches one query per expanded directory keyed `rpcKeys.explorer(path)` — so "subscribe each
   expanded directory, invalidate exactly its key on push" is a 1:1 fit with existing state, with
   no tree-diffing and no new data model.
5. **Large text files open at all.** `file_read_request`'s 512 KiB inline cap makes a 2 MB log
   unopenable today (§2.3); it becomes a three-tier path — 5 MiB inline (async, so the read stops
   blocking the daemon's event loop), the existing *uncapped* chunked download above that, and a
   30 MiB *display* ceiling where the viewer offers a download instead of rendering. Independent of
   the molecule viewer, but the same file-size wall motivated both.
6. Reuses the existing tab/panel host, lazy-load, and `useFileDownload` infrastructure. The only
   new web-client surface is one `TabKind` + one panel + one viewer component (§4.3); the only new
   daemon surface is the file-watch service (§3.2) plus the shared session-cleanup registry that
   fixes an existing leak on the way past (§4.5). No parallel/duplicate infrastructure anywhere.

## 2. Current state (grounded)

### 2.1 File-viewer registry — `packages/web-client/src/features/files/viewer-registry.ts`

- `ViewerKind = "text" | "markdown" | "image" | "video" | "binary"` (line 11).
- `VIEWER_BY_KIND: Record<ViewerKind, ComponentType<ViewerProps>>` (lines 29–35) — one lazy
  component per kind. `ViewerProps` is just `{ path: string }` (lines 13–16).
- `detectViewerKind(path, opts)` (lines 89–103): extension lookup (`EXT_TO_VIEWER`, lines 37–70)
  first, then a MIME-prefix fallback (`MIME_PREFIX_TO_VIEWER`, lines 72–75) for extension-less
  files, then `isBinary` hint, else `"text"`. The registry's own header comment (lines 1–7) states
  the extension point directly: adding a format is "one entry in `EXT_TO_VIEWER`/
  `MIME_PREFIX_TO_VIEWER` plus one entry in `VIEWER_BY_KIND`, no changes to `FilePanel` itself."
  This is the seam behavior (1) uses — with one adjustment, see §2.2 and §4.3: molecule files get
  their own `TabKind`, so the registry exports the *extension set* rather than gaining a new
  `ViewerKind`.

### 2.2 How a file becomes a tab

`FileExplorer.tsx:83–88` — a row click calls `openTab({ id: tabIds.file(path), kind: "file",
label: …, closable: true, data: { path } })`. `tabIds.file` and the `Tab`/`FileTabData` shapes
live in `stores/tab-store.ts`:

- `TabKind = "chat" | "file" | "diff" | "terminal"` (`tab-store.ts:20`).
- `FileTabData { path: string }` (`tab-store.ts:22–24`).
- `Tab { id, kind, label, closable, data, workspaceCwd }` (`tab-store.ts:44–53`).
- `panel-registry.ts:20–25` — `PANEL_BY_KIND: Record<Tab["kind"], ComponentType<PanelProps>>` maps
  `"file"` and `"diff"` **both** to `FilePanel` ("`FilePanel` handles both file/diff view toggle
  internally", `panel-registry.ts:23`).
- `FilePanel.tsx:49–50` is the exact point where kind→component resolution happens today:
  `const viewerKind = detectViewerKind(path); const Viewer = VIEWER_BY_KIND[viewerKind];` then
  `<Viewer path={path} />` (line 77).

**Consequence for this feature** (as resolved in §4.3): molecule files get their own
`kind: "molecule"` tab rather than riding `kind: "file"`, so the routing decision moves to the
single site that opens file tabs — `FileExplorer.tsx:83–88` — which asks
`isMoleculeFile(path)` (new export from `viewer-registry.ts`, keeping all format knowledge in the
one module that already owns it) and picks the kind. `VIEWER_BY_KIND` gains **no** `"molecule"`
entry: `FilePanel` never renders a molecule viewer, so an unused registry slot would be dead
weight. Grepped and confirmed `FileExplorer.tsx:83–88` is the **only** site in the web-client that
opens a `kind: "file"` tab, so this is a one-line-of-logic change with no second opener to keep in
sync.

Dropping `FilePanel`'s File/Diff toggle (`FilePanel.tsx:57–72`) for molecule tabs costs nothing:
diff tabs are minted independently by the git Changes panel (`ChangesPanel.tsx:32–37`,
`kind: "diff"` → `FilePanel` → text diff), so a `.pdb`'s git diff stays reachable exactly as it is
today — just from the git panel rather than from a toggle inside the molecule tab.

### 2.3 Content fetching — two existing paths, different size ceilings

- `useFileRead(path)` (`hooks/use-file-read.ts`) → `file_read_request` RPC. Server-side handler:
  `packages/server/src/daemon/bootstrap.ts:465–483`. **Hard 512 KiB cap** (line 472–473:
  `if (stat.size > 512 * 1024) return { ok: false, error: "file_too_large", size: stat.size }`),
  UTF-8 text only (`readFileSync(resolved, "utf8")`, line 474). Query key `rpcKeys.fileRead(path)`.
- `useFileDownload(path)` (`hooks/use-file-download.ts`) → chunked binary transfer
  (`file_download_token_request` → `file_download_request` → `Begin`/`Chunk`/`End` binary frames,
  `packages/server/src/files/file-transfer.ts`). **No size cap** — streams via
  `createReadStream`/`open` (`file-transfer.ts:1–2`), 32 KiB chunks (`DEFAULT_CHUNK_BYTES`, line
  21). Resolves to an object URL; the hook also hands back the raw path through `transferFor(...)
  .download(path)`.

**Decision**: molecule files use `useFileDownload`, not `useFileRead`. Rationale: MD trajectory
files (`.lammpstrj`, multi-frame XYZ/extXYZ) routinely exceed 512 KiB, so hard-capping at 512 KiB
would silently break the exact files this viewer exists for. **No decode step is needed**:
`MolViewerSource` includes a `{ url: string; name?: string }` variant
(`node_modules/@molviewer/core/dist/types/ui/api.d.ts:20–22`), so the object URL `useFileDownload`
already produces is handed straight to molviewer, which reads it itself (`name` supplies the
extension it resolves the format from, api.d.ts:12–13). That also means the hook is reused verbatim
— no `TextDecoder`, no new fetch hook, and `use-file-download.ts:46–61`'s existing
revoke-on-supersede lifecycle is exactly what the live-reload path needs.

**Related change folded into this sprint (task-009)**: the inline cap is *also* the reason a 2 MB log
is unopenable in the text viewer today, so it is raised in the same pass — 512 KiB →
**5 MiB** (`MAX_INLINE_FILE_READ_BYTES`, a shared constant, since the literal is currently duplicated
in both bootstraps) — and, more importantly, the handler becomes **async**. `readFileSync` on the
inline path blocks the daemon's entire event loop (every agent stream, terminal byte and heartbeat)
for the duration of the read, which is the real constraint that kept the cap low; raising the number
without fixing that would trade one bad failure mode for a worse one. Above 5 MiB `TextViewer` falls
back to the same uncapped download path described above, so file size stops being a wall entirely,
with 30 MiB as a *display* ceiling (CodeMirror + `lineWrapping`, `CodeView.tsx:59`) beyond which it
offers a download instead of rendering. Net effect: no multi-MB string ever crosses a JSON text
frame — the relay would otherwise NaCl-box a full-size copy of it too.

### 2.4 TabStrip "+" menu — `packages/web-client/src/features/workspace/TabStrip.tsx`

- `NewTabMenu` (lines 90–118) renders a Radix `DropdownMenu` with two `DropdownMenu.Item`s calling
  `openNewChat(cwd)` (line 106) and `openNewTerminal(cwd)` (line 110) — both imported from
  `tab-store.ts`. `ICON_BY_KIND: Record<TabKind, typeof MessageSquare>` (lines 33–37) maps each
  `TabKind` to a lucide icon for the tab's own strip icon (not the menu).
- `openNewTerminal`/`openNewChat` (`tab-store.ts:211–252`) are the copy-paste template for a third
  `openNewMolecule(workspaceCwd)` helper: mint an id via a new `tabIds.molecule(n)` entry
  (`tab-store.ts:199–203` is the existing `tabIds` map), open a tab with `data: {}` (no path — the
  empty-state case), `kind: "molecule"`.

### 2.5 Cache invalidation today — `lib/connection/files-changed.ts`

`invalidateAfterToolCompletion(queryClient, client, cwd, toolFilePath)` (lines 34–49): debounced
500 ms (`DEBOUNCE_MS`, line 22), invalidates the `["file"]` and `["explorer"]` TanStack Query
families and fires an explicit `checkout_refresh_request`. Its own header comment (lines 7–10) is
explicit that **the daemon does NOT push `checkout_status_update` automatically after a
git-affecting tool completion** — this invalidation is entirely reactive to the *web-client's own*
knowledge that an agent tool just ran, not to any daemon-side file-change signal. This is the
client-side half of the "no live file events exist" finding below.

### 2.6 Daemon-side file watching: **confirmed absent**

- `grep -rn "chokidar|fs\.watch|watchFile|FSWatcher" packages/server/src packages/cli/src` →
  **zero matches**. No filesystem watcher exists anywhere in the daemon or CLI.
- `packages/server/src/projects/workspace-git-service.ts:4–8`'s own header comment claims
  "Recomputation is change-driven (a filesystem watcher calls `refresh()`)" — the **watcher** half is
  stale/aspirational: reading the class body (`workspace-git-service.ts:17–69`), `refresh(cwd)` is a
  public method with no internal timer or watcher. It has two kinds of caller, and the distinction
  matters for §3.2's design:
  1. `checkout_refresh_request`'s handler (`git-checkout-rpc.ts:71–78`), fired by the client
     (`files-changed.ts:46`) after a debounced guess that an agent tool touched something.
  2. **Every mutating git RPC** — `git-operations.ts` wraps it in a private `refresh(cwd)` (lines
     252–254) called from ~9 sites after commit/checkout/branch/merge/reset (159, 173, 178, 189,
     196, 199, 206, 227, 234).
  So daemon-initiated git mutations *do* push correctly today. What is missing is any reaction to a
  change the daemon did not itself perform — an external editor, a shell command, a build step,
  `git` run in a pi-studio terminal. **No OS-level file event reaches the daemon in any form**, which
  is the gap §3.2 fills. The new watcher is a separate `file_changed` path; it does not call
  `refresh()` and does not alter git-status behavior.
- Confirms the user's framing exactly: "file update live events should be handled by the daemon if
  not already implemented" — it is not implemented, in any form, for any file. This scope
  therefore includes building it from scratch (§3.2).

### 2.7 The one real push-notification precedent to follow: `checkout_status_update`

Full traced path, all 4 hops:

1. **Protocol** — `checkout_status_update` (and `checkout_status_subscribe`/`_unsubscribe`,
   `checkout_refresh_request`/`_response`) are **not** in the central Zod discriminated union
   (`packages/protocol/src/messages.ts:825–874` lists every member explicitly — these are absent).
   They fall through to the structural fallback, `sessionMessageBaseSchema = z.object({ type:
   z.string() }).passthrough()` (`messages.ts:882`), accepted by `sessionEnvelopeSchema`'s
   `z.union([sessionMessageSchema, sessionMessageBaseSchema])` (`messages.ts:894–898`). In other
   words: **not every push type needs a protocol-package schema entry** — the established
   convention for this family is a loosely-typed `{type, ...}` object, validated only by a local
   TypeScript interface at the point of use (see hop 4). This directly lowers the bar for adding
   `file_changed`: no change to `packages/protocol/src/messages.ts`'s big union is required,
   consistent with how `checkout_status_update`/`file_read_request`/`file_diff_request` all work
   today.
2. **Server emit** — `git-checkout-rpc.ts:29–42`, `registerGitCheckoutHandlers`'s
   `checkout_status_subscribe` handler: keeps a `Map<string /* sessionKey:cwd */, unsubscribe>`
   (line 27), calls `gitService.subscribe(cwd, (projection) => session.send({ type: "session",
   message: { type: "checkout_status_update", cwd, projection } }))` (lines 34–39) — i.e. pushes
   **directly to the one requesting `Session`**, not a global broadcast. (Contrast: most other
   server pushes use the daemon-wide `broadcast(getActiveSessions(), message)` helper defined at
   `bootstrap.ts:210–221` and used for `agent_update`/`workspace_update`/etc. — a global fan-out
   filtered client-side by id. Both patterns coexist; per-session-scoped `send()` is the closer
   precedent for a per-*path* subscription, since not every connected session cares about every
   watched file.)
3. **Client SDK** — no `PiStudioClient`-level wrapper exists for this one (contrast
   `onWorkspaceUpdate`/`onAgentUpdate`, `packages/client/src/pistudio-client.ts:238–251`, which
   *do* wrap `daemon.onSessionMessage`). `checkout_status_update` is consumed via the lower-level
   `DaemonClient.onSessionMessage(handler)` (`packages/client/src/daemon-client.ts:246–250`)
   directly.
4. **Web-client consumer** — `hooks/use-checkout-status.ts:14–18` declares a local
   `CheckoutStatusUpdateMessage` interface, `lines 24–28` structurally narrow `unknown` to it via a
   type guard, `line 52` calls `client.connection.onSessionMessage((msg) => { if (cancelled)
   return; if (!isCheckoutStatusUpdate(raw)) return; … })`. Subscribes on `cwd` change, unsubscribes
   the old `cwd` first (header comment, lines 4–7).

**A new `file_changed` push follows this exact 4-hop shape** — no `PiStudioClient` wrapper needed
either (matches precedent), just a local interface + type guard in the new web-client hook.

### 2.8 Debounce/coalescing precedent

`TerminalManager` (`packages/server/src/terminal/terminal-manager.ts`): `coalesceMs` option
(default 4 ms, line 86), buffers PTY output in `pending: Uint8Array[]` per terminal and flushes via
one `setTimeout` (lines 231–242) — the established server-side pattern for "don't broadcast every
single low-level event, batch them over a short window." A filesystem watcher firing multiple
events per single logical save (common: editors write via temp-file + rename, or emit separate
`change`+`rename` events) should reuse the same shape: buffer per watched path, flush after N ms of
quiet.

### 2.9 Bundling / dependency footprint

- `@molviewer/core` (`^0.3.0`) is currently declared under **root** `package.json:53–55`
  (`"dependencies": { "@molviewer/core": "^0.3.0" }`) — this is the **only** entry the root
  `package.json` has under `dependencies` at all (root only otherwise has `devDependencies` for
  shared tooling: typescript, vitest, oxlint, oxfmt, `@types/node`, zod — `package.json:42–49`).
  This is inconsistent with every other runtime dependency in the repo, which lives in the
  workspace package that actually imports it (e.g. `@xterm/xterm`/`@xterm/addon-fit` are declared
  in `packages/web-client/package.json:35–36`, not root). It was added by the user's ad hoc `npm i
  @molviewer/core` run from the repo root without a `-w` flag. **Cleanup item**: move the
  dependency into `packages/web-client/package.json` and drop it from root.
- Real installed sizes (`du -sh node_modules/@molviewer/core/dist/*`):
  `molviewer.js` 4.3 MB, `molviewer.js.map` 13 MB (not shipped to the browser — sourcemap only),
  `style.css` 88 KB, `types/` 688 KB (d.ts only, not bundled).
- `vite.config.ts:37–66` — `manualChunks(id)` already special-cases most heavy deps into named
  vendor chunks (`vendor-markdown`, `vendor-highlight` for shiki, `vendor-terminal` for `@xterm`,
  `vendor-motion`, `vendor-overlays`, `vendor-query`, `vendor-dnd`, `vendor-icons`, `vendor-react`)
  and falls through everything else to a single catch-all `"vendor"` chunk (line 65). Without a new
  rule, molviewer's 4.3 MB would land in that shared `"vendor"` bucket, inflating every page load
  even for users who never open a molecule tab. **Needs its own
  `if (id.includes("molviewer") || id.includes("molstar")) return "vendor-molviewer";`** rule, and
  the *component itself* must be lazy-loaded (`React.lazy`, exactly like every other entry in
  `VIEWER_BY_KIND`/`PANEL_BY_KIND` already is, e.g. `viewer-registry.ts:18–26`) so the chunk is
  fetched only when a molecule tab actually opens — this is a `Suspense` boundary the registry
  already provides for free (`FilePanel.tsx:76–78`).
- CSS import precedent: third-party stylesheets are imported directly at the component-module
  level, not centrally. **Confirmed during implementation:** `TerminalPanel.tsx` imports
  `@xterm/xterm/css/xterm.css` directly at the component-module top level (plain `import "...";`
  statement, line 7). `MoleculeViewer.tsx` follows the exact same pattern: `import
  "@molviewer/core/style.css";` at the module top. `package.json`'s `sideEffects: ["**/*.css"]`
  (molviewer's own `package.json:12–15`) confirms Vite/Rollup won't tree-shake it away.
- React version: web-client is on `react@^19.2.7`/`react-dom@^19.2.7`
  (`packages/web-client/package.json:40–41`); molviewer's peer range is `^18.3.0 || ^19.0.0`
  (molviewer `package.json:59–63`) — compatible, no action needed.
- Test implications: **confirmed, no issue.** This repo has no jsdom test environment configured
  anywhere — `@testing-library/react` is a listed `devDependency` but `jsdom` itself is not
  installed in `node_modules`, and no Vitest config sets a DOM `environment`; `.tsx` files are not
  discovered as test files under the root node-environment config at all (`packages/web-client/
  AGENTS.md`'s own testing-convention note). So `MoleculeViewer.tsx` — and every other
  component/hook this sprint added with real branching logic — is never imported by a test at
  all; each extracts its real logic into a plain, framework-free function or factory
  (`shouldApplyRefresh`, `moleculeSource`, `watchFile`, `createExplorerWatcher`,
  `mergeFileTextState`, `selectTextViewerState`) that IS unit-tested directly, with the
  component/hook itself left as thin, untested glue verified only by typecheck + the live E2E
  pass (§ below). No mocking of `@molviewer/core` was needed because no test ever imports it.

### 2.10 Tab mounting/lifecycle — `TabPanelHost.tsx`

All tabs across all workspaces stay mounted permanently; switching tabs toggles `display:none`
(`TabPanelHost.tsx:1–8` header comment, `line 69`: `clsx(styles.panel, tab.id === activeTabId &&
styles.active)`) — panels are **never** unmounted on tab-switch, only hidden. Two consequences for
a `MoleculeViewerPanel`:

- Good: molviewer's own component-owned state (camera, selection, undo stack) survives tab
  switches for free — no extra persistence work.
- Needs attention: `TerminalPanel.tsx` demonstrates a pattern — a `ResizeObserver` on the container
  (`TerminalPanel.tsx:227–230`) **and** an explicit re-fit effect keyed on `isActive = activeTabId
  === tab.id` (`TerminalPanel.tsx:246–249`, `useEffect(() => { if (!isActive) return;
  fitAddonRef.current?.fit(); }, [isActive])`), because a `display:none` element reports a
  zero-size layout box. **Resolved during implementation:** rotated the molecule's camera via a
  mouse drag on the canvas, switched to a different tab and back, then compared a canvas pixel
  checksum (canvas.toDataURL()) before and after — exact match, same 623×813 canvas size, same
  rendered pixels. Confirms Molstar's own internal `ResizeObserver` on its canvas container
  handles the hidden-to-visible transition correctly on its own. `MoleculeViewer.tsx`'s `isActive`
  prop is accepted (for a future escape hatch) but is NOT currently wired to any manual re-fit
  call, and this was the right call — no re-fit workaround was needed.

### 2.11 Empty-state — no new UI needed

Confirmed directly in molviewer's own source: `MolViewer.tsx:739` — `{ui.emptyState && !ready &&
state.status !== 'loading' && state.tool !== 'draw' && <FirstRunCard onFiles={onFiles} />}`. An
uncontrolled `<MolViewer />` with no `source` prop already renders a drag-drop/file-pick empty
state on its own. "New molecule view" from the TabStrip "+" menu is therefore just: mint a tab,
mount `<MolViewer />` with no `source` — zero new UI work for the empty case itself.

## 3. Proposed architecture

### 3.1 Web-client: new viewer kind (behaviors 1 + 2, no daemon changes needed)

| File | Change |
|---|---|
| `viewer-registry.ts` | Export `MOLECULE_EXTENSIONS` (`pdb, mol, mol2, cif, mmcif, xyz, extxyz, gro, lammpstrj, xsf` — **no** `data`, per §4.1) and `isMoleculeFile(path): boolean`. No new `ViewerKind`, no new `VIEWER_BY_KIND` entry (§4.3). |
| `MoleculeViewer.tsx` (new) | The shared mount: `{ path: string \| null }` → when `path` is set, `useFileDownload(path, Boolean(path))` → hand molviewer the object URL directly (`<MolViewer source={{ url, name }} …/>`, no decode step — see §2.3); `sourceMode` is `"replace"` on first load, `"update"` thereafter (§3.3). When `path` is `null`, render `<MolViewer />` bare (built-in empty state, §2.11). Owns the "reload iff not modified" gate (§3.3). |
| `MoleculeViewerPanel.tsx` (new) | Thin `PanelProps` → `MoleculeViewer` adapter: reads `tab.data.path`, no header, no File/Diff toggle. Both the explorer-opened and the "+"-menu-opened tab render this one panel — one mount path, two data shapes. |
| `tab-store.ts` | Add `"molecule"` to `TabKind` (line 20); `MoleculeTabData { path: string \| null }` **added to the `TabData` union** (line 42, else `Tab.data` rejects `{ path: null }`); `tabIds.molecule(pathOrSeq)`; `openNewMolecule(workspaceCwd)` for the empty case, mirroring `openNewTerminal` (`tab-store.ts:211–221`, numbered off the module-level counter at line 206). |
| `panel-registry.ts` | Add `molecule: lazy(() => import("…/MoleculeViewerPanel"))` to `PANEL_BY_KIND`. Compile-enforced: the map is `Record<Tab["kind"], …>`, so adding the `TabKind` forces this entry. |
| `FileExplorer.tsx` | Inside `handleOpenFile` (lines 82–91, the only site that opens `kind: "file"` tabs — and called both by the row click and by `submitDraft`'s create-then-open at line 101): pick `kind`/`id`/`data` via `isMoleculeFile(path)` — molecule files open `kind: "molecule"`, everything else unchanged. |
| `TabStrip.tsx` | Add `molecule: <icon>` to `ICON_BY_KIND`; add a third `DropdownMenu.Item` calling `openNewMolecule(cwd)`. |
| `vite.config.ts` | Add `vendor-molviewer` manualChunks rule. |
| `packages/web-client/package.json` | ~~Add `@molviewer/core`~~ — **already done** in commit `6bd8232`; declared at line 27. |
| root `package.json` | ~~Remove the misplaced entry~~ — **already done**; the root now has no `dependencies` field at all. |

### 3.2 Daemon: file-watch subsystem (behaviors 3 + 4 — the genuinely new piece)

Mirrors `WorkspaceGitService` (§2.7/2.6) structurally, but keyed by absolute path instead of cwd,
and backed by a **real** `fs.watch`, since none exists anywhere today.

**`FileWatchService`** (new, `packages/server/src/files/file-watch-service.ts`):
- `subscribe(path: string, listener: () => void): () => void` — same shape as
  `WorkspaceGitService.subscribe`. `path` may be a **file or a directory**: a file subscriber is
  filtered by basename, a directory subscriber hears every child create/delete/rename (behavior 4).
  One service, two subscription flavors, one watcher pool.
- Internally: one `fs.watch(dirname(path), { persistent: false })` per **directory** (not per
  file) — deliberate, not `fs.watch(path)` directly, because editors/agents commonly save via
  write-to-temp + atomic rename, which unlinks the original inode; watching the file handle directly
  silently stops firing after the first such save on some platforms/filesystems. Filter events by
  `path.basename === basename(watchedPath)` inside the directory watcher's callback.
- Debounce per path at **150 ms** (`FILE_WATCH_COALESCE_MS`), using the `TerminalManager`
  `coalesceMs` shape (§2.8) — collapses the write+rename event burst into a single push. Chosen
  over terminal's 4 ms (that value exists for keystroke-latency reasons that don't apply to a file
  save) and comfortably under `files-changed.ts`'s 500 ms client debounce (§2.5), so a
  daemon-pushed `file_changed` never races the client's own post-tool invalidation.
- One directory watcher shared across every subscribed file in that directory (ref-counted); torn
  down when its last subscriber unsubscribes — avoids N duplicate `fs.watch` handles for N files in
  one folder (a real MD project keeps trajectory + topology + log files side by side).
- No new dependency: Node's built-in `fs.watch` is sufficient for this — cross-platform caveats
  (`recursive` option is macOS/Windows-only, irrelevant here since we watch one directory
  non-recursively) are the only wrinkle, not a blocker.

**Protocol** (no `messages.ts` union change required, per §2.7 hop 1 precedent):
- `file_watch_subscribe_request { type, requestId, path }` / `_response { type, requestId, ok }`
- `file_watch_unsubscribe_request { type, requestId, path }` / `_response`
- Server push: `{ type: "file_changed", path }` (no payload beyond the path — the client already
  knows how to re-fetch; keeping this minimal also sidesteps re-sending file content over the
  RPC/text-frame channel for potentially multi-MB trajectories — the client re-downloads via the
  existing chunked binary path, §2.3).

**Server wiring**: new `registerFileWatchHandlers(registry, { fileWatchService, subscriptions })`
in `packages/server/src/files/`, registered from `bootstrap.ts` alongside the existing
`file_read_request`/`checkout_*` handlers. Pushes go to the subscribing `Session` via
`session.send(...)` directly (not the global `broadcast()` helper) — only sessions that actually
subscribed to that path should hear about it. Per-session subscription bookkeeping goes through the
new shared `SessionSubscriptions` registry rather than a module-local `Map`, so disconnect cleanup
is handled once for every subscription family — see §4.5.

**Web-client**: two consumers of one hook family.
- `hooks/use-file-watch.ts` (new), structurally identical to `use-checkout-status.ts` (§2.7 hop 4)
  — subscribe on `path` change, unsubscribe the previous path, local `FileChangedMessage` interface
  + type guard, `client.connection.onSessionMessage(...)`. Consumed by `MoleculeViewer` (§3.3).
- `hooks/use-explorer-watch.ts` (new) for behavior 4: diffs `explorer-store`'s `expanded` set across
  renders (subscribe newly expanded, unsubscribe collapsed, leave the rest alone — never tear down
  and re-subscribe the whole set), one shared `onSessionMessage` handler, and invalidates exactly
  `rpcKeys.explorer(path)` per push rather than the whole `["explorer"]` family. Called from
  `FileExplorer.tsx` next to the existing `useExplorerTree(expanded)` (line 68).

### 3.3 "Don't clobber user edits" — the actual gating logic

`MoleculeViewer.tsx` ties it together:

```tsx
const ref = useRef<MolViewerHandle>(null);
const [modified, setModified] = useState(false);
// path is null for a "+"-menu tab: no fetch, no watch, bare <MolViewer /> empty state.
const download = useFileDownload(path);
const watch = useFileWatch(path); // { changedAt: number | null } — bumps on each file_changed push

useEffect(() => {
  if (!watch.changedAt) return;
  // User has unsaved in-viewer edits — do NOT clobber them. Also the reason no echo-suppression
  // window is needed for a future in-viewer save: see §4.6.
  if (modified) return;
  void download.refetch().then((r) => {
    if (r.data) ref.current?.update({ name: fileName, text: r.data.text });
  });
}, [watch.changedAt]);
```

This is exactly the behavior `AGENTS.md §3`'s dirty-tracking section (rewritten in the prior
session, `docs/molviewer-core-doc.md`) describes: `onModifiedChange` fires only on the
clean↔dirty transition, and `update()`/`sourceMode="update"` is the non-destructive reload that
preserves camera/selection — the whole reason that mode exists instead of always using `"replace"`.
No new molviewer-side capability needed; this is pure composition of what the component already
exposes.

## 4. Resolved decisions

### 4.1 LAMMPS `data` files — not auto-detected in v1

`EXT_TO_VIEWER`-style extension matching genuinely cannot identify them (`data.lammps`, `in.data`,
or no extension at all), and the alternative — content-sniffing for `Masses`/`Atoms` section
headers — would turn `detectViewerKind`/`isMoleculeFile` from a pure synchronous string function
into something that has to read file bytes. That is a real architectural cost (async, needs the
file content before it can pick a tab kind, i.e. before the panel that fetches content even
mounts) for one format. **Resolution: ship the other ten formats; `data` files open as text.**

### 4.2 Manual "open as molecule" escape hatch — not in v1

Deliberately paired with §4.1: the escape hatch's only real justification was covering the LAMMPS
`data` gap, and adding a `FileContextMenu` action whose sole purpose is a format nobody in this
repo has asked for yet means shipping a code path with no exercised use case. **Resolution: skip.**
Deferring is cheap by construction — `openNewMolecule(cwd)` already accepts the empty case, so a
later escape hatch is one `FileContextMenu.tsx` item plus an optional `path` argument, with no
rework of anything decided here. If a LAMMPS user shows up, §4.1 and §4.2 land together as one
small follow-up.

### 4.3 Dedicated `MoleculeViewerPanel` + own `TabKind` — not `FilePanel`

Molecule tabs are `kind: "molecule"` and render one dedicated panel, with no File/Diff toggle.
Reasoning:

- The empty "+"-menu tab has **no path at all**. Routing it through `FilePanel` would mean
  special-casing that component's entire premise (`FilePanel.tsx:49–52` reads a path, detects a
  viewer kind, and renders a File/Diff header around it) for a tab that has none of those things.
- Nothing is lost: `.pdb` diffs still come from the git Changes panel (`ChangesPanel.tsx:32–37`),
  which is a separate `kind: "diff"` tab and completely unaffected (§2.2).
- Both entry points converge on **one** `MoleculeViewer` mount (§3.1) whose only variable is
  `path: string | null`, so the file-backed and empty cases share all the `<MolViewer>` wiring —
  no duplicated props/handle/dirty-tracking logic, which was the thing worth avoiding here.
- `TabKind`'s two `Record<TabKind, …>` maps (`ICON_BY_KIND` at `TabStrip.tsx:33–37`,
  `PANEL_BY_KIND` at `panel-registry.ts:20–25`) make the additions compile-enforced — the type
  checker names every site that needs updating, so there is no discovery risk in this change.

### 4.4 File-watch debounce — 150 ms

`FILE_WATCH_COALESCE_MS = 150`. Rationale in §3.2: above terminal's latency-driven 4 ms, well
below the client's existing 500 ms invalidation debounce so the two never fight.

### 4.5 Subscription cleanup on disconnect — fixed properly, once, for both families

The leak is real and confirmed: `git-checkout-rpc.ts:27`'s `statusUnsubs` map is only ever cleared
by an explicit `checkout_status_unsubscribe` (handler at lines 44–50) or a same-key re-subscribe
(line 33), and `ws-server.ts`'s `ws.on("close")` handler (lines 157–172) does nothing for
subscriptions — line 159 removes the session from its own map, the rest just logs. There is no
hook through which a handler module can learn a session died. A dropped connection (lid closed,
tab crashed, network drop) therefore leaves that session's `WorkspaceGitService` listener alive
forever. Copying that shape for file watching would be strictly worse than the git case, because a
leaked file subscription also pins an OS-level `fs.watch` handle.

**Resolution — three small pieces, ~40 lines total:**

1. `packages/server/src/ws/session-subscriptions.ts` (new): `SessionSubscriptions` with
   `add(session, key, unsub)`, `remove(session, key)`, `disposeSession(session)`. A
   `WeakMap<Session, Map<string, () => void>>` — nothing more.
2. `ws-server.ts`: new optional `onSessionClose?: (session: Session) => void` in `WsServerDeps`
   (next to the existing `onMessage`/`logger`, lines 43–45), invoked from the `ws.on("close")`
   handler at line 157 alongside `sessions.delete(session)`.
3. `bootstrap.ts`: construct one `SessionSubscriptions`, pass it to both
   `registerGitCheckoutHandlers` and the new `registerFileWatchHandlers`, and wire
   `onSessionClose: (s) => subscriptions.disposeSession(s)`.

This replaces `git-checkout-rpc.ts`'s module-local `statusUnsubs` map with the shared registry —
i.e. the existing leak is fixed as part of this work, not merely avoided in new code. It is the
one piece of pre-existing-bug cleanup this feature justifies touching, because the feature would
otherwise duplicate the bug.

### 4.6 Self-triggered reload after a future in-viewer save — already handled

No extra guard. The §3.3 `modified` check is sufficient by construction: a save can only happen
while `modified === true`, and the earliest a save could flip it to `false` is after the write
completes — at which point re-reading the file the viewer just wrote is a no-op that produces the
content already on screen (and `sourceMode="update"` preserves camera/selection anyway, so even
the redundant case is invisible). A timestamp/echo-suppression window would be complexity paying
for nothing. Worth a one-line code comment at the guard, no more.

## 5. Implementation order

Two halves; the web-client half delivers behaviors (1) and (2) with **no daemon changes at all**, so
it can ship and be smoke-tested first. Behaviors (3) and (4) share the daemon watcher but are
independent consumers, verified separately. **All six steps completed and smoke-tested in
sprint-044 (tasks 001-009); see implementation results above.**

1. **Bundling** — add the `vendor-molviewer` `manualChunks` rule (`vite.config.ts:37–66`). The
   dependency move this step used to describe (root `package.json` → `packages/web-client`) already
   landed in commit `6bd8232`; `@molviewer/core` now sits at `packages/web-client/package.json:27`
   and the root has no `dependencies` field at all.
2. **Viewer + panel** — `isMoleculeFile`/`MOLECULE_EXTENSIONS` in `viewer-registry.ts`;
   `MoleculeViewer.tsx`; `MoleculeViewerPanel.tsx`; `TabKind`/`tabIds`/`openNewMolecule` in
   `tab-store.ts`; `PANEL_BY_KIND` + `ICON_BY_KIND` entries; `FileExplorer.tsx` kind selection;
   `TabStrip.tsx` third menu item. **Smoke test:** open a `.pdb` from the explorer, open an empty
   molecule tab from "+", switch tabs and back (checks the ResizeObserver concern above). ✓
3. **Daemon file-watch** — `SessionSubscriptions` + `ws-server.ts` `onSessionClose` +
   `git-checkout-rpc.ts` migration (§4.5), then `FileWatchService`, then
   `registerFileWatchHandlers` + `bootstrap.ts` wiring. ✓
4. **Live reload wiring** — `use-file-watch.ts`, then the §3.3 gate in `MoleculeViewer.tsx`.
   **Smoke test:** open a `.pdb`, edit it on disk (`sed` append), confirm the viewer reloads
   with camera preserved; then make an in-viewer edit, touch the file again, confirm it does *not*
   reload. ✓
5. **Live file tree** — `use-explorer-watch.ts` + one call site in `FileExplorer.tsx`.
   **Smoke test:** with the tree open, `touch`/`mv`/`rm` a file in an expanded directory from an
   external shell and `git checkout` a branch that adds+deletes files; rows update within ~1 s with
   no manual refresh, and collapsing a directory releases its watcher. ✓
6. **Large-file ceiling** (independent — implementable in parallel with any of the above):
   `files/limits.ts`'s `MAX_INLINE_FILE_READ_BYTES`, the async `file_read_request` in both
   bootstraps, `use-file-text.ts`, and `TextViewer`'s three-state branch. **Smoke test:** open 2 MB,
   12 MB and 48 MB fixtures — inline, streamed, download-only respectively — and confirm the daemon
   stays responsive during the 12 MB read. ✓
## 6. Non-goals (explicitly out of scope for this pass)

- A "Save" action that writes viewer edits back to disk (`exportFile()` exists on the handle;
  wiring a save button is a separate, later feature — same status as README's own "Save Changes"
  example, which is host-app-provided, not built into molviewer).
- Trajectory playback UX beyond what `<MolViewer>` already provides out of the box.
- Auto-detection of LAMMPS `data` files and the manual "open as molecule" action (§4.1, §4.2) —
  deliberately deferred as a pair.
- Live refresh of an **open text file's contents** when it changes on disk (`rpcKeys.fileRead`).
  Same primitive, obvious follow-up — but it needs its own answer to the unsaved-editor-state
  question that §3.3 answers for the molecule viewer, so it is not smuggled in here.
- `CheckoutDiffManager`'s subscriptions (`git-checkout-rpc.ts:52–69`). Keyed by a manager-issued
  `subscriptionId` rather than per session, so they almost certainly share the §4.5 disconnect leak
  — recorded as a `TODO(verify)`, not fixed, because migrating them is a larger change with its own
  risk profile.
- Any *behavioral* change to git checkout/status. The one exception, agreed in §4.5:
  `git-checkout-rpc.ts`'s per-session subscription bookkeeping is migrated onto the shared
  `SessionSubscriptions` registry, which fixes its existing disconnect leak. That is a
  correctness-preserving refactor of cleanup only — no change to what `checkout_status_update`
  computes, sends, or when.

## 7. Implementation plan

Completed as `swe/sprints/sprint-044-molecule-viewer-live-files/` — 10 tasks in
`backlog/`, indexed in `swe/sprints/PLAN.md`. Tasks 001–004 were the web-client
molecule viewer (no daemon changes), 005–008 the live-update subsystem (005 first fixed the §4.5
leak), 009 the raised file-read ceiling (§2.3, independent of both halves). Task 010 is
implementation-complete; this doc now records the sprint's delivered scope and smoke-test results.
