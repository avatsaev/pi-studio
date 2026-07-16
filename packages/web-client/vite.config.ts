import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two build targets from one source:
//   - web:      served over HTTP, absolute base, /daemon-ws dev proxy.
//   - electron: loaded from file:// inside a BrowserWindow, relative base so
//               assets resolve without a web server.
// Selected via VITE_TARGET (defaults to "web").
export default defineConfig(() => {
  const target = process.env.VITE_TARGET ?? "web";
  const isElectron = target === "electron";

  return {
    plugins: [react()],
    root: resolve(__dirname),
    base: isElectron ? "./" : "/",
    define: {
      "import.meta.env.VITE_TARGET": JSON.stringify(target),
    },
    build: {
      outDir: isElectron ? "dist/electron" : "dist/web",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split large vendor libraries into their own chunks so the main
          // entry stays small and framework code caches independently.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("react-markdown") ||
              id.includes("remark") ||
              id.includes("micromark") ||
              id.includes("mdast") ||
              id.includes("hast") ||
              id.includes("unist") ||
              id.includes("unified")
            ) {
              return "vendor-markdown";
            }
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
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@av-pi-studio/protocol": resolve(__dirname, "../protocol/src/index.ts"),
        "@av-pi-studio/client": resolve(__dirname, "../client/src/index.ts"),
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
