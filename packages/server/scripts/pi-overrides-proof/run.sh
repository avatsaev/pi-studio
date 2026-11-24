#!/usr/bin/env bash
# The gate of sprint-139/task-001 (swe/grills/single-binary-daemon.md, open question 3): inside a
# compiled Bun binary with no Node and no npm on the machine, (1) `pi install npm:…` works through the
# `bun` script, (2) a package in BINARY_EXCLUDED_PACKAGES that is already installed is not loaded, and
# (3) the user's Pi settings gain only the entry the user asked to install.
#
#   packages/server/scripts/pi-overrides-proof/run.sh      # needs docker and network
#
# Builds linux-x64 into a scratch folder, runs the steps in a bare debian container, prints one line
# per check and exits non-zero on the first failure.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
OUT="${PROOF_OUT:-$(mktemp -d /tmp/pi-proof.XXXXXX)}"
PI="$ROOT/node_modules/@earendil-works/pi-coding-agent"
mkdir -p "$OUT/bin/theme" "$OUT/bin/assets" "$OUT/bin/export-html/vendor"

echo "== build ($OUT)"
cd "$ROOT"
npx bun build --compile --no-compile-autoload-bunfig --no-compile-autoload-dotenv \
  --target=bun-linux-x64 \
  "$HERE/entry.ts" \
  "$PI/dist/utils/image-resize-worker.js" "$PI/dist/extensions/codemode/worker.js" \
  --outfile "$OUT/bin/pi-proof" >/dev/null

# Pi reads these from the executable's folder (dist/config.js, isBunBinary).
cp "$PI/package.json" "$PI/README.md" "$PI/CHANGELOG.md" "$OUT/bin/"
cp "$PI"/dist/modes/interactive/theme/*.json "$OUT/bin/theme/"
cp "$PI"/dist/modes/interactive/assets/*.png "$OUT/bin/assets/"
cp "$PI"/dist/core/export-html/template.html "$PI"/dist/core/export-html/template.css "$OUT/bin/export-html/"
cp "$PI"/dist/core/export-html/vendor/*.js "$OUT/bin/export-html/vendor/"
cp "$PI/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" "$OUT/bin/"
cp -r "$PI/docs" "$OUT/bin/docs"
# `bun` for Pi's package manager: the same executable, started as Bun.
printf '#!/bin/sh\nBUN_BE_BUN=1 exec "$(dirname "$0")/pi-proof" "$@"\n' >"$OUT/bin/bun"
chmod +x "$OUT/bin/bun" "$OUT/bin/pi-proof"
ls -l "$OUT/bin/pi-proof" | awk '{print "binary bytes:", $5}'

echo "== run in a container with no Node and no npm"
cp "$HERE/container-steps.sh" "$OUT/container-steps.sh"
docker run --rm -v "$OUT:/proof" -e HOME=/tmp/home debian:bookworm-slim bash /proof/container-steps.sh
echo "== done; scratch folder kept at $OUT"
