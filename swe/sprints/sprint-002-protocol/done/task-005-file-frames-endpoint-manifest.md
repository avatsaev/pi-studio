# Task 005 — File-transfer frames, endpoint parsing, provider manifest types

- **Sprint:** sprint-002-protocol
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Add the file-transfer binary frame format, host/endpoint parsing, and provider-manifest type
scaffolding to the protocol package.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Binary frames (file-transfer)
- `clean-room-scope/features/file-explorer-transfer.md` § Binary transfer frames
- `clean-room-scope/features/agent-providers.md` § Registration surface (manifest)
- `clean-room-scope/MAIN-SCOPE.md` § 4 (protocol package responsibilities)

## What to build
- File-transfer binary frame codec (separate from terminal frames): chunked download/upload with a
  completion marker; layout TODO(verify) — define opcodes, chunk payload, end-of-stream marker.
- Endpoint/host parser: parse a daemon target (`host:port`, `tcp://host:port?ssl=&password=`, relay
  endpoints) into a normalized descriptor.
- Provider manifest types: provider definition + mode metadata (`icon`, `colorTier`:
  `safe`/`moderate`/`dangerous`/`planning`) and `AgentCapabilityFlags` type.

## Out of scope
- Provider implementation (sprint-005). File services (sprint-009).

## Acceptance criteria
- [ ] File-transfer frames round-trip a multi-chunk payload with an explicit completion marker.
- [ ] Endpoint parser normalizes direct and relay/tcp forms and extracts ssl/password params.
- [ ] Manifest types express modes with `colorTier` and providers with `AgentCapabilityFlags`.

## Test / verification plan
- Tests: `npx vitest run .../file-frames.test.ts`, `.../endpoint.test.ts` — round-trip + parse cases.
- Build: `npm run build:protocol`.

## Notes
- Frame layout (opcodes/chunk size/completion marker) is TODO(verify) against the live codec.
