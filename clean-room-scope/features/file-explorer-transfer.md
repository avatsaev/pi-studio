# File Explorer & Transfer — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/auth-security.md](../architecture/auth-security.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [projects-workspaces.md](projects-workspaces.md), [file-explorer-move.md](file-explorer-move.md)

## Purpose

Browse the daemon machine's filesystem (directory listings + file previews) and transfer files
to/from the daemon over binary streams (download, upload). Backs the in-app file explorer, file
previews, attachments, and project/path pickers.

## Public Contract

### RPCs

| Operation | Message |
|-----------|---------|
| List/preview a path | `FileExplorerRequest` |
| Directory suggestions (path picker) | `DirectorySuggestionsRequest` |
| Request a download token | `FileDownloadTokenRequest` |
| Upload a file | `FileUploadRequest` |
| Project icon | `ProjectIconRequest` |
| Move/rename a path | `FileMoveRequest` (see [file-explorer-move.md](file-explorer-move.md)) |

### Binary transfer frames
- A file-transfer binary frame format (separate from terminal frames) streams download/upload bytes
  in chunks. Downloads are authorized via a one-time download token from `FileDownloadTokenRequest`.

## Behavior & Algorithms

```
function listOrPreview(path):
    normalize + resolve path (symlink checks in the daemon file service)
    if directory: return entries (name, kind, size, mtime, icon hints)
    if file: return preview (text, or metadata + token for binary)

function download(path):
    token = issueDownloadToken(path)         # short-lived, single use
    client opens transfer stream with token → daemon streams file bytes in chunks

function upload(meta):
    client streams bytes in chunks → daemon writes to target path (within allowed authority)
```

- **Trust boundary:** connected clients are trusted operators; a preview may read any regular file
  the daemon process can read. Path normalization and symlink checks stay server-side.
  Workspace-relative paths are a UI convenience, **not** a security boundary. See
  [../architecture/auth-security.md](../architecture/auth-security.md).
- File icons use a Material icon theme mapping for the explorer (see original `docs/file-icons.md`).
## Live Directory & File Watching

The daemon maintains a real filesystem watcher (`FileWatchService`) that observes paths on disk
and pushes live change notifications to any client that has subscribed to them. This enables the
file tree UI to update without polling or waiting for the next manual refresh.

**Subscription model:**
- Clients subscribe/unsubscribe per path via `file_watch_subscribe` / `file_watch_unsubscribe` RPCs.
- Subscriptions are per-session (per WebSocket connection) — a client only receives pushes for paths
  it explicitly subscribed to, not a global broadcast.
- A file subscription watches that file's parent directory, filtering by the file's basename. This
  survives the common editor save pattern (write to a temp file, then atomic rename-in-place), so
  the watch doesn't silently break after the first external edit.
- A directory subscription watches the directory and reports any create/delete/rename among its
  immediate children.
- Per-session cap: 128 concurrent watched paths per connection. Once the cap is reached, new
  `file_watch_subscribe` requests for uncached paths are rejected with a `too_many_watches` error,
  though re-subscribing to an already-watched path never counts against the cap.

**Push behavior:**
- Filesystem events from any source (external editor, shell command, build step, `git` CLI) are
  coalesced: a burst of filesystem changes within ~150 milliseconds collapse into a single `file_changed`
  notification per subscribed path, preventing UI thrashing from rapid tool writes.
- Each `file_changed` push carries only the changed path; the client fetches updated content/metadata
  if needed via a separate RPC.
- On a watcher error (e.g., filesystem mount gone), the daemon snapshots current subscribers,
  emits one final push synchronously to all of them, then tears down that watch.

**Use case:**
- The file explorer tree subscribes to every currently-expanded directory, enabling live row updates
  (file/folder create/delete/rename) with no manual "refresh" action needed. Branch checkouts that
  add or remove files are reflected live on the UI side, indistinguishable from the user's own
  filesystem actions from a different terminal.

## Molecular Structure Viewer

Files containing molecular or crystal structures can be previewed in a dedicated 3D viewer instead
of as text. The following formats are auto-detected by filename extension:
**.pdb, .cif, .mmcif, .mol, .mol2, .xyz, .extxyz, .gro, .lammpstrj, .xsf**, plus extension-less
VASP structure files **POSCAR** and **CONTCAR** (matched by exact basename).
LAMMPS `data` files are NOT auto-detected (they have no fixed extension and would require
content-sniffing, which is not performed).

**Viewer behavior:**
- Opening a supported molecular file from the file explorer opens a 3D structure viewer with:
  - Camera controls (rotate, zoom, pan)
  - Atom and bond visualization
  - Basic structure editing tools
  - Per-file drag-and-drop support (external file to the canvas → replace structure)
- Viewers are tab-like in the UI, like other file previews, but render a WebGL canvas instead
  of text.
- An empty molecule viewer tab (via the "+ New molecule view" UI affordance) shows a built-in
  empty state with a file picker and drag-and-drop zone, letting a user load a structure that
  doesn't yet exist in the workspace.

**Live reload on external file changes:**
- When an opened structure file changes on disk (detected via the live watching mechanism above),
  the viewer reloads the new content.
- The reload preserves the viewer's camera position, selection state, and undo history by default,
  providing a transparent update experience.
- If the user has unsaved in-viewer edits (geometry changes, structure modifications), the reload
  is gated: instead of silently overwriting, a **"File changed on disk"** indicator appears. The
  reload is applied only after the user discards or undoes their edits, preventing data loss.

**Performance:** The viewer rendering library is loaded lazily — only when a molecule file is
actually opened or an empty molecule tab is created. Users who never open a molecular structure
file incur no additional load time or bundle weight.

## Data & Persistence
- No dedicated store; reads/writes the real filesystem. Download tokens are transient in-memory.
  Client-side web attachments cache in IndexedDB (see
  [../architecture/persistence.md](../architecture/persistence.md)).

## File Preview Size Tiers

Text file previews are tiered by file size to balance responsiveness, memory use, and visual
completeness:

| Size range | Behavior |
|---|---|
| `0 – 5 MiB` | Fetched inline via `file_read_request` as UTF-8 JSON; rendered instantly. |
| `> 5 MiB – 30 MiB` | Fetched via the unbounded chunked binary download transport, decoded to text client-side, and rendered the same way as inline files. A muted "N.N MB file streamed" indicator appears in the UI to acknowledge the fetch method differs, but rendering is unchanged. |
| `> 30 MiB` | No render attempt; the UI displays the file size, an explanation that the display threshold is 30 MiB, and a "Download" action. The code viewer's line-height measurement on very large documents becomes interactive-hostile well above this threshold. The download transport itself is unbounded — arbitrarily large files can still be saved locally; the 30 MiB limit is a rendering ceiling, not a transport limit. |

The 5 MiB threshold (previously 512 KB in earlier versions) was raised because the daemon's
file-read RPC now uses async I/O (`fs/promises`), avoiding event-loop blockage under concurrent
agent/terminal/heartbeat activity, and because modern developer workflows routinely involve files
in the 1–5 MiB range (build outputs, minified bundles, large JSON exports). The 30 MiB ceiling
corresponds to the practical interactive limit of the code renderer, not any wire protocol limit.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Path the daemon can't read | Error result |
| Symlink escaping intent | Normalized/checked server-side |
| Expired/invalid download token | Reject the transfer |
| Large file | Chunked streaming (bounded frames) |
| Binary file preview | Return metadata + transfer token instead of inline text |

## Dependencies
- Internal: file-explorer service, file-download, file-upload, private-files/path-utils.
- External: filesystem.

## Acceptance Criteria
- [ ] `FileExplorerRequest` lists a directory and previews a text file.
- [ ] Downloading requires a valid token and streams bytes in chunks.
- [ ] Uploading writes the streamed file to the target path.
- [ ] Symlink/path normalization is enforced on the daemon, not the client.
- [ ] Binary files return metadata + a transfer token rather than inline content.

## TODO(verify)
- [ ] File-transfer frame layout (opcodes, chunk size, completion marker).
- [ ] Download-token TTL and single-use semantics.
