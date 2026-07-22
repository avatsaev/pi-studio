#!/usr/bin/env bash
# Full release pipeline — chains the three existing, independent release scripts in order:
#
#   1. scripts/publish.sh          — bump + publish npm packages
#   2. scripts/docker-publish.sh   — build + push Docker images, tagged to match step 1's version
#   3. scripts/dokploy-deploy.sh   — pin + deploy relay/web-client to production on that same tag
#
# This is pure orchestration — no new logic. Each step is still independently idempotent and
# runnable on its own (`npm run publish`, `npm run docker:publish`, `npm run docker:deploy`); this
# script exists so a single command can carry a fresh version end-to-end from "clean working tree"
# to "live in production" without hand-copying the version number between steps.
#
# Usage:
#   scripts/release.sh                  # full pipeline: publish npm -> publish docker -> deploy
#   scripts/release.sh --dry-run        # steps 1+2 in dry-run mode; step 3 is SKIPPED (nothing
#                                        # would actually be pushed for it to deploy)
#   scripts/release.sh --no-bump        # publish the current npm version as-is (forwarded to
#                                        # publish.sh) instead of bumping the patch version
#   scripts/release.sh --skip-npm       # skip step 1 (npm already published); steps 2+3 use the
#                                        # CURRENT packages/protocol/package.json version
#   scripts/release.sh --skip-docker    # skip step 2 (images already pushed for this version)
#   scripts/release.sh --skip-deploy    # skip step 3 (publish only, deploy separately/later)
#   scripts/release.sh --install-gh     # forwarded to docker-publish.sh (bundle GitHub CLI)
#   scripts/release.sh --no-wait        # forwarded to dokploy-deploy.sh (trigger, don't poll)
#   scripts/release.sh relay            # forwarded to dokploy-deploy.sh (deploy relay only)
#   scripts/release.sh web-client        # forwarded to dokploy-deploy.sh (deploy web-client only)
#
# Requires everything the three underlying scripts each require: npm login, docker login with
# push access, and the `dokploy` CLI installed + authenticated (`dokploy auth`).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=false
NO_BUMP=false
SKIP_NPM=false
SKIP_DOCKER=false
SKIP_DEPLOY=false
INSTALL_GH=false
NO_WAIT=false
DEPLOY_TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --no-bump) NO_BUMP=true; shift ;;
    --skip-npm) SKIP_NPM=true; shift ;;
    --skip-docker) SKIP_DOCKER=true; shift ;;
    --skip-deploy) SKIP_DEPLOY=true; shift ;;
    --install-gh) INSTALL_GH=true; shift ;;
    --no-wait) NO_WAIT=true; shift ;;
    relay) DEPLOY_TARGETS+=(relay); shift ;;
    web-client) DEPLOY_TARGETS+=(web-client); shift ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [relay|web-client] [--dry-run] [--no-bump] [--skip-npm] [--skip-docker] [--skip-deploy] [--install-gh] [--no-wait]" >&2
      exit 1
      ;;
  esac
done

log() { printf '\n\033[1;35m########## %s ##########\033[0m\n' "$1"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

# --- Step 1: npm publish ------------------------------------------------------------------------

if [[ "$SKIP_NPM" == true ]]; then
  log "1/3 npm publish — SKIPPED (--skip-npm)"
else
  log "1/3 npm publish"
  publish_args=()
  [[ "$DRY_RUN" == true ]] && publish_args+=(--dry-run)
  [[ "$NO_BUMP" == true ]] && publish_args+=(--no-bump)
  bash scripts/publish.sh "${publish_args[@]}"
fi

# Version driving steps 2+3 — always re-read from disk (not captured from step 1's stdout) so
# --skip-npm correctly picks up whatever is already there, and a real (non-dry-run) bump in step 1
# is correctly reflected even though `--dry-run` still bumps the on-disk version (see
# publish.sh's own dry-run note: version files are bumped either way, only the registry push is
# skipped).
VERSION="$(node -e "console.log(require('./packages/protocol/package.json').version)")"
log "Release version: $VERSION"

# --- Step 2: docker publish ----------------------------------------------------------------------

if [[ "$SKIP_DOCKER" == true ]]; then
  log "2/3 docker publish — SKIPPED (--skip-docker)"
else
  log "2/3 docker publish (tag $VERSION)"
  docker_args=(--tag "$VERSION")
  [[ "$DRY_RUN" == true ]] && docker_args+=(--dry-run)
  [[ "$INSTALL_GH" == true ]] && docker_args+=(--install-gh)
  bash scripts/docker-publish.sh "${docker_args[@]}"
fi

# --- Step 3: production deploy -------------------------------------------------------------------

if [[ "$DRY_RUN" == true ]]; then
  log "3/3 production deploy — SKIPPED (--dry-run: nothing new was pushed for it to deploy)"
elif [[ "$SKIP_DEPLOY" == true ]]; then
  log "3/3 production deploy — SKIPPED (--skip-deploy)"
else
  log "3/3 production deploy (tag $VERSION)"
  deploy_args=(--tag "$VERSION")
  [[ "$NO_WAIT" == true ]] && deploy_args+=(--no-wait)
  deploy_args+=("${DEPLOY_TARGETS[@]}")
  bash scripts/dokploy-deploy.sh "${deploy_args[@]}"
fi

log "Release $VERSION complete"
