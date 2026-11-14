# Grill — `@av-pi-studio/ui-library`: shared React components + global styles package

> Status: grilled
> Started: 2026-11-14   Last updated: 2026-11-14   Rounds: 8
> Engineer: avatsaev   Agent: pi

## Raw idea
"i want to export reusable react ui components and global styles into a separate package called @av-pi-studio/ui-library so i can build new client apps by reusing the same components and styles without duplicating them"

## Codebase context
| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Primitives | `packages/web-client/src/components/primitives/` (barrel `index.ts`) | 21 components + `useHover` + `helpers.ts`, each with a sibling `*.module.css` reading only `--pi-*` vars. Deps: `react`, `react-dom` (portal), `clsx`, `lucide-react`, `@radix-ui/react-{dialog,dropdown-menu,popover}`. |
| Primitive → app coupling | `Announcer.tsx`, `ToastViewport.tsx` | Only two primitives reach outside the design system: they read zustand stores in `src/stores/announcer-store.ts` / `toast-store.ts` (app state, `zustand` dep). Everything else imports only `ui/` + `react`/radix/lucide/clsx. |
| Pure UI logic | `packages/web-client/src/ui/` | Framework-free TS (`button`, `combobox`, `status-dot`, `status-badge`, `toast`, `shortcut`, `screen-header`, `avatar`, `option-groups`); no React, no CSS; unit-tested. `status-dot.ts` encodes agent-status semantics (`AgentStatus`, attention reasons) — domain-flavoured. |
| Theme system | `packages/web-client/src/theme/` (barrel `index.ts`) | tokens → palette → colors → 6 variants → `applyAppearance` → `css-bridge.flattenThemeToVars` → `--pi-*` vars on `documentElement`. `ThemeBoundary` applies synchronously before first paint; `appearance-store` persists to an injected `KeyValueStore` under key `pi-studio-appearance`. Imports `brand/`. |
| Brand | `packages/web-client/src/brand/` | `config.ts` (Zod `BrandConfigSchema`, `DEFAULT_BRAND`, accent resolution) + `theme-injection.ts` are runtime theme inputs (`zod` dep). `build-brand.ts` is a **Vite build-time** helper (`PI_STUDIO_BRAND_TITLE`/icon) — app build concern, not a component. |
| Global styles | `packages/web-client/src/global.css`, `theme/fonts.css`, `assets/fonts/` | `global.css` is a reset + body tokens + scrollbar, but also carries app-specific rules (`#root` flex, `body[data-pi-dragging] iframe` paired with `lib/drag-guard.ts` and guarded by `drag-guard.test.ts`). `fonts.css` bundles Cascadia Mono (210 KB + 976 KB NF woff2), terminal-specific. Note: **no CSS file defines the `--pi-*` vars** — they exist only after `ThemeBoundary`/`applyThemeToDOM` runs JS. |
| Breakpoints | `packages/web-client/src/platform/breakpoints.ts` | `getBreakpoint`, `isCompactFormFactor`, layout constants (`HEADER_INNER_HEIGHT`, `MAX_CONTENT_WIDTH`, `WINDOW_CHROME`). |
| Regression guards | `theme/token-integrity.test.ts`, `theme/font-scale.test.ts` | Scan **every** `.css/.ts/.tsx` under `web-client/src` for `--pi-*` references and resolve them against `flattenThemeToVars`. Scan root is the web-client `src` dir — a split must keep both packages covered. |
| Alias | `@pi-studio-ui/*` → `packages/web-client/src/*` (`vite.config.ts`, `tsconfig.json` paths, root `vitest.config.ts`) | 182 files use this alias; ~69 non-design-system files import primitives/ui/theme through it. Despite the name, it is a web-client-internal path alias, not a package. |
| Heavier reusable-looking UI | `src/timeline/markdown.tsx` (+ shiki `highlight.ts`, mermaid, katex), `features/files/CodeView`/`DiffView`, `features/terminal/TerminalPanel` | Larger rendering components tied to app hooks/stores and lazy vendor chunks configured in `vite.config.ts` `manualChunks`. |
| Packaging today | `packages/web-client/package.json`, `scripts/publish.sh` | web-client has **only devDependencies** — it ships a prebuilt Vite SPA (`dist/web`, `dist/electron`) consumed by `cli` (`pi-studio ui`) and Docker. Not in root `tsconfig.json` references (built by Vite). `publish.sh` `PUBLISH_ORDER=(protocol relay client web-client server cli)`, all versions aligned. |
| Two build targets | `vite.config.ts` | `VITE_TARGET=web|electron`; CSS Modules compiled by Vite. |
| Precedent | commit `650c695` | A previous `highlight` package was **removed as unused** — a shared package without a second real consumer was deleted. |
| Design doc | `packages/web-client/DESIGN_SYSTEM.md` | Full catalog of tokens, primitives, `ui/` modules, conventions, guards — would move/split with the code. |

## Problem & outcome
- **Who:** the engineer building new React client apps (inside this monorepo and in other repos via npm) that should look and behave like Pi-Studio's web-client.
- **Today:** the design system (primitives, `ui/` logic, theme/brand) lives inside `packages/web-client/src` behind the internal `@pi-studio-ui/*` alias; web-client publishes only a prebuilt SPA, so another app can only copy files.
- **Done means:** a fresh Vite + React app installs `@av-pi-studio/ui-library`, wraps its root in `ThemeBoundary`, imports one CSS entry, and renders themed primitives identical to web-client with zero copied files; web-client consumes the same package and is visually unchanged (D5).
- **Measured by:** the in-repo gallery app (D2) building and rendering against the package as an independent consumer; no duplicated design-system files left in web-client.

## Goals
- Move the reusable design system out of web-client into a new workspace package `@av-pi-studio/ui-library` — single source, no duplication (D3).
- Publish it to npm alongside the other packages so external repos can consume it (D1).
- Ship a small in-repo component gallery/playground app as the second consumer that proves the package works standalone (D2).
- Support React web SPAs (Vite) and Electron renderers (D4).
- v1 contents (D6): all 21 primitives + `useHover` + `helpers.ts`; pure `ui/*.ts` logic; the theme system (tokens, palette, variants, css-bridge, appearance store, `ThemeBoundary`); brand runtime (`brand/config.ts`, `theme-injection.ts`); `platform/breakpoints.ts`; the generic part of `global.css`; the toast + announcer stores (D7).
- Keep Pi-Studio identity as-is: `--pi-*` var prefix, agent-status semantics (`StatusDot`, `ui/status-dot.ts`), `DEFAULT_BRAND`; white-labelling via the existing brand accent mechanism (D8).

## Non-goals
- React Native (rules out CSS Modules/Radix; not wanted) (D4).
- SSR frameworks (Next.js etc.) — `ThemeBoundary` touches `document` during render; not supported in v1 (D4).
- Generic/neutral rebrand of the library (no var-prefix rename, no stripping of agent-status semantics) (D8).
- `brand/build-brand.ts` (Vite build-time `PI_STUDIO_BRAND_TITLE`/favicon) — app build concern, stays in web-client (D6).
- App-specific global rules (`#root` flex, `body[data-pi-dragging] iframe` drag-guard rule paired with `lib/drag-guard.ts`) — stay in web-client (D6).
- Bundled Cascadia Mono terminal font and heavy rendering components (markdown/shiki/mermaid/katex, CodeView/DiffView, Terminal) — see Deferred (D6).
- Publishing or deploying the gallery app (D9).

## Happy path
1. Engineer creates a new React app (Vite, or Electron renderer) in this monorepo or another repo and adds `@av-pi-studio/ui-library` (workspace dep or npm install) (D1, D4).
2. In the entry module: `import "@av-pi-studio/ui-library/reset.css"` (opt-in global reset) and `import "@av-pi-studio/ui-library/styles.css"` (prebuilt component CSS with scoped class names baked in) — no CSS-Modules config needed in the consumer (D10, D11).
3. Wraps the root in `<ThemeBoundary>` with no props: `store` defaults to the exported `localStorageKvStore`; `brandConfig` optional for accent white-labelling. `--pi-*` vars are applied synchronously before first paint (D13).
4. Imports components/hooks from the root barrel (`import { Button, Dialog, toast } from "@av-pi-studio/ui-library"`) or React-free modules from subpaths (`/theme`, `/ui`, `/brand`, `/breakpoints`) (D12).
5. Mounts `<ToastViewport/>` and `<Announcer/>` explicitly where it wants them; calls the toast/announcer store APIs from anywhere (D7, D14).
6. Result: the app renders primitives pixel-identical to web-client in all six themes; switching theme via the appearance controller restyles live.

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | problem | Who consumes it? | Both new apps inside this monorepo **and** apps in other repos via npm | Matches "build new client apps"; forces a real published, self-contained build (cannot rely on consumer compiling raw source/aliases) | 1 |
| D2 | problem | Concrete second consumer? | None yet → ship an in-repo component gallery/playground app as the second consumer | Avoids the fate of the deleted `highlight` package (commit `650c695`); proves the package works standalone | 1 |
| D3 | problem | What happens to web-client's copy? | **Move**: code leaves web-client; web-client imports from `@av-pi-studio/ui-library` | Single source of truth; "without duplicating" | 1 |
| D4 | problem | Target app kinds | React web SPAs (Vite) + Electron renderer. Not React Native, not SSR | web-client already has both web/electron targets; RN/SSR would force a different styling/theming architecture | 1 |
| D5 | problem | Success criterion | Fresh Vite+React app: install → `ThemeBoundary` → import the library CSS entries (refined by D11: `styles.css` + opt-in `reset.css`) → themed primitives identical to web-client, zero copied files; web-client visually unchanged | Observable, testable bootstrap story | 1 |
| D6 | scope | What moves in v1? | Primitives (21 + `useHover` + helpers), `ui/*.ts`, theme system, brand runtime (`config.ts` + `theme-injection.ts`), `platform/breakpoints.ts`, generic global CSS. **Not**: `build-brand.ts`, app-specific global rules, terminal font, heavy renderers | Moves the already-clean design-system layer; heavy renderers are entangled with app hooks/stores and vendor-chunk config | 2 |
| D7 | scope | Toast/Announcer coupling to app zustand stores | Move `stores/toast-store.ts` + `stores/announcer-store.ts` into the library; `zustand` becomes a library dependency | A new app gets `toast()`/`announce()` working out of the box; no per-app re-implementation | 2 |
| D8 | scope | Pi-Studio clients or generic apps? | New apps are **Pi-Studio clients**: keep `--pi-*` prefix, `AgentStatus` semantics; white-label via brand accent. (`DEFAULT_BRAND` part superseded by D16) | Zero renames; matches the intended consumers | 2 |
| D9 | scope | Gallery app depth | Private workspace package, never published or deployed; renders every primitive in every theme with a theme switcher; **built in CI** so a break is caught | Proves standalone consumption at minimal ops cost | 2 |
| D10 | happy path | CSS delivery | Library build compiles all CSS Modules (scoped class names baked into emitted JS) into **one prebuilt `styles.css`**; consumer imports it once | Works with any bundler; required for npm consumers (D1); raw `.module.css` only works under Vite | 3 |
| D11 | happy path | Global reset placement | Separate `reset.css` entry (html/body reset, body tokens, box-sizing, scrollbar) alongside `styles.css`. Refines D5's "one CSS import" to two entries | Reset styles `body`; an embedding host must be able to skip it | 3 |
| D12 | happy path | JS import surface | Root barrel `@av-pi-studio/ui-library` (everything) **plus** subpaths `/theme`, `/ui`, `/brand`, `/breakpoints` | React-free consumers (token tables, pure logic) import without pulling React | 3 |
| D13 | happy path | `ThemeBoundary` store | Library exports `localStorageKvStore` (moved from web-client `providers/kv-store.ts`); `store` prop becomes **optional**, defaulting to it; injection still supported (Electron/hosts) | Minimal bootstrap; keeps the DI seam | 3 |
| D14 | happy path | Toast/announcer host mounting | App mounts `<ToastViewport/>` + `<Announcer/>` explicitly (as web-client does in `routes/WorkspacePage.tsx`); `ThemeBoundary` does not auto-mount | No hidden portals; placement stays the app's call | 3 |
| D15 | data | Appearance storage key | Optional `storageKey` on `ThemeBoundary` / `createAppearanceController`, default `pi-studio-appearance`, JSON shape unchanged | Existing web-client users keep saved settings; a new app on the same origin can opt out of sharing | 4 |
| D16 | data | Unwired brand scaffold (supersedes D8's "keep `DEFAULT_BRAND`") | Trim on move. Library ships `BrandConfigSchema`/`BrandConfig` + `resolveAccentColors` + `injectBrandAccent`; schema relaxed so only `colors` (with required `accent`) is required. **Dropped:** `getActiveBrand`/`_setActiveBrand`/`_resetActiveBrand`, `resolveBrandConfig`, `buildBrandedThemes`, `DEFAULT_BRAND`, required `productName`/`assets` | Zero non-test callers; `DEFAULT_BRAND` points at non-existent assets/site; no dead public API to keep stable once on npm | 4 |
| D17 | data | Dependency classes / duplicate-instance risk | `react`, `react-dom` = `peerDependencies`; `@radix-ui/*`, `lucide-react`, `clsx`, `zustand`, `zod` = `dependencies`. Document "one copy of ui-library per app" | Avoids duplicate React; toast/announcer singletons only work with a single library instance | 4 |
| D18 | data | Version line | Lockstep with the other packages via `scripts/publish.sh` (one aligned version) | Existing repo convention | 4 |
| D19 | integration | Library build + consumer resolution | Library builds with **Vite library mode** (ESM JS + `styles.css` + `reset.css`) + `tsc --emitDeclarationOnly` for `.d.ts`. **web-client** aliases `@av-pi-studio/ui-library` to its `src` (existing protocol/client pattern, HMR). **Gallery** consumes the built `dist` via package `exports`, no alias | web-client keeps fast dev loop; gallery is the one consumer that exercises the published artifact | 5 |
| D20 | integration | `@pi-studio-ui/*` alias | **Rename** web-client's internal alias to `@web-client/*` across all files (vite config, tsconfig `paths`, root `vitest.config.ts`); moved modules import from `@av-pi-studio/ui-library` | Avoids confusion between a web-client-internal alias named "ui" and the real ui-library package | 5 |
| D21 | integration | Token regression guards after split | Library exports a React-free checker from `/theme` (e.g. `findInvalidTokenRefs(files)` covering both today's guards: dangling `--pi-*`/`--syntax-*` refs, illegal emitted keys, literal font sizes). Library runs it over its own src; web-client and gallery each run a thin test over theirs | Each package stays covered; external apps can reuse the guard | 5 |
| D22 | integration | First npm publish of a new package | Before merging: manually `npm publish` a placeholder `@av-pi-studio/ui-library` with a token, register `release.yml` as its Trusted Publisher on npmjs.com, then merge. Documented as a one-time step | OIDC trusted publishing can only be configured on an existing package; `release.yml` runs on every push to `main`, so merging first would fail the release mid-pipeline | 5 |
| D23 | integration | Docs & packaging touch-points | Move `DESIGN_SYSTEM.md` into ui-library (web-client keeps a pointer); new `packages/ui-library/{README,AGENTS}.md` (README = consumer bootstrap); update root `AGENTS.md`/`README.md`/`docs/build-layering.md`; `publish.sh` gets ui-library before web-client; ui-library is a web-client **devDependency** (bundled into the SPA); `docker/web-client.Dockerfile` copies `packages/ui-library`. **No** Fern page | Developer package, not end-user facing | 5 |
| D24 | edge cases | Invalid `brandConfig` | Validate with `BrandConfigSchema`; on failure `console.warn` once with the Zod errors and render the **unbranded** theme; never throw | A cosmetic misconfig must not blank the app | 6 |
| D25 | edge cases | Consumer forgets `styles.css` | Dev-only check in `ThemeBoundary`: `styles.css` defines a sentinel custom property; if absent after mount, `console.warn` once naming the missing import. Compiled out of production builds | Silent unstyled UI is the most likely first-use failure | 6 |
| D26 | edge cases | Class-name collisions & override order | Library scoped class names use a fixed prefix + hash (e.g. `piui-Button_root_<hash>`); README: "import library CSS before your own" so a consumer `className` wins at equal specificity. No `@layer` | Prevents collisions with consumer CSS Modules; keeps today's cascade in web-client | 6 |
| D27 | edge cases | Multiple `ThemeBoundary` instances | Exactly one per document is supported; documented; dev-only `console.warn` when a second mounts. Scoped/nested boundaries out of scope | Both write to `document.documentElement`; last write wins | 6 |
| D28 | edge cases | Peer React range | `react`/`react-dom` peer `^19` | What web-client runs; primitives use React 19 APIs freely | 6 |
| D29 | NFR | Performance / bundle budget | web-client built output within **±2%** of pre-move total size, same vendor chunk names; library sets `"sideEffects": ["**/*.css"]` so unused components tree-shake from consumer JS | Moving code must not regress the shipped SPA | 7 |
| D30 | NFR | Public API stability | Public API = root barrel + declared subpaths only (`exports` blocks deep imports); breaking changes get a dated entry in `packages/ui-library/CHANGELOG.md` | Lockstep 0.0.x gives no semver protection | 7 |
| D31 | NFR | Rollout | All sprints on one feature branch; **single merge** to `main` (library + web-client migration + gallery + publish wiring together) | Every push to `main` publishes npm + Docker + deploys; no half-migrated state may ship | 7 |
| D32 | NFR | Visual parity proof | **No automated visual check.** Superseded in part by D34: the engineer checks web-client parity manually | Engineer's call | 7 |
| D33 | NFR | Rollback | Revert the merge commit (web-client is a self-contained SPA) and `npm deprecate` the affected ui-library versions | Restores production fully; warns npm consumers | 7 |
| D34 | acceptance | How is D5's "web-client visually unchanged" proven? | The engineer checks web-client manually before the single merge (D31). Not an agent-run gate, no screenshot/CSS-diff tooling | Engineer owns the visual sign-off; keeps D5 verifiable without new infra | 8 |
| D35 | acceptance | Acceptance list | AC1–AC10 below accepted in full; grill closed | Engineer confirmed readout | 8 |

## Data & state
No server-side data, no migrations. Client-side state owned by the library:
- **Appearance settings** — `{ mode, settings }` JSON in the injected `KeyValueStore` (default `localStorageKvStore`) under `storageKey` (default `pi-studio-appearance`, D15). Shape unchanged, so existing web-client users keep their theme/font settings across the move. Corrupt/missing data keeps today's fallback (`DEFAULT_THEME_NAME` + `{}`).
- **Toast + announcer stores** — module-level zustand singletons, in-memory only, one per library instance (D7, D17).
- **Brand** — no module state after D16; brand is a per-`ThemeBoundary` prop (`brandConfig`), accent-only.
- **Runtime CSS vars** — `--pi-*`/`--syntax-*` written to `document.documentElement.style` by `applyThemeToDOM` (derived, never stored).
- Ownership: the library owns these shapes; the app owns placement (hosts, `ThemeBoundary` position) and the storage backend choice.

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `packages/web-client/src/{components/primitives,ui,theme,brand}`, `platform/breakpoints.ts`, `stores/{toast,announcer}-store.ts`, `providers/kv-store.ts`, generic part of `global.css` | Moved into `packages/ui-library/src` (D3, D6, D7, D13) | moved | ~69 web-client files import these today; every import rewritten to `@av-pi-studio/ui-library` |
| web-client remaining code (182 files using `@pi-studio-ui/*`) | Alias renamed to `@web-client/*` (D20) | writes | Large mechanical diff; `vite.config.ts`, `tsconfig.json` `paths`, root `vitest.config.ts` all change together |
| `packages/web-client/vite.config.ts` | New `resolve.alias` for `@av-pi-studio/ui-library` → `../ui-library/src` (D19); `manualChunks` still sees radix/lucide/etc. from node_modules | writes | Must keep vendor chunking unchanged (`vendor-overlays`, `vendor-icons`) |
| `packages/web-client/src/global.css` | Keeps only app-specific rules (`#root`, drag-guard iframe rule); imports library `reset.css` | writes | `lib/drag-guard.test.ts` reads `global.css` by path — rule must stay there |
| `packages/web-client/src/providers/AppProviders.tsx`, `routes/WorkspacePage.tsx` | Use library `ThemeBoundary` (store default) and library `ToastViewport`/`Announcer` | consumes | — |
| `theme/token-integrity.test.ts`, `theme/font-scale.test.ts` | Become a library-exported checker + thin per-package tests (D21) | moved/split | Coverage must not shrink: web-client CSS still references `--pi-*` vars |
| `packages/ui-gallery` (new, private) | Consumes built `dist` of ui-library via `exports` (D9, D19) | consumes | Must be part of root `npm run build` so a break fails the release pipeline |
| Root `package.json` | `workspaces` + `build:ui-library` + build order: protocol → relay → client → **ui-library** → server → web-client → **ui-gallery** → cli | writes | Order: ui-library before web-client and gallery |
| Root `tsconfig.json` / `tsconfig.base.json` | ui-library declarations emitted for typecheck (`npm run typecheck`) | writes | web-client is outside the `tsc -b` graph today; library should be inside it |
| `scripts/publish.sh` | `PUBLISH_ORDER`/`ALL_PACKAGES` gain `ui-library` before `web-client`; version bump + internal dep rewrite covers it (D18, D23) | writes | README image rewrite logic applies if README references `assets/` |
| `.github/workflows/release.yml` + npmjs.com Trusted Publisher | New package must exist + be registered before merge (D22) | config | Partial-release risk if skipped |
| `docker/web-client.Dockerfile` | `COPY packages/ui-library/package.json` + source (D23) | writes | Image build fails otherwise |
| `packages/cli` | Unchanged — ships web-client's prebuilt SPA; ui-library is bundled into it | none | No runtime dep on ui-library |
| Docs: `packages/web-client/{AGENTS,README,DESIGN_SYSTEM}.md`, root `AGENTS.md`/`README.md`, `docs/build-layering.md`, new `packages/ui-library/{README,AGENTS,DESIGN_SYSTEM}.md` | Updated per D23 | writes | Root AGENTS.md "Monorepo layout" + dependency graph + publish order prose |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | Invalid `brandConfig` (bad hex, missing `accent`) | `console.warn` once with Zod errors; unbranded theme renders | D24 |
| inputs | `brandConfig` without `productName`/`assets` | Valid — only `colors.accent` is required | D16 |
| inputs | Custom `storageKey` | Used verbatim; absent → `pi-studio-appearance` | D15 |
| identity & access | n/a — client-side presentation library; no auth, tenants, or user data | | |
| state | Stored appearance JSON corrupt/missing | Unchanged fallback: `DEFAULT_THEME_NAME` + `{}` | D15 |
| state | Existing web-client user upgrades | Same key + shape → saved theme/font settings survive the move | D15 |
| state | Two `ThemeBoundary`s in one document | Unsupported; dev-only warn on second mount; last write wins | D27 |
| state | Two copies of ui-library in one app (version skew) | `toast()` from one copy never reaches the other's viewport; documented "one copy per app"; React kept single via peers | D17 |
| timing | Theme vars before first paint | Unchanged: `ThemeBoundary` applies synchronously during first render | D13 |
| timing | `styles.css` never imported | Dev-only warn once after mount (sentinel custom property); silent in prod | D25 |
| timing | n/a — no network, retries, or async ordering in the library beyond existing toast timers (`ui/toast.ts` `remainingMs`) | | |
| scale | Consumer uses one component but imports full `styles.css` | Accepted cost of D10; JS tree-shaking + size budget — see Non-functional constraints | D10 |
| dependencies | Consumer CSS class collides / overrides lose | Prefixed scoped names; "import library CSS first" | D26 |
| dependencies | Consumer on React 18 | Unsupported; peer `^19` makes npm warn/fail at install | D28 |
| dependencies | Radix/lucide/zustand version drift between library and consumer | Library-owned regular `dependencies`; consumer may get a second copy of e.g. lucide (size only, no behavior break) | D17 |
| data lifecycle | Removed brand APIs (`getActiveBrand`, `DEFAULT_BRAND`, …) | Removed with their tests; no runtime caller exists | D16 |
| data lifecycle | Removed web-client paths (`@pi-studio-ui/*`) | Alias renamed to `@web-client/*` in one cut; no shim | D20 |
| observability & ops | Token typo/dangling var in any package | Library-exported checker fails that package's test | D21 |
| observability & ops | First release with the new package | Placeholder published + Trusted Publisher registered before merge; otherwise `release.yml` fails mid-pipeline | D22 |
| observability & ops | Rollback | See Non-functional constraints | |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | web-client built output within ±2% of pre-move size, vendor chunk names unchanged; library `sideEffects: ["**/*.css"]` (D29). Full `styles.css` imported regardless of components used (D10) |
| Security & authorization | n/a — no network, secrets, auth, or `dangerouslySetInnerHTML` introduced; library is presentation-only |
| Privacy | n/a — no telemetry; only appearance settings in the consumer's chosen `KeyValueStore` |
| Backward compatibility | Existing web-client users keep saved appearance (D15). Public npm API = barrel + subpaths, breaking changes in `CHANGELOG.md` (D30). Removed brand APIs had no callers (D16). React peer `^19` (D28) |
| Rollout / feature flag | No flag; single merge of the whole feature branch to `main` (D31); manual placeholder publish + Trusted Publisher first (D22) |
| Observability | Dev-only `console.warn`s: invalid brand (D24), missing `styles.css` (D25), second `ThemeBoundary` (D27). Token checker in every package's tests (D21) |
| Rollback | Revert merge commit + `npm deprecate` affected ui-library versions (D33) |

## Deferred
- Bundled Cascadia Mono terminal font (`theme/fonts.css`, `assets/fonts/`) — terminal-specific, ~1.2 MB; revisit if a second app embeds a terminal (D6).
- Heavy rendering components (markdown + shiki/mermaid/katex, CodeView/DiffView, TerminalPanel) — coupled to app hooks/stores and `vite.config.ts` `manualChunks`; candidates for a later sprint/package (D6).

## Open questions — TODO(verify)
(None blocking.)
- [ ] One-time: publish placeholder `@av-pi-studio/ui-library` with a token and register `release.yml` as its Trusted Publisher on npmjs.com — **before** the merge (D22) — owner: avatsaev
- [ ] Manual web-client visual parity check before the merge (D34) — owner: avatsaev
- [ ] Gallery package name/location (working name `packages/ui-gallery`) and exact scoped-class prefix (working `piui-`) — owner: scope
- [ ] Whether ui-library joins the root `tsc -b` references graph or only typechecks via its own script (web-client sits outside it today) — owner: scope

## Acceptance criteria (draft)
- [ ] AC1 — Given a clean checkout, when `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` run, then all pass and `packages/ui-library/dist` holds ESM JS, `.d.ts`, `styles.css` and `reset.css` (D10, D11, D19).
- [ ] AC2 — No moved module remains in web-client (`components/primitives`, `ui`, `theme` except app-only leftovers, `brand/{config,theme-injection}.ts`, `platform/breakpoints.ts`, `stores/{toast,announcer}-store.ts`, `providers/kv-store.ts`); zero `@pi-studio-ui` references repo-wide; web-client reaches design-system code only via `@av-pi-studio/ui-library` (D3, D6, D20).
- [ ] AC3 — Given the `npm pack` tarball installed into a scratch Vite + React 19 app **outside** the workspace, when it imports `reset.css` + `styles.css`, wraps in `<ThemeBoundary>` with no props and renders `<Button>`, then the button renders with resolved `--pi-*` values, types resolve under `tsc`, and a deep import (`@av-pi-studio/ui-library/src/...`) is rejected by `exports` (D1, D5, D12, D13, D30).
- [ ] AC4 — The gallery builds against ui-library `dist` with no alias, renders every exported primitive, and switches across all six themes (one browser check of the gallery) (D2, D9, D19).
- [ ] AC5 — With default config an existing `pi-studio-appearance` value is honoured; with a custom `storageKey` that key is neither read nor written (unit tests) (D15).
- [ ] AC6 — Invalid `brandConfig` → exactly one warn + unbranded theme; missing `styles.css` and a second `ThemeBoundary` → one dev warn each; none of these warns in a production build (unit tests) (D24, D25, D27).
- [ ] AC7 — A dangling `var(--pi-color-nope)` or a literal font size in ui-library, web-client or gallery CSS fails that package's test (D21).
- [ ] AC8 — web-client `dist/web` total size within ±2% of the pre-move baseline, with the same vendor chunk names (D29).
- [ ] AC9 — `npm run publish -- --dry-run` packs ui-library before web-client at the aligned version; `docker/web-client.Dockerfile` builds (D18, D22, D23).
- [ ] AC10 — Docs per D23 are truthful; the ui-library README bootstrap snippet pasted into AC3's scratch app works unchanged (D23).

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem & outcome | Consumers both in-repo and npm; in-repo gallery app as second consumer; move (not copy); web + Electron only; success = fresh-app bootstrap + web-client unchanged. |
| 2 | scope boundary | v1 = primitives + ui logic + theme + brand runtime + breakpoints + generic global CSS + toast/announcer stores; Pi identity kept; terminal font + heavy renderers deferred; gallery private + CI-built. |
| 3 | happy path | Prebuilt single `styles.css` + separate opt-in `reset.css` (refines D5); root barrel + React-free subpaths; `ThemeBoundary.store` optional w/ exported localStorage adapter; toast/announcer hosts mounted explicitly. |
| 4 | data & state | Configurable `storageKey` (default unchanged); trim unwired brand scaffold to accent-only API (supersedes part of D8); react/react-dom peers, rest deps; lockstep version. |
| 5 | integration | Vite lib-mode build; web-client aliases src, gallery consumes dist; rename `@pi-studio-ui/*` → `@web-client/*`; exported token-guard checker; manual first publish + trusted publisher before merge; docs/publish/Docker touch-points, no Fern. |
| 6 | edge cases | Invalid brand → warn + unbranded; dev-only missing-CSS and second-`ThemeBoundary` warnings; prefixed scoped class names, library CSS imported first; React peer `^19`. Identity/access and async timing n/a. |
| 7 | NFR | ±2% web-client size budget + same chunks; `exports`-bounded API + CHANGELOG; single merge to main; no visual check (engineer); revert + `npm deprecate` rollback. Security/privacy n/a. |
| 8 | acceptance | Challenged D5 vs D32: engineer will check web-client parity manually (D34). AC1–AC10 accepted; grill closed. |

## Handoff to scope
**2026-11-14: `scope` skipped by the engineer.** This brief is the spec, and sprints 088–090
(`swe/sprints/PLAN.md`) cite its decision ids directly. The table below is kept only as a record.
Scope-owned open questions were settled at planning time: `packages/ui-gallery`, the `piui-` prefix,
and ui-library in the root `tsc -b` graph.

Project spec dirs (per `swe/av-swe.config.json`): `swe/features/`, `swe/architecture/`, index `swe/MAIN-SCOPE.md`.

| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/ui-library.md` | Problem & outcome, Goals, Non-goals, Happy path, Decisions D1–D16 + D24–D28, Edge cases, Acceptance criteria |
| `swe/architecture/ui-library-packaging.md` | Integration points, Data & state, Decisions D10–D13 + D17–D23 + D29–D33, Non-functional constraints, Open questions |
| `swe/MAIN-SCOPE.md` (update) | Monorepo package list + dependency graph: new `ui-library` (publishable) and private gallery app |

Pointers for `plan`: the move (D3) and alias rename (D20) are large mechanical diffs — sequence them before the behavioural additions (D13, D15, D16, D24–D27) so each lands on a green build. The gallery (D9) and pack-smoke (AC3) depend on the Vite library build (D19) existing first. Everything ships in one merge (D31), after the two owner actions in Open questions.
