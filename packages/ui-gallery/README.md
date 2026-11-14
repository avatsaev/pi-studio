# @av-pi-studio/ui-gallery

Private Vite + React app that renders every `@av-pi-studio/ui-library` primitive family, with a
theme switcher over all six themes. It proves the library works standalone: it consumes the **built**
`dist` through the library's package `exports`, with no source alias.

Not published and not deployed (it is not in `scripts/publish.sh`).

## Run

Build the library first — the gallery resolves `dist`, not `src`:

```sh
npm run build -w packages/ui-library
npm run dev -w packages/ui-gallery      # Vite dev server
npm run build -w packages/ui-gallery    # typecheck + production build
```

The root `npm run build` builds it after `web-client` and before `cli`. Its appearance is persisted
under its own storage key, `pi-ui-gallery-appearance`.
