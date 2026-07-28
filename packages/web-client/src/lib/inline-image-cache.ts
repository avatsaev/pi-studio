/**
 * Ref-counted, LRU-bounded object-URL cache for inline chat images (features/inline-image-
 * rendering.md § Inline image fetch + cache). Framework-free and module-scoped so it survives
 * virtualized row unmount/remount: `useInlineImage` (`hooks/use-inline-image.ts`) is the only
 * consumer, but this file has no React import so it is testable without one.
 *
 * Deliberately NOT `useFileDownload`'s retention policy (`staleTime: Infinity, gcTime: 0`,
 * revoke-on-unmount) — that model is correct for a file tab (one exclusive viewer at a time) and
 * wrong here: the timeline virtualizes rows, so an image scrolled out of view and back would
 * revoke its URL and re-download on every scroll past. This cache instead revokes an object URL
 * only on LRU eviction (bounded at `MAX_INLINE_IMAGE_ENTRIES`) or on `clearInlineImageCache()`
 * (connection teardown) — never on a mount's own unmount. Do not "fix" this into a `useQuery`;
 * TanStack Query's cache has no way to express "revoke only on LRU eviction, not on unmount".
 */

export interface InlineImageEntry {
  objectUrl: string;
  mimeType?: string;
}

/** Bounded LRU size, exported so tests can assert against it directly. */
export const MAX_INLINE_IMAGE_ENTRIES = 32;

interface CacheRecord {
  refs: number;
  /** Set once the download settles successfully; `null` while in flight or after a failure. */
  entry: InlineImageEntry | null;
  /** The in-flight fetch, shared by every concurrent acquirer of the same path. */
  pending: Promise<InlineImageEntry> | null;
}

/** Keyed by absolute resolved path. Map insertion order doubles as LRU order — every acquire
 *  re-inserts its key to mark it most-recently-used. */
const cache = new Map<string, CacheRecord>();

/** Evicts the least-recently-used entry with `refs === 0`, if any, until the cache is back at or
 *  under the bound. An entry still referenced by a mounted consumer is never evicted — the cache
 *  is allowed to exceed the bound rather than revoke a URL something is still displaying. */
function evictOverBound(): void {
  while (cache.size > MAX_INLINE_IMAGE_ENTRIES) {
    let evictedPath: string | null = null;
    for (const [path, record] of cache) {
      if (record.refs === 0 && record.entry) {
        URL.revokeObjectURL(record.entry.objectUrl);
        evictedPath = path;
        break;
      }
    }
    if (evictedPath === null) return; // every entry is live (or still downloading) — allow overflow
    cache.delete(evictedPath);
  }
}

/**
 * Acquire (fetching if needed) and increment the ref count. Concurrent callers of the same path
 * share one in-flight fetch and both resolve to the same object URL. `download` is injected
 * (never imported) so this module is testable with no daemon/client.
 */
export function acquireInlineImage(
  path: string,
  download: (path: string) => Promise<{ bytes: Uint8Array; mimeType?: string }>,
): Promise<InlineImageEntry> {
  const existing = cache.get(path);
  if (existing) {
    existing.refs += 1;
    cache.delete(path);
    cache.set(path, existing); // touch: mark most-recently-used
    return existing.entry ? Promise.resolve(existing.entry) : existing.pending!;
  }

  const record: CacheRecord = { refs: 1, entry: null, pending: null };
  cache.set(path, record);
  evictOverBound();

  record.pending = download(path)
    .then((file) => {
      // `Blob`'s DOM typings require an `ArrayBuffer`-backed view; the assembled `Uint8Array`'s
      // `ArrayBufferLike` backing doesn't satisfy that on its own (mirrors `use-file-download.ts`).
      const blob = new Blob([Uint8Array.from(file.bytes)], {
        type: file.mimeType || "application/octet-stream",
      });
      const result: InlineImageEntry = {
        objectUrl: URL.createObjectURL(blob),
        mimeType: file.mimeType,
      };
      if (cache.get(path) === record) {
        record.entry = result;
        record.pending = null;
      } else {
        // Evicted, cleared, or replaced while this fetch was in flight — nothing owns this URL
        // anymore, so revoke it immediately instead of leaking it.
        URL.revokeObjectURL(result.objectUrl);
      }
      return result;
    })
    .catch((error: unknown) => {
      if (cache.get(path) === record) cache.delete(path); // let the next mount retry
      throw error;
    });

  return record.pending;
}

/** Decrement the ref count. Never revokes — retention past zero refs is the LRU's job. */
export function releaseInlineImage(path: string): void {
  const existing = cache.get(path);
  if (!existing) return;
  existing.refs = Math.max(0, existing.refs - 1);
}

/** Revoke every object URL and clear the map (connection teardown / tests). */
export function clearInlineImageCache(): void {
  for (const record of cache.values()) {
    if (record.entry) URL.revokeObjectURL(record.entry.objectUrl);
  }
  cache.clear();
}
