# Task 005 — Docker: a required password, and the web image pairs through the relay

- **Sprint:** sprints/sprint-146-close-the-door
- **Status:** done
- **Type:** chore
- **Area:** docker, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
`docker compose up` works after M1: the daemon has a password, and the web client container connects
through the relay instead of the `/daemon-ws` proxy.

## Context / why
`docker/daemon.Dockerfile` sets `PI_STUDIO_LISTEN=0.0.0.0:6767`, and the compose file passes
`PI_STUDIO_PASSWORD: "${PI_STUDIO_PASSWORD:-}"`, so after task-002 the container refuses to start.
The nginx template proxies `/daemon-ws` to the daemon, a direct browser path that task-003 removed.

## Scope references
- `docs/daemon-audit-handoff.md` § Milestones → "Things M1 changes for existing set-ups"
- `docker/docker-compose.yml`, `docker/daemon.Dockerfile`, `docker/web-client.Dockerfile`,
  `docker/web-client.nginx.conf.template`, `docker/README.md`
- `scripts/docker-publish.sh` (web-client boot smoke test)
- fern Docker page; root `README.md`/`AGENTS.md` Docker sections

## What to build
- Compose: `PI_STUDIO_PASSWORD: "${PI_STUDIO_PASSWORD:?set PI_STUDIO_PASSWORD}"`; the header comment
  explains connecting the web client with `pi-studio daemon pair` (relay link) and the CLI with the
  password.
- Remove the `/daemon-ws` location from the nginx template and the compose comment that points to it.
- Docs updated in the same change.

## Out of scope
Publishing changes (sprint-148/task-004).

## Acceptance criteria
- [ ] `docker compose -f docker/docker-compose.yml config` fails with the message when the password is
      unset and succeeds when set.
- [ ] The nginx template has no `/daemon-ws`; `docker/README.md` and fern match.
- [ ] `npm run docker:publish -- --dry-run` still passes its web-client smoke test (run in the task
      owner's session only if Docker is available; otherwise say so in the summary).

## Test / verification plan
- `docker compose -f docker/docker-compose.yml config` with and without `PI_STUDIO_PASSWORD`
- Optional: `npm run docker:publish -- --dry-run`
