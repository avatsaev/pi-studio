// TEMPORARY (sprint 092 → removed in sprint 093): Vite-only constructs the moved application code
// still uses. They resolve only because web-client compiles this package from source through its
// Vite alias, with its own `define`/`worker` config. Sprint 093 routes all four through the host.

/** This package's own version, read from package.json at build time (features/cli.md's web-client
 *  equivalent — see AGENTS.md § Versioning). Displayed in the connection bar after the brand. */
declare const __APP_VERSION__: string;

/** Build-time white-label title override (`PI_STUDIO_BRAND_TITLE`, `vite.config.ts`'s
 *  `brandHtmlPlugin` + `src/brand/build-brand.ts`). Defaults to "Pi-Studio". Used by
 *  `ConnectionBar.tsx`'s brand label; `vite.config.ts` also bakes it into `index.html`'s
 *  `<title>`. */
declare const __BRAND_TITLE__: string;

/** Vite's statically replaced `import.meta.env` — only the keys this package reads (the package
 *  does not load `vite/client` types). `BASE_URL` is the consuming app's Vite `base`. */
interface ImportMetaEnv {
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Vite `?worker` import: a constructor for the bundled worker entry (`vite.config.ts`'s
 *  `worker.format` decides classic vs module). */
declare module "*?worker" {
  const WorkerConstructor: new (options?: { name?: string }) => Worker;
  export default WorkerConstructor;
}
