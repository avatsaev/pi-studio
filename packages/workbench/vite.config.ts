import { createHash } from "node:crypto";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));

// Everything a consumer's package manager installs for us stays out of the bundle, including deep
// subpaths such as `react/jsx-runtime` or `katex/dist/katex.min.css` (packaging spike, finding 1).
const externals = [
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.peerDependencies),
  "react/jsx-runtime",
].map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(/.*)?$`));

/** `piwb-<Component>_<class>_<hash>`: a fixed prefix keeps workbench classes off consumer CSS. */
function generateScopedName(local: string, filename: string): string {
  const component = basename(filename).replace(/\.module\.css$/, "");
  const hash = createHash("sha1")
    .update(`${relative(root, filename)}:${local}`)
    .digest("base64url")
    .slice(0, 5);
  return `piwb-${component}_${local}_${hash}`;
}

export default defineConfig({
  css: { modules: { generateScopedName } },
  build: {
    target: "es2022",
    sourcemap: false,
    // One `styles.css` for every CSS Module.
    cssCodeSplit: false,
    lib: {
      entry: { index: resolve(root, "src/index.ts") },
      formats: ["es"],
      cssFileName: "styles",
    },
    rollupOptions: {
      external: externals,
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
});
