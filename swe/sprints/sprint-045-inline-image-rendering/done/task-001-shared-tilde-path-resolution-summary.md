# Task 001 — Shared daemon path resolution (`~` expansion) + `mimeType` in transfer `Begin` — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-28
- **Status:** done

## What was implemented
- A single canonical `expandHome(path)` helper now lives at `packages/server/src/files/resolve-path.ts`.
  It expands a bare `~` or a `~/`-prefixed path against `os.homedir()` and returns every other input
  (including `~otheruser/x`, absolute, relative, empty) unchanged.
- All six previously-duplicated inline `~` expansions now call this one helper:
  `daemon/bootstrap.ts` (git-diff `cwd`, `file_read_request`), `daemon/dev-bootstrap.ts` (same two),
  `files/file-watch-rpc.ts` (`file_watch_subscribe`/`_unsubscribe`), and `files/file-watch-service.ts`
  (`subscribe`) — whose "duplicated per that file's own convention" comment is now false and was
  replaced.
- `agent/providers/pi/rpc-transport.ts`'s own `expandHome` (used for the spawned `pi` process's `cwd`)
  is now a re-export of the same function from `files/resolve-path.ts`, preserving the existing public
  surface (`agent/index.ts` re-exports it) with exactly one implementation in the package.
- `files/file-transfer.ts`'s `file_download_token_request` handler now expands `~` before `realpath()`
  — previously the only one of the six paths with **no** expansion, which is exactly what blocked
  `~/shot.png`-style inline image downloads.
- `files/file-explorer.ts`'s module-private `mimeHintForFile` is now exported (extension table and
  `application/octet-stream` default untouched) and used by `file-transfer.ts`'s `startDownload` to
  stamp the `Begin` frame's `meta.mimeType`. `FileTransferClient` (`packages/client`) already read
  `frame.meta.mimeType` and the protocol's `fileTransferBeginSchema.mimeType` was already optional —
  no protocol or client change was needed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/resolve-path.ts` | created — canonical `expandHome` |
| `packages/server/src/files/resolve-path.test.ts` | created — unit tests |
| `packages/server/src/agent/providers/pi/rpc-transport.ts` | modified — local `expandHome` replaced by import + re-export from `resolve-path.ts`; dropped now-unused `homedir` import |
| `packages/server/src/daemon/bootstrap.ts` | modified — both inline `~` expansions call `expandHome` |
| `packages/server/src/daemon/dev-bootstrap.ts` | modified — both inline `~` expansions call `expandHome`; dropped now-unused `join` import |
| `packages/server/src/files/file-watch-rpc.ts` | modified — both handlers call `expandHome`; dropped now-unused `homedir`/`join` imports |
| `packages/server/src/files/file-watch-service.ts` | modified — `subscribe()` calls `expandHome`, stale "duplicated per convention" comment removed; dropped now-unused `homedir`/`join` (kept `basename`/`dirname`) |
| `packages/server/src/files/file-explorer.ts` | modified — `mimeHintForFile` exported (was module-private) |
| `packages/server/src/files/file-transfer.ts` | modified — `file_download_token_request` expands `~`; `startDownload`'s `Begin` frame includes `meta.mimeType` |
| `packages/server/src/daemon/bootstrap.test.ts` | modified — added: download-token for `~/<file>`, `~otheruser/x` passthrough (→ `not_found`, proving no rewrite to `$HOME/otheruser/x`), `file_watch_subscribe` with a `~` path echoing the expanded path |
| `packages/server/src/files/file-transfer.test.ts` | modified — added: unknown-extension `Begin.meta.mimeType` assertion on the existing streaming test, new test asserting `image/png` for a `.png` download |

## How it satisfies the scope
- `clean-room-scope/features/inline-image-rendering.md` § Behavior & Algorithms → Path resolution
  asymmetry: implemented "option 2" (fix `file_download_token_request` to expand `~` like the other
  daemon path RPCs) rather than leaving the asymmetry or expanding client-side.
- Same doc § MIME type: `Begin` frame is now stamped with `mimeHintForFile`'s result instead of relying
  on browser blob-URL sniffing.
- `clean-room-scope/features/file-explorer-transfer.md` § Binary transfer frames: no wire-format
  change — `meta.mimeType` was already an optional passthrough field.
- Root `AGENTS.md` invariant 7 ("`~` expanded server-side") is now backed by one implementation instead
  of six copies, closing the exact gap the invariant's own file (`file-watch-service.ts`) called out as
  intentionally unaddressed.

## Build & test results
```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean exit, no output)

$ npx vitest run packages/server
 Test Files  50 passed (50)
      Tests  425 passed (425)
```

## Acceptance criteria
- [x] `expandHome` exists in exactly one place in `packages/server` (`files/resolve-path.ts`);
      `rpc-transport.ts` re-exports rather than redefining it. `grep -c 'homedir(), .*slice(1)'` over
      `packages/server/src` returns 0 (verified).
- [x] `file_download_token_request` with `path: "~/<file>"` issues a token — verified by
      `bootstrap.test.ts`'s new "issues a download token for a ~-prefixed path" test.
- [x] `file_read_request` with `~/<file>` still resolves — no regression; existing test in
      `bootstrap.test.ts` still passes.
- [x] `~otheruser/x` passes through unexpanded — verified by the new
      `file_download_token_request` test asserting `error: "not_found"` (a rewritten
      `$HOME/otheruser/x` would also 404 on a real machine, so the `resolve-path.test.ts` unit test is
      the direct proof; the integration test corroborates the RPC path uses the same helper).
- [x] A downloaded `.png` arrives with `mimeType: "image/png"`; an unknown extension (`.txt`) still
      yields `application/octet-stream` — verified by `file-transfer.test.ts`.
- [x] `file_watch_subscribe` with a `~` path still resolves and echoes the resolved (expanded) path —
      verified by the new `bootstrap.test.ts` test in the `file_watch RPC` describe block.
- [x] `npm run build:server` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None. `.webp`/`.svg`/`.avif` remain outside `mimeHintForFile`'s table (explicitly out of scope per
  the task's own Notes) and still render via browser sniffing, unchanged from before this task.
