/**
 * `html-asset-loader` — framework-free fetch orchestration for local-asset inlining
 * (`html-assets.ts`'s pure core, task-001): turns a document's already-confined local-asset refs
 * into `data:` URIs over the existing binary file-transfer path, with bounded parallelism, the
 * shared byte caps, and one nested pass into an inlined stylesheet's own `url(...)` references.
 *
 * Framework-free by design (no React, no TanStack Query) so it is unit-testable with an injected
 * fake fetch — no network, no DOM — mirroring `use-inline-image.ts`'s `loadInlineImage` split
 * between the effect body and the hook that drives it. `HtmlViewer` (task-002) wires this to
 * `transferFor(daemon).download(path)` behind a `useQuery`.
 *
 * A fetch failure — network error, file gone, or simply not connected — degrades only the refs
 * that shared that one fetch to `"fetch-failed"`; it never rejects the whole bundle. The document
 * still renders, unstyled/unscripted for those refs, with a "not inlined" note listing them.
 */

import { dirOf } from "@pi-studio-ui/lib/paths.js";
import {
  confineAssetRef,
  dataUri,
  extractCssUrlRefs,
  mimeForAssetPath,
  rewriteCssUrls,
  withinAssetCaps,
  type ConfinedRef,
} from "./html-assets.js";

export type ByteFetch = (path: string) => Promise<Uint8Array>;

export interface SkippedRef {
  raw: string;
  reason: "external" | "outside-workspace" | "unsupported" | "over-cap" | "fetch-failed";
}

export interface AssetBundle {
  /** Raw ref string → `data:` URI, ready for `assembleHtmlPreview`'s `assets` option. */
  assets: Record<string, string>;
  skipped: SkippedRef[];
}

export interface AssetLoaderContext {
  /** The confinement root a nested (stylesheet-internal) ref is checked against — the same root
   *  the top-level confined refs were already checked against. */
  root: string;
  homeDir: string | null;
  fetchBytes: ByteFetch;
}

const MAX_CONCURRENT_FETCHES = 6;

/** Runs `worker` over `items` with at most `concurrency` in flight at once. */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const item = items[index]!;
      index += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

type LocalRef = Extract<ConfinedRef, { kind: "local" }>;

/** Groups confined refs by their resolved absolute path — one fetch per de-duplicated path, with
 *  every ref sharing that path (e.g. an `<img src>` and a matching `srcset` candidate) resolved
 *  to the same `data:` URI once the fetch settles. */
function groupByPath(refs: readonly LocalRef[]): Map<string, LocalRef[]> {
  const groups = new Map<string, LocalRef[]>();
  for (const ref of refs) {
    const group = groups.get(ref.path);
    if (group) group.push(ref);
    else groups.set(ref.path, [ref]);
  }
  return groups;
}

/**
 * Fetches and inlines every confined local ref in `confined` (skip entries pass through
 * unchanged), enforcing `ASSET_LIMITS` as bytes arrive. A ref confined with `context: "style"`
 * gets one extra pass: its own `url(...)` references are extracted, confined against `ctx.root`
 * from *the stylesheet's own directory* (not the top-level document's), fetched under the same
 * caps and pool, and rewritten back into the stylesheet before it is inlined — recursion stops
 * there by construction, since a CSS-extracted ref is always `"image"`/`"font"`, never `"style"`.
 */
export async function loadHtmlAssetBundle(
  confined: readonly ConfinedRef[],
  ctx: AssetLoaderContext,
): Promise<AssetBundle> {
  const assets: Record<string, string> = {};
  const skipped: SkippedRef[] = [];
  let count = 0;
  let totalBytes = 0;
  let capExhausted = false;

  const local: LocalRef[] = [];
  for (const ref of confined) {
    if (ref.kind === "skip") skipped.push({ raw: ref.raw, reason: ref.reason });
    else local.push(ref);
  }

  function skipGroup(refs: readonly LocalRef[], reason: SkippedRef["reason"]): void {
    for (const ref of refs) skipped.push({ raw: ref.raw, reason });
  }

  async function fetchOne(path: string, refs: LocalRef[]): Promise<void> {
    if (capExhausted) {
      skipGroup(refs, "over-cap");
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await ctx.fetchBytes(path);
    } catch {
      skipGroup(refs, "fetch-failed");
      return;
    }

    if (!withinAssetCaps(count, totalBytes, bytes.byteLength)) {
      capExhausted = true;
      skipGroup(refs, "over-cap");
      return;
    }
    count += 1;
    totalBytes += bytes.byteLength;

    if (refs[0]!.context !== "style") {
      const uri = dataUri(mimeForAssetPath(path), bytes);
      for (const ref of refs) assets[ref.raw] = uri;
      return;
    }

    // One nested level: inline the stylesheet's own url(...) refs, resolved against its own
    // directory, then rewrite them into the text actually inlined.
    const cssText = new TextDecoder().decode(bytes);
    const cssDir = dirOf(path);
    const nestedConfined = extractCssUrlRefs(cssText).map((ref) =>
      confineAssetRef(ref.raw, cssDir, ctx.root, ref.context, ctx.homeDir),
    );
    const nestedLocal: LocalRef[] = [];
    for (const ref of nestedConfined) {
      if (ref.kind === "skip") skipped.push({ raw: ref.raw, reason: ref.reason });
      else nestedLocal.push(ref);
    }
    const nestedGroups = groupByPath(nestedLocal);
    await runPool([...nestedGroups.entries()], MAX_CONCURRENT_FETCHES, ([nestedPath, nestedRefs]) =>
      fetchOne(nestedPath, nestedRefs),
    );

    const nestedAssets: Record<string, string> = {};
    for (const ref of nestedLocal) {
      const uri = assets[ref.raw];
      if (uri !== undefined) nestedAssets[ref.raw] = uri;
    }
    const rewrittenCss = rewriteCssUrls(cssText, nestedAssets);
    const finalBytes = new TextEncoder().encode(rewrittenCss);

    // The rewritten stylesheet inflates with its own inlined data: URIs — re-check the delta
    // against the shared budget rather than trusting the pre-rewrite `bytes.byteLength` already
    // committed above (per-asset checks alone can't see this inflation coming).
    const delta = finalBytes.byteLength - bytes.byteLength;
    if (
      delta > 0 &&
      !withinAssetCaps(count - 1, totalBytes - bytes.byteLength, finalBytes.byteLength)
    ) {
      capExhausted = true;
      skipGroup(refs, "over-cap");
      return;
    }
    totalBytes += delta;

    const uri = dataUri("text/css", finalBytes);
    for (const ref of refs) assets[ref.raw] = uri;
  }

  const groups = groupByPath(local);
  await runPool([...groups.entries()], MAX_CONCURRENT_FETCHES, ([path, refs]) =>
    fetchOne(path, refs),
  );

  return { assets, skipped };
}
