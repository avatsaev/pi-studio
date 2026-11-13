# Task 005 — Layer A: schema validation, manifest check, secret scan, signature guard

- **Sprint:** sprint-083-external-client-fixtures
- **Status:** done
- **Type:** test
- **Area:** packages/protocol (src test, scripts, package.json)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, task-004

## Goal

A protocol-package test fails on any fixture that is malformed, unlisted, schema-invalid, secret
bearing, or breaking without a `formatVersion` bump.

## Scope references

- swe/architecture/external-client-fixtures.md § The contract test › Layer A, § Shape signature,
  § Compatibility rule
- packages/protocol/src/messages.ts (`sessionMessageSchema`, `helloSchema`, `pongSchema`, status
  schemas)
- packages/protocol/src/session-messages.test.ts (existing round-trip style)
- packages/protocol/package.json (`scripts`, `files`)

## What to build

- `packages/protocol/src/external-fixtures.test.ts`:
  - manifest equals the directory listing (`.json` fixtures only; `manifest.json` and
    `.signatures.json` excluded);
  - each file has the documented shape, and every `volatile` pointer resolves inside `frame`;
  - unwrap the envelope, assert `msg.type === fixture.type`, and parse with the schema registered
    for that type (a `type → schema` map built from the existing exports). No schema means skip,
    and the manifest must then show a Layer B producer (enforced in task-006);
  - secret scan: no key matching the password/token family holds anything but the literal fake
    value;
  - signature guard: compute `(pointer → JSON type)` per leaf (volatile values excluded) and
    compare with `.signatures.json`. A removed or retyped pair fails unless
    `manifest.formatVersion` is greater than the recorded one **and** `CHANGELOG.md` names the file.
    Added pairs pass.
- `npm run fixtures:update -w @av-pi-studio/protocol`: regenerates `.signatures.json` (with the
  `formatVersion` it was generated at). The script needs no build step.
- The signature/pointer helpers live in one test-support module the test and the script share. They
  are not part of the published `dist`.

## Acceptance criteria

- [ ] All current fixtures pass.
- [ ] Mutation proofs, each run once and recorded in the summary, then reverted:
  - renaming a leaf in one fixture fails the guard;
  - also bumping `formatVersion` and adding a CHANGELOG line passes;
  - adding an optional field passes;
  - an unlisted file fails;
  - a `"password":"hunter2"` value fails the scan.
- [ ] Runtime < 1 s.

## Test / verification plan

- `npx vitest run packages/protocol/src/external-fixtures.test.ts`
- `npm run build:protocol`; `npx oxfmt <changed files>`; `npm run lint`
