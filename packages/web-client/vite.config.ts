import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Two build targets from one source:
//   - web:      served over HTTP, absolute base, /daemon-ws dev proxy.
//   - electron: loaded from file:// inside a BrowserWindow, relative base so
//               assets resolve without a web server.
// Selected via VITE_TARGET (defaults to "web").
const { version: APP_VERSION }: { version: string } = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
);

export default defineConfig(() => {
  const target = process.env.VITE_TARGET ?? "web";
  const isElectron = target === "electron";

  return {
    plugins: [react()],
    root: resolve(__dirname),
    base: isElectron ? "./" : "/",
    define: {
      "import.meta.env.VITE_TARGET": JSON.stringify(target),
      // Own package.json version, baked in at build time (Toolbar.tsx — displayed after the
      // brand title). Ambient type in `src/vite-env.d.ts`.
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    build: {
      outDir: isElectron ? "dist/electron" : "dist/web",
      emptyOutDir: true,
      // No sourcemap consumer exists (no Sentry/error-tracking upload, nothing reads .map at
      // runtime) — generating them for these large vendor chunks (18MB+ for a single chunk) blew
      // Rollup's sourcemap-rendering phase past the default V8 old-space heap on GitHub Actions'
      // standard runner, OOM-killing every release build from 2026-08-17 onward (18.5MB+8.3MB+…
      // of maps was ~68% of the whole dist/ output — pure waste being shipped to production too).
      sourcemap: false,
      rollupOptions: {
        output: {
          // Split large vendor libraries into their own chunks so the main
          // entry stays small and framework code caches independently.
          manualChunks(id) {
            // Vite's dynamic-import preload helper (virtual module, no node_modules in its id).
            // Left to Rollup's default placement it lands inside whichever vendor chunk happens
            // to reference it first (was: vendor-highlight), making every other chunk that uses
            // a dynamic import depend on that chunk — the final edge of a vendor-highlight ->
            // vendor-markdown -> vendor -> vendor-highlight circular-chunk cycle (see below).
            // Pin it into the base `vendor` chunk that everything already imports.
            if (id.includes("vite/preload-helper")) return "vendor";
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("react-markdown") ||
              id.includes("remark") ||
              id.includes("micromark") ||
              id.includes("mdast") ||
              id.includes("hast") ||
              id.includes("unist") ||
              id.includes("unified") ||
              // Not caught by the patterns above, but only ever pulled in by the markdown/KaTeX
              // pipeline (rehype-katex; property-information via hast-util-*; vfile/vfile-message
              // via unified). Left in the default `vendor` bucket they created a circular chunk
              // import (vendor <-> vendor-markdown) — e.g. vfile-message imports
              // unist-util-stringify-position back out of vendor-markdown — which Rollup resolves
              // with the wrong module init order in production builds: `Cannot access '<var>'
              // before initialization` on load. Dev-mode Vite serves unbundled ESM and never
              // hits this, so it only reproduces in built output (`pi-studio web`/vite preview).
              id.includes("property-information") ||
              id.includes("rehype-katex") ||
              id.includes("vfile")
            ) {
              return "vendor-markdown";
            }
            // @shikijs/langs and @shikijs/themes are pure dynamic-import registries (634
            // languages / 110 themes, ~11MB source) — each language/theme is its own
            // `() => import(...)` loaded on demand by highlight.ts's `loadLanguage()`. Excluding
            // them here lets Rollup's default per-dynamic-import chunking split each into its
            // own tiny lazy chunk instead of forcing all 744 of them into one eager bundle.
            if (id.includes("@shikijs/langs") || id.includes("@shikijs/themes")) return undefined;
            if (id.includes("shiki") || id.includes("@shikijs")) return "vendor-highlight";
            if (id.includes("@xterm")) return "vendor-terminal";
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("@radix-ui") || id.includes("@floating-ui")) return "vendor-overlays";
            if (id.includes("@tanstack")) return "vendor-query";
            if (id.includes("@dnd-kit")) return "vendor-dnd";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (
              id.includes("react-router") ||
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("@molviewer/core") || id.includes("molstar")) return "vendor-molviewer";
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@av-pi-studio/protocol": resolve(__dirname, "../protocol/src/index.ts"),
        "@av-pi-studio/client": resolve(__dirname, "../client/src/index.ts"),
        "@pi-studio-ui": resolve(__dirname, "src"),
      },
    },
    server: {
      host: process.env.WEB_CLIENT_DEV_HOST ?? "0.0.0.0",
      port: Number(process.env.WEB_CLIENT_DEV_PORT ?? 5173),
      allowedHosts: true,
      // Proxy WebSocket traffic to the daemon through the same port the browser
      // used to load the page (avoids exposing 6767 across NAT/firewall).
      proxy: {
        "/daemon-ws": {
          target: `ws://${process.env.PI_STUDIO_DAEMON_HOST ?? "127.0.0.1"}:${process.env.PI_STUDIO_DAEMON_PORT ?? "6767"}`,
          ws: true,
          changeOrigin: true,
          rewriteWsOrigin: true,
        },
      },
    },
  };
});
