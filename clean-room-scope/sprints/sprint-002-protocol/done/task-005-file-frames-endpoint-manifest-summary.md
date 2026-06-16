# Task 005 — File-transfer frames, endpoint parsing, provider manifest types — Summary

- **Sprint:** sprint-002-protocol
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Three protocol additions:

1. **File-transfer binary codec** (`binary-frames/file-transfer-protocol.ts`): layout
   `[opcode][stream][payload]`, opcodes `Begin=0x10` (UTF-8 JSON header), `Chunk=0x11` (raw bytes),
   `End=0x12` (explicit completion marker, ok flag byte), `Error=0x13` (UTF-8 message).
   `encode/decode/tryDecode` + `FileTransferFrameError`. A transfer is `Begin → N×Chunk → End`.
2. **Endpoint parser** (`endpoint.ts`): `parseEndpoint(input)` → normalized `EndpointDescriptor`
   (`kind: direct|relay`, host, port, ssl, password?, relayId?, raw). Handles bare `host`/`host:port`
   (default port `6767`), `tcp://`, `ws://`/`wss://`, `http(s)://`, and `relay://`, extracting
   `ssl`/`tls`/`password` query params and the relay channel id; supports IPv6 literals.
3. **Provider manifest types** (`provider-manifest.ts`): `colorTierSchema`
   (`safe|moderate|dangerous|planning`), `agentCapabilityFlagsSchema` (the six `supports*` flags),
   `providerModeSchema` (id/label/description/icon/colorTier), `providerDefinitionSchema`
   (id + label + modes + capabilities + optional `extends`), `providerIdSchema` (`/^[a-z][a-z0-9-]*$/`).

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/binary-frames/file-transfer-protocol.ts` | created |
| `packages/protocol/src/endpoint.ts` | created |
| `packages/protocol/src/provider-manifest.ts` | created |
| `packages/protocol/src/binary-frames/index.ts` | modified — re-exports file-transfer |
| `packages/protocol/src/index.ts` | modified — re-exports endpoint + manifest |
| `packages/protocol/src/binary-frames/file-transfer-protocol.test.ts` | added — 3 tests |
| `packages/protocol/src/endpoint.test.ts` | added — 7 tests |
| `packages/protocol/src/provider-manifest.test.ts` | added — 5 tests |

## How it satisfies the scope
- **websocket-protocol.md / file-explorer-transfer.md § Binary transfer frames:** a chunked
  download/upload format separate from terminal frames, with an explicit completion marker.
- **agent-providers.md § Registration surface / Capability flags:** mode metadata with `colorTier`,
  provider definition with `AgentCapabilityFlags`, provider id pattern, custom `extends:"pi"` profiles.
- **MAIN-SCOPE §4:** endpoint parsing is a protocol-package responsibility.

## Build & test results
```
$ npm run build:protocol      → exit 0 (no type errors)
$ npx vitest run packages/protocol/src/binary-frames/file-transfer-protocol.test.ts \
      packages/protocol/src/endpoint.test.ts packages/protocol/src/provider-manifest.test.ts
 ✓ endpoint.test.ts (7) ✓ file-transfer-protocol.test.ts (3) ✓ provider-manifest.test.ts (5)
 Test Files  3 passed (3)      Tests  15 passed (15)

# Full sprint re-verification
$ npm run build               → exit 0
$ npx vitest run              → 9 files, 62 tests passed
$ npx oxlint                  → exit 0
$ npx oxfmt --check .         → clean
```

## Acceptance criteria
- [x] File-transfer frames round-trip a multi-chunk payload with an explicit completion marker
      (Begin + 2 Chunks + End reassembled to `[1,2,3,4,5]`, `End.ok=true`).
- [x] Endpoint parser normalizes direct and relay/tcp forms and extracts ssl/password params (and
      relayId, IPv6, wss⇒ssl).
- [x] Manifest types express modes with `colorTier` and providers with `AgentCapabilityFlags`
      (+ provider id pattern, `extends` profiles).

## Follow-ups / TODO(verify)
- File-transfer frame layout (opcode values `0x10–0x13`, chunk sizing, completion-marker encoding)
  is TODO(verify) against the live codec.
- Download-token TTL/single-use semantics and the relay endpoint URL grammar are confirmed in their
  feature sprints (sprint-009 file services, sprint-013 relay).
