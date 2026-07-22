#!/usr/bin/env bash
# Deploy `avatsaev/pi-studio-{relay,web-client}` Docker Hub images to production on Dokploy
# (project `molagent-platform`, https://infra.molagent.ai) — relay.molagent.ai and app.molagent.ai.
#
# Pins each compose stack's image to a CONCRETE version tag (default: the repo's current
# `packages/*/package.json` version, e.g. `0.0.13`) rather than deploying against a bare/`:latest`
# reference. This is load-bearing, not cosmetic: Dokploy's deploy command is
# `docker compose up -d --build --remove-orphans` — it never runs `docker compose pull`, and there
# is no exposed API/CLI endpoint to force one. Against a bare `image: avatsaev/pi-studio-web-client`
# (implicit `:latest`) that's ALREADY CACHED on the Dokploy host, `up -d` sees nothing changed and
# leaves the stale container running — the deployment reports "done" while silently serving old
# code (real incident: 2026-07-22, `app.molagent.ai` stayed on a two-day-old build after multiple
# "successful" redeploys). Rewriting the compose file's `image:` line to a fresh tag on every
# deploy forces Dokploy to detect a real diff and recreate the container, which DOES pull — see the
# real deploy log evidence: `Image avatsaev/pi-studio-relay:0.0.13 Pulling` → `Pulled` → `Container
# ... Recreate` → `Recreated`, vs. the old bare-tag path's `Container ... Running` (a no-op).
#
# Uses the `dokploy` CLI (https://github.com/Dokploy/cli) for the compose-file update
# (`compose update`) and the deploy trigger (`compose redeploy`) — both POST and work fine — but
# talks to the tRPC API directly via `curl` for status polling — as of `@dokploy/cli` 0.29.4,
# `apiGet` (dist/client.js) builds its query string as `?input=<rawJSON>`, omitting the
# `{ json: ... }` superjson wrapper `apiPost` correctly adds. Every GET-style read endpoint that
# takes params (`compose.one`, `deployment.allByCompose`, `compose.search`, `project.one`, …) 400s
# through the CLI as a result; POST-style ones are unaffected. Confirmed via direct `curl` against
# the same endpoints with the wrapper added — this is a CLI bug, not an auth/access problem. Report
# upstream separately; this script works around it rather than patching the installed package.
#
# Usage:
#   scripts/dokploy-deploy.sh                  # pin+deploy both relay + web-client to the repo's
#                                               # current version, wait for each
#   scripts/dokploy-deploy.sh relay             # relay only
#   scripts/dokploy-deploy.sh web-client        # web-client only
#   scripts/dokploy-deploy.sh --tag 0.0.12      # pin to a specific version instead of the repo's
#                                               # current one (e.g. a hotfix rollback)
#   scripts/dokploy-deploy.sh --no-wait         # trigger deploys, don't poll for completion
#
# Requires the versioned image tag to already exist on Docker Hub — run
# `npm run docker:publish -- --tag <version>` FIRST if it doesn't.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Fixed identifiers for molagent-platform's production environment — stable Dokploy ids, not
# expected to change; re-derive via `dokploy project all --json` if the stacks are ever recreated.
RELAY_COMPOSE_ID="RV5y1KpU45yPzN5ebWbv1"
WEB_CLIENT_COMPOSE_ID="1Y6QjVVev4DOVmuZE-cgi"

RELAY_URL="https://relay.molagent.ai"
WEB_CLIENT_URL="https://app.molagent.ai"

WAIT=true
TAG=""
TARGETS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-wait) WAIT=false; shift ;;
    --tag)
      [[ $# -ge 2 ]] || { echo "--tag requires a value" >&2; exit 1; }
      TAG="$2"
      shift 2
      ;;
    --tag=*) TAG="${1#--tag=}"; shift ;;
    relay) TARGETS+=(relay); shift ;;
    web-client) TARGETS+=(web-client); shift ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [relay|web-client] [--tag <version>] [--no-wait]" >&2
      exit 1
      ;;
  esac
done
[[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=(relay web-client)

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$1" >&2; exit 1; }

command -v dokploy >/dev/null || die "dokploy CLI is required (https://github.com/Dokploy/cli)"
command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required (JSON parsing)"

if [[ -z "$TAG" ]]; then
  TAG="$(python3 -c "import json; print(json.load(open('$ROOT_DIR/packages/protocol/package.json'))['version'])")"
fi

DOKPLOY_CONFIG="$(dirname "$(readlink -f "$(command -v dokploy)")")/../config.json"
[[ -f "$DOKPLOY_CONFIG" ]] || die "dokploy CLI is not authenticated — run 'dokploy auth' first"

DOKPLOY_URL="$(python3 -c "import json; print(json.load(open('$DOKPLOY_CONFIG'))['url'])")"
DOKPLOY_TOKEN="$(python3 -c "import json; print(json.load(open('$DOKPLOY_CONFIG'))['token'])")"

# Direct tRPC GET, working around the CLI's apiGet bug (see header comment).
trpc_get() {
  local endpoint="$1" params_json="$2"
  local input
  input="$(python3 -c "import json,sys,urllib.parse; print(urllib.parse.quote(json.dumps({'json': json.loads(sys.argv[1])})))" "$params_json")"
  curl -sf -H "x-api-key: $DOKPLOY_TOKEN" "$DOKPLOY_URL/api/trpc/$endpoint?input=$input"
}

current_compose_file() {
  local compose_id="$1"
  trpc_get "compose.one" "{\"composeId\":\"$compose_id\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['data']['json']['composeFile'])"
}

# Rewrite the compose file's `image: avatsaev/<repo>[:<oldTag>]` line to pin `:<newTag>`, leaving
# everything else (healthcheck, env, restart policy, …) untouched — those live in
# docker/*.Dockerfile + docker/docker-compose.yml, this only ever touches the tag.
pin_image_tag() {
  local compose_file="$1" image_repo="$2" tag="$3"
  python3 -c "
import re, sys
compose = sys.argv[1]
repo = sys.argv[2]
tag = sys.argv[3]
pattern = re.compile(r'(image:\s*' + re.escape(repo) + r')(:[^\s]+)?')
new_compose, count = pattern.subn(r'\1:' + tag, compose)
if count == 0:
    sys.exit(f'no image line found for {repo!r} in compose file')
print(new_compose, end='')
" "$compose_file" "$image_repo" "$tag"
}

latest_deployment_status() {
  local compose_id="$1"
  trpc_get "deployment.allByCompose" "{\"composeId\":\"$compose_id\"}" \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)['result']['data']['json']
if not data:
    print('none')
else:
    d = sorted(data, key=lambda x: x['createdAt'])[-1]
    print(d['status'])
    if d.get('errorMessage'):
        print(d['errorMessage'], file=sys.stderr)
"
}

deploy_one() {
  local name="$1" compose_id="$2" image_repo="$3" url="$4"

  log "Pinning $name ($compose_id) to $image_repo:$TAG"
  local current new
  current="$(current_compose_file "$compose_id")"
  new="$(pin_image_tag "$current" "$image_repo" "$TAG")"
  if [[ "$current" == "$new" ]]; then
    echo "$name: compose file already pinned to $image_repo:$TAG — redeploying anyway to be sure"
  fi
  dokploy compose update --composeId "$compose_id" --composeFile "$new" >/dev/null

  log "Redeploying $name — forces a pull+recreate since the compose file just changed"
  dokploy compose redeploy --composeId "$compose_id" \
    --title "Deploy $image_repo:$TAG ($(date -u +%Y-%m-%dT%H:%M:%SZ))" >/dev/null

  if [[ "$WAIT" != true ]]; then
    echo "$name: redeploy triggered (--no-wait — not polling for completion)"
    return 0
  fi

  echo -n "$name: waiting for deployment to finish"
  local status="running"
  for _ in $(seq 1 60); do
    sleep 3
    status="$(latest_deployment_status "$compose_id" 2>/tmp/dokploy-deploy-err.log || echo "error")"
    echo -n "."
    [[ "$status" == "done" || "$status" == "error" || "$status" == "none" ]] && break
  done
  echo

  if [[ "$status" == "done" ]]; then
    echo "$name: deployed successfully — $url"
    return 0
  fi

  echo "$name: deployment ended with status '$status'" >&2
  [[ -s /tmp/dokploy-deploy-err.log ]] && cat /tmp/dokploy-deploy-err.log >&2
  return 1
}

log "Checking dokploy auth"
dokploy organization active >/dev/null || die "dokploy CLI is not authenticated — run 'dokploy auth' first"
echo "authenticated against $DOKPLOY_URL"
echo "target version tag: $TAG"

FAILED=false
for target in "${TARGETS[@]}"; do
  case "$target" in
    relay)
      deploy_one "relay" "$RELAY_COMPOSE_ID" "avatsaev/pi-studio-relay" "$RELAY_URL" || FAILED=true
      ;;
    web-client)
      deploy_one "web-client" "$WEB_CLIENT_COMPOSE_ID" "avatsaev/pi-studio-web-client" "$WEB_CLIENT_URL" || FAILED=true
      ;;
  esac
done

if [[ "$FAILED" == true ]]; then
  die "one or more deployments failed — see output above"
fi

log "Done"
