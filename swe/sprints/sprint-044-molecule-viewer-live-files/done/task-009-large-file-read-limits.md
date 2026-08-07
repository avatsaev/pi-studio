# Task 009 — Raise the file-read ceiling: 5 MiB inline, streamed above that, 30 MiB display cap

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** none

## Goal
Make opening a large text file work instead of erroring at 512 KiB — without putting a multi-MB
string in a JSON text frame or blocking the daemon's event loop. Three tiers: inline RPC up to
**5 MiB**, the existing **uncapped chunked download** above that, and a **30 MiB display ceiling**
where the viewer stops trying and offers a download instead.

## Background / why
`file_read_request` today (`bootstrap.ts:465-491`, duplicated verbatim in `dev-bootstrap.ts:281-303`)
rejects anything over **512 KiB** with `error: "file_too_large"`, which `use-file-read.ts:32` turns
into a thrown `Error` and `TextViewer.tsx:23-29` renders as a bare `Error: file_too_large` line. A
600 KB JSON fixture or a 2 MB log is unopenable, with no path forward offered.

**Why not simply raise the number to 30 MiB** — measured against the actual implementation:
1. `readFileSync(resolved, "utf8")` (line 474) is **synchronous**. A 30 MB read + UTF-8 decode blocks
   the daemon's event loop outright: agent streams, terminal output, heartbeats and every other
   session stall for its duration. This is the single strongest argument and it applies at *any*
   raised cap, which is why the read becomes async here regardless of the number.
2. The payload is copied roughly four times end to end: `JSON.stringify`'s escape pass → the WS text
   frame → the client's `JSON.parse` → the TanStack cache entry. Over the relay
   (`packages/relay`), each message is additionally NaCl-boxed — another full-size copy plus crypto.
3. No `maxPayload` is configured on the `ws` server anywhere (grep-verified across
   `packages/{server,protocol,client,relay}/src`), so an oversized frame is not rejected — it just
   silently costs the memory on both ends.
4. `CodeView.tsx:59` enables `EditorView.lineWrapping`, which makes CodeMirror measure heights across
   the document; a 30 MB doc is well past where that stays interactive.

Meanwhile the **uncapped** path already exists and is the right mechanism for genuinely large files:
`FileTransferService` streams via `createReadStream` in 32 KiB chunks (`file-transfer.ts`,
`DEFAULT_CHUNK_BYTES`), and `useFileDownload` already wraps it with object-URL lifecycle management
(`use-file-download.ts:46-61`). Routing large text through it costs one branch, not a new subsystem —
and yields *unbounded* file size rather than a bigger fixed number.

## Scope references
- `docs/molviewer-integration-scope.md` § 2.3 (the two fetch paths and their ceilings)
- `clean-room-scope/features/file-explorer-transfer.md` § file preview, § transfer
- `clean-room-scope/architecture/websocket-protocol.md` § text frames vs binary frames
- `packages/server/AGENTS.md` § files services; `packages/web-client/AGENTS.md` § features/files

## What to build
### Server
- **`packages/server/src/files/limits.ts`** (new) — the single source of truth, since the cap is
  currently duplicated across two bootstraps:
  ```ts
  /** Largest file returned inline as UTF-8 in a `file_read_response` JSON frame. Above this,
   *  clients must use the chunked binary download path (`file-transfer.ts`), which is unbounded. */
  export const MAX_INLINE_FILE_READ_BYTES = 5 * 1024 * 1024;
  ```
- **`packages/server/src/daemon/bootstrap.ts`** (`file_read_request`, lines 465-491) and
  **`dev-bootstrap.ts`** (lines 281-303) — both handlers:
  - use `MAX_INLINE_FILE_READ_BYTES` instead of the inline `512 * 1024`;
  - become **async**: `statSync`/`readFileSync` → `await stat(...)`/`await readFile(..., "utf8")`
    from `node:fs/promises`. The registry already supports async handlers (sibling handlers such as
    `file_diff_request` at line 443 and `checkout_refresh_request` are `async`), so this is a local
    change with no plumbing.
  - keep the `error: "file_too_large"` code and the `size` field exactly as they are — the client
    branches on both, and the wire contract is append-only. Add the ceiling to the response as a new
    **optional** field `maxBytes` so a client can render an accurate message without hardcoding the
    server's limit.
  - keep the two handlers byte-identical to each other (they already are; preserve that).

### Client
- **`packages/web-client/src/hooks/use-file-read.ts`** — surface the structured failure instead of
  flattening it into a message string. Widen `FileReadResult`/the thrown error so a caller can
  distinguish `file_too_large` (with `size` and `maxBytes`) from a genuine read failure. Do not
  change the success shape.
- **`packages/web-client/src/hooks/use-file-text.ts`** (new) — the tier-2 fetch: given a path, fetch
  through `useFileDownload` and decode the blob to text (`await (await fetch(objectUrl)).text()`, or
  a `TextDecoder` over the bytes — whichever reads cleaner against the hook's return shape). This is
  the same primitive the molecule viewer uses for its own (binary-safe) source, so no new transport.
  **Note the daemon asymmetry**: the download RPCs this depends on are registered **only** in the
  production bootstrap (`bootstrap.ts:429-434`); `dev-bootstrap.ts` has none (line 252 registers a
  bare `FileExplorerService`). So under `npm run dev:daemon` a file above the inline cap will fail
  the streamed fetch rather than render. Surface that as the normal error state — do not add
  download handlers to the dev bootstrap — and verify tier 2 against `npm start`.
- **`packages/web-client/src/features/files/TextViewer.tsx`** — three states instead of one error
  line:
  1. under the inline cap → today's `useFileRead` → `CodeView` path, unchanged;
  2. `file_too_large` **and** `size <= MAX_DISPLAY_BYTES` (30 MiB, a web-client constant) →
     transparently refetch via `use-file-text.ts` and render `CodeView` as normal, with a small muted
     note that the file was streamed;
  3. `size > MAX_DISPLAY_BYTES` → a clear terminal state: the file's size, why it is not rendered,
     and a download action reusing `BinaryFallbackViewer`'s existing download affordance
     (`BinaryFallbackViewer.tsx:36-38`) rather than a new one.
  Keep the error copy specific — `"12.4 MB file streamed"` / `"48 MB — too large to display"`, never
  a bare `file_too_large`.

## Out of scope
- Virtualizing or paginating `CodeView` for huge documents, or disabling `lineWrapping` above a
  threshold. The 30 MiB display ceiling exists precisely so this isn't needed now; note it as the
  natural follow-up if users hit the ceiling in practice.
- Binary sniffing. `readFile(..., "utf8")` on a 5 MB binary still yields garbage — same as today,
  just more of it. `detectViewerKind`'s existing `isBinary`/mimeHint routing is the intended guard and
  is unchanged here. Note the residual risk; do not extend into content sniffing.
- Raising or touching any limit in the **download** path (it has no cap by design) or molviewer's own
  `maxFileBytes` (64 MB default, `api.d.ts:240-241`).
- Making either limit configurable via env/`config.json`. Two constants in two files is the right
  amount of mechanism; a knob nobody has asked for is not.
- `git diff`'s `maxBuffer: 1024 * 1024` (`bootstrap.ts:450`) — a separate, unrelated ceiling on
  `file_diff_request`. Note it as a known adjacent limit; do not change it in this task.

## Acceptance criteria
- [ ] A 2 MB text file opens inline and renders in `CodeView` (previously `file_too_large`).
- [ ] A 12 MB text file opens via the streaming fallback and renders, with the muted "streamed" note.
- [ ] A 48 MB text file shows the size-aware terminal state with a working download action, and does
      **not** attempt to render.
- [ ] `file_read_request` is `async` in both bootstraps — a large read no longer blocks the event
      loop. Demonstrated, not assumed: see the test plan's concurrency check.
- [ ] The `file_too_large` error code and `size` field are unchanged; `maxBytes` is additive and
      optional.
- [ ] The 512 KiB literal no longer appears in either bootstrap; both read
      `MAX_INLINE_FILE_READ_BYTES`.
- [ ] `npm run build`, `npm run typecheck`, and `npm test` pass.

## Test / verification plan
- Server unit (`packages/server/src/files/limits.test.ts` or alongside the existing bootstrap tests):
  a file just under the cap returns `ok: true` with correct `size`; just over returns
  `ok: false, error: "file_too_large"` with `size` and `maxBytes`; a directory still returns
  `is_directory`; a `~`-prefixed path still resolves.
- **Event-loop non-blocking check** (the point of the async change): issue a `file_read_request` for a
  ~5 MiB file and, without awaiting it, issue a second cheap RPC on the same connection; assert the
  cheap one resolves before or alongside the large read rather than strictly after it. If the harness
  makes interleaving hard to assert deterministically, measure instead that a large read does not
  delay a concurrent `ping`/cheap request beyond a small bound, and record the observed numbers.
- Client unit: `use-file-text.test.ts` (mock `useFileDownload`) asserts decode-to-text; a `TextViewer`
  test with a mocked `useFileRead` asserting the three-state branch by `size` (inline / streamed /
  too-large) — mock `CodeView` rather than mounting CodeMirror.
- Manual, against the production daemon: generate fixtures and open each from the explorer —
  `head -c 2M`, `head -c 12M`, `head -c 48M` of a real source-ish file (e.g. repeated JSON lines) plus
  one just under and just over 5 MiB.

## Notes
- Numbers chosen deliberately: 5 MiB covers essentially every real source file and most logs while
  keeping the JSON round trip cheap; 30 MiB is where CodeMirror + `lineWrapping` stops being
  interactive, so it is a *display* ceiling rather than a transport one. The transport itself is
  unbounded above 5 MiB via streaming — that is what makes "open a 30 MB file" work without a 30 MB
  JSON frame.
- This task is independent of the molecule viewer (which never used `file_read_request`) and of the
  file-watch work — it can be implemented in parallel with any of tasks 001-008.
