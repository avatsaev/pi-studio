# Technical scope — `@molviewer/core` as a pi-studio file-viewer module

&gt; Status: **scope only, no code written yet.** Every claim below is grounded in the actual
&gt; installed/checked-out source (file:line references throughout); no upstream prose docs were
&gt; trusted uncritically (see `docs/molviewer-core-doc.md` for the prior audit of molviewer's own
&gt; docs, which had several stale API descriptions).

## 0. The four requirements, restated precisely

1. Opening a supported molecule file from the file explorer opens molviewer, not the text viewer.
2. An **empty** molviewer can be opened from the TabStrip's trailing "+" menu.
3. When the file backing an open molviewer tab changes on disk, the viewer auto-reloads the new
   geometry **iff the user has made no in-viewer edits** — otherwise it must not clobber those
   edits. This requires the daemon to detect and push disk-file-change events, which today it
   does not do at all (verified below).
4. (Implicit prerequisite of #3) the daemon needs a real file-change notification mechanism.

---

## 1. Current state — grounded findings

### 1.1 Web-client file-viewer/tab infrastructure

Two independent, exhaustive `Record&lt;Kind, Component&gt;` registries, both lazy-loaded, both with an
explicit "add one entry here, nothing else" doc-comment:

- **`panel-registry.ts`** (`packages/web-client/src/features/workspace/panel-registry.ts:20-25`)
  maps `Tab["kind"]` → panel component: `{ chat: ChatPanel, file: FilePanel, diff: FilePanel,
  terminal: TerminalPanel }`.
- **`viewer-registry.ts`** (`packages/web-client/src/features/files/viewer-registry.ts:29-35,
  37-70`) maps a narrower `ViewerKind = "text"|"markdown"|"image"|"video"|"binary"` → viewer
  component, selected by `detectViewerKind(path)` from the file extension (`EXT_TO_VIEWER`) with
  a MIME-prefix/`isBinary` fallback. **No molecular extension is registered anywhere** — `.pdb`,
  `.mol`, `.mol2`, `.cif`, `.xyz`, `.gro`, LAMMPS `.lammpstrj`/`data`, POSCAR, `.xsf` all fall
  through to the `"text"` default and would render as raw garbled text today.

Full open path (`FileExplorer.tsx:82-91` → `tab-store.ts` → `panel-registry.ts` →
`FilePanel.tsx:38-95` → `viewer-registry.ts`):

```
TreeNode row click → FileExplorer.handleOpenFile(path)
  → useTabStore.open({ kind: "file", data: { path }, id: tabIds.file(path), ... })
  → TabPanelHost renders PANEL_BY_KIND["file"] = FilePanel for that tab
  → FilePanel calls detectViewerKind(path) → VIEWER_BY_KIND[kind]
  → lazy-loaded viewer component receives { path } and fetches its own content
```

`Tab`/`TabKind` union, verbatim (`tab-store.ts:20-53`):

```ts
export type TabKind = "chat" | "file" | "diff" | "terminal";

export interface FileTabData { path: string; }
export interface DiffTabData { path: string; staged: boolean; }
export interface ChatTabData { sessionId: string; }
export interface TerminalTabData { slot: number | null; cwd: string; }

export type TabData = ChatTabData | FileTabData | DiffTabData | TerminalTabData;

export interface Tab {
  id: string; kind: TabKind; label: string; closable: boolean;
  data: TabData; workspaceCwd: string;
}
```

`TabPanelHost.tsx:62-77` keeps every open tab's panel **mounted but hidden** (`display:none` via
a CSS class), never unmounting on tab-switch — only on real tab close. This is why
`TerminalPanel` needs (and has) resize-refit logic for the hidden→visible transition (§4.3 below);
a WebGL-backed molviewer panel will need the same.

**File content fetching** — two hooks, no shared abstraction:
- `use-file-read.ts:22-37` — `file_read_request` RPC, returns the **whole file as one UTF-8
  string in a single response, capped at 512 KB server-side**
  (`packages/server/src/daemon/bootstrap.ts:464-483`: `if (stat.size &gt; 512 * 1024) return {
  ok:false, error:"file_too_large" }`). Used by `TextViewer`/`MarkdownFileViewer`.
- `use-file-download.ts:22-64` — chunked binary transfer (`file_download_token_request` →
  `file_download_request` → `Begin`/`Chunk`/`End` binary frames via
  `packages/server/src/files/file-transfer.ts`, streamed with `createReadStream`, **no size cap**)
  → assembled into a `Blob` → `URL.createObjectURL`. Used by `ImageViewer`/`VideoViewer`.

**TabStrip "+" menu** (`TabStrip.tsx:33-38,90-118`) has exactly two items today, both calling a
`tab-store.ts` helper (`openNewChat`/`openNewTerminal`) that mints an id via `tabIds.*` and calls
`useTabStore.getState().open(...)`. `ICON_BY_KIND` (`TabStrip.tsx:33-38`) is a `Record&lt;TabKind,
Icon&gt;` — **exhaustive**, so any new `TabKind` forces a new entry here (compile error otherwise).

**Cache invalidation on file change** — `lib/connection/files-changed.ts:34-49`:
`invalidateAfterToolCompletion` is a 500ms-debounced bulk invalidation of the `["file"]`/
`["explorer"]` TanStack Query families, plus an explicit `checkout_refresh_request`. Its **sole
call site** is `hooks/agent-stream-events.ts`, on a `tool_call` timeline event reaching
`status:"completed"` for `toolMutatesFiles(tool)` (write/edit/shell). **This is reactive to the
current chat session's own agent tool calls, not to the filesystem** — a file changed by anything
else (another editor, another daemon client, `git checkout`, a background script) produces no
signal at all.

**Precedent for "don't clobber user edits on refresh": none.** Every existing viewer
(`TextViewer`, `MarkdownFileViewer`, `CodeView` — CodeMirror mounted `editable={false}`/
`readOnly` — `ImageViewer`, `VideoViewer`, `BinaryFallbackViewer`, `DiffView`) is strictly
read-only. Molviewer's `isModified()`/`onModifiedChange` + a conditional refresh gate would be
**the first instance of local-draft-vs-server-state reconciliation anywhere in this codebase.**

### 1.2 Daemon-side live-push infrastructure — the checkout-status precedent (and its gaps)

There is **no filesystem watcher anywhere in the monorepo.** Grepped for `chokidar`, `fs.watch`,
`FSWatcher`, `watchFile` across every `packages/*/src` — zero matches.

The closest analogous *live push* feature is git checkout status
(`packages/server/src/projects/workspace-git-service.ts` + `git-checkout-rpc.ts`), and it is
architecturally the right template — **but its own doc-comment is wrong**, and it has two real
gaps worth knowing before copying it:

- `workspace-git-service.ts:5-7` claims "Recomputation is change-driven (a filesystem watcher
  calls `refresh()`), never polled." **There is no filesystem watcher.** `refresh()` is called
  from exactly three places, all client-triggered RPCs, never a daemon-internal watcher:
  `RightSidebar.tsx:37`, `use-checkout-status.ts:60,74`, and `files-changed.ts:46` — i.e. the
  "live" status update is really "the client asks again after every mount/reconnect/tool-call and
  a subscribed session gets pushed the result if it changed." Nothing pushes proactively when a
  file changes outside of those trigger points.
- **The checkout messages (`checkout_status_update`, `checkout_status_subscribe`, etc.) have no
  Zod schema anywhere in `packages/protocol`** — grepped `messages.ts` and the whole protocol
  package, zero matches. They're sent as raw object literals
  (`git-checkout-rpc.ts:35-38: session.send({ type:"session", message:{ type:"checkout_status_update", cwd, projection } })`)
  and consumed via a hand-written structural type guard on the client
  (`use-checkout-status.ts:20-32`). They only parse at all because
  `sessionEnvelopeSchema` (`messages.ts:894-897`) falls back to `sessionMessageBaseSchema`
  (`messages.ts:882`: `z.object({ type: z.string() }).passthrough()`) for any `type` not in the
  strict `sessionMessageSchema` union. This is a real deviation from the root `AGENTS.md`
  invariant that the protocol package is "the single shared contract" — **do not repeat it**; the
  new file-watch messages should get real schemas (§2.2 below).
- **Per-session subscriptions leak on disconnect.** `git-checkout-rpc.ts:26-27,33-40` keeps a
  `Map&lt;sessionKey:cwd, unsubscribe&gt;` (`statusUnsubs`), but `ws-server.ts`'s `ws.on("close", ...)`
  handler (`ws-server.ts:157-170`) only does `sessions.delete(session)` — there is **no
  `deps.onSessionClose` hook** exposed for downstream services to clean up their own per-session
  state on disconnect. A client that disconnects without explicitly calling
  `checkout_status_unsubscribe` leaks its listener in `WorkspaceGitService.watched` until daemon
  restart. For an in-memory `Set` entry this is cheap; for a new file-watch service holding a real
  `fs.watch()` OS handle per watched path, the same leak is a genuine resource leak in a
  long-running daemon and should be **fixed**, not copied (§2.2).

Registration point for new services: `packages/server/src/daemon/bootstrap.ts:407-427` — where
`WorkspaceGitService`/`registerGitCheckoutHandlers` are constructed and wired; the new
`FileWatchService`/`registerFileWatchHandlers` slot in right beside it.

Feature gating: `checkout_refresh_request` is registered conditionally on a plain boolean
(`checkoutRefreshEnabled: true`, `bootstrap.ts:413`), advertised to clients via
`SERVER_FEATURES` (`packages/protocol/src/client-capabilities.ts:40-42,70-72`) — `defaultFeatures()`
(`ws-server.ts:54-56`) auto-advertises every key in `SERVER_FEATURES` as `true` unless overridden.
A new `fileWatch` key follows the identical pattern.

### 1.3 `@molviewer/core` API surface relevant to this integration

Fully documented in `docs/molviewer-core-doc.md` (written against the actual installed source,
cross-checked against upstream). The load-bearing facts for this scope:

- `MolViewerSource` accepts `{ url: string; name?: string }` — molviewer does its own `fetch()`.
  **This means a browser object URL from `useFileDownload` can be handed to molviewer directly as
  `source={{ url: objectUrl, name: fileName }}`** — no new content-fetching code needed on the
  pi-studio side, and no 512 KB text-RPC cap, since it rides the same unbounded chunked binary
  path already used for images/video.
- `sourceMode: 'replace' | 'update'` (prop, not part of `source`): `'update'` "swaps geometry
  only. Camera, settings, selection (if atom count is stable)... are all preserved; ... the
  viewer becomes unmodified again" — **this is exactly the auto-refresh behavior requirement #3
  asks for**, already built into the library; pi-studio only needs to gate *whether* to feed a new
  `source` at all, not reimplement "preserve camera on reload."
  Changing `source` re-triggers a load only when the reference changes (`Object.is` check), so a
  fresh `{url, name}` literal on every render would thrash — must be `useMemo`'d on the download
  query's data.
- `onModifiedChange(modified: boolean)` fires only on the clean↔dirty transition; `ref.current
  .isModified()` reads it synchronously. This is the gate for requirement #3.
- `ui.emptyState` (default `true`) and `ui.dropToOpen` (default `true`) mean `&lt;MolViewer /&gt;` with
  **no `source` prop at all** already renders a first-run placeholder card with working
  drag-and-drop — satisfies requirement #2 with zero extra UI work.
- No `resize()`/`refit()` method exists on `RenderEngine` or `MolViewerHandle`. Mol*'s `Canvas3D`
  is expected to self-manage resize via its own internal `ResizeObserver`, same as any other
  WebGL canvas — but this is **unverified** for the specific "mounted under `display:none`, then
  flipped back to `display:block`" transition `TabPanelHost` uses. `TerminalPanel.tsx:227-230,
  247-249` is the existing, proven mitigation pattern for exactly this class of problem (a
  `ResizeObserver` on the container **plus** an effect keyed on `isActive =
  activeTabId === tab.id` that force-refits on tab-activate) — flagged as a required smoke-test
  in §4, with that pattern as the fallback if Mol*'s own ResizeObserver doesn't fire correctly.

### 1.4 Bundling / packaging implications

- `@molviewer/core` (`^0.3.0`, `molstar` peer bundled in) is currently a dependency of the **root**
  `package.json` only — zero references anywhere in `packages/*`. Every other workspace package
  declares its runtime deps explicitly even when hoisting would resolve them anyway
  (`packages/relay/package.json`, web-client's own 25+ deps) — adding
  `"@molviewer/core": "^0.3.0"` to `packages/web-client/package.json` dependencies is required to
  match convention.
- Dist sizes: `molviewer.js` = **4.3 MB**, `style.css` = **84.7 KB** (sourcemap 12.3 MB, not
  shipped/imported). React peer range `^18.3.0 || ^19.0.0` is satisfied by web-client's
  `^19.2.7` — no conflict, no dedup work needed.
- `vite.config.ts`'s `manualChunks` (lines ~44-70) has named branches for markdown/shiki/xterm/
  framer-motion/radix/tanstack/dnd-kit/icons/react, with everything else falling into one shared
  `'vendor'` catch-all chunk. **`@molviewer/core` matches no existing branch** — landing 4.3 MB in
  the shared vendor chunk would bloat every page load regardless of whether a molviewer tab is
  ever opened. Needs its own `manualChunks` branch.
- Both registries (`panel-registry.ts`, `viewer-registry.ts`) already lazy-load every entry via
  `lazy(() =&gt; import(...))` — so as long as the new molecule panel/viewer component is *also*
  registered this way (matching the existing convention exactly), its own chunk (however it's
  named) only downloads when a user opens a molecule tab, regardless of `manualChunks` naming.
- Third-party CSS import convention: side-effect import **inside the one component that needs
  it** (`TerminalPanel.tsx:18`: `import "@xterm/xterm/css/xterm.css";`), not centralized in
  `main.tsx`/global CSS. `@molviewer/core/style.css` follows the same rule.
- Root `vitest.config.ts` runs `environment: "node"` and only discovers `*.test.ts` (not
  `.test.tsx` — the include glob is `packages/*/src/**/*.test.ts`). Zero existing tests render any
  component tree. Adding molviewer introduces **no test-suite exposure** unless a new `.test.tsx`
  is explicitly added later (out of scope here — see §5 Non-goals).

---

## 2. Design decisions

### 2.1 Tab/viewer routing — two small additions, not one big one

Two distinct entry points need two distinct pieces of plumbing, because they have genuinely
different shapes (one has a `path`, one doesn't) and one of pi-studio's own registries
(`viewer-registry.ts`) only fires for tabs that go through `FilePanel`'s File/Diff toggle chrome:

**(a) File-explorer open (requirement #1)** → reuse `kind: "file"` tabs unchanged, add one
`ViewerKind` entry:
- `viewer-registry.ts`: add `"molecule"` to the `ViewerKind` union; add every supported extension
  to `EXT_TO_VIEWER` (`pdb`, `mol`, `mol2`, `cif`, `mmcif`, `xyz`, `extxyz`, `gro`, `lammpstrj`,
  `data`, `poscar`, `contcar`, `xsf` → `"molecule"`); add `molecule: MoleculeFileViewer` to
  `VIEWER_BY_KIND`.
- `FilePanel.tsx` needs **zero changes** — this is the exact "one new file + one/two registry
  entries" seam the doc-comment on `viewer-registry.ts:1-7` describes. The File/Diff toggle stays
  available for molecule files "for free" (all the listed formats are text, so the existing
  text-based diff view remains meaningful — e.g. seeing exactly what an agent's edit changed in a
  `.pdb`).
- New `MoleculeFileViewer.tsx` implements the existing `ViewerProps { path: string }` contract.

**(b) Blank molviewer from "+" (requirement #2)** → cannot reuse `kind:"file"` (no path to carry;
`FileTabData.path` is a required `string`, and `FilePanel`'s File/Diff toggle + `detectViewerKind`
call have nothing to do for a path-less tab). Needs one new tab kind:
- `tab-store.ts`: add `"molecule"` to `TabKind`; add `MoleculeTabData { path: null }` to `TabData`
  (always `null` — a blank tab never gains a path later; if the user drags a file into it,
  that's an in-memory `MolViewerSource`, not a pi-studio-tracked file path); add
  `tabIds.molecule: (n: number) =&gt; \`molecule-${n}\`` and an exported `openNewMolecule(cwd)`
  mirroring `openNewTerminal`'s shape (`tab-store.ts:208-221`) exactly (counter-based label,
  `useTabStore.getState().open(...)`).
- `panel-registry.ts`: add `molecule: MoleculeBlankPanel` (or reuse one shared component
  parameterized by `path: string | null` — see below).
- `TabStrip.tsx`: add `molecule: Atom` to `ICON_BY_KIND` (lucide-react ships an `Atom` icon,
  confirmed present in `node_modules/lucide-react/dist/esm/icons/atom.js`); add a third
  `DropdownMenu.Item` to `NewTabMenu` calling `openNewMolecule(cwd)`.

**Shared implementation**: both `MoleculeFileViewer` (registry entry, always has a `path`) and
the blank-tab panel render the same underlying `MoleculeViewerCore` component, parameterized by
`path: string | null`. When `path` is `null`, it renders bare `&lt;MolViewer /&gt;` (built-in empty
state + drag-drop, §1.3) with no download hook, no file-watch subscription, and no auto-refresh
logic — those only activate when `path` is non-null.

### 2.2 Daemon file-watch service — new, mirrors `WorkspaceGitService`, fixes its gaps

New `packages/server/src/files/file-watch-service.ts`:

```ts
export type FileChangeListener = (info: { mtimeMs: number; size: number }) =&gt; void;

export class FileWatchService {
  // Map&lt;resolvedAbsolutePath, { listeners: Set&lt;FileChangeListener&gt;; watcher: fs.FSWatcher; last: string | null }&gt;
  subscribe(path: string, listener: FileChangeListener): () =&gt; void { ... }
}
```

- Uses Node's native `fs.watch` (no new dependency — `chokidar` isn't used anywhere in this repo
  and would be the first). Debounced ~200ms per path (editors commonly emit multiple raw events
  per save; matches the spirit of `files-changed.ts`'s existing 500ms debounce convention on the
  client side).
- **Handles the native `fs.watch` rename gotcha explicitly**: many editors save via
  write-temp-then-rename-over-original, which changes the watched path's underlying inode; a
  watcher opened before the rename can silently stop firing further events on some platforms.
  On any `"rename"` event for the watched path, close and re-open a fresh `fs.watch` on the same
  path rather than assuming the existing watcher keeps working. This is exactly the class of bug
  `chokidar` normally papers over — since we're deliberately not adding that dependency (one file,
  one path, no recursive directory watching needed), it must be handled by hand here.
- Emits `{ mtimeMs, size }` (not a diff/content) — content is re-fetched via the existing
  `useFileDownload` path client-side; the daemon push is a signal, not a payload, exactly like
  `checkout_status_update` pushes a projection but relies on separately-issued RPCs for full
  content (diff/read).

RPC surface, registered in `bootstrap.ts` beside `registerGitCheckoutHandlers`
(`bootstrap.ts:407-427`), following the checkout precedent's per-session `Map` pattern but with
**real protocol schemas** this time (`packages/protocol/src/messages.ts`, appended into the
`sessionMessageSchema` discriminated union at `messages.ts:825-874`, append-only per root
`AGENTS.md` invariant #1):

```ts
export const fileWatchSubscribeRequestSchema = z.object({
  type: z.literal("file_watch_subscribe_request"), path: z.string(),
}).passthrough();
export const fileWatchSubscribeResponseSchema = z.object({
  type: z.literal("file_watch_subscribe_response"), path: z.string(), ok: z.boolean(),
}).passthrough();
export const fileWatchUnsubscribeRequestSchema = z.object({
  type: z.literal("file_watch_unsubscribe_request"), path: z.string(),
}).passthrough();
export const fileWatchUnsubscribeResponseSchema = z.object({
  type: z.literal("file_watch_unsubscribe_response"), path: z.string(), ok: z.boolean(),
}).passthrough();
export const fileChangedUpdateSchema = z.object({
  type: z.literal("file_changed_update"), path: z.string(), mtimeMs: z.number(), size: z.number(),
}).passthrough();
```

Feature flag: add `fileWatch: "fileWatch"` to `SERVER_FEATURES`
(`packages/protocol/src/client-capabilities.ts:40-42`) with a `COMPAT(fileWatch)` entry
(`client-capabilities.ts:70-72` pattern), auto-advertised `true` via `defaultFeatures()`.

**Required fix, not optional**: add a `deps.onSessionClose?.(session)` call to `ws-server.ts`'s
`ws.on("close", ...)` handler (`ws-server.ts:157-170`), threaded from `bootstrap.ts` to call both
the new file-watch cleanup **and** (while we're touching this) the existing
`registerGitCheckoutHandlers`'s `statusUnsubs` cleanup for that session. Native `fs.watch()`
handles are real OS file descriptors; leaking them across every tab-open/close/reconnect cycle in
a long-running daemon is a resource leak worth closing now rather than inheriting silently.

### 2.3 Client hook — `useFileWatch`, mirrors `use-checkout-status.ts`

New `packages/web-client/src/hooks/use-file-watch.ts`, structurally identical to
`use-checkout-status.ts:38-77`: subscribe on mount/path-change via `file_watch_subscribe_request`,
listen for `file_changed_update` via `client.connection.onSessionMessage`, unsubscribe on
unmount/path-change via `file_watch_unsubscribe_request`. Exposes the raw `{mtimeMs, size}` signal
to its caller via a callback prop — no store needed (unlike git status, this has exactly one
consumer per path: whichever `MoleculeViewerCore` instance has that path open).

### 2.4 `MoleculeViewerCore` — the refresh gate (requirement #3)

```tsx
function MoleculeViewerCore({ path }: { path: string | null }) {
  const ref = useRef&lt;MolViewerHandle&gt;(null);
  const [isModified, setIsModified] = useState(false);
  const isModifiedRef = useRef(false);
  isModifiedRef.current = isModified;

  const download = useFileDownload(path ?? "", path !== null); // existing hook, unchanged
  const queryClient = useQueryClient();

  useFileWatch(path, () =&gt; {
    if (isModifiedRef.current) {
      // surface a "file changed on disk — you have unsaved edits" banner with a manual
      // "discard &amp; reload" button that calls queryClient.invalidateQueries + resets isModified;
      // do NOT auto-clobber.
    } else {
      void queryClient.invalidateQueries({ queryKey: rpcKeys.fileDownload(path!) });
      // refetch -&gt; new download.data -&gt; new `source` below -&gt; MolViewer picks it up via
      // sourceMode="update" automatically (camera/selection preserved, dirty flag stays false).
    }
  });

  const loadedOnceRef = useRef(false);
  const source = useMemo(
    () =&gt; (download.data ? { url: download.data.objectUrl, name: fileNameOf(path!) } : undefined),
    [download.data, path],
  );
  useEffect(() =&gt; { if (source) loadedOnceRef.current = true; }, [source]);

  return (
    &lt;MolViewer
      ref={ref}
      source={source}
      sourceMode={loadedOnceRef.current ? "update" : "replace"}
      onModifiedChange={setIsModified}
      style={{ height: "100%" }}
    /&gt;
  );
}
```

This is the load-bearing piece of the whole feature and the one genuinely new pattern in the
codebase (§1.1's "no precedent" finding) — everything else here is copy-the-existing-convention.

---

## 3. File-by-file change list

**Protocol** (`packages/protocol/src/`):
- `messages.ts` — 5 new schemas (§2.2), appended to `sessionMessageSchema`.
- `client-capabilities.ts` — `fileWatch` feature key.

**Server** (`packages/server/src/`):
- `files/file-watch-service.ts` — new, `FileWatchService` class (§2.2).
- `files/file-watch-rpc.ts` — new, `registerFileWatchHandlers` (mirrors `git-checkout-rpc.ts`
  shape: subscribe/unsubscribe handlers, per-session unsub `Map`).
- `daemon/bootstrap.ts` — construct `FileWatchService`, call `registerFileWatchHandlers`, wire the
  new `onSessionClose` cleanup for both file-watch and (fix) checkout-status subscriptions.
- `ws/ws-server.ts` — add `deps.onSessionClose?.(session)` to the `"close"` handler.

**Web-client** (`packages/web-client/src/`):
- `package.json` — add `"@molviewer/core": "^0.3.0"` dependency.
- `vite.config.ts` — new `manualChunks` branch for `@molviewer/core`/`molstar`.
- `stores/tab-store.ts` — `"molecule"` `TabKind`, `MoleculeTabData`, `tabIds.molecule`,
  `openNewMolecule`.
- `features/workspace/panel-registry.ts` — `molecule: MoleculeBlankPanel` (or shared component).
- `features/workspace/TabStrip.tsx` — `Atom` icon in `ICON_BY_KIND`, new `NewTabMenu` item.
- `features/files/viewer-registry.ts` — `"molecule"` `ViewerKind`, extension table entries,
  `VIEWER_BY_KIND` entry.
- `features/files/MoleculeFileViewer.tsx` — new, implements `ViewerProps`, wraps
  `MoleculeViewerCore`.
- `features/molecule/MoleculeViewerCore.tsx` — new, the shared component (§2.4), imports
  `@molviewer/core/style.css` as a side-effect (matching `TerminalPanel.tsx`'s xterm-CSS
  convention).
- `hooks/use-file-watch.ts` — new (§2.3).
- `lib/connection/rpc-keys.ts` — no change needed (`fileDownload` key already generic over path).

---

## 4. Open risks needing empirical verification (not assumed solved)

1. **WebGL canvas resize under `display:none` → `display:block`.** `TabPanelHost` never unmounts
   inactive panels. Mol*'s `Canvas3D` is expected to self-manage resize, but this specific
   transition is unverified. Mitigation ready if it fails: reuse `TerminalPanel.tsx`'s
   `ResizeObserver` + `isActive`-keyed re-fit pattern (§1.3) — needs a hook into
   `MolViewerHandle.engine()` or a forced remount-on-activate as a last resort, since
   `RenderEngine` exposes no public `resize()`.
2. **Bundle weight in practice.** 4.3 MB of JS + 84.7 KB CSS, lazy-loaded — confirm the new
   `manualChunks` branch actually produces a separate chunk and that it only downloads on first
   molecule-tab open, via a real build + network-tab check, not just config inspection.
3. **`fs.watch` platform behavior.** Native `fs.watch` semantics (especially the rename-swap
   gotcha, §2.2) vary by OS/filesystem; the debounce window and re-arm-on-rename logic need a real
   editor-save smoke test (e.g. `vim`'s default backup-and-rename write mode) on the actual
   deployment target, not just a synthetic `fs.writeFile`.
4. **Multi-session same-path collisions.** Two browser tabs/clients with the same molecule file
   open: each gets its own `FileWatchService` subscription and its own independent
   modified/unmodified state — by design (no locking anywhere else in the app either), but worth
   confirming the daemon-side `Map` keys correctly per-path-with-multiple-listeners rather than
   per-session-overwriting-per-path.

## 5. Non-goals (explicitly out of scope for this pass)

- **Writing edits back to disk.** Molviewer's edits are in-memory; a "Save" action would need to
  wire `exportFile()`/`exportText()` into the existing `useFileTransfer().saveToDisk` upload path
  and reset `isModified` afterward — natural follow-up, not required by the four stated
  requirements, and not implied by "auto-refresh when unmodified."
- **Server-side lazy/streamed trajectory frame sources.** Molviewer's own disk-backed
  `FileSystemFrameSource` (mentioned in its `AGENTS.md`) only applies to local drag-dropped
  `File` objects via the browser's File System Access API — not reachable for daemon-hosted files
  fetched over the WebSocket. Large trajectories opened this way load fully into browser memory
  via the existing unbounded binary download path; no new server-side streaming is scoped here.
- **Fixing the pre-existing `checkout_status_update` protocol-typing gap** beyond not repeating
  it for the new messages — that's a separate, already-shipped feature; flagged in §1.2 as
  context, not queued as work here.
- **New automated tests.** Per repo convention (root `vitest.config.ts` is `node`-only, zero
  `.test.tsx` today), verification for this feature is a manual smoke test (open a `.pdb` from the
  explorer, edit it, save the file externally, confirm no clobber; save unmodified, confirm
  auto-refresh; open a blank molviewer from "+", drag a file in) — not a new test file, unless a
  future contributor decides the `FileWatchService`'s debounce/rename-rearm logic warrants a
  focused unit test (it's pure enough to be one, but that's a judgment call at implementation
  time, not scoped here).
