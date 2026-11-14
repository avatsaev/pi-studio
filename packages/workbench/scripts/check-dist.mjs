#!/usr/bin/env node
/**
 * Asserts the published `dist` has the properties a consumer relies on and a diff cannot show
 * (`swe/architecture/workbench-package.md` § Build). Runs as the last step of `npm run build`.
 *
 *   node scripts/check-dist.mjs [distDir]      (default: ../dist next to this script)
 *
 * Exit 1 with one line per problem. Prints the file count and total size either way.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, "../dist"));
const src = join(here, "../src");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
const files = walk(dist).filter((f) => !f.endsWith(".tsbuildinfo"));
const rel = (f) => relative(dist, f);
const read = (f) => readFileSync(f, "utf8");

// 1. Everything the `exports` map and the README promise is there.
for (const required of [
  "index.js",
  "index.d.ts",
  "styles.css",
  "fonts.css",
  "vite/index.js",
  "vite/index.d.ts",
]) {
  if (!existsSync(join(dist, required))) problems.push(`missing ${required}`);
}
const fonts = files.filter((f) => rel(f).startsWith("fonts/") && f.endsWith(".woff2"));
if (fonts.length === 0) problems.push("no font files under fonts/");
const chunks = files.filter((f) => rel(f).startsWith("chunks/") && f.endsWith(".js"));
if (chunks.length === 0) problems.push("no lazy chunks under chunks/");

// 2. No inlined binaries: Vite's library mode base64-inlines every asset a bundled file references.
const code = files.filter((f) => /\.(js|css)$/.test(f));
for (const file of code) {
  const text = read(file);
  if (/data:font\//.test(text)) problems.push(`${rel(file)}: inlined font (data:font/…)`);
  if (/data:[\w.+/-]+;base64,[A-Za-z0-9+/=]{4096,}/.test(text)) {
    problems.push(`${rel(file)}: large base64 data URL`);
  }
}

// 3. No construct only the source build understands.
const FORBIDDEN = ["?worker", "import.meta.env", "__APP_VERSION__", "__BRAND_TITLE__"];
for (const file of code) {
  const text = read(file);
  for (const token of FORBIDDEN) {
    if (text.includes(token)) problems.push(`${rel(file)}: contains ${token}`);
  }
}

// 4. Lazy imports stay lazy: at least as many dynamic imports in dist as in the sources.
const isSource = (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/test/");
const sourceDynamic = walk(src)
  .filter(isSource)
  .reduce((n, f) => n + (read(f).match(/import\(\s*["'`.@a-z]/g) ?? []).length, 0);
const distDynamic = files
  .filter((f) => f.endsWith(".js") && !rel(f).startsWith("vite/"))
  .reduce((n, f) => n + (read(f).match(/\bimport\(/g) ?? []).length, 0);
if (distDynamic < sourceDynamic) {
  problems.push(
    `dynamic imports: ${distDynamic} in dist < ${sourceDynamic} in src (a lazy chunk was merged)`,
  );
}

// 5. The automatic JSX runtime (a classic `React.createElement` build would need React in scope).
if (!files.some((f) => f.endsWith(".js") && read(f).includes('from "react/jsx-runtime"'))) {
  problems.push("no chunk imports react/jsx-runtime (tsconfig `jsx` must be `react-jsx`)");
}

// 6. styles.css cannot reach outside the workbench: every class it defines is a scoped `piwb-` class,
//    and a third-party class (CodeMirror's `.cm-editor`, pdf.js's `.markedContent`) appears only
//    inside a selector that is itself anchored on a `piwb-` class.
if (existsSync(join(dist, "styles.css"))) {
  const css = read(join(dist, "styles.css"))
    .replace(/url\([^)]*\)/g, "")
    .replace(/"[^"]*"|'[^']*'/g, "")
    .replace(/\{[^{}]*\}/g, "{}"); // declaration blocks out; nested @-rule bodies keep their selectors
  const selectors = css
    .split(/[{}]/)
    .filter((part) => part.trim() && !part.trim().startsWith("@"))
    .flatMap((list) => list.split(","))
    .map((selector) => selector.trim());
  const unanchored = selectors.filter(
    (selector) => /(?<![\w-])\.-?[_a-zA-Z]/.test(selector) && !/\.piwb-/.test(selector),
  );
  if (unanchored.length > 0) {
    problems.push(
      `styles.css: selectors not anchored on a piwb- class: ${unanchored.slice(0, 5).join(" | ")}`,
    );
  }
}

const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(
  `dist: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB; dynamic imports ${distDynamic} (src ${sourceDynamic})`,
);
if (problems.length > 0) {
  for (const problem of problems) console.error(`check-dist: ${problem}`);
  process.exit(1);
}
console.log("check-dist: ok");
