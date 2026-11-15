# Task 002 — SDK `agentStreams` option and the `hello.agentStreams` fixture

- **Sprint:** sprint-098-agent-stream-mode-cli-json
- **Status:** done
- **Type:** feature
- **Area:** packages/client (handshake), packages/protocol (fixtures), packages/server (live fixture scenario)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001, sprint-097/task-004, sprint-097/task-005

## Goal
An SDK consumer can open a quiet connection with one option, and the handshake variant is pinned by a fixture.

## Context / why
Task-001 makes the daemon honour `hello.agentStreams`. The SDK's `DaemonClient` builds the `hello` itself, so without an option no SDK consumer can send the field. The desktop client's Rust side builds its own `hello` and needs the fixture to do so.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 2 (row "SDK"), § 4 (`hello.agentStreams.json`)
- `packages/client/src/daemon-client.ts` (`DaemonClientOptions`, `connect`: where `platform` is sent)
- `packages/client/src/daemon-client.test.ts`, `packages/client/AGENTS.md`, `packages/client/README.md`
- `packages/protocol/fixtures/external-clients/` (`hello.platform.json` as the model, `manifest.json`, `CHANGELOG.md`, `README.md`, `.signatures.json`)
- `packages/server/src/test-support/external-fixtures-scenario.ts`, `packages/server/src/daemon/external-fixtures-e2e.test.ts` (how `hello.platform` is covered)

## What to build
- `DaemonClientOptions.agentStreams?: "all" | "none"`, sent as `hello.agentStreams` when set and omitted otherwise.
- JSDoc on the option and on `timeline.subscribe`: with `"none"` no stream listener ever fires, and against a daemon without `agentStreamsMode` the field is ignored and streams arrive, so a consumer must tolerate them.
- Fixture `hello.agentStreams.json`: a `hello` variant with `agentStreams: "none"`, `requiresFeature: "agentStreamsMode"`, answered by the existing `status.server_info.json`. Manifest entry, a dated additive changelog entry, the README table, regenerated signatures, and the live scenario covering it the way it covers `hello.platform`.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- Making the workbench send the option: its connection needs the streams.
- Any daemon behaviour (task-001).

## Acceptance criteria
- [ ] With `agentStreams: "none"` the SDK's `hello` carries the field; without the option the `hello` has no such key.
- [ ] `hello.agentStreams.json` is listed in the manifest and passes both fixture test layers; `manifest.json` stays at `formatVersion` 2.
- [ ] The signature guard passes with regenerated signatures.

## Test / verification plan
- `npm run fixtures:update -w @av-pi-studio/protocol`
- `npx vitest run packages/client/src packages/protocol/src packages/server/src/daemon/external-fixtures-e2e.test.ts`
- `npm run build:protocol && npm run build:client && npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- Depends on sprint-097/task-004 because both edit `packages/client/AGENTS.md` and `README.md`, and on sprint-097/task-005 because both edit the fixture manifest, changelog, signatures and the live scenario.
