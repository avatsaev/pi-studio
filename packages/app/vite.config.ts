import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const target = process.env.VITE_TARGET ?? "web";

  return {
    plugins: [react()],
    root: resolve(__dirname),
    define: {
      "import.meta.env.VITE_TARGET": JSON.stringify(target),
    },
    build: {
      outDir: target === "electron" ? "dist/electron" : "dist/web",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split large vendor libraries into their own chunks so the main
          // entry stays under the 500 kB warning threshold and browsers can
          // cache framework code independently of app code.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react-markdown") || id.includes("remark") || id.includes("micromark") || id.includes("mdast") || id.includes("hast") || id.includes("unist") || id.includes("unified")) return "vendor-markdown";
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("@radix-ui") || id.includes("@floating-ui")) return "vendor-overlays";
            if (id.includes("@tanstack")) return "vendor-query";
            if (id.includes("@dnd-kit")) return "vendor-dnd";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("react-router") || id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react";
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@av-pi-studio/highlight": resolve(__dirname, "../highlight/src/index.ts"),
        "@av-pi-studio/protocol": resolve(__dirname, "../protocol/src/index.ts"),
        "@av-pi-studio/client": resolve(__dirname, "../client/src/index.ts"),
      },
    },
    server: {
      host: process.env.APP_DEV_HOST ?? "0.0.0.0",
      port: Number(process.env.APP_DEV_PORT ?? 5173),
      // Dev convenience: allow any Host header (matches daemon's `hostnames: true`).
      allowedHosts: true,
      // Proxy WebSocket traffic to the daemon through the SAME port the browser
      // already reached to load the page. Avoids requiring a second reachable
      // port (6767) across NAT/firewall boundaries.
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
