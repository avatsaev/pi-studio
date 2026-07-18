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
      if (p.dependencies) {
        for (const dep of Object.keys(p.dependencies)) {
          if (dep.startsWith('@av-pi-studio/')) p.dependencies[dep] = '^$NEXT_VERSION';
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
