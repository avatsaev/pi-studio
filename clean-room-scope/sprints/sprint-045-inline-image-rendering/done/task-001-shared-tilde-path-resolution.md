# Task 001 — Shared daemon path resolution (`~` expansion) + `mimeType` in transfer `Begin`

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Make every daemon file-path RPC expand a leading `~` through **one** shared helper — closing the gap
that `file_download_token_request` does not expand at all — and stamp the transfer's `Begin` frame
with a MIME hint so downloaded blobs are correctly typed instead of relying on browser sniffing.

## Background / why
Root `AGENTS.md` invariant 7 says `~` is expanded server-side. It is — six times, inline, copy-pasted:

- `packages/server/src/daemon/bootstrap.ts:456` (git-diff cwd), `:479` (`file_read_request`)
- `packages/server/src/daemon/dev-bootstrap.ts:264`, `:287` (same two)
- `packages/server/src/files/file-watch-rpc.ts:42`, `:73`

`packages/server/src/files/file-watch-service.ts:62-66` carries a comment that explicitly *declines*
to factor it out ("duplicated inline per that file's own convention"). Meanwhile a correct helper
already exists in the wrong place: `expandHome(dir)` in
`packages/server/src/agent/providers/pi/rpc-transport.ts:53-57`.

The consequence this sprint trips over: `file_download_token_request`
(`packages/server/src/files/file-transfer.ts:53-63`) calls `realpath(path)` directly with **no**
expansion, so `~/shot.png` fails there while succeeding on `file_read_request`. Inline chat images
resolve `~` paths (see the scope's classification table), so this asymmetry must go.

The inline form is also subtly wrong: `path.startsWith("~") ? join(homedir(), path.slice(1)) : path`
turns `~otheruser/x` into `$HOME/otheruser/x`. `expandHome` only matches `~` exactly and the `~/`
prefix, leaving `~otheruser` alone — which is the correct behavior.

Separately, `startDownload` (`file-transfer.ts:104-110`) emits `Begin` with `{ transferId, fileName }`
only — no `mimeType` — so `FileTransferClient` (`packages/client/src/file-transfer-client.ts:141-142`)
always reports `undefined` and every assembled blob is typed `application/octet-stream`. Browsers
sniff blob URLs in `<img>` so the existing `ImageViewer` works, but the daemon already has the lookup
it needs (`mimeHintForFile`, `packages/server/src/files/file-explorer.ts:302`).

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Behavior & Algorithms → Path resolution
  asymmetry (option 2 is the chosen one), § MIME type
- `clean-room-scope/features/file-explorer-transfer.md` § Binary transfer frames
- Root `AGENTS.md` § Key invariants / coding conventions (invariant 7)

## What to build
- **`packages/server/src/files/resolve-path.ts`** (new) — the single home-expansion helper for the
  daemon's file surface:
  ```ts
  /** Expand a leading `~`/`~/` against the process home dir. Any other path is returned as-is. */
  export function expandHome(path: string): string;
  ```
  Same semantics as `providers/pi/rpc-transport.ts`'s `expandHome`. Re-export it from there (or
  import it there) so there is exactly one implementation in the package — pick one direction and say
  which in the summary.
- **Replace all six inline expansions** with a call to it: `bootstrap.ts:456,479`,
  `dev-bootstrap.ts:264,287`, `file-watch-rpc.ts:42,73`. Also
  `files/file-watch-service.ts:62-66` — delete the now-false "duplicated per convention" comment and
  call the helper.
- **`packages/server/src/files/file-transfer.ts`** — `file_download_token_request` expands `~` before
  `realpath()`. This is the behavioral fix inline images need.
- **`packages/server/src/files/file-explorer.ts`** — export `mimeHintForFile` (currently
  module-private at line 302) so the transfer service can use it. Leave its extension table and
  `application/octet-stream` default untouched.
- **`packages/server/src/files/file-transfer.ts`** — `startDownload` includes
  `mimeType: mimeHintForFile(path)` in the `Begin` frame's `meta`. The frame `meta` is already a
  passthrough object and `FileTransferClient` already reads `frame.meta.mimeType`, so no protocol or
  client change is needed.

## Out of scope
- Any download size cap (explicitly out of scope for the whole sprint — see the scope's § Known
  Limitations).
- Extending `mimeHintForFile`'s extension table.
- Sandboxing/rooting file paths. The daemon's file surface is documented as not a security boundary
  (`file-explorer.ts` header) and this task does not change that.
- Client-side `~` handling (the client still normalizes `~` for its own cache keys — task-002).

## Acceptance criteria
- [ ] `expandHome` exists in exactly one place in `packages/server`, and `grep -c 'homedir(), .*slice(1)'`
      over `packages/server/src` returns 0.
- [ ] `file_download_token_request` with `path: "~/<file>"` issues a token (previously `not_found`).
- [ ] `file_read_request` with `~/<file>` still resolves (no regression on the existing behavior).
- [ ] `~otheruser/x` is passed through unexpanded rather than rewritten to `$HOME/otheruser/x`.
- [ ] A downloaded `.png` arrives with `mimeType: "image/png"` on the client, and an unknown
      extension still yields `application/octet-stream`.
- [ ] `file_watch_subscribe` with a `~` path still resolves and echoes the resolved path.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/server/src/files/resolve-path.test.ts` (new) — `~`, `~/x`, `~otheruser/x`, `/abs`,
  `rel`, `""`.
- Integration: extend the existing tilde test in
  `packages/server/src/daemon/bootstrap.test.ts` (§ `file_read RPC`, the `~/` case at ~line 488) with
  a sibling case that requests a download token for a `~/` path and asserts `ok: true`.
- Unit: extend the file-transfer tests to assert the `Begin` frame's `meta.mimeType` for a `.png` and
  for an unknown extension.
- Run: `npx vitest run packages/server/src/files packages/server/src/daemon/bootstrap.test.ts`.

## Notes
- `dev-bootstrap.ts` does **not** register the download-token RPCs (its own comment at
  `dev-bootstrap.ts:282-284` says so), so the download-token fix only lands in the production
  bootstrap path. Do not add them to the dev bootstrap here.
- `mimeHintForFile` currently covers png/jpg/jpeg/gif/pdf/zip/wasm. `.webp`/`.svg`/`.avif` fall
  through to octet-stream, which still renders via sniffing — acceptable, and out of scope.
