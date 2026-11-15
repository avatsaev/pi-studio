# Task 002 — Relay documents rewritten to protocol 2

- **Sprint:** sprint-101-relay-multi-client-close
- **Status:** done
- **Type:** docs
- **Area:** swe/, docs/, fern/, root and package docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Every document that describes the relay describes protocol 2 and the multi-client behaviour. Nothing names `relay_register` as a working registration, `e2ee_*` frames, `RelaySessionBridge` or a Cloudflare relay.

## Context / why
The feature spec lists the documents as acceptance criteria of their own. Earlier tasks updated their own package docs as they went; this task does the cross-cutting ones and checks the per-package ones once more against the final code.

## Scope references
- `swe/features/relay-multi-client.md` § Acceptance criteria (Documents, updated in the same change), § What a user sees during the rollout
- Inventory found at planning (`git grep -n "Cloudflare\|e2ee_app\|relay_register\|RelaySessionBridge"`):
  - `swe/architecture/relay-e2ee.md`: keep § Pairing and identity; point to `relay-protocol.md` for the wire; remove the "planned change" banner, the Cloudflare rows and the `e2ee_*` frame table.
  - `swe/architecture/relay-protocol.md`: status "built" with the release.
  - `swe/MAIN-SCOPE.md`: technology table, `packages/relay/src/` row ("Cloudflare adapter"), the open question on replay protection. The website row stays: it is about the marketing site.
  - `swe/architecture/external-client-fixtures.md`: the `relay/` subdirectory and its manifest.
  - `swe/features/connection-resilience.md`: connect limit, refusal reasons, daemon redial backoff, dead-socket detection.
  - `swe/features/desktop-client-protocol-followups.md`: "relay downloads are unpaced" is no longer true.
  - Root `AGENTS.md` (relay row in the layout, `hello.platform` note on relay rejection, the sprint-096 "relay's stand-in socket reports none" line, the sprint-072/080 "relay transport" mentions if stale), `README.md` (the mermaid diagram and handshake order, lines ~157–166), `CONTRIBUTING.md` (line ~182).
  - `fern/pages/configuration/relay.mdx` (same diagram and handshake text as README).
  - `packages/relay/AGENTS.md`, `README.md`; `packages/client/AGENTS.md`, `README.md`; `packages/server/AGENTS.md`, `README.md`; `packages/cli/AGENTS.md` (line ~333, `RelaySessionBridge`); `docker/README.md`.
  - `docs/desktop-client-handoff.md`: the relay section; the answered open question on a second channel (lines ~400–401); the Rust library (`crypto_box`); the fixtures a Rust client tests against; task-001's figures.
  - `packages/protocol/fixtures/external-clients/README.md` and `CHANGELOG.md`: check what sprint-099/task-006 wrote.

## What to build
- Rewrite each item above to the code as built. Describe the rollout once, in the README/fern relay section: a daemon must be updated; an old daemon shows `daemon_outdated`; old tabs stay on "connecting" until reloaded.
- No document claims behaviour the code does not have. Where a figure comes from task-001, cite it as measured on loopback.

## Out of scope
- Live checks and spec acceptance ticks (task-003).

## Acceptance criteria
- [ ] `git grep -n "e2ee_app\|e2ee_bin\|e2ee_hello\|e2ee_ready\|RelaySessionBridge\|cf-adapter\|createCloudflareRelayHandler"` outside `swe/grills/`, `swe/sprints/` and `CHANGELOG.md` finds nothing.
- [ ] `relay_register` appears only where the relay's parking of old sockets is described.
- [ ] `cd fern && fern check` passes.
- [ ] Each item of the inventory has been read and either changed or confirmed unchanged in the summary.

## Test / verification plan
- The two `git grep` checks above.
- `cd fern && fern check`
- Markdown is not formatted by oxfmt (`.oxfmtrc.json`); keep the existing table and list style.

## Notes
- `swe/sprints/` task and summary files of earlier sprints are history: leave them.
- Do not tick the spec's acceptance boxes here; task-003 does it after the live check.
