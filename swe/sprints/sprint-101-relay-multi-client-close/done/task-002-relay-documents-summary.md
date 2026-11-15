# Task 002 — Relay documents rewritten to protocol 2 — Summary

- **Sprint:** sprints/sprint-101-relay-multi-client-close
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
Three doc slices (specs / root+fern+docker / packages+handoff) rewritten to protocol 2 as built.

| File | Result |
|---|---|
| `swe/architecture/relay-e2ee.md` | changed: banner, Cloudflare rows and `e2ee_*` tables removed; wire section points to relay-protocol.md; § Pairing kept; tweetnacl named |
| `swe/MAIN-SCOPE.md` | changed: technology table, relay/src and daemon relay-transport rows, relay integration row, replay-protection question closed, sprint-096 follow-up note |
| `swe/architecture/external-client-fixtures.md` | changed: `relay/` subdirectory |
| `swe/features/connection-resilience.md` | changed: connect limit, refusal reasons, pings + 90 s detection, redial backoff |
| `swe/features/desktop-client-protocol-followups.md` | changed: relay downloads paced, 1008 on bad hello, loopback figures |
| `AGENTS.md` (root) | changed: relay layout row, sprint-096 line, hello.platform note, new "Relay protocol 2" bullet, architecture list |
| `README.md`, `fern/pages/configuration/relay.mdx` | changed: diagram, handshake, cap/codes/limit/flow control/pings, rollout note |
| `CONTRIBUTING.md`, `docker/README.md`, `packages/cli/AGENTS.md` | changed |
| `packages/relay/AGENTS.md`, `README.md` | changed: channel API, wire format, nonce invariant, refusal codes, security notes, flow control, loopback figures |
| `packages/client/AGENTS.md` | changed (provider-auth note); `README.md` confirmed unchanged |
| `packages/server/AGENTS.md`, `README.md`, protocol fixtures `README.md`/`CHANGELOG.md` | confirmed unchanged |
| `docs/desktop-client-handoff.md` | changed: relay section, answered second-channel question, `crypto_box`, fixtures, figures, milestone 4 |

## Build & test results
```
$ git grep "e2ee_app|e2ee_bin|e2ee_hello|e2ee_ready|RelaySessionBridge|cf-adapter|createCloudflareRelayHandler" (excl. swe/grills, swe/sprints, CHANGELOG, dist)
  -> remaining hits are only: the "Removed" tables / old-protocol notes in swe/features/relay-multi-client.md and swe/architecture/relay-protocol.md, and one parking test string (relay-server.test.ts)
$ git grep relay_register in docs -> only where parking of old sockets / the legacy fixture is described, plus the protocol spec
$ fern check -> NOT RUN (fern CLI not installed)
```

## Acceptance criteria
- [x] grep criterion (with the spec "removed"/old-protocol descriptions as the only hits)
- [x] `relay_register` only in parking/legacy-fixture/spec context
- [ ] `fern check` — fern CLI not installed here; not run
- [x] every inventory item read and changed or confirmed unchanged (table above)

## Follow-ups / TODO(verify)
- Run `cd fern && fern check` where the CLI exists.
- `since` 0.0.121 in handoff doc/fixtures README is an assumption (release number).
- Rust note (`crypto_box` against `keys.json`) is framed as "check first"; not run here.
- Status lines in `swe/MAIN-SCOPE.md` (lines ~292, 328) and both relay specs are updated in t003.
