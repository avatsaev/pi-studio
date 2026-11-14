# Task 003 — Sprint close: docs, release note, MAIN-SCOPE, gates — Summary

- **Sprint:** sprints/sprint-087-daemon-loopback-default
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
Docs now state loopback default, `daemon.listen` precedence, opt-in LAN and the password advice: root README/AGENTS, `packages/server` README/AGENTS (incl. upgrade note — no CHANGELOG exists in the repo), fern `configuration/daemon.mdx`, `docker/README.md` (why the container sets `0.0.0.0`). MAIN-SCOPE § 10 D35 item ticked and noted shipped. `PLAN.md` untouched per orchestration rules.

## Build & test results
```
$ npm run build      # success
$ npm run typecheck  # success
$ npm run lint       # 0 errors (pre-existing warnings only)
$ npm run fmt:check  # fails on 42 pre-existing files; none are files touched by this sprint
$ npm test           # 243 files, 3305 passed
```

## Acceptance criteria
- [x] grep shows `0.0.0.0:6767` only in opt-in examples and Docker rows (relay `0.0.0.0:7000` unrelated)
- [~] Gates green except pre-existing fmt:check failures in untouched files

## Follow-ups / TODO(verify)
- Docker compose smoke not run. `docker/README.md` and fern `docker.mdx:88` rows keep `0.0.0.0` (explicit); fern docker.mdx row not annotated.
