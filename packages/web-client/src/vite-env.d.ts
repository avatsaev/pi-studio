/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "web" (default) or "electron" — selected via VITE_TARGET in vite.config.ts. */
  readonly VITE_TARGET?: string;
}
