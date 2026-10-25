# Task 002 — Node floor ≥22.20, pinned `skills` dependency, `skills-cli.ts`

- **Sprint:** sprint-076-skills-remove-update
- **Status:** done
- **Type:** chore
- **Area:** repo root, packages/server
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

The daemon can run the pinned `skills` CLI with the exact argv/env the spec requires.

## Context / why

`skills` 1.7.x needs Node ≥22.20; Pi 1.4.0 already needs 22.19, so the effective floor moves one patch (brief D14).

## Scope references

- swe/architecture/pi-resource-management.md § Ground truth (skills CLI), § Spawn environment
- package.json (root `engines`), packages/server/package.json, packages/cli/package.json
- packages/server/src/agent/providers/pi/rpc-transport.ts:103 (`resolveBundledPiCli` — resolution pattern)
- README.md, packages/cli/README.md, root AGENTS.md § Tech stack (Node version statements)
- Create: packages/server/src/resources/skills-cli.ts (+ test)

## What to build

- Root `engines.node` → `>=22.20`; update every doc line stating Node ≥20.
- `skills` exact-pinned in `packages/server` dependencies; lockfile committed.
- `skills-cli.ts`: `resolveSkillsCli()` reads the dependency's own `package.json` `bin` (never a hardcoded path); `skillsArgv(op, …)` builders for `add` (`-g -a pi -y -s <names…> <src>`), `remove` (`-g -y <name>` — **never `-a`**), `update` (`-g -y`); `spawnEnv(agentDir)` with `PI_CODING_AGENT_DIR`, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND` default `ssh -o BatchMode=yes`, `npm_config_yes=true`, `DISABLE_TELEMETRY=1`, `DO_NOT_TRACK=1`, `SKILLS_CLONE_TIMEOUT_MS` below the item timeout.

## Out of scope

- Running any operation (tasks 004-005)

## Acceptance criteria

- [x] `resolveSkillsCli()` returns the path declared in the installed package's `bin` (test asserts equality, like the Pi CLI test)
- [x] `remove` argv never contains `-a`
- [x] `npm install` on a clean checkout under Node 22.20 succeeds

## Test / verification plan

- `npx vitest run packages/server/src/resources/skills-cli.test.ts`
- `npm run build:server`
- `node node_modules/skills/<bin> --version` prints the pinned version
