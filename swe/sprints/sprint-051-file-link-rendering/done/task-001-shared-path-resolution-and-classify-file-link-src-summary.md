# Task 001 — Shared path-resolution fix + `classifyFileLinkSrc` — Summary

- **Sprint:** sprint-051-file-link-rendering
- **Completed:** 2026-08-05 13:50 UTC
- **Status:** done

## What was implemented

1. **`collapseDotSegments` helper** (`packages/web-client/src/lib/paths.ts`):
   - Pure function that lexically normalizes `.` and `..` segments in absolute paths
   - No filesystem access; handles path segments in order with a stack
   - Returns unchanged non-absolute paths per contract
   - Tested with 13 comprehensive cases including edge cases (leading `..`, mixed segments, double slashes)

2. **Shared href-resolution module** (`packages/web-client/src/timeline/href-resolution.ts`):
   - Extracted candidate-resolution step from `classifyImageSrc`
   - Handles fragment/query stripping, scheme detection, absolute/tilde/relative path resolution
   - Delegates path joining to `resolveWorkspacePath` and tilde expansion to `normalizeCwd` (no reimplementation)
   - Applies `collapseDotSegments` normalization and percent-decoding to the resolved candidate
   - Percent-decoding via `decodeURIComponent` with safe fallback for malformed sequences (returns original unchanged)

3. **Refactored `classifyImageSrc`** (`packages/web-client/src/timeline/image-src.ts`):
   - Now uses the shared `resolveHrefCandidate` step for path resolution, normalization, and percent-decoding
   - Retains its three-way classification (remote/local/unresolvable) and extension gate
   - Behavior change: `local` results are now normalized and percent-decoded
   - Test expectations updated to reflect normalized paths:
     - `./shot.png` against `/repo` now returns `/repo/shot.png` (not `/repo/./shot.png`)
     - `../shot.png` against `/repo/sub` now returns `/repo/shot.png` (not `/repo/sub/../shot.png`)
   - Added test for percent-decoding: `my%20shot.png` decodes to `my shot.png`

4. **New `classifyFileLinkSrc` function** (`packages/web-client/src/timeline/file-link-src.ts`):
   - Two-way classification: `local` (open as file) or `external` (regular link)
   - Uses shared resolution step for consistent behavior with `classifyImageSrc`
   - No extension gate — directories and any file type qualify as `local`
   - Fragment-only hrefs (`#section`) return `external` (in-page anchors never intercepted)
   - Path+fragment hrefs (`README.md#usage`) strip fragment and classify remainder
   - Explicit schemes and relative-without-base return `external`

5. **Comprehensive test suites**:
   - `file-link-src.test.ts`: 47 tests covering every classification table row
   - `image-src.test.ts`: Updated 24 tests with new normalized expectations
   - `markdown.test.ts`: Updated integration tests to verify normalized path flow
   - `paths.test.ts`: Added 13 tests for `collapseDotSegments` (e.g., mixed `.` and `..`, leading `..` at root, edge cases)

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/lib/paths.ts` | Added `collapseDotSegments` function (48 lines) |
| `packages/web-client/src/timeline/href-resolution.ts` | **New file** — shared resolution module (70 lines) |
| `packages/web-client/src/timeline/image-src.ts` | Refactored to use `resolveHrefCandidate`; schema and behavior unchanged except local paths now normalized/decoded (70 lines) |
| `packages/web-client/src/timeline/file-link-src.ts` | **New file** — two-way classifier (47 lines) |
| `packages/web-client/src/timeline/file-link-src.test.ts` | **New file** — 47 comprehensive tests |
| `packages/web-client/src/timeline/image-src.test.ts` | Updated test expectations for normalized paths (3 tests updated, 1 new percent-decoding test) |
| `packages/web-client/src/timeline/markdown.test.ts` | Updated integration test to verify normalized paths |
| `packages/web-client/src/lib/paths.test.ts` | Added 13 tests for `collapseDotSegments` |

## How it satisfies the scope

- ✅ **Path normalization:** All local paths are normalized via `collapseDotSegments` before return, ensuring exact string matching for tab identity
- ✅ **Percent-decoding:** Markdown hrefs are percent-decoded in the shared step (e.g., `my%20notes.md` → `my notes.md`), with safe fallback for malformed sequences
- ✅ **No duplication:** The shared step delegates to `resolveWorkspacePath` and `normalizeCwd` with no reimplementation
- ✅ **Two-way classification:** `classifyFileLinkSrc` implements local/external split per spec, no third "unresolvable" state
- ✅ **No extension gate on file links:** Directories and any file type classify as `local` when resolved
- ✅ **Fragment-only returns external:** `#section` never intercepted; `README.md#usage` strips fragment and classifies remainder
- ✅ **Acceptance criteria verified:** All six acceptance-criteria tests pass:
  - `classifyFileLinkSrc("./notes.md", "/repo", null)` → `{ kind: "local", path: "/repo/notes.md" }`
  - `classifyFileLinkSrc("../x/../notes.md", "/repo/a", null)` → `{ kind: "local", path: "/repo/notes.md" }`
  - `classifyFileLinkSrc("my%20notes.md", "/repo", null)` → `{ kind: "local", path: "/repo/my notes.md" }`
  - `classifyImageSrc("./shot.png", "/repo", "/home/bob")` → `{ kind: "local", path: "/repo/shot.png" }` (normalized)
  - `classifyImageSrc("my%20shot.png", "/repo", "/home/bob")` → `{ kind: "local", path: "/repo/my shot.png" }` (decoded)
  - Directory paths classify as `local` (no extension gate)

## Build & test results

### Test run: `npx vitest run packages/web-client/src/timeline packages/web-client/src/lib`
```
 Test Files  14 passed (14)
      Tests  201 passed (201)
   Start at  13:50:17
   Duration  438ms
```

Test file breakdown:
- `packages/web-client/src/timeline/file-link-src.test.ts` → 47 tests ✓
- `packages/web-client/src/timeline/image-src.test.ts` → 24 tests ✓ (updated expectations)
- `packages/web-client/src/timeline/markdown.test.ts` → 6 tests ✓ (updated expectations)
- `packages/web-client/src/lib/paths.test.ts` → 23 tests ✓ (13 new for `collapseDotSegments`)
- 9 other test files → 101 tests ✓ (unchanged, verify no regression)

### Typecheck: `npm run typecheck`
```
[no errors]
```
Full workspace typecheck passes with no issues.

### Lint: `npm run lint`
```
[no issues in modified files]
```
All new and modified files pass lint checks (oxlint).

## Acceptance criteria

- [x] `classifyFileLinkSrc` is unit-tested across every table row: empty/whitespace (✓), fragment-only (✓), path+fragment (✓), `http:`/`https:` (✓), another explicit scheme (✓), `/`-absolute (✓), `~`-prefixed (✓), `./`/`../`/bare-relative (✓), both with and without base/homeDir (✓)
- [x] `classifyFileLinkSrc("./notes.md", "/repo", null)` and `classifyFileLinkSrc("../x/../notes.md", "/repo/a", null)` both return `{ kind: "local", path: "/repo/notes.md" }` (normalization) — verified in tests and passing
- [x] `classifyFileLinkSrc("my%20notes.md", "/repo", null)` returns `{ kind: "local", path: "/repo/my notes.md" }` (percent-decoding) — verified in tests and passing
- [x] `classifyImageSrc("./shot.png", "/repo", "/home/bob")` now returns `{ kind: "local", path: "/repo/shot.png" }`, and `classifyImageSrc("my%20shot.png", "/repo", "/home/bob")` decodes — test expectations updated, all passing
- [x] A directory-shaped local path still classifies `local` under `classifyFileLinkSrc` — no extension gate — verified in edge-cases test
- [x] The shared step contains no join/tilde logic of its own — grep confirms only `resolveWorkspacePath` and `normalizeCwd` calls (lines 64, 67 of href-resolution.ts)
- [x] `npm run typecheck` passes (full workspace tsc -b)

## Follow-ups / TODO(verify)

None. This task is complete and self-contained. The wiring of `classifyFileLinkSrc` into the markdown renderer is task-003 (out of scope). The pane-owner propagation (`owningPaneId`) is task-002 (concurrent, separate).

---

**Task moved to done/: 2026-08-05 13:50 UTC**
