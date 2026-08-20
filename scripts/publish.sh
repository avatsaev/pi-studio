#!/usr/bin/env bash
# Publish the Pi-Studio library packages to npm.
#
# - Bumps the patch version of EVERY workspace package so the whole monorepo stays on one
#   aligned version number, even though only the library packages below are actually pushed to
#   the registry.
# - Rewrites internal "@av-pi-studio/*" dependency ranges to match the new version.
# - Builds, typechecks, and tests before publishing anything.
# - Publishes the library packages to npm in dependency order (protocol/highlight/relay have no
#   workspace deps and go first; client depends on protocol+relay; web-client is a static-asset
#   dependency of cli, built and published before it; server/cli depend on the others and go last).
#
# Usage:
#   npm run publish                 # bump patch + publish everything below
#   npm run publish -- --dry-run    # do everything except the actual `npm publish`
#   npm run publish -- --no-bump    # publish the current versions as-is (no version bump)
#
# Requires: npm login (interactive; the registry may prompt for 2FA/OTP).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Packages actually published to the npm registry, in dependency order.
PUBLISH_ORDER=(protocol highlight relay client web-client server cli)

# Every workspace package, kept in version lockstep even though desktop is not published
# (desktop is an empty placeholder).
ALL_PACKAGES=(protocol highlight relay client server cli desktop web-client)

DRY_RUN=false
BUMP=true
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-bump) BUMP=false ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--dry-run] [--no-bump]" >&2
      exit 1
      ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"

log "Checking npm auth"
if ! npm whoami >/dev/null 2>&1; then
  die "not logged into npm — run 'npm login' first"
fi
echo "Logged in as $(npm whoami)"

log "Checking git working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is not clean — commit or stash changes before publishing"
fi

# --- Version bump -----------------------------------------------------------------------------

if [[ "$BUMP" == true ]]; then
  log "Bumping patch version for all packages"

  # Compute the single next version from protocol's current version (all packages are kept
  # aligned, so any one of them is representative of "the current version").
  NEXT_VERSION="$(node -e "
    const p = require('./packages/protocol/package.json');
    const [maj, min, patch] = p.version.split('.').map(Number);
    console.log(\`\${maj}.\${min}.\${patch + 1}\`);
  ")"
  echo "New version: $NEXT_VERSION"

  for pkg in "${ALL_PACKAGES[@]}"; do
    node -e "
      const fs = require('fs');
      const path = 'packages/$pkg/package.json';
      const p = JSON.parse(fs.readFileSync(path, 'utf8'));
      p.version = '$NEXT_VERSION';
      for (const depsKey of ['dependencies', 'devDependencies']) {
        if (!p[depsKey]) continue;
        for (const dep of Object.keys(p[depsKey])) {
          if (dep.startsWith('@av-pi-studio/')) p[depsKey][dep] = '^$NEXT_VERSION';
        }
      }
      fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\n');
    "
  done

  log "Syncing lockfile"
  npm install >/dev/null
else
  NEXT_VERSION="$(node -e "console.log(require('./packages/protocol/package.json').version)")"
  log "Publishing existing version $NEXT_VERSION (--no-bump)"
fi

# --- Verify ------------------------------------------------------------------------------------

log "Clean build"
npm run clean >/dev/null
npm run build

log "Typecheck"
npm run typecheck

log "Test suite"
npm test

# --- README image URLs -------------------------------------------------------------------------
#
# npmjs.com renders README.md through GitHub's GFM API, which carries no repo context: a relative
# image path (`assets/screenshots/x.webp`) resolves against nothing there and renders broken, even
# though it works on github.com. npm's old marky-markdown used to rewrite relative image paths to
# raw.githubusercontent equivalents; the current GFM-API rendering does not, and
# `repository.directory` only improves the source link (npm RFC #10), not image URLs.
#
# raw.githubusercontent is NOT usable here: this repo is PRIVATE, so those URLs 404 for the
# anonymous visitors reading the package page. Instead the images ship inside the tarball (each
# such package lists "assets" in its "files") and the registry README points at jsDelivr, which
# mirrors published npm packages publicly and needs no auth:
#   https://cdn.jsdelivr.net/npm/@av-pi-studio/<pkg>@<version>/assets/...
# Pinned to the exact version being published, so a given package page always renders the images
# that shipped with it and can never drift.
#
# The in-repo README keeps its relative paths (what github.com needs). The trap restores every
# rewritten file unconditionally, so an aborted or failed publish never leaves a rewritten README
# behind in the working tree.
REWRITTEN_READMES=()
restore_readmes() {
  local f
  for f in ${REWRITTEN_READMES[@]+"${REWRITTEN_READMES[@]}"}; do
    [[ -f "$f.orig" ]] && mv -f "$f.orig" "$f"
  done
}
trap restore_readmes EXIT

log "Rewriting relative README image URLs for the registry"
for pkg in "${PUBLISH_ORDER[@]}"; do
  readme="packages/$pkg/README.md"
  [[ -f "$readme" ]] || continue
  grep -q 'src="assets/' "$readme" || continue
  node -e "
    const p = require('./packages/$pkg/package.json');
    const files = p.files ?? [];
    if (!files.includes('assets')) {
      console.error('packages/$pkg/README.md references assets/ but packages/$pkg/package.json');
      console.error('does not list \"assets\" in \"files\" — the images would 404 on jsDelivr.');
      process.exit(1);
    }
  " || die "packages/$pkg: add \"assets\" to \"files\" before publishing"
  cp "$readme" "$readme.orig"
  REWRITTEN_READMES+=("$readme")
  CDN_BASE="https://cdn.jsdelivr.net/npm/@av-pi-studio/$pkg@$NEXT_VERSION"
  node -e "
    const fs = require('fs');
    const path = 'packages/$pkg/README.md';
    const base = '$CDN_BASE';
    const src = fs.readFileSync(path, 'utf8');
    fs.writeFileSync(path, src.replaceAll('src=\"assets/', \`src=\"\${base}/assets/\`));
  "
  echo "  $readme -> $CDN_BASE/assets/..."
done

# --- Publish -------------------------------------------------------------------------------------

log "Publishing to npm (dependency order: ${PUBLISH_ORDER[*]})"
for pkg in "${PUBLISH_ORDER[@]}"; do
  echo
  echo "--- @av-pi-studio/$pkg@$NEXT_VERSION ---"
  if [[ "$DRY_RUN" == true ]]; then
    npm publish --dry-run --access public -w "packages/$pkg"
  else
    npm publish --access public -w "packages/$pkg"
  fi
done

if [[ "$DRY_RUN" == true ]]; then
  log "Dry run complete — nothing was actually published. Version files were still bumped; revert with git checkout if needed."
else
  log "Published @av-pi-studio/{${PUBLISH_ORDER[*]// /,}}@$NEXT_VERSION"
  echo "Don't forget to commit the version bump: git add -A && git commit -m \"chore: release $NEXT_VERSION\""
fi
