# Task 003 — Sprint close: live browser checks, docs, spec amendments, gates

- **Sprint:** sprint-082-agent-deep-link
- **Status:** done
- **Type:** docs
- **Area:** packages/web-client; AGENTS.md (root + web-client); fern; swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Every acceptance criterion is observed in a real browser against a dev daemon, and the link is
documented as the contract the dashboard builds against.

## Scope references

- swe/features/web-ui-agent-deep-link.md § Acceptance criteria, § TODO(verify)
- packages/web-client/AGENTS.md, root AGENTS.md (web-client line in the monorepo layout)
- fern/pages/web-ui.mdx (user-facing URL parameters)

## What to build

- Live checks against `npm run dev:daemon` and the Vite dev server, with at least two agents:
  - `?host=ws://127.0.0.1:6767&connect=1#agent=<older agent>` selects it over the most recent one,
    in the focused pane;
  - a bare `#agent=<id>` does not connect, and a manual Connect then selects the agent;
  - `#agent=nope` shows one toast and leaves the URL without `#`;
  - `#offer=…&agent=…` cleanup leaves `#offer=…`;
  - a `hashchange` on a connected page selects the agent;
  - the same agent already open does not get a duplicate tab;
  - a reload after an apply does not re-select it.
  - Record what each check showed in the summary, with a screenshot of the selected agent.
- Relay pairing + `agent` together, if a relay is reachable locally. Otherwise state it was not
  run.
- Docs:
  - `packages/web-client/AGENTS.md`: deep-link invariant (grammar, apply point, one-shot, cleanup,
    no auto-connect, files);
  - root `AGENTS.md` web-client line;
  - fern `web-ui.mdx`: the recommended link form
    `<webUiUrl>/?host=<ws url>&connect=1#agent=<urlencoded id>` and the `%2B` note.
- Spec: set Status to shipped, resolve the TODO(verify) items (TODO #1, bare link: the dashboard
  appends `host` + `connect=1`; TODO #2 placement, from task-002's test; TODO #3 English literal;
  TODO #4 same toast). Mark the MAIN-SCOPE row shipped (sprint-082).

## Acceptance criteria

- [ ] Every spec acceptance criterion is checked off with evidence (test name or live observation).
- [ ] "No server involvement": `git diff --stat` for the sprint touches nothing under
  `packages/server` or `packages/protocol`.
- [ ] Gates are green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test`.

## Test / verification plan

- Browser session as above, plus the full gates listed.
