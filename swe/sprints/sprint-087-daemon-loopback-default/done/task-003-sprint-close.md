# Task 003 — Sprint close: docs, release note, MAIN-SCOPE, gates

- **Sprint:** sprint-087-daemon-loopback-default
- **Status:** done
- **Type:** docs
- **Area:** README.md / AGENTS.md (root, server); fern; docker README; swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Every document states one default, the way to opt in, and the password advice. Users who relied on
LAN access learn how to keep it.

## What to build

- Docs that state `0.0.0.0` or contradict loopback (re-grep before editing):
  - root `README.md:93`;
  - `packages/server/README.md`: the :100 banner, the :110 "reachable over the LAN" line, the :132
    dev-daemon line and the :174 env table;
  - the root `AGENTS.md` env table (drop the production-vs-CLI split, document `daemon.listen`
    precedence and the warning) and its `npm run dev:daemon` line ("binds 0.0.0.0");
  - `fern/pages/configuration/daemon.mdx:13`;
  - `docker/README.md` (its explicit `0.0.0.0` row stays correct; add one line explaining why the
    container sets it).
- Release note, wherever this repo records user-facing changes: the daemon now binds `127.0.0.1` by
  default; set `PI_STUDIO_LISTEN=0.0.0.0:6767` or `daemon.listen` for LAN access, together with
  `PI_STUDIO_PASSWORD`.
- `swe/MAIN-SCOPE.md` § 10: mark the D35 item resolved (sprint-087), and the `PLAN.md` open
  question likewise.

## Acceptance criteria

- [ ] `grep -rn "0.0.0.0:6767" README.md AGENTS.md packages/*/README.md packages/*/AGENTS.md fern/pages`
  shows only the explicit opt-in examples and the Docker rows.
- [ ] Gates are green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test`.

## Test / verification plan

- The grep above, plus the full gates.
