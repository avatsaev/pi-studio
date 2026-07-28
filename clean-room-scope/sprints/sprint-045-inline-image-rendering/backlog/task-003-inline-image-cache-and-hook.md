# Task 003 — Ref-counted inline-image object-URL cache + `useInlineImage`

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** none (task-001 makes `~`-derived paths resolvable; this hook takes an already-absolute path)

## Goal
Fetch image bytes over the existing binary file-transfer path and hand back an object URL whose
lifetime survives virtualized row unmount — so a chat image scrolled out of view and back is instant
and never re-downloads.

## Background / why
The download mechanism is already built and shipping: `useFileDownload`
(`packages/web-client/src/hooks/use-file-download.ts`) → `transferFor(daemon).download(path)`
(`hooks/file-transfer-instance.ts` → `packages/client/src/file-transfer-client.ts:85-109`) → token
RPC, chunked `Begin/Chunk/End` frames, `Blob`, `URL.createObjectURL`. `ImageViewer.tsx` consumes it.

But `useFileDownload`'s ownership model is deliberately **single exclusive consumer**: `staleTime:
Infinity`, `gcTime: 0`, and revoke-on-unmount (`use-file-download.ts:40-61`, whose comments state the
reasoning). That is correct for a file tab, where exactly one viewer is mounted at a time. It is wrong
for the chat timeline, which is virtualized by `@tanstack/react-virtual`: scrolling an image row out
of view unmounts it, revokes the URL, and forces a full re-download on scroll-back — visible flicker
plus repeated multi-MB transfers.

So: same transfer primitive, different retention policy, separate module. Do **not** change
`useFileDownload`'s lifecycle — the file viewers depend on it, and `MoleculeViewer`'s live-reload gate
(sprint-044/task-007) is built on its `refetch()`-only semantics.

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Public Contract → Inline image fetch +
  cache, § Behavior & Algorithms → Lazy loading
- `clean-room-scope/features/file-explorer-transfer.md` § Binary transfer frames
- `packages/web-client/AGENTS.md` § hooks

## What to build
- **`packages/web-client/src/lib/inline-image-cache.ts`** (new) — framework-free, module-scoped,
  testable without React:
  ```ts
  export interface InlineImageEntry { objectUrl: string; mimeType?: string }

  /** Acquire (fetching if needed) and increment the ref count. Concurrent callers share one fetch. */
  export function acquireInlineImage(
    path: string,
    download: (path: string) => Promise<{ bytes: Uint8Array; mimeType?: string }>,
  ): Promise<InlineImageEntry>;

  /** Decrement the ref count. Never revokes — retention is the LRU's job. */
  export function releaseInlineImage(path: string): void;

  /** Revoke every object URL and clear the map (connection teardown / tests). */
  export function clearInlineImageCache(): void;
  ```
  - Keyed by **absolute resolved path**.
  - `Map` insertion order is the LRU order; on acquire, re-insert to mark as most-recently-used.
  - Bounded at `MAX_INLINE_IMAGE_ENTRIES = 32` (exported so the test can assert against it).
    Eviction picks the least-recently-used entry **with `refs === 0`** and revokes its object URL; if
    every entry is live, the cache is allowed to exceed the bound rather than revoke a URL a mounted
    `<img>` is still displaying.
  - An in-flight fetch is stored as the promise so N concurrent acquirers of the same path share one
    download. A rejected fetch removes the entry so the next mount retries.
  - The `download` function is injected (never imported) so tests need no daemon.
- **`packages/web-client/src/hooks/use-inline-image.ts`** (new):
  ```ts
  export type InlineImageState =
    | { status: "idle" }        // no client yet, or path is null
    | { status: "loading" }
    | { status: "ready"; objectUrl: string }
    | { status: "error"; message: string };

  export function useInlineImage(path: string | null): InlineImageState;
  ```
  - Reads `client`/`daemon` from `useConnectionStore` exactly as `use-file-download.ts:23-24` does;
    with no live connection the state is `idle` (no fetch, no error flash).
  - Acquires on mount / path change, releases the previous path in cleanup, and ignores a resolution
    that lands after unmount (the `cancelled` flag pattern used across the existing hooks).
  - Passes `(p) => transferFor(daemon).download(p)` as the injected downloader.
  - Deliberately **not** a TanStack Query hook, and therefore no `rpcKeys` entry: the retention policy
    is the whole point and Query's cache cannot express "revoke only on LRU eviction". Say this in a
    header comment so the next maintainer does not "fix" it into a `useQuery`.
- **Teardown wiring:** call `clearInlineImageCache()` where the connection tears down (the same place
  `connection-store.ts` disposes the client / `transferFor`'s instance), so a reconnect does not leak
  object URLs pointing at a dead transfer.

## Out of scope
- Any markdown/component integration (task-004).
- Path classification or resolution (task-002).
- Live refresh when the underlying file changes — inline images deliberately do **not** subscribe to
  `file_watch_*` (scope § Error Handling: stale image is kept).
- Download size caps (out of scope sprint-wide).
- Changing `useFileDownload` in any way.

## Acceptance criteria
- [ ] Two components requesting the same path concurrently trigger exactly **one** download and both
      receive the same object URL.
- [ ] Mounting, unmounting, and remounting the same path performs exactly one download; the object URL
      is not revoked between them.
- [ ] Acquiring a 33rd distinct path with all previous entries released revokes the least-recently-used
      one; with all 32 still referenced, nothing is revoked.
- [ ] A failed download surfaces `status: "error"` with the transfer's message and leaves no cache
      entry, so a remount retries.
- [ ] `clearInlineImageCache()` revokes every URL and empties the map.
- [ ] With no connection, `useInlineImage` returns `idle` and issues no request.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/web-client/src/lib/inline-image-cache.test.ts` — pure, with a fake `download` that
  counts calls and a stubbed `URL.createObjectURL`/`revokeObjectURL` pair (assert revoke calls
  directly). Covers: dedupe of concurrent acquires, hit after release, LRU eviction with and without
  live refs, rejection cleanup, `clear`.
- Unit: `packages/web-client/src/hooks/use-inline-image.test.ts` — with a fake client following the
  `fakeClient({...})` factory convention in `packages/web-client/src/stores/materialize.test.ts`:
  asserts `idle` with no client, `loading` → `ready` transition, release-on-unmount, and that a
  path change releases the old path before acquiring the new one.
- Run: `npx vitest run packages/web-client/src/lib/inline-image-cache.test.ts packages/web-client/src/hooks/use-inline-image.test.ts`.

## Notes
- `FileTransferClient.download` resolves `{ bytes, fileName?, mimeType? }`; after task-001 `mimeType`
  is populated for known extensions. Type the blob with it, falling back to
  `"application/octet-stream"` exactly as `use-file-download.ts:34-36` does — including its
  `Uint8Array.from(...)` copy, which exists because `Blob`'s DOM typings reject an
  `ArrayBufferLike`-backed view.
- `transferFor(daemon)` is per-daemon-instance; the cache is global. That is intentional (paths are
  machine-absolute and a daemon swap tears the cache down), but note it in the module header.
