# Task 003 — Ref-counted inline-image object-URL cache + `useInlineImage` — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-28
- **Status:** done

## What was implemented
- `packages/web-client/src/lib/inline-image-cache.ts` (new): framework-free, module-scoped cache
  keyed by absolute resolved path. `acquireInlineImage(path, download)` dedupes concurrent fetches
  of the same path (shared in-flight promise), increments a ref count, and re-inserts the key on
  every acquire so `Map` insertion order tracks LRU order. `releaseInlineImage(path)` only
  decrements the ref count — it never revokes; eviction is the only thing that revokes.
  `clearInlineImageCache()` revokes every object URL and empties the map. Bounded at
  `MAX_INLINE_IMAGE_ENTRIES = 32` (exported); eviction walks the map in LRU order and revokes the
  first entry with `refs === 0`, leaving the cache over-bound rather than revoking a URL something
  still references. A rejected download removes its cache entry so the next mount retries. An
  object URL that resolves after its own entry was replaced (evicted/cleared mid-flight) is revoked
  immediately rather than leaked.
- `packages/web-client/src/hooks/use-inline-image.ts` (new): `useInlineImage(path)` reads
  `client`/`daemon` from `useConnectionStore` exactly as `use-file-download.ts` does — no
  connection means `idle`, no fetch. The actual effect body is extracted into `loadInlineImage`
  (exported), mirroring `use-file-watch.ts`'s `watchFile` extraction: this package has no
  jsdom/React-Testing-Library environment (`packages/web-client/AGENTS.md`'s documented testing
  convention), so hooks with real branching logic get a plain, directly-testable core rather than a
  `renderHook` test. `loadInlineImage` acquires on call, reports `loading` → `ready`/`error`, and
  returns a cleanup that releases the path and ignores a resolution landing after cleanup (the
  `cancelled`-flag pattern used across the existing hooks). `useInlineImage`'s `useEffect` derives
  the injected `download` function as `(p) => transferFor(daemon).download(p)` — or `null` when
  there is no live connection — and passes it straight to `loadInlineImage`.
- `packages/web-client/src/lib/connection/connection-store.ts` — `disconnect()` now calls
  `clearInlineImageCache()` alongside its existing `daemon?.close()`/state reset, so a reconnect
  never leaks object URLs pointing at a torn-down transfer instance.
- Explicitly untouched: `use-file-download.ts` (file-tab viewers keep their single-exclusive-
  consumer, revoke-on-unmount lifecycle), path classification (task-002), and any markdown/UI
  wiring (task-004).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/lib/inline-image-cache.ts` | created |
| `packages/web-client/src/lib/inline-image-cache.test.ts` | created |
| `packages/web-client/src/hooks/use-inline-image.ts` | created |
| `packages/web-client/src/hooks/use-inline-image.test.ts` | created |
| `packages/web-client/src/lib/connection/connection-store.ts` | modified — `disconnect()` calls `clearInlineImageCache()` |

## How it satisfies the scope
- `clean-room-scope/features/inline-image-rendering.md` § Inline image fetch + cache: module-
  scoped cache keyed by absolute path, `{ objectUrl, refCount }`-shaped entries, ~32-entry LRU
  bound, shared in-flight download for concurrent requests, revoke only on LRU eviction or
  connection teardown — every bullet has a corresponding test.
- § Lazy loading: no `IntersectionObserver` — `useInlineImage` only starts fetching once mounted
  (i.e. once a caller calls it with a non-null path), matching "mounting is the visibility signal".
- `clean-room-scope/features/file-explorer-transfer.md` § Binary transfer frames: reuses the
  existing `transferFor(daemon).download(path)` primitive verbatim — no new RPC, no new opcode.
- `packages/web-client/AGENTS.md` § hooks / testing convention: `loadInlineImage` is the
  "extract the logic into a plain function" seam, tested directly with no jsdom.

## Build & test results
```
$ npx vitest run packages/web-client/src/lib/inline-image-cache.test.ts packages/web-client/src/hooks/use-inline-image.test.ts
 Test Files  2 passed (2)
      Tests  13 passed (13)

$ npx vitest run packages/web-client
 Test Files  28 passed (28)
      Tests  245 passed (245)

$ npm run build:web-client
✓ built in 8.41s   (pre-existing "circular chunk"/chunk-size warnings, unrelated)

$ npx tsc -b packages/web-client
(clean exit, no errors)
```

## Acceptance criteria
- [x] Two components requesting the same path concurrently trigger exactly one download and both
      receive the same object URL — "dedupes concurrent acquires" test.
- [x] Mounting, unmounting, and remounting the same path performs exactly one download; the object
      URL is not revoked between them — "hits the cache after release without re-downloading" test.
- [x] Acquiring a 33rd distinct path with all previous entries released revokes the
      least-recently-used one; with all 32 still referenced, nothing is revoked — both "evicts…"
      tests in `inline-image-cache.test.ts`, plus the hook-level eviction test in
      `use-inline-image.test.ts` proving `loadInlineImage`'s cleanup is what makes a path evictable.
- [x] A failed download surfaces `status: "error"` with the transfer's message and leaves no cache
      entry, so a remount retries — "removes the cache entry on a rejected download" +
      "transitions loading -> error" tests.
- [x] `clearInlineImageCache()` revokes every URL and empties the map — direct test.
- [x] With no connection, `useInlineImage` returns `idle` and issues no request —
      `loadInlineImage(path, null, cb)` test (the `null`-download case is exactly what
      `useInlineImage`'s effect passes when `client`/`daemon` are absent).
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- `useInlineImage` itself (the thin `useEffect` wrapper around `loadInlineImage`) is not exercised
  by a render test, per this package's documented no-jsdom convention — `loadInlineImage` is the
  extracted, directly-tested core, and the wrapper is trivial glue (derive `download` from
  `client`/`daemon`, call `loadInlineImage`, return its cleanup). `TODO(verify)`: if a future jsdom
  test environment is added to this package, a `renderHook` smoke test of `useInlineImage` itself
  would still be additive coverage, not a correctness gap found here.
