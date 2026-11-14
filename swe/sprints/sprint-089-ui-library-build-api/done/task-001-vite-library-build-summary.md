# Summary — sprint-089 task-001 vite-library-build

## What was built
`packages/ui-library/vite.config.ts`: Vite 6 library mode, ES only, five entries (`index`, `theme/index`, `ui/index`, `brand/index`, `breakpoints`), every `dependencies`/`peerDependencies` entry (deep subpaths included) plus `react/jsx-runtime` external, `cssCodeSplit: false` + `cssFileName: "styles"` → one `dist/styles.css`, scoped names `piui-<Component>_<class>_<hash5>` (117 prefixed selectors, none unprefixed), `reset.css` emitted verbatim by a tiny plugin. Declarations: `tsconfig` is now `emitDeclarationOnly`; `build` = `vite build && tsc -b`. `package.json` `exports`: `.`, `./theme`, `./ui`, `./brand`, `./breakpoints`, `./styles.css`, `./reset.css`, `./package.json` — nothing else, so deep imports are rejected. `vite` added as devDependency.
`/theme` had to become React-free: `ThemeBoundary`/`useAppearance`/`useResolvedTheme` moved out of `theme/index.ts` into the root barrel only (`src/index.ts`).

## NODE_ENV TODO(verify) — resolved
Probe: appended `process.env.NODE_ENV !== "production"` to the entry and built. Vite 6.4.6 lib mode leaves it untouched in `dist/index.js` (`_o = process.env.NODE_ENV !== "production"`). No `define` needed. Probe removed afterwards. (Guard for bare-browser `process` is task-004's concern.)

## Commands run
- `npm run build -w packages/ui-library` ok; node import of `@av-pi-studio/ui-library/theme` (32 keys) and `/ui` (31 keys) resolves via workspace link
- dist checks: theme/ui/brand/breakpoints graphs import only `zod` + local chunks (no react); no `@pi-studio-ui`/`@web-client` string in dist; root bundle imports react, react-dom, react/jsx-runtime, radix, lucide, clsx, zustand externally, no inlined React
- `npx tsc -b` clean; `npm run build` (all) ok; `npx vitest run` 257 files / 3522 tests passed; web-client dist/web 26529752 B (baseline 26532061)
- removed one unused import (`filterOptions` in `primitives/Select.tsx`) while touching moved code

## Acceptance criteria
- [x] dist has ESM per entry, `.d.ts` per entry, `styles.css` (all prefixed), `reset.css`. [x] `/theme` pulls no react. [x] no alias specifiers or inlined React in dist.

## Follow-ups
- web-client still resolves the library through its source alias (D19); `reset.css` alias entry from s088 is unchanged and now also matches a real export.
