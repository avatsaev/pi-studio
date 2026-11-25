#!/usr/bin/env bash
# Publish the Pi-Studio packages to npm.
#
# - Publishes the version in packages/*/package.json; it never changes it. In CI that is the
#   release's version, written by `scripts/set-version.mjs next` (the committed one is only a
#   floor); locally it is the committed one. Every workspace package stays on one aligned version
#   number (web-client shows its own version in the UI), even though only the five packages below
#   are pushed to the registry. workbench, ui-library and web-client are private (built from
#   source by the desktop app and the web-client image).
# - Refuses to run when the lockstep versions or the published packages' internal
#   "@av-pi-studio/*" ranges do not match that version.
# - Builds, typechecks, and tests before publishing anything.
# - Publishes the packages to npm in dependency order (protocol/relay have no workspace deps and
#   go first; client depends on protocol+relay; server/cli depend on the others and go last).
#   A package already on npm at this version is skipped, so a re-run is safe.
#
# Usage:
#   npm run publish                 # publish the committed version
#   npm run publish -- --dry-run    # do everything except the actual `npm publish`
#
# Requires: npm login locally (interactive; the registry may prompt for 2FA/OTP). In GitHub
# Actions no login is needed: publishing uses npm trusted publishing (OIDC, `id-token: write`).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Packages actually published to the npm registry, in dependency order. They must not depend on
# any private workspace package.
PUBLISH_ORDER=(protocol relay client server cli)

# Every versioned workspace package, kept in version lockstep (scripts/set-version.mjs sets them).
# The private ones (ui-library workbench web-client) are versioned but never published.
ALL_PACKAGES=(protocol relay client server cli ui-library workbench web-client)

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--dry-run]" >&2
      exit 1
      ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"

log "Checking npm auth"
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  # Trusted publishing: the OIDC token is exchanged at publish time; `npm whoami` has no login.
  echo "Running in GitHub Actions — publishing via npm trusted publishing (OIDC)"
elif ! npm whoami >/dev/null 2>&1; then
  die "not logged into npm — run 'npm login' first"
else
  echo "Logged in as $(npm whoami)"
fi

log "Checking git working tree"
# CI runs this after `set-version.mjs next`, which leaves the tree modified on purpose.
if [[ "${GITHUB_ACTIONS:-}" != "true" && -n "$(git status --porcelain)" ]]; then
  die "working tree is not clean — commit or stash changes before publishing"
fi

# --- Version ------------------------------------------------------------------------------------
#
# This script never changes a version: it publishes the one in packages/*/package.json. In CI
# `scripts/set-version.mjs next` has just written the release's version there (the committed one
# is only a floor); locally it is the committed one. Move the floor with
# `npm run version:set -- patch|minor|major|x.y.z` and commit.

NEXT_VERSION="$(node -e "console.log(require('./packages/protocol/package.json').version)")"
log "Publishing version $NEXT_VERSION"

# The lockstep and the published packages' internal ranges must match the version, or a package
# would be published against a dependency version that is not the one released with it.
node -e "
  const fs = require('fs');
  const version = '$NEXT_VERSION';
  const all = '${ALL_PACKAGES[*]}'.split(' ');
  const published = '${PUBLISH_ORDER[*]}'.split(' ');
  const problems = [];
  for (const pkg of all) {
    const p = JSON.parse(fs.readFileSync('packages/' + pkg + '/package.json', 'utf8'));
    if (p.version !== version) problems.push(pkg + ' is at ' + p.version);
    if (!published.includes(pkg)) continue;
    for (const key of ['dependencies', 'devDependencies']) {
      for (const [dep, range] of Object.entries(p[key] ?? {})) {
        if (dep.startsWith('@av-pi-studio/') && range !== '^' + version) {
          problems.push(pkg + ' depends on ' + dep + '@' + range);
        }
      }
    }
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
" || die "package versions are not in lockstep at $NEXT_VERSION (listed above) — fix those package.json files (npm run version:set moves all of them together)"

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
# raw.githubusercontent was not usable when this was written: the repo was private then, so those
# URLs 404ed for the anonymous visitors reading the package page (it is public now; this stays
# because the URLs below are pinned to a version). The images ship inside the tarball (each
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
  # Idempotent re-runs: a previous run may have published some packages before failing (e.g. a
  # missing trusted-publisher registration on a later one). Re-publishing a version is an error.
  if [[ "$DRY_RUN" != true ]] && npm view "@av-pi-studio/$pkg@$NEXT_VERSION" version >/dev/null 2>&1; then
    echo "already on npm — skipping"
    continue
  fi
  if [[ "$DRY_RUN" == true ]]; then
    npm publish --dry-run --access public -w "packages/$pkg"
  else
    npm publish --access public -w "packages/$pkg"
  fi
done

if [[ "$DRY_RUN" == true ]]; then
  log "Dry run complete — nothing was actually published."
else
  log "Published @av-pi-studio/{${PUBLISH_ORDER[*]// /,}}@$NEXT_VERSION"
fi
