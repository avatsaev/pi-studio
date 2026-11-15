# Task 002 — SDK `agentStreams` option and the `hello.agentStreams` fixture — Summary

- **Sprint:** sprints/sprint-098-agent-stream-mode-cli-json
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
- `DaemonClientOptions.agentStreams?: "all" | "none"`, sent as `hello.agentStreams` only when set (`JSON.stringify` drops `undefined`, as for `platform`). JSDoc on the option and on `PiStudioAgentTimelineHandle.subscribe`: with `"none"` no stream handler fires; against a daemon without `agentStreamsMode` the field is ignored and streams arrive.
- Fixture `hello.agentStreams.json` (`since` 0.0.119, `requiresFeature: "agentStreamsMode"`, `agentStreams: "none"`), manifest entry answered by `status.server_info.json`, dated additive changelog entry, README bullet, regenerated signatures. `manifest.json` stays at `formatVersion` 2. Layer B already replays every `hello` fixture against the live dev daemon, so no scenario change was needed (`hello.platform` has none either).

## Files created / changed
`packages/client/src/daemon-client.ts`, `daemon-client.test.ts`, `pistudio-client.ts` (JSDoc), `packages/client/AGENTS.md`; `packages/protocol/fixtures/external-clients/{hello.agentStreams.json, manifest.json, CHANGELOG.md, README.md, .signatures.json}`.

## Build & test results
```
$ npm run fixtures:update -w @av-pi-studio/protocol    wrote .signatures.json (formatVersion 2)
$ npx vitest run packages/client/src packages/protocol/src packages/server/src/daemon/external-fixtures-e2e.test.ts
Test Files 25 passed / Tests 653 passed
$ npm run build:protocol; npm run build:client; npx oxfmt/oxlint <changed>   clean (the two `_state` warnings are pre-existing)
```

## Acceptance criteria
- [x] `hello` carries the field with `agentStreams: "none"` and has no such key without the option.
- [x] Fixture listed, passes both layers; `formatVersion` stays 2.
- [x] Signature guard passes with regenerated signatures.

## Follow-ups / TODO(verify)
- The SDK-over-real-daemon behaviour (a quiet connection receives no stream, a normal one does) is proven in task-004's live check.
