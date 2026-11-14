#!/usr/bin/env bash
# Packs @av-pi-studio/workbench and the workspace packages it depends on, installs the tarballs into
# a scratch Vite + React + TS application outside the repository, and asserts what a consumer (the
# desktop app) relies on. Two entries: the README quickstart (whole application) and a custom shell.
# KEEP_DIR=1 keeps the scratch directory (then `npx vite preview` in it for the run-time check).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PKG="$ROOT/packages/workbench"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/workbench-smoke.XXXXXX")"
cleanup() {
  if [ "${KEEP_DIR:-}" = "1" ]; then echo "KEEP_DIR: $TMP"; else rm -rf "$TMP"; fi
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# The consumer pins the tooling the repository builds with (packaging spike: an unpinned
# plugin-react pulls a version that needs a newer Vite).
VITE_RANGE="$(node -p "require('$ROOT/packages/web-client/package.json').devDependencies.vite")"
PLUGIN_REACT_RANGE="$(node -p "require('$ROOT/packages/web-client/package.json').devDependencies['@vitejs/plugin-react']")"
PDFJS_RANGE="$(node -p "require('$PKG/package.json').dependencies['pdfjs-dist']")"

mkdir -p "$TMP/pack" "$TMP/app/src"
for p in protocol relay client ui-library workbench; do
  [ -f "$ROOT/packages/$p/dist/index.js" ] || fail "packages/$p is not built (run npm run build)"
  (cd "$ROOT/packages/$p" && npm pack --pack-destination "$TMP/pack" >/dev/null 2>&1)
done
pass "packed protocol, relay, client, ui-library, workbench"

cd "$TMP/app"
cat > package.json <<'JSON'
{ "name": "workbench-smoke-app", "private": true, "version": "0.0.0", "type": "module" }
JSON
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx",
    "strict": true, "noEmit": true, "skipLibCheck": false, "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
JSON

# README snippets, extracted verbatim.
extract() {
  awk "/<!-- smoke:$1 -->/{f=1;next} /<!-- \\/smoke:$1 -->/{f=0} f" "$PKG/README.md" | sed '/^```/d'
}
extract vite.config.ts > vite.config.base.ts
extract main.tsx > src/main.tsx
[ -s vite.config.base.ts ] && [ -s src/main.tsx ] || fail "README snippets not extracted"

# The quickstart config plus: a second page, and a report of which modules each chunk holds.
cat > vite.config.ts <<'TS'
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeConfig, type Plugin } from "vite";
import base from "./vite.config.base";

const chunkReport: Plugin = {
  name: "smoke-chunk-report",
  generateBundle(_o, bundle) {
    const chunks = Object.values(bundle)
      .filter((c) => c.type === "chunk")
      .map((c) => ({ file: c.fileName, isEntry: c.isEntry, imports: c.imports, modules: Object.keys(c.modules) }));
    writeFileSync("chunk-report.json", JSON.stringify(chunks));
  },
};

export default mergeConfig(base, {
  plugins: [chunkReport],
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, "index.html"), custom: resolve(__dirname, "custom.html") },
    },
  },
});
TS
for page in index:main custom:custom; do
  cat > "${page%%:*}.html" <<HTML
<!doctype html>
<html><body><div id="root"></div><script type="module" src="/src/${page##*:}.tsx"></script></body></html>
HTML
done

cat > src/custom.module.css <<'CSS'
.layout { display: grid; grid-template-columns: 280px 1fr; height: 100vh; }
.bar { padding: 8px; }
CSS
cat > src/custom.tsx <<'TSX'
import "@av-pi-studio/ui-library/reset.css";
import "@av-pi-studio/ui-library/styles.css";
import "@av-pi-studio/workbench/styles.css";
import { createRoot } from "react-dom/client";
import {
  createBrowserHost,
  PaneArea,
  SessionList,
  useConnection,
  WorkbenchBoot,
  WorkbenchProvider,
} from "@av-pi-studio/workbench";
import styles from "./custom.module.css";

function ConnectButton() {
  const { status, connect, disconnect } = useConnection();
  return (
    <div className={styles.bar}>
      <span data-smoke-status>{status}</span>{" "}
      {status === "open" ? (
        <button onClick={() => disconnect()}>Disconnect</button>
      ) : (
        <button
          onClick={() =>
            void connect({ url: new URLSearchParams(location.search).get("host") ?? "127.0.0.1:6767" })
          }
        >
          Connect
        </button>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <WorkbenchProvider host={createBrowserHost({ app: { title: "Custom shell", version: "0" } })}>
    <WorkbenchBoot />
    <div className={styles.layout}>
      <aside>
        <ConnectButton />
        <SessionList />
      </aside>
      <PaneArea />
    </div>
  </WorkbenchProvider>,
);
TSX

npm install --no-audit --no-fund --loglevel=error "$TMP"/pack/*.tgz react@^19 react-dom@^19 \
  "pdfjs-dist@$PDFJS_RANGE" "vite@$VITE_RANGE" "@vitejs/plugin-react@$PLUGIN_REACT_RANGE" \
  typescript @types/react@^19 @types/react-dom@^19 >/dev/null || fail "npm install"
pass "npm install of the tarballs"

npx tsc --noEmit || fail "tsc --noEmit (skipLibCheck: false)"
pass "types resolve with skipLibCheck: false (both entries)"

npx vite build >/dev/null || fail "vite build"
pass "vite build (both entries)"

# Heavy libraries live only in lazily loaded chunks: never in an entry or anything it imports
# statically.
node --input-type=module -e '
import { readFileSync } from "node:fs";
const chunks = JSON.parse(readFileSync("chunk-report.json", "utf8"));
const byFile = new Map(chunks.map((c) => [c.file, c]));
const eager = new Set();
const visit = (file) => {
  if (eager.has(file)) return;
  eager.add(file);
  for (const dep of byFile.get(file)?.imports ?? []) visit(dep);
};
for (const c of chunks) if (c.isEntry) visit(c.file);
const heavy = [/node_modules\/mermaid\//, /node_modules\/pdfjs-dist\//, /node_modules\/@molviewer\//, /node_modules\/@shikijs\/langs\//, /node_modules\/shiki\/dist\/langs/];
const leaks = [...eager].flatMap((f) =>
  // `…?worker` is the few-line `new Worker(url)` wrapper the quickstart imports on purpose; the
  // worker code itself is a separate file.
  byFile.get(f).modules.filter((m) => !m.endsWith("?worker") && heavy.some((re) => re.test(m))).map((m) => `${f}: ${m}`),
);
if (leaks.length) { console.error(leaks.slice(0, 10).join("\n")); process.exit(1); }
const lazyHeavy = chunks.filter((c) => !eager.has(c.file) && c.modules.some((m) => heavy.some((re) => re.test(m))));
if (lazyHeavy.length === 0) { console.error("no heavy library found in any lazy chunk (check broken?)"); process.exit(1); }
' || fail "a heavy library is in an eager chunk"
pass "mermaid, shiki languages, pdf.js and the molecule viewer are lazy"

[ -n "$(find dist/assets -name 'CascadiaMono*.woff2')" ] || fail "terminal fonts not emitted as files"
# The workbench's own faces only: the consumer's Vite may legitimately inline a tiny third-party font
# (KaTeX_Size3 is under its default 4 KiB `assetsInlineLimit`), exactly as web-client does.
if grep -oE 'font-family:"?Cascadia[^}]*' dist/assets/*.css | grep -q 'data:font/'; then
  fail "a workbench font was inlined as base64"
fi
pass "workbench fonts emitted as files, none inlined"
[ -n "$(find dist/pdfjs/wasm -type f 2>/dev/null)" ] || fail "pdfjsAssetsPlugin emitted no data"
pass "pdf.js data emitted by the ./vite plugin"

for spec in "@av-pi-studio/workbench/src/index.ts" "@av-pi-studio/workbench/dist/index.js" "@av-pi-studio/workbench/chunks/x.js"; do
  printf 'import "%s";\n' "$spec" > src/deep.ts
  if npx tsc --noEmit >/dev/null 2>&1; then rm src/deep.ts; fail "deep import resolved: $spec"; fi
  rm src/deep.ts
done
pass "deep imports rejected by exports"

# The scratch app's own CSS Module classes never use the workbench's prefix, and the workbench's
# classes are all prefixed, so the two cannot collide.
cat dist/assets/*.css | grep -q '\.piwb-' || fail "built CSS lacks .piwb- classes"
if grep -oE '\._?(layout|bar)_[A-Za-z0-9_-]+' dist/assets/*.css | grep -q 'piwb-'; then
  fail "app CSS Module class uses the piwb- prefix"
fi
pass "workbench classes are piwb- prefixed; app classes are not"

echo "ALL PASS"
