# Task 006 — Fixed-key relay fixtures (`external-clients/relay/`) and the tests that pin them

- **Sprint:** sprint-099-relay-protocol-primitives
- **Status:** done
- **Type:** test
- **Area:** packages/protocol (fixture files), packages/relay (tests)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, task-005

## Goal
The Rust desktop client can test its relay implementation against committed bytes: keys, control frames, close codes and channel frames, which this repository proves its own code reproduces byte for byte.

## Context / why
D11: fixed-key fixtures pin the contract so the Rust client needs no live relay. They follow the `binary/` precedent: a subdirectory of `packages/protocol/fixtures/external-clients/` with its own `manifest.json`, `formatVersion` 1, so the dashboard's vendored test (which rejects unlisted top-level JSON) is unaffected. The relay package gains no runtime dependency on the protocol package: the tests read the files by path.

## Scope references
- `swe/features/relay-multi-client.md` § Public contract 5 (Fixtures), § Acceptance criteria (fixtures byte for byte)
- `swe/architecture/relay-protocol.md` § 1, § 3, § 4
- `swe/architecture/external-client-fixtures.md` (the rules for subdirectories, `formatVersion`, `CHANGELOG.md`)
- Create: `packages/protocol/fixtures/external-clients/relay/` (`manifest.json` + one file per fixture), `packages/relay/src/relay-fixtures.test.ts`
- Modify: `packages/relay/src/relay-server.test.ts` (compare sent control frames with the fixtures), `packages/protocol/fixtures/external-clients/README.md`, `packages/protocol/fixtures/external-clients/CHANGELOG.md`
- Pattern: `packages/protocol/fixtures/external-clients/binary/manifest.json`, `packages/protocol/src/external-binary-fixtures.test.ts` (hex + decoded form)

## What to build
- **Keys** fixture: daemon key pair, client key pair, salt, the derived session id (`deriveRelaySessionId`), and the `box.before` shared key. Marked `"testMaterial": true` with a description saying these keys must never be used for a real daemon.
- **Control frames**: one file per frame of § 1 (six), plus the legacy `relay_register` frame (marked as what the relay parks), each holding the exact JSON text.
- **Close codes**: § 3 as data (code, name, sender, condition).
- **Channel frames**: `hello` and `ready` as hex; a text and a binary message in each direction with their counters (c→d 0 and 1, d→c 1 and 2), as hex and decoded (kind, payload, nonce hex).
- `manifest.json` lists every file with its group; `formatVersion: 1`; each file carries `description` and `since` (the release that ships the feature; see Notes).
- `relay-fixtures.test.ts`: rebuilds every channel frame from the keys and salt through the real `channel.ts` (injected key pair and `randomBytes`) and compares bytes; opens every fixture frame and compares the decoded form; checks the control frames against `encodeControlFrame` and close codes against `RELAY_CLOSE`; and checks that the manifest lists every `*.json` file in the directory and nothing else.
- `relay-server.test.ts`: the `relay_registered`, `relay_dial` (with the id masked) and `relay_paired` frames the server actually sends equal the fixture text.
- Fixtures `README.md`: a `relay/` section (what each group is, the keys are test material). `CHANGELOG.md`: a dated entry for the new subdirectory.

## Out of scope
- `swe/architecture/external-client-fixtures.md` and the handoff doc (sprint-101/task-002).
- Any change to the top-level JSON or `binary/` fixtures and their manifests.

## Acceptance criteria
- [ ] The relay test rebuilds every channel fixture byte for byte, in both directions, and decodes every fixture to its recorded form.
- [ ] The relay server test proves the frames it sends equal the control-frame fixtures.
- [ ] Changing one byte of a channel fixture, or one character of a control-frame fixture, fails a test.
- [ ] The top-level fixture tests (`packages/protocol/src/external-fixtures.test.ts`, `external-binary-fixtures.test.ts`) pass unchanged; `npm pack -w packages/protocol --dry-run` lists the `relay/` files.

## Test / verification plan
- `npx vitest run packages/relay/src packages/protocol/src`
- `npm run build:relay && npm run build:protocol`
- `npm pack -w packages/protocol --dry-run | grep relay/`
- `npx oxfmt <changed files>` (JSON fixtures included only if the existing ones are formatted; check `.oxfmtrc.json`)

## Notes
- `since`: the release carrying this feature is assumed to be the next after 0.0.120, i.e. 0.0.121. Check the published version when implementing.
- Keep the fixture generator inside the test (or a tiny script beside it), not in the published relay package.
- Rust interop itself is tested in the desktop repository against these files (relay-protocol.md § TODO(verify), Rust).
