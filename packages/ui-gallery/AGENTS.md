# `@av-pi-studio/ui-gallery` — AGENTS.md

Private component gallery for `@av-pi-studio/ui-library`. Never published or deployed.

## Source layout

```
index.html                    Vite entry.
vite.config.ts                Vite + React; deliberately NO alias for the library.
src/
  main.tsx                    Imports library CSS (before gallery.css), mounts ThemeBoundary (storageKey `pi-ui-gallery-appearance`), ToastViewport, Announcer.
  App.tsx                     Theme switcher over all six themes + one section per primitive family.
  gallery.css                 Gallery-only layout; tokens only.
  design-tokens.test.ts       Runs the library's `findTokenProblems` over this package's sources.
```

## Invariants

- Consume the library **only through its package `exports`** (the built `dist`) — never add a
  `resolve.alias` or deep imports; that is the point of the app. Run
  `npm run build -w packages/ui-library` before `dev`/`build`.
- Same styling rules as the library: `var(--pi-*)` tokens only, no literal font sizes.
- Add a gallery section when a primitive family is added to the library.

## Commands

```bash
npm run dev -w packages/ui-gallery
npm run build -w packages/ui-gallery    # tsc --noEmit && vite build
```

Root `npm run build` builds it after `web-client`, before `cli`. It is not in `scripts/publish.sh`.
