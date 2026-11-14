/// <reference types="vite/client" />
// ^ `?worker` imports and `import.meta.env` (main.tsx's pdf.js runtime).

// Build-time constants injected by vite.config.ts's `define`. Both the dev server and the
// production build set these; main.tsx passes them to the workbench through the browser host.

/** This package's own version, read from package.json at build time. Shown in the connection bar. */
declare const __APP_VERSION__: string;

/** Build-time white-label title override (`PI_STUDIO_BRAND_TITLE`, `vite.config.ts`'s
 *  `brandHtmlPlugin` + `src/brand/build-brand.ts`). Defaults to "Pi-Studio". Shown in the
 *  connection bar; `vite.config.ts` also bakes it into `index.html`'s `<title>`. */
declare const __BRAND_TITLE__: string;
