# File Explorer & Transfer — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/auth-security.md](../architecture/auth-security.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [projects-workspaces.md](projects-workspaces.md)

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

## Data & Persistence
- No dedicated store; reads/writes the real filesystem. Download tokens are transient in-memory.
  Client-side web attachments cache in IndexedDB (see
  [../architecture/persistence.md](../architecture/persistence.md)).

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
