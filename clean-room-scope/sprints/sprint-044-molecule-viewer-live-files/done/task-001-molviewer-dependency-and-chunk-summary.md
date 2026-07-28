# Task 001 — Summary

## What was done
1. **Verified the dependency placement (no-op).** Confirmed at HEAD:
   - Root `package.json` has no `dependencies` field at all.
   - `packages/web-client/package.json` declares `"@molviewer/core": "^0.3.0"` (dependencies block).
   - `npm install` produced no lockfile diff — the placement was already committed correctly by
     `6bd8232`, exactly as the task's rewritten background section anticipated.
2. **Added the `vendor-molviewer` manual chunk rule.** In
   `packages/web-client/vite.config.ts`'s `manualChunks(id)`, inserted, immediately before the
   catch-all `return "vendor"`:
   ```ts
   if (id.includes("@molviewer/core") || id.includes("molstar")) return "vendor-molviewer";
   ```
   Placed after the `vendor-react` clause and before the final `return "vendor"` — evaluated before
   the catch-all, as required.

## Verification
- `npm run build:web-client` — succeeds. `dist/web/assets` contains **no** `vendor-molviewer-*.js`
  chunk, which is the expected intermediate state: nothing in `packages/web-client/src` imports
  `@molviewer/core` yet (task-003 adds the first import), so the new `manualChunks` clause is never
  matched. This is the documented baseline to diff against once task-003 lands.
- Confirmed the two "Circular chunk: vendor-markdown -> vendor -> …" warnings emitted by this build
  are **pre-existing** — reproduced identically on a stashed (pre-edit) build. Unrelated to this
  change; not introduced by it.
- `npm run typecheck` — passes (`tsc -b`, no errors).
- `npm install` at repo root — no `package-lock.json` diff.

## Acceptance criteria
- [x] `manualChunks` returns `"vendor-molviewer"` for molviewer/Mol* ids, evaluated before the
      catch-all `"vendor"` return.
- [x] `@molviewer/core` confirmed present in `packages/web-client/package.json` and absent from the
      root `package.json`; `npm install` produces no lockfile change.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-up for task-003
Once a component imports `@molviewer/core`, re-run `npm run build:web-client` and confirm a
`vendor-molviewer-*.js` chunk appears, is multi-MB, and is not referenced from `index.html`'s
initial `<script>` tags (i.e. it is lazy-loaded, not part of the eager bundle).
