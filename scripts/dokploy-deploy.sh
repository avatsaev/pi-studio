#!/usr/bin/env bash
# Deploy the latest `avatsaev/pi-studio-{relay,web-client}` Docker Hub images to production on
# Dokploy (project `molagent-platform`, https://infra.molagent.ai) — relay.molagent.ai and
# app.molagent.ai. Both compose stacks reference their image with no tag (implicit `:latest`), so
# a plain Dokploy redeploy re-pulls the current `:latest` digest and restarts the service; there is
# no compose-file/tag edit needed here as long as `scripts/docker-publish.sh` already pushed fresh
# `:latest` images (run that FIRST if you haven't).
#
# Uses the `dokploy` CLI (https://github.com/Dokploy/cli) for the actual deploy trigger
# (`compose redeploy`, which POSTs and works fine) but talks to the tRPC API directly via `curl`
# for status polling — as of `@dokploy/cli` 0.29.4, `apiGet` (dist/client.js) builds its query
# string as `?input=<rawJSON>`, omitting the `{ json: ... }` superjson wrapper `apiPost` correctly
# adds. Every GET-style read endpoint that takes params (`compose.one`, `deployment.allByCompose`,
# `compose.search`, `project.one`, …) 400s through the CLI as a result; POST-style ones
# (`compose.redeploy`, `project.all`) are unaffected. Confirmed via direct `curl` against the same
# endpoints with the wrapper added — this is a CLI bug, not an auth/access problem. Report upstream
# separately; this script works around it rather than patching the installed package.
#
# Usage:
#   scripts/dokploy-deploy.sh                  # redeploy both relay + web-client, wait for each
#   scripts/dokploy-deploy.sh relay             # redeploy relay only
#   scripts/dokploy-deploy.sh web-client        # redeploy web-client only
#   scripts/dokploy-deploy.sh --no-wait         # trigger redeploys, don't poll for completion
set -euo pipefail

# Fixed identifiers for molagent-platform's production environment — stable Dokploy ids, not
# expected to change; re-derive via `dokploy project all --json` if the stacks are ever recreated.
RELAY_COMPOSE_ID="RV5y1KpU45yPzN5ebWbv1"
WEB_CLIENT_COMPOSE_ID="1Y6QjVVev4DOVmuZE-cgi"

RELAY_URL="https://relay.molagent.ai"
WEB_CLIENT_URL="https://app.molagent.ai"

WAIT=true
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --no-wait) WAIT=false ;;
    relay) TARGETS+=(relay) ;;
    web-client) TARGETS+=(web-client) ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [relay|web-client] [--no-wait]" >&2
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
  local name="$1" compose_id="$2" url="$3"
  log "Redeploying $name ($compose_id) — pulls the current :latest digest and restarts"
  dokploy compose redeploy --composeId "$compose_id" --title "Redeploy latest image ($(date -u +%Y-%m-%dT%H:%M:%SZ))" >/dev/null

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

FAILED=false
for target in "${TARGETS[@]}"; do
  case "$target" in
    relay)
      deploy_one "relay" "$RELAY_COMPOSE_ID" "$RELAY_URL" || FAILED=true
      ;;
    web-client)
      deploy_one "web-client" "$WEB_CLIENT_COMPOSE_ID" "$WEB_CLIENT_URL" || FAILED=true
      ;;
  esac
done

if [[ "$FAILED" == true ]]; then
  die "one or more deployments failed — see output above"
fi

log "Done"
