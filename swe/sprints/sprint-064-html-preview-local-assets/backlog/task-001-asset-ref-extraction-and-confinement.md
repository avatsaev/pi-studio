# Task 001 — Pure asset-ref extraction, confinement and rewriting

- **Sprint:** sprint-064-html-preview-local-assets
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/files
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-063/task-003

## Goal
Add the pure, DOM-free core of local-asset inlining: find a document's local asset references,
resolve and confine them to the workspace root, enforce the caps, and substitute `data:` URIs — with
no fetching and no React in this task.

## Context / why
Sprint-063 renders the document but not its neighbours: `./style.css`, `./app.js` and `./logo.png`
resolve against the injected `.invalid` base and fail, so a multi-file report previews unstyled. The
fix cannot use object URLs — a sandboxed opaque-origin document cannot fetch a parent-created `blob:`
URL (measured, `swe/features/html-file-preview.md` § Browser platform constraints) — so assets must be
inlined as `data:` URIs, which is a pure string substitution over the document.

Two properties make this a *pure* module rather than logic inside the component:

1. **Confinement is a security gate, and must be unit-testable.** Remote loading is on by default, so
   a document that names `../../../.ssh/id_rsa` and is fetched on its behalf could read the inlined
   bytes back out of its own `data:` URI and post them anywhere. The gate — **percent-decode first**
   (once, non-throwing), resolve against the document's directory, `collapseDotSegments`, reject any
   surviving `.`/`..` segment, then a segment-aware root check (`path === root ||
   path.startsWith(root + "/")`, never a bare prefix) — is the thing that prevents it, and it gets
   exhaustive tests. The decode-first order is load-bearing: normalize-then-decode lets
   `foo%2F..%2F..%2F..%2Fetc%2Fpasswd` pass as one opaque segment and decode back into a traversal
   the daemon resolves.
2. **Rewriting is best-effort presentation, never a boundary.** The sandbox is the boundary. That is
   what makes string-level attribute rewriting acceptable in a package whose test runner has no DOM:
   a missed ref degrades to exactly the pre-sprint outcome.

## Scope references
- `swe/features/html-file-preview.md` § Local asset inlining, § Preview document assembly
- `packages/web-client/src/features/files/html-sandbox.ts` (sprint-063 — `assembleHtmlPreview`
  already accepts the `assets` substitution map this task produces keys for)
- `packages/web-client/src/lib/paths.ts` (`dirOf`, `collapseDotSegments`, `resolveWorkspacePath`)
- `packages/web-client/src/timeline/href-resolution.ts` (the existing scheme/tilde/percent-decode
  resolution step — reuse its semantics; do not fork a second copy of the rules)

## What to build
- New `packages/web-client/src/features/files/html-assets.ts`:
  ```ts
  export interface AssetRef { raw: string; context: "style" | "script" | "image" | "media" | "font"; }
  export type ConfinedRef =
    | { kind: "local"; raw: string; path: string; context: AssetRef["context"] }
    | { kind: "skip"; raw: string; reason: "external" | "outside-workspace" | "unsupported" };

  export const ASSET_LIMITS: { maxCount: number; maxBytesPerAsset: number; maxBytesTotal: number };
  export function extractLocalAssetRefs(source: string): AssetRef[];
  export function confinementRoot(docDir: string, workspaceRoot: string, homeDir: string | null): string;
  export function confineAssetRef(raw: string, docDir: string, root: string, context): ConfinedRef;
  export function dataUri(mimeType: string, bytes: Uint8Array): string;
  export function mimeForAssetPath(path: string): string;
  export function rewriteCssUrls(css: string, assets: Readonly<Record<string, string>>): string;
  ```
  Contexts scanned per the spec: `link[rel=stylesheet][href]`, `script[src]`, `img[src]`,
  `img[srcset]`, `source[src|srcset]`, `video[src|poster]`, `audio[src]`, plus `url(…)` inside an
  inlined stylesheet (one nested level, via `rewriteCssUrls`). Skipped without a fetch: explicit
  `scheme:`, protocol-relative `//`, fragment-only `#`, `data:`, `mailto:`, empty/whitespace.
  `mimeForAssetPath` is client-side by extension — the daemon answers `application/octet-stream` for
  `.css`/`.js`/`.html`, which browsers reject for stylesheets and classic scripts.
  `confinementRoot` implements the spec's home-narrowing rule: the effective root is the expanded
  workspace root, narrowed to `docDir` when the workspace root is the home directory itself —
  otherwise a workspace-less tab (`cwd = "~"`) would put `~/.ssh` *inside* the root and make the
  gate vacuous.
- Extend `assembleHtmlPreview`'s `assets` handling (sprint-063 left it a pass-through) so a supplied
  map substitutes raw ref strings inside the scanned attribute contexts only — never inside text
  content, never a blind global string replace.
- New `html-assets.test.ts` covering: single/double/unquoted attribute values, uppercase tags and
  attributes, attribute order variations, `srcset` with descriptors (`logo.png 2x, logo@3x.png 3x`)
  **including a substitution round-trip with `data:` URIs** (the mandatory comma in
  `data:image/png;base64,…` must survive srcset parsing), duplicate refs collapsing to one fetch
  key, every skip reason, `..` escapes rejected (`../../../.ssh/id_rsa`, `%2e%2e%2f` encoded form,
  **and `%2F`-encoded separators** — `foo%2F..%2F..%2F..%2Fetc%2Fpasswd`), a sibling directory
  sharing the root as a string prefix rejected (`/ws` vs `/ws-evil`), `confinementRoot` narrowing to
  `docDir` for a home-rooted workspace and passing the workspace root through otherwise,
  `~`-prefixed refs, absolute in-workspace paths accepted, absolute out-of-workspace paths rejected,
  an entity-bearing ref (`a&amp;b.png`) documented as matched-as-authored (not inlined, no decode),
  cap arithmetic, `rewriteCssUrls` with quoted and unquoted `url()`.

## Out of scope
- Fetching anything, any React, any query wiring (task-002).
- Recursing more than one level into stylesheets (`@import` chains), or rewriting refs inside inline
  `<style>` blocks in the document itself — recorded as a known limitation for the note in task-002.
- Rewriting `<iframe src>` (nested frames stay unresolved by design).

## Acceptance criteria
- [ ] `extractLocalAssetRefs` finds every scanned context in a realistic fixture document and no
      false positives from text content or from a `data:`/absolute ref.
- [ ] `confineAssetRef` rejects every out-of-root form — `..` traversal, its percent-encoded
      spelling, `%2F`-encoded separators, and a sibling directory sharing the root as a string
      prefix — and accepts the in-root relative/absolute/`~` forms. The gate decodes before it
      normalizes, and a candidate with any surviving `.`/`..` segment is rejected.
- [ ] `confinementRoot` narrows to the document's directory when the workspace root is the home
      directory, and passes the workspace root through otherwise.
- [ ] Caps are expressed once, in `ASSET_LIMITS`, and enforced by a pure predicate the tests drive.
- [ ] `assembleHtmlPreview` substitutes a supplied asset map inside attribute values only; a ref
      appearing as document text is untouched.
- [ ] Every test runs in the node environment with no DOM (`npx vitest run` green, no jsdom added).
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/files`.
- Build/typecheck as above.

## Notes
Reuse `href-resolution.ts`'s scheme detection and its non-throwing percent-decode (`%E0%` keeps its
raw form) — `lib/paths.ts`'s doc comment explicitly forbids a second copy of the join/tilde logic,
and the same reasoning applies here. But do **not** copy `resolveHrefCandidate`'s order of
operations: it normalizes before decoding, which is fine for display-path resolution and exploitable
in a security gate (`%2F`-encoded separators decode back into traversal after normalization has
already run). Here the decode comes first, per the spec's § Local asset inlining.
