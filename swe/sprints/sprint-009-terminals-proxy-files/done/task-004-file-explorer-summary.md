# Task 004 — File explorer (list/preview) + path safety — Summary

- **Sprint:** sprint-009-terminals-proxy-files
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/files/file-explorer.ts` — `FileExplorerService`:
- **`listOrPreview(path)`** — normalizes (`resolve`) + resolves symlinks server-side (`fs.realpath`),
  then:
  - **directory** → sorted entries `{ name, kind (file/directory/symlink/other), size, mtimeMs,
    iconHint }` (dirs first; icon hint = extension or `dir`).
  - **text file** → inline `content` (bounded to 256KiB, `truncated` flag).
  - **binary file** (NUL byte in an 8KiB sniff) → `{ metadata:{ size, mtimeMs, mimeHint },
    transferToken }` instead of inline content. Token issued via injected `issueDownloadToken`
    (task-005 store) or a random UUID fallback.
  - errors → `{ ok:false, error }` (`not_found` / `unreadable` / `empty_path` / `unsupported`).
- **Handlers:** `file_explorer_request`, `directory_suggestions_request` (subdir picker),
  `project_icon_request`.
- **Trust boundary:** any regular file the daemon can read is previewable; normalization + symlink
  checks live in the daemon, not the client. The result reports `resolvedPath` (the real target).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/file-explorer.ts` | created |
| `packages/server/src/files/index.ts` | created |
| `packages/server/src/index.ts` | modified (re-export) |
| `packages/server/src/files/file-explorer.test.ts` | added — 5 tests (real temp fs + symlink) |

## Build & test results
```
$ npm run build:server                                            → exit 0
$ npx vitest run packages/server/src/files/file-explorer.test.ts  → 5 passed
$ npx oxlint / oxfmt --check packages/server/src/files             → clean
```

## Acceptance criteria
- [x] `FileExplorerRequest` lists a directory and previews a text file.
- [x] Binary files return metadata + a transfer token instead of inline text.
- [x] Symlink/path normalization is enforced on the daemon (`realpath`; `resolvedPath` is the real
      target).
- [x] An unreadable/missing path returns an error result.

## Follow-ups / TODO(verify)
- Material file-icon theme mapping is a client concern (icon hint = extension only here).
- Download token issuance/validation store is task-005 (injected here).
