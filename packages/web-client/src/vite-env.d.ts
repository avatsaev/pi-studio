// Build-time constants injected by vite.config.ts's `define`. Both the dev server and the
// production build set these, so every entry point that reaches ConnectionBar.tsx goes through
// Vite — there is no runtime fallback.

/** This package's own version, read from package.json at build time (features/cli.md's web-client
 *  equivalent — see AGENTS.md § Versioning). Displayed in the connection bar after the brand. */
declare const __APP_VERSION__: string;

/** Build-time white-label title override (`PI_STUDIO_BRAND_TITLE`, `vite.config.ts`'s
 *  `brandHtmlPlugin` + `src/brand/build-brand.ts`). Defaults to "Pi-Studio". Used by
 *  `ConnectionBar.tsx`'s brand label; `vite.config.ts` also bakes it into `index.html`'s
 *  `<title>`. */
declare const __BRAND_TITLE__: string;
