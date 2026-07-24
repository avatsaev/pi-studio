---
name: publish-and-release
description: Use when the user asks to "publish and deploy", "release", "ship it", "push a release", or similar for pi-studio — runs the full npm publish -> Docker build/push -> Dokploy production deploy pipeline with minimal back-and-forth. Also use for a partial release (npm only, docker only, one service only, dry-run).
---

# Publish and release pi-studio

One command ships everything: `npm run release` (root `scripts/release.sh`), chaining three
independently-idempotent scripts in order — npm publish, Docker build+push, Dokploy production
deploy. Root `AGENTS.md` § "Release & production deployment" is the source of truth for every
flag and requirement below; this file is the AGENT execution playbook on top of it — how to run
it efficiently, what to check first, and how to read the (very noisy) output without flooding
context.

## 0. Preconditions — check ALL of these before running anything

Run in parallel (one bash cell, several commands):

```bash
git status --short              # MUST be empty — publish.sh aborts on a dirty tree
npm whoami                       # MUST print a username — npm publish needs this
docker info 2>&1 | grep -i username   # MUST show a logged-in docker user
dokploy organization active      # MUST print org JSON, not an error
```

If the working tree is dirty: commit or ask the user first — do not stash/discard without asking.
If any auth check fails, stop and tell the user exactly which one (don't guess credentials).

## 1. Run the pipeline

Default ("publish and deploy everything", the common case):

```bash
npm run release
```

This bumps every workspace package's patch version, rebuilds+typechecks+tests, publishes to npm,
builds+boot-smoke-tests+pushes the three Docker images (`avatsaev/pi-studio-{relay,daemon,
web-client}`) tagged both `:<version>` and `:latest`, then pins and redeploys the `relay` and
`web-client` Dokploy compose stacks to that concrete version tag and polls each to completion.

**Always run it as a background `hub` job, not inline `bash`** — it takes ~2 minutes and step 2's
`docker push` progress bars alone produce tens of thousands of characters of repetitive
"Waiting/Pushing/Layer already exists" noise that will blow out the transcript if streamed live:

```
hub start name=release-run application=npm args=["run","release"] cwd=<repo root> persist=true
```

Then poll for completion instead of following logs live:

```
hub wait name=release-run for=exit timeout=180
```

If it's still running after 180s, `hub wait` again (each `npm run publish` + full monorepo build +
test run legitimately takes 60-90s before Docker even starts) — do not assume a hang.

## 2. Read the result without flooding context

Once `release-run` has exited, do NOT dump the full log by default — pull only the section
headers and tail, which is enough to confirm success or locate a failure:

```
hub logs name=release-run grep="##########|deployed successfully|Error:|npm error" lines=200
```

- Success looks like three `##########` banners (`1/3 npm publish`, `2/3 docker publish`,
  `3/3 production deploy`) ending in `Release <version> complete`, with both
  `relay: deployed successfully` and `web-client: deployed successfully` lines.
- `set -euo pipefail` means the script stops at the FIRST failure — a non-zero exit means read the
  ~30 lines right before the exit, not the whole log.

## 3. Verify production afterward — always, don't just trust "deployed successfully"

```bash
npm view @av-pi-studio/server version        # should equal the version just released
curl -sf https://relay.molagent.ai/health && echo         # should print "ok"
curl -sfo /dev/null -w "HTTP %{http_code}\n" https://app.molagent.ai/   # should print 200
```

Report the actual verified values to the user, not just "it said success."

## Partial releases — forward flags after `--`

| User asks for | Command |
|---|---|
| Just publish npm, no deploy | `npm run release -- --skip-docker --skip-deploy` |
| npm already done, finish docker+deploy | `npm run release -- --skip-npm` |
| Only redeploy one service (images already pushed) | `npm run release -- --skip-npm --skip-docker relay` or `... web-client` |
| Preview without publishing/pushing/deploying | `npm run release -- --dry-run` (steps 1+2 dry-run; step 3 is skipped entirely — nothing was pushed for it to deploy) |
| Republish current version, no version bump | `npm run release -- --no-bump` |
| Trigger deploy but don't poll for completion | `npm run release -- --no-wait` (only affects step 3) |

Every step is independently re-runnable — a failure in step 2 or 3 does NOT require re-running
step 1 (`--skip-npm` picks up whatever version is already on disk in `packages/protocol/
package.json`).

## Gotchas

- **Never let step 3 deploy a bare `:latest` reference** — this script already avoids that itself
  (it always rewrites the compose file to the concrete version tag before redeploying, per root
  `AGENTS.md`'s documented 2026-07-22 incident), so don't "simplify" this by hand-rolling a
  `dokploy compose redeploy` call without first pinning the tag.
- **The daemon image is built and pushed but never deployed by step 3** — only `relay` and
  `web-client` run on Dokploy (`molagent-platform`); the daemon is self-hosted per user. Don't treat
  a missing "daemon: deployed" line as a failure.
- **Docker push output repeats the same layer list dozens of times** (progress re-renders) — this
  is normal `docker push` TTY behavior being captured non-interactively, not a hang or a retry loop.
- Auth for all three steps (npm, docker, dokploy) is checked by the scripts themselves and they
  fail fast with a clear message — but checking it yourself FIRST (step 0) avoids burning ~90s of
  build+test time before discovering an avoidable auth failure.
