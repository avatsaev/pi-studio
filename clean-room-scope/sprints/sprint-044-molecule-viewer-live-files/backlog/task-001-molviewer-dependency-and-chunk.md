# Task 001 — Move `@molviewer/core` into web-client + give it its own vendor chunk

- **Sprint:** sprint-044-molecule-viewer-live-files
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** none

## Goal
Declare `@molviewer/core` in the package that actually imports it, and code-split its 4.3 MB bundle
into a dedicated `vendor-molviewer` chunk so users who never open a molecule tab don't download it.

## Background / why
`@molviewer/core@^0.3.0` is currently declared in the **root** `package.json:53-55` — the only entry
in the root's `dependencies` at all (everything else there is `devDependencies` tooling). It was
added by an ad hoc `npm i` from the repo root without `-w`. Every other runtime dep lives in its
consuming workspace (e.g. `@xterm/xterm` in `packages/web-client/package.json:35-36`).

Installed size: `dist/molviewer.js` = **4.3 MB**, `dist/style.css` = 88 KB (the 13 MB `.js.map` and
688 KB `types/` never reach the browser). `vite.config.ts:37-66`'s `manualChunks(id)` names a chunk
per heavy dep (`vendor-terminal`, `vendor-highlight`, `vendor-markdown`, …) and falls through to a
single catch-all `"vendor"` (line 65) — so without a rule, molviewer's 4.3 MB lands in the chunk
**every** page load pulls.

## Scope references
- `docs/molviewer-integration-scope.md` § 2.9 (bundling / dependency footprint), § 5 step 1
- `docs/build-layering.md` (root build/workspace layering conventions)
- root `AGENTS.md` § Monorepo layout, § Tech stack

## What to build
- **`packages/web-client/package.json`** — add `"@molviewer/core": "^0.3.0"` to `dependencies`
  (alphabetical position, matching the file's existing ordering).
- **root `package.json`** — remove the `@molviewer/core` entry. If that leaves `dependencies` empty,
  remove the now-empty `dependencies` block entirely (the root had none before this dep was added).
- **`packages/web-client/vite.config.ts`** — inside `manualChunks(id)`, **before** the catch-all
  `return "vendor"` at line 65, add:
  ```ts
  if (id.includes("@molviewer/core") || id.includes("molstar")) return "vendor-molviewer";
  ```
  The `molstar` clause matters: molviewer's render engine is Mol\*-based
  (`MolstarEngine`, exported from its `lib.ts`), and depending on how it resolves, Mol\* may appear
  as its own module id rather than nested under `@molviewer/core`.
- Run `npm install` so the lockfile records the dependency under the workspace.

## Out of scope
- Any component that imports molviewer (task-003) — after this task nothing imports it yet, which is
  expected: the chunk only materializes once task-003 lands.
- `@fontsource` IBM Plex packages (molviewer's `lib.d.ts:14-20` documents that fonts are
  deliberately NOT bundled and it falls back to `system-ui`). We accept the fallback; pi-studio has
  its own monospace stack.

## Acceptance criteria
- [ ] `@molviewer/core` appears in `packages/web-client/package.json` `dependencies` and **not** in
      the root `package.json`.
- [ ] `npm install` completes and `node_modules/@molviewer/core` still resolves from the web-client.
- [ ] `manualChunks` returns `"vendor-molviewer"` for molviewer/Mol\* ids, and that clause is
      evaluated before the catch-all `"vendor"` return.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- `npm run build:web-client`, then confirm the chunk split:
  `ls packages/web-client/dist/assets | grep -i molviewer` → currently expected to produce **no**
  `vendor-molviewer` chunk yet (nothing imports it — this is the correct pre-task-003 state; the
  `manualChunks` rule is inert until then). Record that in the summary.
- Re-verify after task-003: a `vendor-molviewer-*.js` chunk exists, is multi-MB, and is **not**
  referenced from `index.html`'s initial script tags (lazy-loaded on demand).

## Notes
- `@molviewer/core`'s `exports` map (verified) is `{ ".": …, "./style.css": "./dist/style.css",
  "./package.json": … }` — so `import "@molviewer/core/style.css"` is a valid subpath (used in
  task-003). Its `package.json` sets `sideEffects: ["**/*.css"]`, so Rollup won't tree-shake it.
- Peer range is `^18.3.0 || ^19.0.0`; web-client is on React `^19.2.7` — compatible, no override
  needed.
