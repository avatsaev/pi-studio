# Molviewer integration — technical scope

Status: **scoping only, no code written**. Every claim below is grounded in the current source
(file:line cited); anything not yet decided is marked `[DECISION NEEDED]`, anything not yet
verified against runtime behavior is marked `[VERIFY]`.

## 1. What we're building

Four observable behaviors:

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
4. Reuses the existing file-viewer registry, tab store, and TabStrip infra as-is; no new
   parallel infrastructure.

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
  This is exactly the seam we use — no registry redesign needed, just a `"molecule"` kind.

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

**Consequence for this feature**: a molecule file opened from the explorer still becomes a
`kind: "file"` tab — nothing in the tab-store/panel-registry layer needs to change for behavior
(1). `detectViewerKind` returning `"molecule"` for `.pdb`/`.mol`/etc. is sufficient; `FilePanel`
picks up the new `VIEWER_BY_KIND["molecule"]` entry automatically. The File/Diff toggle header
(`FilePanel.tsx:57–72`) still renders around it, which is correct — a molecule file can still have
a git diff.

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
files (`.lammpstrj`, multi-frame XYZ/extXYZ) routinely exceed 512 KiB — `molviewer`'s own docs
describe multi-GB trajectory support via a disk-backed `FrameSource` — so hard-capping at 512 KiB
would silently break the exact files this viewer exists for. All molviewer-supported formats are
text, so the new hook decodes the downloaded `Uint8Array` via `TextDecoder` and hands the string to
molviewer's `sourceFromText(filename, content)` (see `docs/molviewer-core-doc.md`).

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
- `packages/server/src/projects/workspace-git-service.ts:5–7`'s own header comment claims
  "Recomputation is change-driven (a filesystem watcher calls `refresh()`)" — this is **stale/
  aspirational**: reading the class body (`workspace-git-service.ts:17–69`), `refresh(cwd)` is a
  public method with no internal timer or watcher; it is only ever invoked from
  `checkout_refresh_request`'s handler (`packages/server/src/projects/git-checkout-rpc.ts:73–76`),
  which is itself only ever called by the client (`files-changed.ts:46`, after a debounced guess
  that an agent tool touched something). **There is no real disk watcher backing any existing
  "live" update in the daemon** — every git-status push today is actually "client asks, daemon
  answers, daemon then pushes if the answer changed since last time," never daemon-initiated from
  a real OS-level file event.
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
  level, not centrally — `[VERIFY during implementation]` exact xterm CSS import site (not
  re-checked in this pass; grep `@xterm/xterm/css` in `TerminalPanel.tsx` before writing the
  molviewer component). `import '@molviewer/core/style.css'` should follow whatever that site's
  pattern is; `package.json`'s `sideEffects: ["**/*.css"]` (molviewer's own `package.json:12–15`)
  confirms Vite/Rollup won't tree-shake it away.
- React version: web-client is on `react@^19.2.7`/`react-dom@^19.2.7`
  (`packages/web-client/package.json:40–41`); molviewer's peer range is `^18.3.0 || ^19.0.0`
  (molviewer `package.json:59–63`) — compatible, no action needed.
- Test implications: `[VERIFY]` — root Vitest config/environment was not re-confirmed in this
  pass; check whether `.tsx` test discovery would try to import a `MoleculeViewer.tsx` that pulls
  in `@molviewer/core` (WebGL/canvas-heavy) under a `jsdom` environment lacking a WebGL context.
  If component tests are added later (not required for this feature — see delivery contract on
  testing scope), they'll need to mock `@molviewer/core` rather than mount it for real, same as any
  `@xterm/xterm`-touching test presumably already does.

### 2.10 Tab mounting/lifecycle — `TabPanelHost.tsx`

All tabs across all workspaces stay mounted permanently; switching tabs toggles `display:none`
(`TabPanelHost.tsx:1–8` header comment, `line 69`: `clsx(styles.panel, tab.id === activeTabId &&
styles.active)`) — panels are **never** unmounted on tab-switch, only hidden. Two consequences for
a `MoleculeViewerPanel`:

- Good: molviewer's own component-owned state (camera, selection, undo stack) survives tab
  switches for free — no extra persistence work.
- Needs attention: `TerminalPanel.tsx` demonstrates the pattern this requires — a `ResizeObserver`
  on the container (`TerminalPanel.tsx:227–230`) **and** an explicit re-fit effect keyed on
  `isActive = activeTabId === tab.id` (`TerminalPanel.tsx:246–249`, `useEffect(() => { if
  (!isActive) return; fitAddonRef.current?.fit(); }, [isActive])`) — because a `display:none`
  element reports a zero-size layout box, and some canvas/WebGL consumers don't self-correct their
  internal resolution when they go from hidden back to visible without being told to. `[VERIFY]`
  whether Mol*'s own internal `ResizeObserver` (if any — `RenderEngine.ts`'s interface, read in the
  prior session, exposes no explicit `resize()` method) already handles this correctly; if not, the
  same `isActive`-keyed re-fit pattern applies to the molecule panel too.

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
| `viewer-registry.ts` | Add `"molecule"` to `ViewerKind`; add extensions to `EXT_TO_VIEWER`: `pdb, mol, mol2, cif, mmcif, xyz, extxyz, gro, lammpstrj, data*, xsf` (LAMMPS `data` has no fixed extension — `[DECISION NEEDED]`, see §4); register `MoleculeViewer` in `VIEWER_BY_KIND`. |
| `MoleculeViewer.tsx` (new) | `ViewerProps` → `useFileDownload(path)` → decode to text → `<MolViewer source={{name, text}} sourceMode="update" ref={...} onModifiedChange={...} .../>`. Owns the "reload iff not modified" logic (§3.2). |
| `tab-store.ts` | Add `"molecule"` to `TabKind`; add `MoleculeTabData { path: string \| null }` (null = empty tab); add `tabIds.molecule`; add `openNewMolecule(workspaceCwd)` mirroring `openNewTerminal`. |
| `panel-registry.ts` | Map `molecule: MoleculeViewerPanel` (new thin panel, or extend `FilePanel` — `[DECISION NEEDED]`, see §4: does an empty molecule tab go through `FilePanel`'s File/Diff toggle at all, given it has no path yet?). |
| `TabStrip.tsx` | Add `molecule: <icon>` to `ICON_BY_KIND`; add a third `DropdownMenu.Item` calling `openNewMolecule(cwd)`. |
| `FileExplorer.tsx` | No change needed — it already just opens `kind: "file"` tabs; `detectViewerKind` inside `FilePanel` does the routing. |
| `vite.config.ts` | Add `vendor-molviewer` manualChunks rule. |
| `packages/web-client/package.json` | Add `@molviewer/core` as a real dependency. |
| root `package.json` | Remove the misplaced `@molviewer/core` entry. |

### 3.2 Daemon: file-watch subsystem (behavior 3 — the genuinely new piece)

Mirrors `WorkspaceGitService` (§2.7/2.6) structurally, but keyed by absolute file path instead of
cwd, and backed by a **real** `fs.watch`, since none exists anywhere today.

**`FileWatchService`** (new, `packages/server/src/files/file-watch-service.ts`):
- `subscribe(path: string, listener: (event: {changed: boolean}) => void): () => void` — same
  shape as `WorkspaceGitService.subscribe`.
- Internally: one `fs.watch(dirname(path), { persistent: false })` per **directory** (not per
  file) — deliberate, not `fs.watch(path)` directly, because editors/agents commonly save via
  write-to-temp + atomic rename, which unlinks the original inode; watching the file handle directly
  silently stops firing after the first such save on some platforms/filesystems. Filter events by
  `path.basename === basename(watchedPath)` inside the directory watcher's callback.
- Debounce per path using the `TerminalManager` `coalesceMs` shape (§2.8) — collapse the
  write+rename event burst into a single push, something like 100–250 ms `[DECISION NEEDED]`
  (terminal output uses 4 ms because it's UI-latency-sensitive; a file-save burst has no such
  constraint — closer to `files-changed.ts`'s existing 500 ms client debounce, so the two don't
  fight each other).
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

**Server wiring** (`packages/server/src/daemon/bootstrap.ts`, alongside the existing
`file_read_request`/`checkout_*` registrations): new `registerFileWatchHandlers(registry,
{fileWatchService})`, following `registerGitCheckoutHandlers`'s exact shape (per-session
`Map<sessionKey:path, unsubscribe>`, push via `session.send(...)` directly — not the global
`broadcast()` helper, since only sessions that actually subscribed to that path should hear about
it).

**Web-client**: `hooks/use-file-watch.ts` (new), structurally identical to
`use-checkout-status.ts` (§2.7 hop 4) — subscribe on `path` change, unsubscribe the previous path,
local `FileChangedMessage` interface + type guard, calls `client.connection.onSessionMessage(...)`.

### 3.3 "Don't clobber user edits" — the actual gating logic

`MoleculeViewer.tsx` ties it together:

```tsx
const ref = useRef<MolViewerHandle>(null);
const [modified, setModified] = useState(false);
const download = useFileDownload(path);
const watch = useFileWatch(path); // { changedAt: number | null } — bumps on each file_changed push

useEffect(() => {
  if (!watch.changedAt) return;
  if (modified) return; // user has unsaved edits — do NOT clobber them
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

## 4. Open decisions

1. **LAMMPS `data` file matching** — no fixed extension (often `data.lammps`, `in.data`, or
   extensionless). `EXT_TO_VIEWER`'s pure-extension lookup can't distinguish it from an arbitrary
   text file. Options: (a) skip auto-detection for this one format, require manual "open as
   molecule" (see #3); (b) content-sniff (`Masses`/`Atoms` section headers) — pushes real logic into
   `detectViewerKind`, which today is a pure, synchronous, content-free function; (c) accept the
   gap for v1, cover it via #3. Recommend (c).
2. **Manual "open as molecule" escape hatch** — should the file explorer's per-row context menu
   gain an "Open as molecule view" action for files `detectViewerKind` doesn't recognize (covers
   #1, plus any file extension not yet in the map)? Not required for the stated behaviors, but
   cheap and consistent with `BinaryFallbackViewer`'s existing manual-action pattern (§2.9-adjacent,
   `BinaryFallbackViewer.tsx:36–38`).
3. **Empty molecule tab + `panel-registry.ts`** — does it route through `FilePanel` (which assumes
   a `path` and renders the File/Diff toggle header) or a dedicated lightweight panel? An empty tab
   has no path and no diff to show, so reusing `FilePanel` means special-casing its header for
   `!path`. Recommend a small dedicated `MoleculeViewerPanel` that `FilePanel`-with-molecule-kind
   *also* renders internally once a path exists (i.e. `FilePanel`'s viewer slot for `"molecule"`
   kind renders the same underlying `<MolViewer>` wrapper as the empty-tab panel) — avoids
   duplicating the `<MolViewer>` mount/props logic in two places while keeping the empty case
   header-free.
4. **Debounce window for `FileWatchService`** — proposed 100–250 ms; needs a real number picked
   before implementation (§3.2).
5. **File-watch subscription lifecycle on tab close/disconnect — confirmed pre-existing gap in the
   precedent, worth fixing rather than copying.** `git-checkout-rpc.ts:27` (`statusUnsubs`) is
   **only ever cleared by an explicit `checkout_status_unsubscribe` call or by a same-key
   `subscribe` replacing it** (lines 33, 47–48) — grepping this file and `packages/server/src/ws`
   for a session-close hook wired to `statusUnsubs` finds none. If a browser tab disconnects
   without the client sending `checkout_status_unsubscribe` first (closing the laptop lid, a
   crashed tab, a network drop), that session's `WorkspaceGitService` listener is never removed —
   a real, currently-shipping leak this scope should not blindly inherit. Since `TabPanelHost`
   never unmounts tabs (§2.10), the *only* client-side unsubscribe trigger for a molecule tab in
   practice is `closeTab` — so the new `FileWatchService`'s per-session `Map` needs its own
   disconnect-driven sweep (`ws-server.ts`'s socket-close handling — not yet traced in this pass —
   is the right place to add `for (const unsub of sessionWatchers.get(session)?.values() ?? [])
   unsub()`), rather than assuming the git-checkout precedent already solved this.
6. **Should `file_changed` also fire for the *own* MoleculeViewer's own save** — i.e. if
   `exportFile()`'s result is written back to disk by some future "Save" action, does that
   round-trip through the same watcher and cause a self-triggered reload attempt? Since
   `modified` would already be `true` at that point (§3.3 guards on it) this is likely a non-issue,
   but worth a deliberate note once a "Save" action exists (not in scope for behaviors 1–3 above —
   no save-to-disk action was requested).

## 5. Non-goals (explicitly out of scope for this pass)

- A "Save" action that writes viewer edits back to disk (`exportFile()` exists on the handle;
  wiring a save button is a separate, later feature — same status as README's own "Save Changes"
  example, which is host-app-provided, not built into molviewer).
- Trajectory playback UX beyond what `<MolViewer>` already provides out of the box.
- Any change to `checkout_status_update`/git infra — cited only as the structural precedent.
