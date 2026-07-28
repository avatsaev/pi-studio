# Inline Image Rendering (Chat Timeline) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [timeline-rendering.md](timeline-rendering.md),
> [file-explorer-transfer.md](file-explorer-transfer.md), [agent-sessions.md](agent-sessions.md),
> [agent-providers.md](agent-providers.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md)

> **Render stack:** DOM clients only (web-client + the Electron shell that hosts the same bundle).
> Markdown rendering is `react-markdown` + `remark-gfm`; the image bytes arrive over the existing
> binary file-transfer frames. Nothing in this feature adds an RPC message type, an HTTP route, or a
> new binary opcode.

> Answers [timeline-rendering.md](timeline-rendering.md) § TODO(verify) *"Exact assistant-image
> resolution + caching path"* and refines its § Error Handling row *"Assistant image fails to
> resolve"*.

## Purpose

An agent that produces an image — a screenshot, a generated plot, a rendered diagram, a photo already
on disk — currently has no way to show it. It can only name the file, and the user must open it
manually in the file panel.

This feature makes markdown image syntax in assistant output render as an actual image in the chat
timeline, with the bytes streamed from the daemon (the browser cannot read the developer's
filesystem), and makes the agent aware that it *should* use that syntax — but only when the
connected client can actually display it.

Two halves, deliberately independent:

- **Render half (client only).** Any `![alt](path)` in a finalized assistant markdown block whose
  `path` resolves to a local image file is fetched over file-transfer and displayed inline.
- **Instruction half (protocol + daemon).** A client advertises an `inline_image_markdown`
  capability in its handshake; the daemon appends a short image-rendering instruction to the agent
  session's system prompt at spawn time when the creating client advertised it.

## Public Contract

### Capability flag

A new client→daemon capability flag, advertised in the `hello` handshake's `capabilities` map:

| Flag | Direction | Meaning |
|------|-----------|---------|
| `inline_image_markdown` | client → daemon | This client renders markdown images (`![alt](path)`) whose target is a local filesystem path, by fetching the file from the daemon. |

Appended to the client-capability registry; the registry's existing `supports(caps, flag)` helper is
the only read path. Purely additive — a client that omits it behaves exactly as today.

Advertised by: web-client (and therefore the Electron desktop shell, which loads the same bundle).
Not advertised by: CLI, MCP.

### Markdown image source classification

A pure function over the raw markdown `src` plus an optional **asset base** directory. It is the
single decision point for "is this a local file we should fetch":

```
classifyImageSrc(src, base) ->
  | { kind: "remote" }                 // pass through to the plain <img> path unchanged
  | { kind: "local", path: <absolute> } // fetch from the daemon
  | { kind: "unresolvable" }            // render the text fallback
```

Classification rules, in order:

| `src` shape | Result |
|---|---|
| empty / whitespace | `unresolvable` |
| `http:` / `https:` / `data:` / `blob:` scheme | `remote` |
| any other explicit `scheme:` (incl. `file:`) | `unresolvable` |
| starts with `/` | `local`, path used as-is |
| starts with `~` | `local`, `~` expanded against the resolved home dir; `unresolvable` if the home dir is not yet known |
| starts with `./` or `../`, or is a bare relative path | `local`, joined onto `base`; `unresolvable` when `base` is absent |
| resolves to a `local` path whose detected viewer kind is not `image` | `unresolvable` |

The final rule is the type gate: the extension→viewer-kind detection that the file panel already uses
decides what counts as an image. `![](report.pdf)` therefore never triggers a download; it degrades
to the text fallback. Registering a new image extension in the viewer registry automatically extends
inline rendering — there is no second extension list.

Relative-path joining reuses the *existing* single source of truth for "repo-relative path + cwd →
absolute path" (the file-tab live-refresh watch-target resolver). That resolver must be lifted into a
shared path-utility module rather than copied: a second, drifting implementation of this join is the
exact failure its own documentation warns about.

### Asset base

The directory that relative image paths resolve against. Passed explicitly as an optional prop, not
via ambient context (the web-client has no React contexts today; introducing one for a single
consumer is not warranted, and an explicit prop keeps the resolution testable).

| Markdown surface | Asset base | Rationale |
|---|---|---|
| Assistant message row | the chat session's `cwd`, tilde-normalized | Matches the cwd the agent itself runs in, so agent-emitted relative paths resolve the way the agent means them |
| Reasoning row | none | Reasoning is a thinking trace, not a deliverable; deliberately excluded so a speculative path in a thought never triggers a fetch |
| Markdown file viewer | none in the initial scope; the viewed file's directory is the natural value | Opting this in makes repository README images render for free; called out as a follow-on, not part of the acceptance criteria |

With no asset base, absolute and `~` paths still resolve; only relative paths degrade to
`unresolvable`.

### Inline image fetch + cache

Image bytes are obtained through the **existing** download path — request a single-use download
token for the path, request the chunked transfer, assemble `Begin → Chunk* → End` binary frames into
one buffer, wrap in a blob, expose an object URL. See
[file-explorer-transfer.md](file-explorer-transfer.md) § Binary transfer frames.

Inline chat images do **not** reuse the file-viewer download hook. That hook's object-URL ownership
model is single-exclusive-consumer: zero cache retention, revoke on unmount. The chat timeline is
virtualized, so scrolling an image out of view unmounts its row; under that model the URL is revoked
and the whole file is re-downloaded on scroll-back. Inline images need shared, many-consumer,
remount-stable ownership:

- A module-scoped cache keyed by **absolute resolved path**, holding `{ objectUrl, refCount }`.
- Bounded by entry count (LRU eviction, order of 32 entries).
- Concurrent requests for the same path share one in-flight download.
- An object URL is revoked only on LRU eviction or on connection teardown — never on row unmount.
- The cache is keyed by path only, so an image whose file changes on disk is not automatically
  refreshed (see § Error Handling & Edge Cases).

Both hooks call the same underlying transfer primitive; only the retention policy differs.

### Loading, error, and interaction states

| State | Rendering |
|---|---|
| `remote` | The plain `<img>` the markdown renderer would have produced, untouched |
| `local`, download in flight | A fixed-height skeleton placeholder (no layout jump, no spinner churn per image) |
| `local`, resolved | `<img>` with the object URL, `alt` from the markdown, constrained to the timeline column width, intrinsic aspect ratio preserved, click opens the file in a file tab |
| `local`, download failed (missing file, unreadable, token refused) | **Text fallback**, not a broken-image icon: the `alt` text (or the raw path when `alt` is empty) rendered as inline monospace text |
| `unresolvable` | Text fallback, no network request |

The text fallback is a hard requirement, not polish. Agents emit paths that do not exist; a
hallucinated image must degrade to readable text that shows the user *what* the agent claimed, never
to a broken-image glyph that looks like a client bug.

### Streaming interaction

Assistant rows render raw text while streaming and only parse markdown once the block finalizes.
Inline image fetching therefore begins at block finalization — a partially-typed `![](scr` never
issues a request. This is existing behavior; the feature depends on it and must not change it.

### Agent instruction

When the client that issues an agent-creation request advertises `inline_image_markdown`, the daemon
appends a short instruction block to that session's system prompt. Content requirements (exact
wording is not contractual, these properties are):

- States that the session's output is displayed in a surface that renders markdown images.
- Instructs the agent to embed images it creates or references as `![alt](path)`.
- States that `path` may be workspace-relative or absolute.
- Constrains it to files that actually exist on the machine.
- Short — a handful of lines. It rides on every turn of the session's context for the session's
  entire life.

Mechanics:

- The instruction is **appended** to the agent session config's existing system-prompt field, which
  already flows to the provider as an appended system prompt (the provider's default prompt is
  preserved, never replaced). If a caller supplied its own system prompt, the instruction is appended
  after it; the caller's text is never overwritten.
- The composed value is persisted in the agent record's config, so it survives a daemon restart.
- The capability is read from the **per-connection session state** the RPC dispatcher already carries
  alongside every request. The agent-creation handler currently discards that session object; it must
  thread it through. No new plumbing beyond passing the value that is already in scope.
- Providers that do not support an appended system prompt ignore the field, as they do today.

## Behavior & Algorithms

### Render pipeline

```
finalized assistant markdown block
  -> markdown renderer, with an `img` node override registered alongside the existing `code` override
  -> classifyImageSrc(src, assetBase)
       remote       -> default <img>
       unresolvable -> text fallback
       local(path)  -> inline-image cache lookup
                         hit          -> object URL, render immediately
                         miss         -> download token -> chunked transfer -> blob -> object URL
                                         (skeleton while in flight, text fallback on failure)
```

The `img` override is registered in the same node-override map that already carries the `code`
override — one added entry, no restructuring of the markdown component.

### Lazy loading

No `IntersectionObserver` is needed. Timeline virtualization only mounts near-viewport rows, so
mounting *is* the visibility signal: images far up the history never fetch until scrolled to. This is
also the reason the shared cache matters — virtualization causes continuous mount/unmount churn.

### Path resolution asymmetry (must-handle)

The daemon's inline text-read handler expands a leading `~` before resolving; the download-token
handler does **not** — it resolves the client-supplied path directly. Two options, both acceptable,
one must be chosen and documented in the implementation:

1. Expand `~` client-side before requesting the token (the client already has a cached resolved home
   directory and a normalization helper), or
2. Fix the asymmetry daemon-side so every file-path handler expands `~` through one shared helper.

Option 2 is preferred on maintenance grounds: the tilde-expansion logic is currently duplicated
across multiple daemon modules, and consolidating it removes both the duplication and the surprise.
Option 1 is sufficient for this feature alone.

### MIME type

The download's `Begin` frame carries a transfer id and file name but no content type, so assembled
blobs are typed `application/octet-stream`. Browsers content-sniff blob URLs in `<img>`, so this
works (the file-panel image viewer already relies on it). The daemon nonetheless already has an
extension→MIME lookup used for file-explorer binary previews; feeding it into the `Begin` frame's
metadata removes the reliance on sniffing and is a strictly additive, optional improvement.

## Data & Persistence

- **Client:** object URLs live only in the bounded module-scoped cache; nothing is persisted. Image
  bytes never enter the timeline store, so persisted agent records stay text-only and no timeline row
  gains a new field.
- **Daemon:** the composed system prompt (caller-supplied text plus the appended image instruction)
  is stored in the agent record's config, as any system prompt already is. No new persisted entity,
  no schema migration.
- **Wire:** no new message type, no new binary opcode, no changed field semantics. One added
  capability flag string.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|---|---|
| Path does not exist / not readable by the daemon | Download token request fails; row shows the text fallback |
| `src` is a remote URL | Rendered as an ordinary `<img>`; no daemon round trip |
| `src` is a non-image file (`.pdf`, `.txt`) | Text fallback; no download attempted |
| Relative path with no asset base | Text fallback; no download attempted |
| `~` path before the home directory has resolved | Text fallback; re-renders as `local` once the home dir arrives |
| Same image referenced by several rows / turns | One download, one object URL, shared by ref count |
| Row scrolled out of view and back | Instant re-render from cache; no re-download |
| Image file changes on disk after being rendered | Stale image is kept. Inline images do not subscribe to file-change pushes; the agent overwriting a path in place is rare relative to the watch cost, and the failure mode is benign |
| Very large image file | Downloaded in full. No size cap in this scope — see § Known Limitations |
| Agent points at a sensitive non-image path | Renders as the text fallback (extension gate). No new capability is granted: the agent already reads arbitrary files with its own tools, and the daemon's file surface is explicitly not a security boundary |
| Client does not advertise the capability | No instruction is appended; agent output is unchanged |
| Disconnected while a download is in flight | The transfer rejects; row shows the text fallback and retries on the next mount |

## Known Limitations (accepted)

**The instruction is fixed at agent spawn time.** A chat created from the CLI and later opened in the
browser has no image instruction; a browser-created session driven from the CLI has the instruction
even though the CLI shows `![](path)` as plain text. This is inherent to an appended-at-spawn system
prompt, and is accepted.

The degradation is benign in both directions: a missing instruction means the agent simply names
files as it does today, and an unused instruction means a CLI user sees a markdown path in text. The
alternative — per-turn hidden context — does not exist in the current design: the prompt string sent
to a turn is dual-purpose (it is both the provider's message text and the timeline's user-visible
message text), so there is no hidden-context channel to inject into without a substantially larger
change to the turn-run contract.

**Pre-existing defect this feature exposes.** Session resume rebuilds the provider process using only
the daemon-wide default appended system prompt, dropping the per-session system prompt the record
carries. Any per-session system prompt therefore vanishes on daemon restart or on the first spawn of
a deferred draft — including this feature's instruction. Resume must honor the record's system prompt
the same way initial creation does. This is a one-line correction and is in scope.

**No download size cap.** An agent linking a very large image downloads it in full. The correct place
for a cap is the daemon's download stream (stat before streaming, refuse with an `Error` frame), but
that changes behavior for the file explorer's downloads too, so it is deliberately out of scope
rather than papered over with a client-side check that runs *after* the bytes have already
transferred.

## Dependencies

- Internal (client): the shared markdown renderer and its node-override map; the file-transfer
  download client; the shared relative-path resolver; the viewer-kind extension detection; the
  cached resolved home directory and cwd normalization; the tab store (click-to-open).
- Internal (daemon/protocol): the client-capability registry and its `supports` helper; the
  per-connection session state carried on each RPC dispatch; the agent session config's system-prompt
  field and the provider's appended-system-prompt spawn argument.
- External: none added.

## Acceptance Criteria

- [ ] An assistant message containing `![alt](./shot.png)` in a session whose cwd contains that file
      renders the image inline, sized to the timeline column.
- [ ] The same with an absolute path, and with a `~`-prefixed path, renders inline.
- [ ] `![alt](https://…)` renders as an ordinary remote image with no daemon round trip.
- [ ] `![alt](missing.png)` renders `alt` as inline text, not a broken-image glyph, and issues no
      repeated retry storm.
- [ ] `![alt](notes.pdf)` renders the text fallback and issues no download request.
- [ ] A relative path in a reasoning/thinking row is never fetched.
- [ ] The same image path referenced twice in a conversation downloads once.
- [ ] Scrolling a rendered image out of the virtualized viewport and back shows it immediately with
      no second download.
- [ ] Clicking a rendered inline image opens that file in a file tab.
- [ ] While an assistant block is still streaming, no image request is issued for partial markdown.
- [ ] A web-client-created agent session's persisted config contains the image instruction appended
      to (not replacing) any caller-supplied system prompt; a CLI-created session's does not.
- [ ] After a daemon restart, a resumed session still spawns with its persisted per-session system
      prompt applied.
- [ ] `classifyImageSrc` is unit-tested across every row of the classification table, including the
      no-asset-base and unknown-home-dir cases.
- [ ] No new wire message type, binary opcode, or HTTP route was introduced.

## Out of Scope

- Server-side thumbnailing, downscaling, or format transcoding.
- Embedding image bytes (base64 / data URLs) in timeline rows or persisted records.
- A dedicated image-fetch RPC or an HTTP static-file route on the daemon.
- Auto-detecting bare image paths in prose — markdown image syntax is the contract.
- Live refresh of an inline image when its file changes on disk.
- Video, audio, or PDF inline embedding.
- Non-DOM clients (a future mobile client opts in by advertising the same capability flag and
  implementing the render half against its own image primitive).

## TODO(verify)

- [ ] Whether the markdown file viewer should pass the viewed file's directory as its asset base
      (makes repository README images render); behavior is desirable, ordering relative to this scope
      is not decided.
- [ ] Whether the daemon-side tilde-expansion consolidation lands with this feature or separately.
