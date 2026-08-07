# Task 009 — Summary

## What was built

### Server
- **`packages/server/src/files/limits.ts`** (new) — `MAX_INLINE_FILE_READ_BYTES = 5 * 1024 * 1024`,
  the single source of truth replacing the `512 * 1024` literal duplicated in both bootstraps.
  Exported from `files/index.ts`.
- **`bootstrap.ts` / `dev-bootstrap.ts`** (`file_read_request`, kept byte-identical to each other,
  as before): converted from a synchronous `registry.register("file_read_request", (ctx) => {...})`
  using `statSync`/`readFileSync` to an `async` handler using `stat`/`readFile` from
  `node:fs/promises`. Uses `MAX_INLINE_FILE_READ_BYTES` instead of the inline literal. The
  `file_too_large` error code and `size` field are unchanged; added the additive optional
  `maxBytes` field so a client can render an accurate ceiling without hardcoding the server's
  number. `is_directory` and generic-failure branches are untouched.

### Client
- **`use-file-read.ts`** — added `FileTooLargeError` (carries `size` + optional `maxBytes`) and
  extracted the response→result/error mapping into a pure, directly-testable
  `parseFileReadResponse`. `useFileRead`'s hook body is now a thin wrapper calling it — callers
  can `instanceof FileTooLargeError` to distinguish "too large, here's how large" from a generic
  read failure, instead of matching the string `"file_too_large"`.
- **`file-text-state.ts`** (new, `hooks/`) — pure merge of the download→decode dependent-query pair
  `use-file-text.ts` composes (`mergeFileTextState`), DOM/React-free so the loading/error/data
  composition is unit-testable without `renderHook`.
- **`use-file-text.ts`** (new) — the tier-2 fetch: wraps `useFileDownload` (the existing uncapped
  chunked binary path — no new RPC, no new transport) and decodes the resulting blob's object URL
  to text via `fetch(objectUrl).then(r => r.text())`, composing loading/error state through
  `mergeFileTextState`.
- **`text-viewer-state.ts`** (new, `features/files/`) — pure tier-selection logic
  (`selectTextViewerState`): given the inline-read state, the tier-2 stream state, and the
  on-demand download state, picks exactly one of `loading` / `inline` / `streaming` / `streamed` /
  `stream-error` / `too-large` / `error`. DOM/React-free.
- **`TextViewer.tsx`** — rewritten as a thin switch-render over `selectTextViewerState`. Three
  behaviors: ≤5 MiB renders inline via the existing `useFileRead` → `CodeView` path unchanged;
  5 MiB–30 MiB transparently refetches via `use-file-text.ts` and renders the same `CodeView` with
  a muted `"N.N MB file streamed"` note; >30 MiB shows a terminal state (size, why, a working
  download action reusing `BinaryFallbackViewer`'s on-demand `useFileDownload` + "Save file" link
  pattern) with **no** render attempt.
- **`TextViewer.module.css`** (new) — `.wrap`/`.note`/`.body`/`.tooLarge` styles for the new states.
- `rpcKeys.fileText` added (`["file", "text", path]`) for the tier-2 query's own cache key.

### Why the pure-core extraction (`text-viewer-state.ts`, `file-text-state.ts`)
Same reasoning as task-007/008's `shouldApplyRefresh`/`createExplorerWatcher` extraction: this repo
has no jsdom test environment configured anywhere (`@testing-library/react` is a listed
`devDependency` but `jsdom` itself is not installed — confirmed via `ls node_modules/jsdom` and a
`vite.config.ts` test block with no `environment` set), so mounting `TextViewer` or calling
`useFileText` via `renderHook` isn't possible here. Pulling the actual decision trees into DOM-free
functions gets the exact "three-state branch by size" coverage the task's test plan asks for,
without adding jsdom as new test infrastructure.

## Verification
- **Server**: `bootstrap.test.ts` — 5 new tests in a `describe("file_read RPC")` block: reads a file
  under the cap (content + size); rejects a file one byte over the cap with `file_too_large` +
  `size` + `maxBytes`; rejects a directory with `is_directory`; resolves a `~`-prefixed path
  against the real home directory; and a concurrency check — issues a `file_read_request` for a
  4 MiB file, then races a second cheap `file_read_request` (on a directory, resolving via the
  `is_directory` branch) against a 300 ms timer on the same connection, asserting the cheap one
  wins the race rather than being serialized behind the large read. All 5 pass;
  `bootstrap.test.ts` full file: 20/20 pass.
- **Client**: `use-file-read.test.ts` (5 tests, `parseFileReadResponse`) — success shape, the
  `file_too_large` → `FileTooLargeError` mapping with size/maxBytes, `is_directory` staying a plain
  `Error` (not `FileTooLargeError`), a missing error code, and a missing `size` on the too-large
  path defaulting to 0. `file-text-state.test.ts` (7 tests, `mergeFileTextState`) — disabled-state
  gating, download-in-flight, decode-in-flight-once-download-resolved, decode's stale
  `isLoading: true` correctly ignored before an object URL exists (the actual dependent-query
  ordering bug this composition has to avoid), download error taking precedence over decode error,
  decode error surfacing alone, and data pass-through. `text-viewer-state.test.ts` (10 tests,
  `selectTextViewerState`) — every state transition including the boundary cases: exactly at the
  30 MiB display ceiling (still `streamed`, not `too-large`) and one byte over (flips to
  `too-large`), and confirms `too-large` ignores the streamed query's state entirely (never fetched
  for files above the ceiling). All 22 new client tests pass.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check` — all clean (oxfmt
  auto-fixed formatting on the new/touched files; zero new lint warnings on any file this task
  touched). Full monorepo suite: **918/918 tests pass**.
- **Live E2E against the real production daemon + browser** (`npm start` + web-client dev server,
  `/tmp/molviewer-smoke-test` workspace): generated three fixtures with `head -c` — a 2 MiB JSON
  lines file, a 12 MiB base64 text file, a 48 MiB base64 text file (verified exact sizes:
  2,097,203 / 12,582,912 / 50,331,648 bytes). Opened each from the real Files tree:
  - **2 MB** rendered inline in `CodeView` immediately, no note, no error (would have failed with
    `file_too_large` under the old 512 KiB cap).
  - **12 MB** showed a brief loading state, then rendered in `CodeView` with the muted
    **"12.0 MB file streamed"** note — confirmed via direct DOM inspection (`[class*="note"]`).
  - **48 MB** showed the terminal state **"48.0 MB — too large to display (display ceiling is
    30.0 MB)."** with a `Download` button and made no render attempt (`CodeView`/CodeMirror never
    mounted for this tab). Clicked `Download`; it resolved to `Save file` with a working
    `blob:` object URL and the correct `download="fixture-48mb.txt"` filename attribute.
  - Checked the daemon's own log during the run: background `agent_session_stats_request` polling
    RPCs on the same live connections kept resolving in 0–1 ms throughout the 12 MB and 48 MB
    reads — corroborating, in a real running daemon rather than just the isolated concurrency test,
    that the async conversion actually keeps the event loop responsive under load.
  - Left both the daemon (`task009-daemon`) and web-client dev server (`task009-web`) running per
    user request, with the three fixtures still present in the workspace, for further manual
    testing.

## Acceptance criteria
- [x] A 2 MB text file opens inline and renders in `CodeView` (previously `file_too_large`).
      **Verified live.**
- [x] A 12 MB text file opens via the streaming fallback and renders, with the muted "streamed"
      note. **Verified live** ("12.0 MB file streamed").
- [x] A 48 MB text file shows the size-aware terminal state with a working download action, and
      does not attempt to render. **Verified live.**
- [x] `file_read_request` is `async` in both bootstraps — demonstrated via the concurrency test in
      `bootstrap.test.ts` and corroborated live via the daemon's own log staying responsive.
- [x] The `file_too_large` error code and `size` field are unchanged; `maxBytes` is additive and
      optional — unit-tested and used live.
- [x] The 512 KiB literal no longer appears in either bootstrap; both read
      `MAX_INLINE_FILE_READ_BYTES` — confirmed by the edit itself (`grep` for `512 \* 1024` across
      both files returns nothing).
- [x] `npm run build`, `npm run typecheck`, and `npm test` pass — plus `lint`/`fmt:check`, run ahead
      of schedule since task-010 folds them in anyway.

## Notes / deviations
- No `limits.test.ts` — `limits.ts` exports a single constant; the meaningful behavior it drives
  (the cap actually being enforced, with the right error shape) is covered directly in
  `bootstrap.test.ts`'s `file_read RPC` suite instead of testing that a constant equals itself.
- Did not touch `dev-bootstrap.ts`'s lack of a dedicated test file — no such file existed before
  this task either; its handler is verified via typecheck + the identical logic shared with
  `bootstrap.ts` (which does have tests) + the live E2E pass (production daemon, which is
  `bootstrap.ts`'s code path, not `dev-bootstrap.ts`'s).
- Left `git diff`'s `maxBuffer: 1024 * 1024` in both bootstraps untouched, per the task's own
  out-of-scope note — it is a separate, unrelated ceiling on `file_diff_request`.
