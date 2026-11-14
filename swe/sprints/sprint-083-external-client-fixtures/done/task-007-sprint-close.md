# Task 007 — Sprint close: publish fixtures in npm `files`, docs, spec amendments, gates

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** docs
- **Area:** packages/protocol (package.json); AGENTS.md (root, protocol, server); swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001…task-006

## Goal

External clients can pin the fixtures by npm version or git commit, and the "fixture shape =
contract" rule is documented where contributors look.

## Scope references

- swe/architecture/external-client-fixtures.md § Files (new/changed), § TODO(verify) #1,
  § Acceptance criteria
- packages/protocol/package.json (`files`: `dist` only today)

## What to build

- `packages/protocol/package.json` `files` += `fixtures` (spec TODO #1; task-001's recommendation
  may overrule this, in which case record the decision instead). `npm pack --dry-run -w
  @av-pi-studio/protocol` shows the directory and no `.signatures.json`-only noise problems.
- Docs:
  - `packages/protocol/AGENTS.md`: the external contract paragraph (path, edit rule,
    `fixtures:update`, CHANGELOG);
  - root `AGENTS.md`: one paragraph under Protocol overview;
  - `packages/server/AGENTS.md`: Layer B and the recorder.
- Spec: set Status to shipped, and resolve the TODO(verify) items from the spike note. Remove the
  `agent_permission_*` / `agent.permission.respond.*` rows, the dev-handle `permissionService`
  file row and the permission scenario steps. Note that the family is retired (sprint-086) and
  deliberately unfixtured. MAIN-SCOPE row: shipped (sprint-083).

## Acceptance criteria

- [ ] All spec acceptance criteria except the cross-repo dashboard round trip are checked off with
  evidence. The round trip is recorded as informational.
- [ ] Gates are green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test`.

## Test / verification plan

- `npm pack --dry-run -w @av-pi-studio/protocol`, plus the full gates.
