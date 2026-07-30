# File Move & Rename — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [file-explorer-transfer.md](file-explorer-transfer.md),
> [../architecture/auth-security.md](../architecture/auth-security.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

## Purpose

Relocate and rename files/directories on the daemon machine from the file explorer, by
drag-and-drop today and by an explicit rename affordance later; the operation is one primitive,
not two.

## Public Contract

### RPCs
| Operation | Message |
|-----------|---------|
| Move or rename a path | `FileMoveRequest` |

`FileMoveRequest` fields:
- `path` — absolute source path.
- `destination` — absolute target path, including the final name (not just a target directory).

Response: `{ ok: true, path, destination }` on success, or `{ ok: false, error }` on failure.

A rename is this same operation with an unchanged parent directory — there is no separate rename
message. Likewise there is no separate copy operation; copying is out of scope for this contract.

## Behavior & Algorithms

```
function move(path, destination):
    reject if either is empty
    normalize both PARENTS (resolve symlinks in ancestors only, never the final component)
    reject an invalid destination name (empty, ".", "..", contains a separator or NUL)
    reject if the source does not exist
    reject if the destination's parent is missing or is not a directory
    reject if source and destination are the same path
    reject if the source is a directory and the destination is inside it
    reject if the destination already exists          # never overwrite, never merge
    rename source → destination
```

- **Parent-only symlink resolution**: a symlink is moved *as the link*, not as its target — which
  differs deliberately from the delete/preview operations, where the full path is resolved.
- **Collision is a hard failure.** No overwrite, no merge-into-directory, no automatic
  de-duplicated name. Callers that want overwrite must delete first, explicitly.
- **No cross-filesystem emulation**: a move whose source and destination sit on different
  filesystems is rejected with a distinct error rather than silently degraded into a
  copy-then-delete.
- **Same trust boundary** as the rest of the file surface: connected clients are trusted
  operators, path normalization stays server-side, and workspace-relative confinement is a UI
  convenience rather than a security boundary.
- **Live updates**: a move fires the existing directory-change notifications for both the source
  and destination directories (each carries only the changed directory path — there is no
  old-path/new-path pairing in the notification), so subscribed clients refresh both sides without
  a dedicated "moved" event.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Empty source or destination | Error result, no filesystem change |
| Source does not exist | Error result |
| Destination's parent directory missing | Error result |
| Destination's parent is not a directory | Error result |
| Invalid destination name (empty, `.`, `..`, contains a separator or NUL) | Error result |
| Destination already exists | Error result; both source and destination left untouched |
| Source and destination are the same path | Error result |
| Directory moved into its own descendant | Error result |
| Move across filesystems | Error result, no copy+delete fallback |
| Destination-exists check races a concurrent create at the destination | Accepted race on a single-user local daemon — no locking; the losing move sees a plain failure, never silent data loss |

## UI Behavior
- The explorer tree: drag a row onto a directory row to move into it, or onto a file row to move
  into that file's parent directory.
- Hovering a collapsed directory for ~700 ms mid-drag auto-expands it.
- Illegal drops (onto itself, into its own descendant, into the folder it already lives in, or
  outside the workspace root) show no drop highlight and do nothing on release.
- The panel's inline status line reports success or the failure reason.
- An open tab for the moved file reopens at its new path, while tabs under a moved *directory*
  close.

## Dependencies
- Internal: file explorer service, directory-watch push.
- External: filesystem rename.

## Acceptance Criteria
- [ ] Moves a file into a sibling directory.
- [ ] Moves a directory with nested contents.
- [ ] Renames within the same parent.
- [ ] Rejects a name collision without modifying either path.
- [ ] Rejects moving a directory into its own descendant.
- [ ] Moves a symlink as the link itself, not its target.
- [ ] Drag-and-drop in the explorer performs the move and both affected directories refresh
      without a manual reload.
