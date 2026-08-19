import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { resolveBrandIcon, resolveBrandTitle } from "./src/brand/build-brand.js";

// Two build targets from one source:
//   - web:      served over HTTP, absolute base, /daemon-ws dev proxy.
//   - electron: loaded from file:// inside a BrowserWindow, relative base so
//               assets resolve without a web server.
// Selected via VITE_TARGET (defaults to "web").
const { version: APP_VERSION }: { version: string } = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
);

// Build-time white-label override (title + favicon only — see AGENTS.md § Invariants "Build-time
// brand override" and `src/brand/build-brand.ts`'s header comment for why this is intentionally
// narrower than the unwired `BrandConfig` colors/logo scaffold). Unset → byte-identical default
// Pi-Studio output.
const BRAND_TITLE = resolveBrandTitle(process.env);
const BRAND_ICON = resolveBrandIcon(process.env);
// Read once at config-eval time: doubles as the "does this file actually exist" fail-fast check,
// and avoids re-reading the file on every dev-server request.
const BRAND_ICON_BUFFER = BRAND_ICON ? readFileSync(resolve(BRAND_ICON.sourcePath)) : null;

/** Rewrites index.html's <title> and (when overridden) favicon <link>; serves/emits the custom
 *  favicon in dev and build respectively. */
function brandHtmlPlugin(): Plugin {
  return {
    name: "pi-studio-brand-html",
    transformIndexHtml(html) {
      let out = html.replace(/<title>[^<]*<\/title>/, `<title>${BRAND_TITLE}</title>`);
      if (BRAND_ICON) {
        out = out.replace(
          /<link rel="icon"[^>]*>/,
          `<link rel="icon" type="${BRAND_ICON.mime}" href="/${BRAND_ICON.fileName}" />`,
        );
      }
      return out;
    },
    configureServer(server) {
      if (!BRAND_ICON || !BRAND_ICON_BUFFER) return;
      const urlPath = `/${BRAND_ICON.fileName}`;
      server.middlewares.use((req, res, next) => {
        if (req.url !== urlPath) return next();
        res.setHeader("Content-Type", BRAND_ICON.mime);
        res.end(BRAND_ICON_BUFFER);
      });
    },
    generateBundle() {
      if (!BRAND_ICON || !BRAND_ICON_BUFFER) return;
      this.emitFile({ type: "asset", fileName: BRAND_ICON.fileName, source: BRAND_ICON_BUFFER });
    },
  };
}

export default defineConfig(() => {
  const target = process.env.VITE_TARGET ?? "web";
  const isElectron = target === "electron";

  return {
    plugins: [react(), brandHtmlPlugin()],
    root: resolve(__dirname),
    base: isElectron ? "./" : "/",
    define: {
      "import.meta.env.VITE_TARGET": JSON.stringify(target),
      // Own package.json version, baked in at build time (ConnectionBar.tsx — displayed after
      // the brand title). Ambient type in `src/vite-env.d.ts`.
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      // Build-time brand title override, resolved above from `PI_STUDIO_BRAND_TITLE`. Ambient
      // type in `src/vite-env.d.ts`.
      __BRAND_TITLE__: JSON.stringify(BRAND_TITLE),
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
              // hits this, so it only reproduces in built output (`pi-studio ui`/vite preview).
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
            // mermaid is dynamically imported by `MermaidBlock` in src/timeline/markdown.tsx
            // ("nobody should pay for mermaid until a message actually contains a diagram").
            // Left unhandled here, its whole dependency subtree fell through to the final
            // `return "vendor"` below and was force-merged into the eagerly modulepreloaded
            // vendor chunk — ~3 MB of mermaid/cytoscape/dagre/langium/roughjs/etc. downloaded on
            // every page load regardless of whether a diagram was ever rendered. Returning
            // `undefined` (not a fixed chunk name) hands placement back to Rollup, which then
            // assigns modules reachable only from the dynamic import into that lazy chunk — same
            // technique as @shikijs/langs/@shikijs/themes above. A fixed "vendor-mermaid" name
            // would not work: any subtree dep left unmatched would still fall through to
            // `vendor` and drag the whole chunk back in with it.
            if (
              id.includes("mermaid") ||
              id.includes("@mermaid-js") ||
              id.includes("langium") ||
              id.includes("chevrotain") ||
              id.includes("cytoscape") ||
              id.includes("layout-base") ||
              id.includes("cose-base") ||
              id.includes("/d3-") ||
              id.includes("/d3/") ||
              id.includes("dagre-d3-es") ||
              id.includes("khroma") ||
              id.includes("roughjs") ||
              id.includes("@upsetjs/venn.js") ||
              id.includes("ts-dedent") ||
              id.includes("@braintree/sanitize-url") ||
              id.includes("@iconify/utils") ||
              id.includes("marked") ||
              id.includes("stylis") ||
              id.includes("dompurify") ||
              id.includes("dayjs")
            ) {
              return undefined;
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
