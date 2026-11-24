# Task 002 — One runtime seam for every spawn site

- **Sprint:** sprints/sprint-139-binary-foundation
- **Status:** done
- **Type:** refactor
- **Area:** packages/server, packages/cli
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Every place that starts Pi, the `skills` CLI, the daemon, the relay or the update helper asks
`packages/server/src/runtime/self.ts` for the command; on Node the commands are exactly today's.

## Context / why
A3. In a compiled binary `process.execPath` is the binary, so `process.execPath <script>` must become
`<binary> __pi …` etc. One module decides for both runtimes.

## Scope references
- `swe/architecture/single-binary-daemon.md` § The runtime seam, § The sub-commands
- Spawn sites: `packages/server/src/agent/providers/pi/rpc-transport.ts` (`defaultPiCommand`),
  `packages/server/src/extensions/sync-executor.ts`, `packages/server/src/resources/resource-service.ts`,
  `packages/server/src/resources/skills-cli.ts`, `packages/server/src/update/helper.ts`,
  `packages/cli/src/daemon-control.ts`, `packages/cli/src/relay-control.ts`, `packages/cli/src/pi-commands.ts`,
  `packages/cli/src/web-server.ts` (`resolveWebClientDist`)
- Create: `packages/server/src/runtime/self.ts`, `self.test.ts`; export from the server's index

## What to build
- `isBinary` (a `PI_STUDIO_BINARY` build-time define; `false` when undefined), `piCommand(args)`,
  `skillsCommand(args)`, `daemonCommand(opts)`, `relayCommand(opts)`, `helperCommand(params)`,
  `assetsDir()`, `webDist()` as in the architecture table.
- Replace every site above; `agents.providers.pi.command` still wins for Pi.
- The CLI's imports of server modules follow the existing narrow exception (`packages/cli/AGENTS.md`).

## Out of scope
The binary's entry and its sub-command handlers (sprint-140/task-001).

## Acceptance criteria
- [ ] With `isBinary` false every command equals today's (tests pin each).
- [ ] With `isBinary` forced true in a test each command is `[execPath, "__<name>", …]`.
- [ ] Full suite green; a dev daemon and a real `npm start` daemon run an agent turn with the mock provider.

## Test / verification plan
- `npx vitest run packages/server/src/runtime/self.test.ts` and the touched files' tests
- `npm run build && npm run typecheck && npm run lint && npm test`

## Notes
Do not change behaviour on Node. `pi-overrides` is applied by the binary's entry, not here.
