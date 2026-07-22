#!/usr/bin/env bash
# Build the three Pi-Studio Docker images from local monorepo source and push them to their
# Docker Hub repos under the `avatsaev` namespace.
#
# - Builds all three images (build context is the repo root — workspace deps resolve there).
# - Boot-smoke-tests the web-client image (runs it detached on a scratch port, curls for a 200)
#   before pushing anything — a broken nginx/SPA bundle must never reach the registry.
# - Tags each image `avatsaev/<repo>:latest` (plus `:<tag>` if `--tag` is given) and pushes both.
#
# Usage:
#   scripts/docker-publish.sh                  # build + smoke-test + push :latest
#   scripts/docker-publish.sh --tag 0.0.12      # also tag + push :0.0.12 alongside :latest
#   scripts/docker-publish.sh --dry-run         # build + smoke-test, skip the actual push
#   scripts/docker-publish.sh --no-build        # skip the build step, push whatever images exist
#   scripts/docker-publish.sh --install-gh      # bundle the GitHub CLI into the daemon image
#
# Requires: docker logged in (`docker login`) with push access to the `avatsaev/*` repos below.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Local build tag -> Docker Hub repo, in the order the compose stack starts them (relay has no
# dependents, so it goes first; daemon and web-client can build in either order after that).
declare -A REPOS=(
  [pi-studio-relay]="avatsaev/pi-studio-relay"
  [pi-studio-daemon]="avatsaev/pi-studio-daemon"
  [pi-studio-web-client]="avatsaev/pi-studio-web-client"
)
BUILD_ORDER=(pi-studio-relay pi-studio-daemon pi-studio-web-client)

DRY_RUN=false
BUILD=true
INSTALL_GH=false
EXTRA_TAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --no-build) BUILD=false; shift ;;
    --install-gh) INSTALL_GH=true; shift ;;
    --tag)
      [[ $# -ge 2 ]] || { echo "--tag requires a value" >&2; exit 1; }
      EXTRA_TAG="$2"
      shift 2
      ;;
    --tag=*) EXTRA_TAG="${1#--tag=}"; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--tag <version>] [--dry-run] [--no-build] [--install-gh]" >&2
      exit 1
      ;;
  esac
done

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v docker >/dev/null || die "docker is required"

log "Checking docker auth"
DOCKER_USER="$(docker info 2>/dev/null | sed -n 's/^ *Username: *//p')"
if [[ -z "$DOCKER_USER" ]]; then
  die "not logged into Docker Hub — run 'docker login' first"
fi
echo "Logged in as $DOCKER_USER"

# --- Build --------------------------------------------------------------------------------------

if [[ "$BUILD" == true ]]; then
  log "Building pi-studio-relay"
  docker build -f docker/relay.Dockerfile -t pi-studio-relay .

  log "Building pi-studio-daemon (INSTALL_GH=$INSTALL_GH)"
  docker build -f docker/daemon.Dockerfile --build-arg "INSTALL_GH=$INSTALL_GH" -t pi-studio-daemon .

  log "Building pi-studio-web-client"
  docker build -f docker/web-client.Dockerfile -t pi-studio-web-client .
else
  log "Skipping build (--no-build) — using existing local images"
  for image in "${BUILD_ORDER[@]}"; do
    docker image inspect "$image" >/dev/null 2>&1 || die "local image '$image' not found — build it first or drop --no-build"
  done
fi

# --- Smoke test (web-client) --------------------------------------------------------------------

log "Boot smoke test: pi-studio-web-client"
SMOKE_CONTAINER="pi-studio-web-client-smoke-$$"
SMOKE_PORT=18080
docker run -d --rm --name "$SMOKE_CONTAINER" -p "$SMOKE_PORT:8080" pi-studio-web-client >/dev/null
cleanup_smoke() { docker rm -f "$SMOKE_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup_smoke EXIT

SMOKE_OK=false
for _ in $(seq 1 15); do
  sleep 1
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/" || true)"
  if [[ "$CODE" == "200" ]]; then
    SMOKE_OK=true
    break
  fi
done
cleanup_smoke
trap - EXIT

if [[ "$SMOKE_OK" != true ]]; then
  die "web-client smoke test failed — nginx never returned 200 on :$SMOKE_PORT"
fi
echo "web-client smoke test passed (200 on :$SMOKE_PORT)"

# --- Tag + push ----------------------------------------------------------------------------------

log "Tagging images"
for local_tag in "${BUILD_ORDER[@]}"; do
  repo="${REPOS[$local_tag]}"
  docker tag "$local_tag" "$repo:latest"
  echo "$local_tag -> $repo:latest"
  if [[ -n "$EXTRA_TAG" ]]; then
    docker tag "$local_tag" "$repo:$EXTRA_TAG"
    echo "$local_tag -> $repo:$EXTRA_TAG"
  fi
done

if [[ "$DRY_RUN" == true ]]; then
  log "Dry run complete — images built, smoke-tested, and tagged locally. Nothing was pushed."
  exit 0
fi

log "Pushing to Docker Hub"
for local_tag in "${BUILD_ORDER[@]}"; do
  repo="${REPOS[$local_tag]}"
  echo
  echo "--- $repo:latest ---"
  docker push "$repo:latest"
  if [[ -n "$EXTRA_TAG" ]]; then
    echo "--- $repo:$EXTRA_TAG ---"
    docker push "$repo:$EXTRA_TAG"
  fi
done

log "Pushed avatsaev/{${BUILD_ORDER[*]// /,}}:latest${EXTRA_TAG:+ and :$EXTRA_TAG}"
