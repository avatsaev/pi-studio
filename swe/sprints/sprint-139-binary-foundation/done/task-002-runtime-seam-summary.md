# Task 002 — One runtime seam for every spawn — Summary

- **Sprint:** sprint-139-binary-foundation
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`packages/server/src/runtime/self.ts`: `isBinary` (from the `PI_STUDIO_BINARY` build define), `piCommand`, `skillsCommand`, `daemonCommand`, `relayCommand`, `helperCommand`, `assetsDir`, `webDist`, the start-script helpers and the `__` sub-command names. Every function takes a trailing `SelfRuntime` (`{isBinary, execPath}`) so tests force the binary branch. On Node every command equals today's; in the binary each is `[execPath, "__<name>", ...]`.
Differences from the spec table: `piCommand`/`skillsCommand` return `string[] | null` (null = package not installed, callers keep their fallback); `daemonCommand`/`relayCommand`/`webDist` take a resolver used only on Node (server must not depend on relay/web-client; the CLI resolves URLs in its own graph); `helperCommand(params, script)` takes the helper text to avoid an import cycle.

Spawn sites moved: `rpc-transport.ts` (`defaultPiCommand` removed), `agent.ts`, `sync-executor.ts`, `resource-service.ts`, `update/helper.ts`, and the CLI's `daemon-control.ts`, `relay-control.ts`, `web-server.ts`, `pi-commands.ts` (`PiRuntime.resolveBundled` → `piCommand`). `daemon-start-script.test.ts` was folded into `self.test.ts` (19 tests). Server and CLI AGENTS.md updated (the CLI's narrow server-import exception now includes `runtime/self.ts`).

## Results
Full gate at wave end: build, typecheck ok; lint 0 errors; `npm test` 322 files / 4569 tests passed.

## Acceptance
- [x] Node behaviour unchanged (existing tests pass; each command pinned in `self.test.ts`).
- [x] With `isBinary` true each command is `[execPath, "__<name>", ...]` (tests).
- [ ] A live dev-daemon / `npm start` agent turn was not run separately; the daemon e2e tests (mock provider) in `npm test` cover the Node path.

## Follow-ups
The update helper's own `findEntry`/`startDaemon` text still runs `process.execPath <entry>`: sprint-140. The `__*` handlers: sprint-140.
