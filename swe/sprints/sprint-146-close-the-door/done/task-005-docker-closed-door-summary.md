# Task 005 — Docker: a required password, and the web image pairs through the relay — Summary

- **Sprint:** sprints/sprint-146-close-the-door
- **Completed:** 2026-11-24
- **Status:** done

## What was implemented
Compose: `PI_STUDIO_PASSWORD: "${PI_STUDIO_PASSWORD:?set PI_STUDIO_PASSWORD}"`; the header comment explains pairing and the password; the web-client service lost `PI_STUDIO_DAEMON_UPSTREAM` and its `depends_on` on the daemon. nginx template: the `/daemon-ws` location and the websocket `map` removed. Web Dockerfile: the upstream env and comment removed. `docker/README.md`, the fern Docker page and the root README: new quick start with the password, CLI command with `--password`, and a recipe to generate a pairing link on the host.

## Files created / changed
| File | Change |
|------|--------|
| `docker/docker-compose.yml`, `web-client.nginx.conf.template`, `web-client.Dockerfile` | as above |
| `docker/README.md`, `fern/pages/configuration/docker.mdx`, `README.md` | docs |

## Build & test results
```
$ docker compose -f docker/docker-compose.yml config            (password unset) -> error: required variable PI_STUDIO_PASSWORD is missing a value: set PI_STUDIO_PASSWORD
$ PI_STUDIO_PASSWORD=x docker compose -f docker/docker-compose.yml config -> ok, password passed through
$ docker run nginx:1.27-alpine nginx -t with the new template   -> syntax ok
$ pairing recipe: daemon on a temp home with the compose relay env, then the CLI with only the home and the same relay env -> printed a relay pairing URL
$ Wave gate (full tree, once, after tasks 001-005): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test`: 329 of 330 files pass, 4727 of 4728 tests pass. The one failure, `packages/server/src/daemon/bootstrap.test.ts` > "extension packs RPC ... full round trip", fails identically on a pristine checkout of HEAD `a6efaa9a` (checked in a temporary worktree), so it is not caused by this sprint. `npm run fmt:check` reports 25 files; the 8 docs/compose files this sprint touched were already unformatted at HEAD.
```

## Acceptance criteria
- [x] Compose config fails with the message when unset, succeeds when set
- [x] No `/daemon-ws` in the nginx template, README or fern
- [ ] `npm run docker:publish -- --dry-run` not run (full image builds); the smoke test only boots the image and curls `/`, and the config passes `nginx -t`

## Follow-ups / TODO(verify)
- The daemon image ships no CLI, so a pairing link needs the host-side recipe in the docs (copying `daemon-keypair.json` out of the volume). A `pair` command in the image would be simpler; not planned.
