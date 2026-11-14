#!/usr/bin/env bash
# Deploy `avatsaev/pi-studio-{relay,web-client}` Docker Hub images to production on Dokploy
# (project `molagent`, https://infra.molagent.ai) — relay.molagent.ai and app.molagent.ai.
#
# Pins each compose stack's image to a CONCRETE version tag (default: the repo's current
# `packages/*/package.json` version, e.g. `0.0.13`) rather than deploying against a bare/`:latest`
# reference. This is load-bearing, not cosmetic: Dokploy's deploy command is
# `docker compose up -d --build --remove-orphans` — it never runs `docker compose pull`, and there
# is no exposed API endpoint to force one. Against a bare `image: avatsaev/pi-studio-web-client`
# (implicit `:latest`) that's ALREADY CACHED on the Dokploy host, `up -d` sees nothing changed and
# leaves the stale container running — the deployment reports "done" while silently serving old
# code (real incident: 2026-07-22, `app.molagent.ai` stayed on a two-day-old build after multiple
# "successful" redeploys). Rewriting the compose file's `image:` line to a fresh tag on every
# deploy forces Dokploy to detect a real diff and recreate the container, which DOES pull — see the
# real deploy log evidence: `Image avatsaev/pi-studio-relay:0.0.13 Pulling` → `Pulled` → `Container
# ... Recreate` → `Recreated`, vs. the old bare-tag path's `Container ... Running` (a no-op).
#
# Talks to Dokploy's REST API directly with `curl` (`x-api-key` header) — no `dokploy` CLI. The
# CLI added nothing (`compose update` / `compose redeploy` are one POST each) and its GET helper
# was broken for every read endpoint that takes params (`@dokploy/cli` 0.29.4's `apiGet` omitted
# the superjson `{ json: ... }` wrapper), which forced a half-curl/half-CLI hybrid.
#
# Compose stacks are resolved BY NAME (project `molagent`, composes `relay` and `app`) on every
# run, not by hardcoded id. Dokploy ids change whenever the instance is rebuilt (real incident:
# 2026-11-11 rebuild → every hardcoded id 404'd and the release failed after npm + Docker had
# already published). Rebuilding the stacks under the same names needs no change here.
#
# Credentials: `DOKPLOY_TOKEN` (API key) + `DOKPLOY_URL` (default https://infra.molagent.ai).
# CI sets both from the `DOKPLOY_TOKEN` repo secret. Locally, if `DOKPLOY_TOKEN` is unset, falls
# back to the token/url a prior `dokploy auth` stored, so an authenticated CLI still works.
# Optional naming overrides: `DOKPLOY_PROJECT` (default `molagent`), `DOKPLOY_RELAY_COMPOSE`
# (default `relay`), `DOKPLOY_WEB_CLIENT_COMPOSE` (default `app`).
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

DOKPLOY_PROJECT="${DOKPLOY_PROJECT:-molagent}"
RELAY_COMPOSE_NAME="${DOKPLOY_RELAY_COMPOSE:-relay}"
WEB_CLIENT_COMPOSE_NAME="${DOKPLOY_WEB_CLIENT_COMPOSE:-app}"

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

command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required (JSON parsing)"

if [[ -z "$TAG" ]]; then
  TAG="$(python3 -c "import json; print(json.load(open('$ROOT_DIR/packages/protocol/package.json'))['version'])")"
fi

# Credentials: env first, then whatever `dokploy auth` stored next to the installed CLI.
DOKPLOY_URL="${DOKPLOY_URL:-}"
DOKPLOY_TOKEN="${DOKPLOY_TOKEN:-}"
if [[ -z "$DOKPLOY_TOKEN" ]] && command -v dokploy >/dev/null; then
  cli_config="$(dirname "$(readlink -f "$(command -v dokploy)")")/../config.json"
  if [[ -f "$cli_config" ]]; then
    DOKPLOY_TOKEN="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('token',''))" "$cli_config")"
    [[ -n "$DOKPLOY_URL" ]] || DOKPLOY_URL="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('url',''))" "$cli_config")"
  fi
fi
DOKPLOY_URL="${DOKPLOY_URL:-https://infra.molagent.ai}"
DOKPLOY_URL="${DOKPLOY_URL%/}"
[[ -n "$DOKPLOY_TOKEN" ]] || die "DOKPLOY_TOKEN is not set (Dokploy API key; in CI it comes from the DOKPLOY_TOKEN repo secret)"

# One request to the Dokploy REST API. Prints the response body; on a non-2xx status prints the
# status + body to stderr and returns 1 (curl -f would swallow the body, which is the only place
# Dokploy says why it refused).
api() {
  local method="$1" endpoint="$2" body="${3:-}"
  local tmp status
  tmp="$(mktemp)"
  local args=(-sS -o "$tmp" -w '%{http_code}' -X "$method" -H "x-api-key: $DOKPLOY_TOKEN" "$DOKPLOY_URL/api/$endpoint")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' --data "$body")
  status="$(curl "${args[@]}")" || { rm -f "$tmp"; echo "$method $endpoint: request failed (network)" >&2; return 1; }
  if [[ "$status" != 2* ]]; then
    echo "$method $endpoint: HTTP $status — $(head -c 500 "$tmp")" >&2
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

# Look up a compose stack's id by project + compose name.
resolve_compose_id() {
  local project="$1" name="$2" projects
  projects="$(api GET project.all)" || return 1
  python3 -c "
import json, sys
project, name = sys.argv[1], sys.argv[2]
matches = [
    c['composeId']
    for p in json.load(sys.stdin) if p['name'] == project
    for e in p.get('environments', [])
    for c in e.get('compose', []) if c['name'] == name
]
if len(matches) != 1:
    sys.exit(f'expected exactly one compose {name!r} in project {project!r}, found {len(matches)}')
print(matches[0])
" "$project" "$name" <<<"$projects"
}

current_compose_file() {
  api GET "compose.one?composeId=$1" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['composeFile'], end='')"
}

# Rewrite the compose file's `image: avatsaev/<repo>[:<oldTag>]` line to pin `:<newTag>`, leaving
# everything else (healthcheck, env, restart policy, trailing comments, …) untouched — those live
# in docker/*.Dockerfile + docker/docker-compose.yml, this only ever touches the tag.
pin_image_tag() {
  local compose_file="$1" image_repo="$2" tag="$3"
  python3 -c "
import re, sys
compose, repo, tag = sys.argv[1], sys.argv[2], sys.argv[3]
pattern = re.compile(r'(image:\s*' + re.escape(repo) + r')(:[^\s]+)?')
new_compose, count = pattern.subn(r'\1:' + tag, compose)
if count == 0:
    sys.exit(f'no image line found for {repo!r} in compose file')
print(new_compose, end='')
" "$compose_file" "$image_repo" "$tag"
}

# Newest deployment of a compose stack as `<id> <status>` (`none` when it has never deployed).
# Dokploy reports the error text of a failed deployment on stderr via the same call's body.
latest_deployment() {
  api GET "deployment.allByCompose?composeId=$1" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if not data:
    print('none')
else:
    d = sorted(data, key=lambda x: x['createdAt'])[-1]
    print(d['deploymentId'], d['status'])
    if d.get('errorMessage'):
        print(d['errorMessage'], file=sys.stderr)
"
}

deploy_one() {
  local name="$1" compose_name="$2" image_repo="$3" url="$4"

  log "Resolving $name (project '$DOKPLOY_PROJECT', compose '$compose_name')"
  local compose_id
  compose_id="$(resolve_compose_id "$DOKPLOY_PROJECT" "$compose_name")" || return 1
  echo "$name: compose id $compose_id"

  log "Pinning $name to $image_repo:$TAG"
  local current new
  current="$(current_compose_file "$compose_id")" || return 1
  new="$(pin_image_tag "$current" "$image_repo" "$TAG")" || return 1
  if [[ "$current" == "$new" ]]; then
    echo "$name: compose file already pinned to $image_repo:$TAG — redeploying anyway to be sure"
  fi
  local update_body
  update_body="$(python3 -c "import json,sys; print(json.dumps({'composeId': sys.argv[1], 'composeFile': sys.argv[2]}))" "$compose_id" "$new")"
  api POST compose.update "$update_body" >/dev/null || return 1

  # Remember the newest deployment BEFORE triggering so the poll can tell the new one from it.
  local before before_id
  before="$(latest_deployment "$compose_id" 2>/dev/null)" || return 1
  before_id="${before%% *}"

  log "Redeploying $name — forces a pull+recreate since the compose file just changed"
  local redeploy_body
  redeploy_body="$(python3 -c "import json,sys; print(json.dumps({'composeId': sys.argv[1], 'title': sys.argv[2]}))" \
    "$compose_id" "Deploy $image_repo:$TAG ($(date -u +%Y-%m-%dT%H:%M:%SZ))")"
  api POST compose.redeploy "$redeploy_body" >/dev/null || return 1

  if [[ "$WAIT" != true ]]; then
    echo "$name: redeploy triggered (--no-wait — not polling for completion)"
    return 0
  fi

  echo -n "$name: waiting for deployment to finish"
  local latest id="" status="" err_log
  err_log="$(mktemp)"
  for _ in $(seq 1 100); do
    sleep 3
    echo -n "."
    latest="$(latest_deployment "$compose_id" 2>"$err_log")" || { status="error"; continue; }
    id="${latest%% *}"
    status="${latest#* }"
    # Only a deployment newer than the one seen before the trigger counts.
    [[ "$id" != "$before_id" && ( "$status" == "done" || "$status" == "error" ) ]] && break
    status="running"
  done
  echo

  if [[ "$status" == "done" ]]; then
    echo "$name: deployed successfully — $url"
    rm -f "$err_log"
    return 0
  fi

  echo "$name: deployment ended with status '$status'" >&2
  [[ -s "$err_log" ]] && cat "$err_log" >&2
  rm -f "$err_log"
  return 1
}

log "Checking dokploy access"
api GET project.all >/dev/null || die "cannot reach $DOKPLOY_URL with the configured API key"
echo "authenticated against $DOKPLOY_URL"
echo "target version tag: $TAG"

FAILED=false
for target in "${TARGETS[@]}"; do
  case "$target" in
    relay)
      deploy_one "relay" "$RELAY_COMPOSE_NAME" "avatsaev/pi-studio-relay" "$RELAY_URL" || FAILED=true
      ;;
    web-client)
      deploy_one "web-client" "$WEB_CLIENT_COMPOSE_NAME" "avatsaev/pi-studio-web-client" "$WEB_CLIENT_URL" || FAILED=true
      ;;
  esac
done

if [[ "$FAILED" == true ]]; then
  die "one or more deployments failed — see output above"
fi

log "Done"
