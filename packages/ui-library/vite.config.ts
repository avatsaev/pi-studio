import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));

// Everything a consumer's package manager installs for us stays out of the bundle, including deep
// subpaths such as `react/jsx-runtime` or `@radix-ui/react-dialog/dist/...`.
const externals = [
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.peerDependencies),
  "react/jsx-runtime",
].map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(/.*)?$`));

/** `piui-<Component>_<class>_<hash>`: a fixed prefix keeps library classes off consumer CSS (D26). */
function generateScopedName(local: string, filename: string): string {
  const component = basename(filename).replace(/\.module\.css$/, "");
  const hash = createHash("sha1")
    .update(`${relative(root, filename)}:${local}`)
    .digest("base64url")
    .slice(0, 5);
  return `piui-${component}_${local}_${hash}`;
}

/** `reset.css` ships untouched, as its own opt-in file next to `styles.css` (D11). */
function emitResetCss(): Plugin {
  return {
    name: "ui-library:emit-reset-css",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "reset.css",
        source: readFileSync(resolve(root, "src/reset.css"), "utf8"),
      });
    },
  };
}

export default defineConfig({
  plugins: [emitResetCss()],
  css: { modules: { generateScopedName } },
  build: {
    target: "es2022",
    sourcemap: false,
    // One `styles.css` for every CSS Module (D10).
    cssCodeSplit: false,
    lib: {
      entry: {
        index: resolve(root, "src/index.ts"),
        "theme/index": resolve(root, "src/theme/index.ts"),
        "ui/index": resolve(root, "src/ui/index.ts"),
        "brand/index": resolve(root, "src/brand/index.ts"),
        breakpoints: resolve(root, "src/breakpoints.ts"),
      },
      formats: ["es"],
      cssFileName: "styles",
    },
    rollupOptions: {
      external: externals,
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
});
