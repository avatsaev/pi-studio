/**
 * `html-sandbox` — pure policy module for the HTML preview iframe: the frozen sandbox token list,
 * the network-blocking CSP, the base-URL neutralization href, and `assembleHtmlPreview`, the
 * function that turns a raw HTML document into the `srcdoc` string the iframe actually loads.
 *
 * Two invariants this module exists to protect, both written down at the point most likely to be
 * "fixed" into a regression later:
 *
 * 1. **Never `allow-same-origin`.** Paired with `allow-scripts` (needed so the previewed document
 *    can run its own inline/CDN scripts) it re-grants the previewed document the app's own origin:
 *    its DOM, its `localStorage` (which holds the daemon password and connection state), and its
 *    live authenticated WebSocket. `HTML_SANDBOX_TOKENS` is a single frozen constant, guarded by
 *    `html-sandbox.test.ts` asserting `allow-same-origin`, every `allow-top-navigation*` form, and
 *    `allow-popups` never appear.
 * 2. **The CSP here is a network policy, never the isolation boundary.** The `sandbox` attribute
 *    alone is what keeps the previewed document out of the app — measured in headless Chromium,
 *    2026-08-19: with `sandbox="allow-scripts"` and no `allow-same-origin`, the child's
 *    `location.origin` is `"null"` and both `parent.document` and `localStorage` throw
 *    `SecurityError`, independent of any CSP. `HTML_PREVIEW_BLOCKING_CSP` only decides whether the
 *    document may reach the *network* — a per-tab convenience toggle, not a safety mechanism.
 */

/** The iframe's `sandbox` attribute token list. `allow-scripts` only — see invariant 1 above. */
export const HTML_SANDBOX_TOKENS: readonly string[] = Object.freeze(["allow-scripts"]);

/** Injected as `<base href>` when the source document declares none of its own — keeps an
 *  un-inlined relative ref off the app's own origin (see `assembleHtmlPreview`'s doc comment). */
export const PREVIEW_BASE_HREF = "https://pi-studio-preview.invalid/";

/**
 * Injected as a `<meta http-equiv="Content-Security-Policy">` when the "Block remote resources"
 * toggle is on. Every directive an inlined asset can hit carries `data:` alongside the directive's
 * own scheme, because sprint-064 inlines every asset kind as a `data:` URI and the blocking policy
 * must not break its own inlined content — measured while implementing (spec `TODO(verify)`):
 * `data:` subresources load with no CSP at all, and under this policy `style-src` needs `data:`
 * explicitly (a `<link href="data:text/css,…">` stylesheet is not covered by `'unsafe-inline'`,
 * which only governs literal inline `<style>`/`style=""`), and likewise for `script-src` (a
 * `data:`-sourced `<script src>`), `img-src`, `font-src` and `media-src`.
 */
export const HTML_PREVIEW_BLOCKING_CSP =
  "default-src 'none'; " +
  "img-src data:; " +
  "style-src 'unsafe-inline' data:; " +
  "script-src 'unsafe-inline' data:; " +
  "font-src data:; " +
  "media-src data:";

/**
 * Intercepts same-document fragment links (`<a href="#…">`) and scrolls manually instead of
 * letting the browser navigate. Only injected alongside an injected `<base>` (never when the
 * source declares its own). Measured in headless Chromium, 2026-08-19: a sandboxed `srcdoc`
 * iframe's `location.href` is `about:srcdoc`, but `document.baseURI` follows the injected
 * `<base>`. Clicking `<a href="#target">` resolves the target against `baseURI`
 * (`https://pi-studio-preview.invalid/#target`), which does not match `location.href` — the
 * browser therefore treats it as a *cross-document* navigation rather than a same-page scroll and
 * attempts to load the `.invalid` host, replacing the entire preview with a network-error page.
 * This listener prevents that default action and performs the scroll itself, matching native
 * same-document fragment-navigation semantics (empty fragment scrolls to top; a named fragment
 * resolves by `id` first, then by anchor `name`, exactly as the browser's own algorithm does).
 */
const FRAGMENT_ANCHOR_SCRIPT =
  '<script>(function(){document.addEventListener("click",function(e){' +
  "var a=e.target&&e.target.closest&&e.target.closest('a[href^=\"#\"]');" +
  "if(!a)return;" +
  'var frag=a.getAttribute("href").slice(1);' +
  "e.preventDefault();" +
  "if(!frag){window.scrollTo(0,0);return;}" +
  "var el=document.getElementById(frag)||document.getElementsByName(frag)[0];" +
  "if(el)el.scrollIntoView();" +
  "},true);})();</script>";

const HEAD_OPEN_RE = /<head(\s[^>]*)?>/i;
const HTML_OPEN_RE = /<html(\s[^>]*)?>/i;
const HAS_BASE_RE = /<base[\s/>]/i;

/**
 * Replaces attribute values that exactly match a key in `assets` with its substitution — never
 * document text, and never a value that merely *contains* a key (a bare `String.replace` over the
 * whole document would also rewrite refs sitting in visible text, comments, or scripts). Inert
 * (returns `source` unchanged) when `assets` is empty, which is this sprint's case: sprint-064
 * populates the map from `extractLocalAssetRefs`/`confineAssetRef`; this sprint only wires the
 * seam through so that work needs no changes here.
 */
function substituteAssets(source: string, assets: Readonly<Record<string, string>>): string {
  const keys = Object.keys(assets);
  if (keys.length === 0) return source;
  return source.replace(
    /=("([^"]*)"|'([^']*)')/g,
    (whole, _quoted: string, dq?: string, sq?: string) => {
      const value = dq !== undefined ? dq : sq;
      if (value === undefined) return whole;
      const replacement = assets[value];
      if (replacement === undefined) return whole;
      const quote = dq !== undefined ? '"' : "'";
      return `=${quote}${replacement}${quote}`;
    },
  );
}

export interface AssembleHtmlPreviewOptions {
  /** Resolved local-asset substitutions (sprint-064): raw ref string → `data:` URI. Applied as an
   *  attribute-value substitution regardless of sprint; empty/absent here is a no-op. */
  assets?: Readonly<Record<string, string>>;
  /** Injects `HTML_PREVIEW_BLOCKING_CSP` as the first `<head>` child when true. */
  blockRemote: boolean;
}

/**
 * Assembles the `srcdoc` string the preview iframe loads: substitutes any supplied local-asset
 * refs, optionally injects the blocking CSP as the very first `<head>` child, and — only when the
 * source declares no `<base>` of its own — injects the `.invalid` neutralization base plus the
 * fragment-anchor click interceptor that keeps in-page `#` links working under it.
 *
 * `srcdoc`'s base URL is the *parent app's own URL* (measured), so any ref this function does not
 * substitute would otherwise resolve against the app origin, where the SPA's history-fallback
 * routing answers with `index.html` (200 `text/html`) — a silently wrong response, not a clean
 * failure. The injected `.invalid` base turns that into a clean failure instead, and is skipped
 * entirely when the document already declares its own `<base>` (the author's intent wins).
 *
 * Head-less documents get a synthesized `<head>` inserted right after `<html>` (or prepended, if
 * the document has no `<html>` tag either); `<head>` detection is case-insensitive, so an
 * uppercase `<HEAD>` is still found and used rather than triggering a second, conflicting one.
 */
export function assembleHtmlPreview(source: string, opts: AssembleHtmlPreviewOptions): string {
  const substituted = substituteAssets(source, opts.assets ?? {});

  const parts: string[] = [];
  if (opts.blockRemote) {
    parts.push(
      `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_BLOCKING_CSP}">`,
    );
  }
  if (!HAS_BASE_RE.test(substituted)) {
    parts.push(`<base href="${PREVIEW_BASE_HREF}">`);
    parts.push(FRAGMENT_ANCHOR_SCRIPT);
  }
  const injection = parts.join("");
  if (injection === "") return substituted;

  const headMatch = HEAD_OPEN_RE.exec(substituted);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return substituted.slice(0, at) + injection + substituted.slice(at);
  }

  const htmlMatch = HTML_OPEN_RE.exec(substituted);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return substituted.slice(0, at) + `<head>${injection}</head>` + substituted.slice(at);
  }

  return `<head>${injection}</head>` + substituted;
}
