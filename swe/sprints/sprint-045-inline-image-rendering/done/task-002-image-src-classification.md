# Task 002 — Shared workspace-path resolver + `classifyImageSrc` (pure, no UI)

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Land the whole decision layer for inline images as pure, exhaustively unit-tested functions: lift the
existing relative-path resolver into a shared module, and add `classifyImageSrc`, the single gate that
decides remote / local-fetch / text-fallback.

## Background / why
Two pieces already exist and must be reused rather than re-derived:

- `watchTargetPath(path, cwd)` — `packages/web-client/src/hooks/use-file-live-refresh.ts:31-36` — is
  already the repo's answer to "relative path + cwd → absolute path", with a documented warning that a
  second implementation would reintroduce the tilde/absolute duplication bug it exists to prevent. It
  lives inside a hook module that inline images have no reason to import, so it moves.
- `detectViewerKind(path)` — `packages/web-client/src/features/files/viewer-registry.ts:121` — is
  already the extension→kind authority the file panel dispatches on. Reusing it as the "is this an
  image" gate means registering a new image extension there automatically extends inline rendering,
  with no second list to keep in sync.

`classifyImageSrc` is the security- and UX-relevant part of this feature and is entirely pure, so it
gets built and tested before any component touches it.

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Public Contract → Markdown image source
  classification (the full rule table), § Asset base
- `clean-room-scope/features/timeline-rendering.md` § Markdown feature support

## What to build
- **`packages/web-client/src/lib/paths.ts`** (new) — move `watchTargetPath` here, renamed to reflect
  its now-shared role:
  ```ts
  /** Absolute target for a possibly-relative path. `/` and `~` prefixes pass through untouched. */
  export function resolveWorkspacePath(path: string, base: string): string | null;
  ```
  Behavior is unchanged from `watchTargetPath` (empty path → `null`; `/`- or `~`-prefixed → as-is;
  otherwise `base` with trailing slashes collapsed + `/` + `path`; empty `base` → `null`).
  Update `use-file-live-refresh.ts` to import it, and move/retarget the existing cases in
  `packages/web-client/src/hooks/use-file-live-refresh.test.ts` (they currently cover the
  join/trailing-slash contract at ~lines 13-19) to `packages/web-client/src/lib/paths.test.ts`. No
  behavior change, no re-export shim left behind.
- **`packages/web-client/src/timeline/image-src.ts`** (new):
  ```ts
  export type ImageSrcClassification =
    | { kind: "remote" }
    | { kind: "local"; path: string }
    | { kind: "unresolvable" };

  /** `base` is the asset base (absolute, tilde-normalized) or null; `homeDir` may be null. */
  export function classifyImageSrc(
    src: string,
    base: string | null,
    homeDir: string | null,
  ): ImageSrcClassification;
  ```
  Rules, applied in this order (the scope's table is normative):
  1. empty/whitespace → `unresolvable`
  2. `http:`/`https:`/`data:`/`blob:` → `remote`
  3. any other `scheme:` prefix, **including `file:`** → `unresolvable`
  4. `/…` → candidate local path as-is
  5. `~` / `~/…` → expand against `homeDir` (reuse `normalizeCwd` from
     `features/sessions/workspace-grouping.ts:19`); `homeDir === null` → `unresolvable`
  6. `./…`, `../…`, bare relative → `resolveWorkspacePath(src, base)`; `null` → `unresolvable`
  7. final gate: `detectViewerKind(candidate) !== "image"` → `unresolvable`; else
     `{ kind: "local", path: candidate }`

  Strip any `#fragment`/`?query` before classification (markdown may carry a title, and a bare `?`
  would otherwise defeat the extension gate).

## Out of scope
- Any React component, hook, or network call — this task is pure functions only.
- Fetching or caching image bytes (task-003).
- Deciding *which* surface supplies the asset base (task-004).

## Acceptance criteria
- [ ] `resolveWorkspacePath` lives in `lib/paths.ts`; `use-file-live-refresh.ts` imports it and no
      copy of the join logic remains (`grep -c watchTargetPath packages/web-client/src` returns 0).
- [ ] `classifyImageSrc` returns the scope table's result for every row, including `file:` →
      `unresolvable` and `~` with an unknown home dir → `unresolvable`.
- [ ] `![](notes.pdf)`-shaped input classifies `unresolvable`, so no download is ever attempted for a
      non-image extension.
- [ ] `./shot.png` with `base: null` → `unresolvable`; with a base → `local` with the joined absolute
      path.
- [ ] `shot.png?v=2` and `shot.png#frag` still classify as `local` images.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/web-client/src/lib/paths.test.ts` — the migrated `resolveWorkspacePath` cases.
- Unit: `packages/web-client/src/timeline/image-src.test.ts` — one case per row of the scope's
  classification table, plus the query/fragment cases and a `.webp`/`.svg` case to pin which
  extensions the viewer registry actually admits (record the answer in the summary; if `.svg` is not
  an image kind there, say so rather than special-casing it here).
- Run: `npx vitest run packages/web-client/src/lib/paths.test.ts packages/web-client/src/timeline/image-src.test.ts packages/web-client/src/hooks/use-file-live-refresh.test.ts`.

## Notes
- Keep `classifyImageSrc` free of store/hook imports (`normalizeCwd` and `detectViewerKind` are both
  pure) so the test file needs no React or client mocks.
- `use-file-live-refresh.ts`'s doc comment explains *why* `~` is left unexpanded for the daemon —
  carry that reasoning into `lib/paths.ts` rather than dropping it. Inline images expand `~` for their
  own cache key (task-003 keys by absolute path), which is a different concern from what the daemon
  receives.
