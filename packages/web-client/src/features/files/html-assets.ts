/**
 * `html-assets` — pure, DOM-free core of local-asset inlining for the HTML preview (sprint-064):
 * finds a previewed document's local asset references, confines them to the workspace root, and
 * rewrites resolved substitutions back into the document (and into an already-fetched stylesheet's
 * own `url(...)` references, one nested level). No fetching, no React — `HtmlViewer`'s asset loader
 * (task-002) supplies the `assets` map this module's rewrite functions consume, over the existing
 * binary file-transfer path.
 *
 * Two invariants this module exists to protect:
 *
 * 1. **Confinement is a security gate, not a convenience filter.** Remote loading is on by default
 *    (`html-sandbox.ts`), so a document naming `../../../.ssh/id_rsa` and fetched on its behalf
 *    could read the inlined bytes back out of its own `data:` URI and post them anywhere. The gate
 *    percent-decodes a candidate **exactly once, non-throwing** — *before* any resolution or
 *    normalization — then resolves it against the document's directory, lexically collapses `.`/
 *    `..` segments (`lib/paths.ts`'s `collapseDotSegments`), and finally requires the result to sit
 *    under the confinement root via a segment-aware check (`path === root ||
 *    path.startsWith(root + "/")`, never a bare string prefix, which would wrongly accept a
 *    `/ws-evil` sibling of `/ws`). The decode-before-normalize order is load-bearing: the reverse
 *    order lets `foo%2F..%2F..%2F..%2Fetc%2Fpasswd` pass the root check as one opaque path segment
 *    (no literal `/`) and only decode back into a real traversal afterward.
 * 2. **Rewriting is best-effort presentation, never a boundary.** This package's test runner has no
 *    DOM (`AGENTS.md`'s testing convention), so every scan here is a regex-based tag/attribute
 *    matcher, not an HTML/CSS parser — a missed ref just degrades to the pre-sprint outcome
 *    (unstyled/unscripted/broken image), never a security hole, because the `sandbox` attribute
 *    (not this module) is what actually isolates the previewed document.
 */

import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { collapseDotSegments, resolveWorkspacePath } from "@pi-studio-ui/lib/paths.js";
import { SCHEME_RE, percentDecode } from "@pi-studio-ui/timeline/href-resolution.js";

/** One candidate local-asset reference found in the document (or, for `context: "font"`/`"image"`
 *  origin, in an already-inlined stylesheet's `url(...)`). `raw` is matched *as authored* — HTML
 *  entities (`a&amp;b.png`) are never decoded, so such a ref simply fails to resolve to a real file
 *  later (best-effort, per invariant 2 above), and no entity-decoding step may be added here. */
export interface AssetRef {
  raw: string;
  context: "style" | "script" | "image" | "media" | "font";
}

export type ConfinedRef =
  | { kind: "local"; raw: string; path: string; context: AssetRef["context"] }
  | { kind: "skip"; raw: string; reason: "external" | "outside-workspace" | "unsupported" };

/** Caps enforced before any fetch, expressed once here so a change never needs a second edit at
 *  the call site (`HtmlViewer`'s asset loader, task-002, drives `withinAssetCaps` as bytes arrive). */
export const ASSET_LIMITS = {
  maxCount: 64,
  maxBytesPerAsset: 2 * 1024 * 1024, // 2 MiB
  maxBytesTotal: 16 * 1024 * 1024, // 16 MiB — base64 inflates raw bytes ~33%; this cap keeps the
  // assembled `srcdoc` string off the main thread as a multi-hundred-MB allocation.
} as const;

/** Pure cap predicate: `candidateBytes` may be inlined given `countSoFar` assets and
 *  `totalBytesSoFar` bytes already committed. The loader stops inlining (reports the remainder
 *  skipped) the first time this returns `false`, rather than assembling an over-cap document. */
export function withinAssetCaps(
  countSoFar: number,
  totalBytesSoFar: number,
  candidateBytes: number,
): boolean {
  if (countSoFar >= ASSET_LIMITS.maxCount) return false;
  if (candidateBytes > ASSET_LIMITS.maxBytesPerAsset) return false;
  if (totalBytesSoFar + candidateBytes > ASSET_LIMITS.maxBytesTotal) return false;
  return true;
}

// ---- classification shared by extraction's pre-filter and confinement's early-out ----

/** A ref extraction and confinement both treat as never-local without touching the workspace: an
 *  explicit scheme (`data:`, `mailto:`, `http:`, ...; also covers protocol-relative `//host`,
 *  folded in below), a fragment-only `#id`, or empty/whitespace. Returns the skip reason, or `null`
 *  when the ref might be local and needs the full confinement gate. */
function classifyNonLocal(trimmed: string): "external" | "unsupported" | null {
  if (trimmed === "" || trimmed.startsWith("#")) return "unsupported";
  if (trimmed.startsWith("//") || SCHEME_RE.test(trimmed)) return "external";
  return null;
}

// ---- confinement ----

/** The confinement root for a document at `docDir`: the expanded workspace root, *narrowed to
 *  `docDir`* when that root is the home directory itself. A tab with no real workspace falls back
 *  to `cwd = "~"` (`FilePanel.tsx`); with all of `$HOME` as the root, `~/.ssh/id_rsa` would sit
 *  *inside* it and the gate would be vacuous exactly where it matters most. */
export function confinementRoot(
  docDir: string,
  workspaceRoot: string,
  homeDir: string | null,
): string {
  if (homeDir !== null && workspaceRoot === homeDir) return docDir;
  return workspaceRoot;
}

/**
 * Classifies one raw ref against the confinement root. `homeDir`, when supplied, expands a
 * tilde-prefixed ref *authored inside the document itself* (`src="~/logo.png"`) via the same
 * `normalizeCwd` every other tilde-workspace consumer uses — distinct from `workspaceCwd`'s own
 * tilde, which is already expanded by the caller before `root` is computed (`ViewerProps`'s
 * contract). Omitted (`null`), a tilde-prefixed ref cannot be resolved and is skipped as
 * `"unsupported"` rather than silently matched against an unexpanded string.
 */
export function confineAssetRef(
  raw: string,
  docDir: string,
  root: string,
  context: AssetRef["context"],
  homeDir: string | null = null,
): ConfinedRef {
  const trimmed = raw.trim();
  const nonLocal = classifyNonLocal(trimmed);
  if (nonLocal) return { kind: "skip", raw, reason: nonLocal };

  // Percent-decode BEFORE resolving/normalizing — load-bearing order, see module doc invariant 1.
  const decoded = percentDecode(trimmed);

  let candidate: string | null;
  if (decoded.startsWith("/")) {
    candidate = decoded;
  } else if (decoded === "~" || decoded.startsWith("~/")) {
    candidate = homeDir !== null ? normalizeCwd(decoded, homeDir) : null;
  } else {
    candidate = resolveWorkspacePath(decoded, docDir);
  }
  if (!candidate) return { kind: "skip", raw, reason: "unsupported" };

  const normalized = collapseDotSegments(candidate);
  if (normalized !== root && !normalized.startsWith(`${root}/`)) {
    return { kind: "skip", raw, reason: "outside-workspace" };
  }
  return { kind: "local", raw, path: normalized, context };
}

// ---- MIME + data: URI ----

/** Client-side extension → MIME map. The daemon's own `mimeHintForFile` has no `.css`/`.js`/`.html`
 *  entries and answers `application/octet-stream` for them (browsers reject that for stylesheets
 *  and classic scripts), and a newer client cannot rely on an older daemon growing them either — so
 *  every `data:` URI this module builds is MIME-typed from here, never from a daemon hint. */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
};

export function mimeForAssetPath(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  if (dot <= slash) return "application/octet-stream";
  return MIME_BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

/** Base64-encodes in fixed-size chunks rather than one `String.fromCharCode(...bytes)` spread, so a
 *  multi-MB asset (up to `ASSET_LIMITS.maxBytesPerAsset`) never blows the JS call-argument limit. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function dataUri(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

// ---- HTML tag/attribute scanning (shared by extraction and rewriting) ----

/** One opening tag, its raw attribute-list text, and its exact closer (` />`, `/>`, or `>`) —
 *  captured together so rewriting can reassemble a tag byte-for-byte apart from the attributes it
 *  actually changes. Deliberately not a full HTML parser (invariant 2): the attribute-value
 *  alternatives (`"..."` / `'...'` / unquoted) are spelled out explicitly so a `>` embedded in a
 *  quoted value is never mistaken for the tag's own closing `>`. */
const TAG_RE =
  /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)(\s*\/?>)/g;

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/** Parses one tag's raw attribute-list text into name (lowercased) → value. First occurrence of a
 *  duplicate attribute name wins, matching browser parsing. */
function parseAttrs(attrsRaw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrsRaw))) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

interface RelevantAttr {
  name: string;
  context: AssetRef["context"];
  /** `srcset`-shaped: a comma-separated list of `url descriptor?` candidates, not one URL. */
  multi: boolean;
}

/** Which attributes on this (lowercased) tag name are asset-bearing, per the spec's scanned-context
 *  list — `<link rel="stylesheet" href>`, `<script src>`, `<img src|srcset>`,
 *  `<source src|srcset>`, `<video src|poster>`, `<audio src>`. A `<link>` without a `stylesheet`
 *  token in `rel` (e.g. a `preload`/`icon` link) is not scanned. `<source>` is labeled `"media"`
 *  regardless of whether its parent is `<picture>` or `<video>`/`<audio>` — this module never
 *  builds a parent chain, and the context is descriptive only (it never gates confinement). */
function relevantAttrsForTag(tagLower: string, attrs: Map<string, string>): RelevantAttr[] {
  switch (tagLower) {
    case "link": {
      const rel = attrs.get("rel") ?? "";
      if (!/(^|\s)stylesheet(\s|$)/i.test(rel)) return [];
      return attrs.has("href") ? [{ name: "href", context: "style", multi: false }] : [];
    }
    case "script":
      return attrs.has("src") ? [{ name: "src", context: "script", multi: false }] : [];
    case "img": {
      const out: RelevantAttr[] = [];
      if (attrs.has("src")) out.push({ name: "src", context: "image", multi: false });
      if (attrs.has("srcset")) out.push({ name: "srcset", context: "image", multi: true });
      return out;
    }
    case "source": {
      const out: RelevantAttr[] = [];
      if (attrs.has("src")) out.push({ name: "src", context: "media", multi: false });
      if (attrs.has("srcset")) out.push({ name: "srcset", context: "media", multi: true });
      return out;
    }
    case "video": {
      const out: RelevantAttr[] = [];
      if (attrs.has("src")) out.push({ name: "src", context: "media", multi: false });
      if (attrs.has("poster")) out.push({ name: "poster", context: "media", multi: false });
      return out;
    }
    case "audio":
      return attrs.has("src") ? [{ name: "src", context: "media", multi: false }] : [];
    default:
      return [];
  }
}

interface SrcsetEntry {
  url: string;
  descriptor: string;
}

/** Splits a `srcset` value into its comma-separated `url descriptor?` candidates. Per the HTML
 *  spec a candidate URL must not itself contain an unescaped comma, so a plain split is safe (and
 *  is exactly what confines this to a per-candidate replace rather than a whole-value one — a
 *  `data:image/png;base64,...` substitution's own comma is never re-split, because it is built by
 *  `serializeSrcset` joining already-parsed entries, never by re-parsing the rewritten string). */
function parseSrcset(value: string): SrcsetEntry[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const spaceIdx = entry.search(/\s/);
      return spaceIdx === -1
        ? { url: entry, descriptor: "" }
        : { url: entry.slice(0, spaceIdx), descriptor: entry.slice(spaceIdx).trim() };
    });
}

function serializeSrcset(entries: SrcsetEntry[]): string {
  return entries.map((e) => (e.descriptor ? `${e.url} ${e.descriptor}` : e.url)).join(", ");
}

/** Records `raw` into `found` (first occurrence wins, order preserved) unless it is obviously
 *  non-local — the "Local" in this function's name. */
function recordLocalCandidate(
  found: Map<string, AssetRef>,
  raw: string,
  context: AssetRef["context"],
): void {
  if (classifyNonLocal(raw.trim())) return;
  if (!found.has(raw)) found.set(raw, { raw, context });
}

/**
 * Finds every local-asset-candidate reference in the document's scanned attribute contexts,
 * de-duplicated and in first-occurrence order. Values with an explicit scheme, a protocol-relative
 * `//`, a fragment-only `#`, or empty/whitespace are excluded here (the "Local" in this function's
 * name) — `confineAssetRef` independently re-checks the same conditions, since it is a standalone
 * exported function nothing should trust extraction alone to have filtered.
 */
export function extractLocalAssetRefs(source: string): AssetRef[] {
  const found = new Map<string, AssetRef>();
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(source))) {
    const tagLower = m[1]!.toLowerCase();
    const attrs = parseAttrs(m[2] ?? "");
    for (const rel of relevantAttrsForTag(tagLower, attrs)) {
      const value = attrs.get(rel.name) ?? "";
      if (rel.multi) {
        for (const entry of parseSrcset(value)) recordLocalCandidate(found, entry.url, rel.context);
      } else {
        recordLocalCandidate(found, value, rel.context);
      }
    }
  }
  return [...found.values()];
}

function rewriteSrcsetValue(
  value: string,
  assets: Readonly<Record<string, string>>,
): string | null {
  let changed = false;
  const rewritten = parseSrcset(value).map((entry) => {
    const replacement = assets[entry.url];
    if (replacement === undefined) return entry;
    changed = true;
    return { url: replacement, descriptor: entry.descriptor };
  });
  return changed ? serializeSrcset(rewritten) : null;
}

/**
 * Substitutes resolved local-asset refs back into the document — the same tag/attribute contexts
 * `extractLocalAssetRefs` scans, so a ref that was never a candidate for inlining (an unscanned
 * attribute, or plain document text that merely happens to match a ref's text) is never touched.
 * `srcset` entries are rewritten per-candidate and rejoined, never matched as a whole attribute
 * value. A no-op (returns `source` unchanged) when `assets` is empty.
 */
export function rewriteHtmlAssetRefs(
  source: string,
  assets: Readonly<Record<string, string>>,
): string {
  if (Object.keys(assets).length === 0) return source;
  TAG_RE.lastIndex = 0;
  return source.replace(TAG_RE, (whole: string, tag: string, attrsRaw: string, closer: string) => {
    const attrs = parseAttrs(attrsRaw);
    const relevant = relevantAttrsForTag(tag.toLowerCase(), attrs);
    if (relevant.length === 0) return whole;
    const relevantByName = new Map(relevant.map((r) => [r.name, r]));

    let changed = false;
    const newAttrsRaw = attrsRaw.replace(
      ATTR_RE,
      (attrWhole: string, name: string, dq?: string, sq?: string, uq?: string) => {
        const rel = relevantByName.get(name.toLowerCase());
        if (!rel) return attrWhole;
        const value = dq ?? sq ?? uq ?? "";
        const rewritten = rel.multi ? rewriteSrcsetValue(value, assets) : (assets[value] ?? null);
        if (rewritten === null) return attrWhole;
        changed = true;
        return `${name}="${rewritten}"`;
      },
    );
    return changed ? `<${tag}${newAttrsRaw}${closer}` : whole;
  });
}

// ---- CSS `url(...)` (one nested level inside an inlined stylesheet) ----

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/gi;
const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/gi;

function cssUrlValue(dq?: string, sq?: string, uq?: string): string {
  return dq ?? sq ?? uq ?? "";
}

/** Byte ranges of every `@font-face { ... }` block in `css` (assumed non-nested, matching real
 *  stylesheet usage) — used to label a `url(...)` found inside one as `"font"` rather than
 *  `"image"`; every other `url(...)` (backgrounds, list markers, cursors, ...) is `"image"`. */
function fontFaceRanges(css: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  FONT_FACE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FONT_FACE_BLOCK_RE.exec(css))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/** Finds every local-asset-candidate `url(...)` in one stylesheet's text, de-duplicated and in
 *  first-occurrence order — the CSS-side counterpart of `extractLocalAssetRefs`, used by the asset
 *  loader (task-002) to fetch an inlined stylesheet's own references one level deep. */
export function extractCssUrlRefs(css: string): AssetRef[] {
  const fontRanges = fontFaceRanges(css);
  const found = new Map<string, AssetRef>();
  CSS_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_URL_RE.exec(css))) {
    const raw = cssUrlValue(m[1], m[2], m[3]);
    const context: AssetRef["context"] = fontRanges.some(
      ([start, end]) => m!.index >= start && m!.index < end,
    )
      ? "font"
      : "image";
    recordLocalCandidate(found, raw, context);
  }
  return [...found.values()];
}

/** Substitutes resolved local-asset refs into a stylesheet's `url(...)` occurrences. A no-op
 *  (returns `css` unchanged) when `assets` is empty; an occurrence with no matching key is left
 *  exactly as authored (original quoting preserved for the untouched case). */
export function rewriteCssUrls(css: string, assets: Readonly<Record<string, string>>): string {
  if (Object.keys(assets).length === 0) return css;
  CSS_URL_RE.lastIndex = 0;
  return css.replace(CSS_URL_RE, (whole: string, dq?: string, sq?: string, uq?: string) => {
    const replacement = assets[cssUrlValue(dq, sq, uq)];
    return replacement === undefined ? whole : `url("${replacement}")`;
  });
}
