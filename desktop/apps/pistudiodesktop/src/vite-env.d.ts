/// <reference types="vite/client" />
// ^ `?worker` imports, CSS imports and `import.meta.env`.

/** The desktop client's version: `[workspace.package] version` in `desktop/Cargo.toml`, set by
 *  `vite.config.ts`. Shown in the connection bar. */
declare const __APP_VERSION__: string;
