# Task 004 — File explorer (list/preview) + path safety

- **Sprint:** sprint-009-terminals-proxy-files
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-005 (sprint-004)

## Goal
Implement filesystem listing and file preview with server-side path normalization/symlink checks.

## Scope references
- `clean-room-scope/features/file-explorer-transfer.md` § RPCs, § Behavior (listOrPreview), § Trust boundary
- `clean-room-scope/architecture/auth-security.md` § Trust model (file previews)

## What to build
- Handlers: `FileExplorerRequest` (list/preview a path), `DirectorySuggestionsRequest` (path picker),
  `ProjectIconRequest`.
- `listOrPreview(path)`: normalize + resolve (symlink checks in the daemon file service); directory →
  entries (name, kind, size, mtime, icon hints); file → text preview, or metadata + transfer token
  for binary.
- Trust boundary: a preview may read any regular file the daemon process can read; workspace-relative
  paths are a UI convenience, not a security boundary.

## Out of scope
- Download/upload binary transfer + tokens (task-005). Icon theme mapping detail (client).

## Acceptance criteria
- [ ] `FileExplorerRequest` lists a directory and previews a text file.
- [ ] Binary files return metadata + a transfer token instead of inline text.
- [ ] Symlink/path normalization is enforced on the daemon, not the client.
- [ ] An unreadable path returns an error result.

## Test / verification plan
- Tests: `npx vitest run .../file-explorer.test.ts` — list, text preview, binary metadata, symlink
  normalization, unreadable error.

## Notes
- Material file-icon theme mapping is a client concern (see original docs/file-icons.md).
