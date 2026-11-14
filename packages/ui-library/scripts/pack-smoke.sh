#!/usr/bin/env bash
# Packs @av-pi-studio/ui-library, installs it into a scratch Vite+React+TS app outside the repo
# using the README quickstart snippet, and asserts consumer-facing behaviour. KEEP_DIR=1 keeps it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PKG="$ROOT/packages/ui-library"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ui-library-smoke.XXXXXX")"
cleanup() {
  if [ "${KEEP_DIR:-}" = "1" ]; then echo "KEEP_DIR: $TMP"; else rm -rf "$TMP"; fi
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$PKG/dist/index.js" ] || (cd "$ROOT" && npm run build -w packages/ui-library)

mkdir -p "$TMP/pack" "$TMP/app/src"
(cd "$PKG" && npm pack --pack-destination "$TMP/pack" >/dev/null 2>&1)
TARBALL="$(ls "$TMP"/pack/*.tgz)"

cd "$TMP/app"
cat > package.json <<'JSON'
{ "name": "smoke-app", "private": true, "version": "0.0.0", "type": "module" }
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
cat > index.html <<'HTML'
<!doctype html>
<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
HTML
cat > vite.config.ts <<'TS'
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({ plugins: [react()] });
TS
# Quickstart snippet comes straight from the README.
awk '/<!-- smoke:main.tsx -->/{f=1;next} /<!-- \/smoke:main.tsx -->/{f=0} f' "$PKG/README.md" \
  | sed '/^```/d' > src/main.tsx
[ -s src/main.tsx ] || fail "README snippet not extracted"

npm install --no-audit --no-fund --loglevel=error "$TARBALL" react react-dom \
  vite @vitejs/plugin-react typescript @types/react @types/react-dom >/dev/null
pass "npm install of tarball"

npx tsc --noEmit || fail "tsc --noEmit"
pass "types resolve (tsc --noEmit)"

npx vite build >/dev/null || fail "vite build"
pass "vite build"

# (a) deep imports rejected by exports
for spec in "@av-pi-studio/ui-library/src/index.ts" "@av-pi-studio/ui-library/dist/index.js"; do
  if node --input-type=module -e "import('$spec')" >/dev/null 2>&1; then
    fail "deep import resolved: $spec"
  fi
  printf 'import "%s";\n' "$spec" > src/deep.ts
  if npx tsc --noEmit >/dev/null 2>&1; then rm src/deep.ts; fail "tsc resolved deep import: $spec"; fi
  rm src/deep.ts
done
pass "deep imports rejected by exports"

# (b) built CSS carries piui- classes
cat dist/assets/*.css | grep -q '\.piui-' || fail "built CSS lacks .piui-"
pass "built CSS contains .piui-"

# (c) no dev warnings in production bundle
if grep -rqE 'styles\.css is not loaded|More than one ThemeBoundary' dist/assets/*.js; then
  fail "production bundle contains dev warning strings"
fi
pass "production bundle free of dev warnings"

# (d) css subpaths resolve
node --input-type=module -e "
import { createRequire } from 'node:module';
const r = import.meta.resolve;
for (const s of ['reset.css','styles.css']) r('@av-pi-studio/ui-library/'+s);
" || fail "css subpaths"
pass "reset.css / styles.css resolve"

echo "ALL PASS"
