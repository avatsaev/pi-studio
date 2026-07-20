/// <reference types="vite/client" />

// Build-time constants injected by vite.config.ts `define`.
interface ImportMetaEnv {
  /** "web" (default) or "electron" — selected via VITE_TARGET in vite.config.ts. */
  readonly VITE_TARGET?: string;
}
