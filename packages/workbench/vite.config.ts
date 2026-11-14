import { createHash } from "node:crypto";
import { cpSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));

// Everything a consumer's package manager installs for us stays out of the bundle, including deep
// subpaths such as `react/jsx-runtime` or `katex/dist/katex.min.css` (packaging spike, finding 1),
// plus Node's built-ins for the `./vite` entry.
const externals = [
  ...[
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies),
    "react/jsx-runtime",
  ].map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(/.*)?$`)),
  /^node:/,
];

/** `piwb-<Component>_<class>_<hash>`: a fixed prefix keeps workbench classes off consumer CSS. */
function generateScopedName(local: string, filename: string): string {
  const component = basename(filename).replace(/\.module\.css$/, "");
  const hash = createHash("sha1")
    .update(`${relative(root, filename)}:${local}`)
    .digest("base64url")
    .slice(0, 5);
  return `piwb-${component}_${local}_${hash}`;
}

/** Fails the build when a chunk contains third-party code: every dependency must stay external so
 *  the consumer's package manager dedupes it. Vite's dynamic-import preload helper is the one
 *  module Vite itself injects. */
function noBundledDependencies(): Plugin {
  return {
    name: "workbench-no-bundled-dependencies",
    generateBundle(_options, bundle) {
      const bundled = Object.values(bundle).flatMap((output) =>
        output.type === "chunk"
          ? Object.keys(output.modules)
              .filter((id) => id.includes("/node_modules/") && !id.includes("vite/preload-helper"))
              .map((id) => `${output.fileName}: ${id}`)
          : [],
      );
      if (bundled.length > 0) {
        this.error(
          `third-party modules were bundled (declare them as dependencies so they stay external):\n${bundled.join("\n")}`,
        );
      }
    },
  };
}

/** `fonts.css` and the font files, copied verbatim: Vite's library mode would inline every font a
 *  bundled stylesheet references as base64 (packaging spike, finding 2). */
function copyFonts(): Plugin {
  return {
    name: "workbench-copy-fonts",
    writeBundle() {
      cpSync(resolve(root, "src/fonts.css"), resolve(root, "dist/fonts.css"));
      cpSync(resolve(root, "src/fonts"), resolve(root, "dist/fonts"), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [noBundledDependencies(), copyFonts()],
  css: { modules: { generateScopedName } },
  build: {
    target: "es2022",
    sourcemap: false,
    // One `styles.css` for every CSS Module.
    cssCodeSplit: false,
    lib: {
      entry: {
        index: resolve(root, "src/index.ts"),
        // Node code for the consumer's `vite.config.ts` (`@av-pi-studio/workbench/vite`).
        "vite/index": resolve(root, "vite/index.ts"),
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
