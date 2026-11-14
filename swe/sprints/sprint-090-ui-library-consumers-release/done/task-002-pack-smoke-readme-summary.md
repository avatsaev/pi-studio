# Summary — sprint-090 task-002 pack-smoke-readme (script + README by subagent PersonalPuma/ConventionalVulture; browser check by parent)

## What was built
`packages/ui-library/README.md` (quickstart snippet fenced by `<!-- smoke:main.tsx -->` markers; install/peers, CSS order, ThemeBoundary props, hosts, subpaths, constraints, dev warnings) and `packages/ui-library/scripts/pack-smoke.sh`: `npm pack` → scratch Vite+React 19+TS app outside the repo → installs the tarball → extracts the README snippet verbatim as `src/main.tsx` → `tsc --noEmit`, `vite build`, asserts deep imports (`src/…`, `dist/…`) are rejected by `exports`, `.piui-` present in built CSS, production bundle free of both dev-warning strings, both CSS files resolve. `KEEP_DIR=1` keeps the dir.

## Verification
- `KEEP_DIR=1 bash packages/ui-library/scripts/pack-smoke.sh` → 7× PASS, `ALL PASS` (re-run after the final script tweak).
- Browser on the kept build: `#smoke-button` computed `background-color` = `rgb(46, 92, 184)` = `--pi-color-accent` `#2e5cb8`; sentinel var `1`; 0 console warnings. Scratch dir removed afterwards.

## Acceptance criteria
- [x] AC3 and AC10 (README snippet is the exact code the smoke app builds).
