# Task 001 — Give `@molviewer/core` its own lazy vendor chunk

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Code-split `@molviewer/core`'s 4.3 MB bundle into a dedicated `vendor-molviewer` chunk so users who
never open a molecule tab don't download it.

## Background / why
**The dependency move this task originally called for is already done** — commit `6bd8232`
("fix: move `@molviewer/core` dependency from root to web-client", 2026-07-27) landed it after this
sprint was planned. Verified at HEAD:
- root `package.json` has **no** `dependencies` field at all (only `devDependencies`);
- `packages/web-client/package.json:27` declares `"@molviewer/core": "^0.3.0"`;
- the working tree is clean, so this is committed state, not a local edit.

So only the bundling half remains. Nothing imports the package yet (grep for `@molviewer/core`
across `packages/web-client/src` and `vite.config.ts` returns **zero** matches), which is why the
chunk rule is inert until task-003 lands — expected, not a failure.

Installed size: `dist/molviewer.js` = **4.3 MB**, `dist/style.css` = 88 KB (the 13 MB `.js.map` and
688 KB `types/` never reach the browser). `vite.config.ts:37-66`'s `manualChunks(id)` names a chunk
per heavy dep (`vendor-terminal`, `vendor-highlight`, `vendor-markdown`, …) and falls through to a
single catch-all `return "vendor"` (line 65) — so without a rule, molviewer's 4.3 MB lands in the
chunk **every** page load pulls.

## Scope references
- `docs/molviewer-integration-scope.md` § 2.9 (bundling / dependency footprint), § 5 step 1
- `docs/build-layering.md` (root build/workspace layering conventions)
- root `AGENTS.md` § Monorepo layout, § Tech stack

## What to build
- **`packages/web-client/vite.config.ts`** — inside `manualChunks(id)`, **before** the catch-all
  `return "vendor"` at line 65, add:
  ```ts
  if (id.includes("@molviewer/core") || id.includes("molstar")) return "vendor-molviewer";
  ```
  The `molstar` clause matters: molviewer's render engine is Mol\*-based (`MolstarEngine`, exported
  from its `lib.ts`), and depending on how it resolves, Mol\* may appear as its own module id rather
  than nested under `@molviewer/core`.
- **Verify, don't re-do, the dependency placement**: confirm `@molviewer/core` is in
  `packages/web-client/package.json` and absent from the root, and that `npm install` leaves the
  lockfile unchanged (it should already record the workspace placement). If either is not true, fix
  it here — but expect no diff.

## Out of scope
- Any component that imports molviewer (task-003). After this task nothing imports it yet, so no
  `vendor-molviewer` chunk is emitted — that is the correct intermediate state.
- `@fontsource` IBM Plex packages (molviewer's `lib.d.ts:14-20` documents that fonts are
  deliberately NOT bundled and it falls back to `system-ui`). We accept the fallback; pi-studio has
  its own monospace stack.

## Acceptance criteria
- [ ] `manualChunks` returns `"vendor-molviewer"` for molviewer/Mol\* ids, and that clause is
      evaluated before the catch-all `"vendor"` return.
- [ ] `@molviewer/core` confirmed present in `packages/web-client/package.json` and absent from the
      root `package.json`; `npm install` produces no lockfile change.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- `npm run build:web-client`, then `ls packages/web-client/dist/assets | grep -i molviewer` →
  expected to produce **no** `vendor-molviewer` chunk yet (nothing imports it). Record that in the
  summary so the post-task-003 check has a baseline.
- Re-verify after task-003: a `vendor-molviewer-*.js` chunk exists, is multi-MB, and is **not**
  referenced from `index.html`'s initial script tags (lazy-loaded on demand).

## Notes
- `@molviewer/core`'s `exports` map (verified) is `{ ".": …, "./style.css": "./dist/style.css",
  "./package.json": … }` — so `import "@molviewer/core/style.css"` is a valid subpath (used in
  task-003). Its `package.json` sets `sideEffects: ["**/*.css"]`, so Rollup won't tree-shake it.
- Peer range is `^18.3.0 || ^19.0.0`; web-client is on React `^19.2.7`
  (`packages/web-client/package.json:41-42`) — compatible, no override needed.
