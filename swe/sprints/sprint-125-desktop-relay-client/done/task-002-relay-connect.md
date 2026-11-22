# Task 002 — Relay crate: connect, pairing and the reasons, against a relay stand-in

- **Sprint:** sprint-125-desktop-relay-client
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/relay
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-124/task-003, sprint-124/task-004

## Goal
`connect(link, max)` dials the relay, pairs, runs the key exchange within 15 s, and answers the SDK's reasons for every failure.

## Context / why
relay-protocol.md § Client and § 3; the SDK's mapping in `packages/client/src/relay-transport.ts`. S5: a dial failure other than `timeout` is `relay_unreachable`.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 5, § Error handling (relay rows), S5
- `packages/client/src/relay-transport.ts` (reasons, messages, close mapping)
- `swe/architecture/relay-protocol.md` § 1, § 3, § Client

## What to build
- `RelayError { reason, message }` with the eight reasons and the SDK's messages.
- `connect` through `net::dial` (no password), the `relay_client_connect` text frame, `relay_paired` (ignoring `relay_registered`), then the channel exchange; the 15 s limit covers it all.
- A relay stand-in behind a `testing` feature: scripted control frames, closes and a daemon half that speaks the channel.

## Out of scope
- The socket after the exchange (t003).

## Acceptance criteria
- [ ] Close 4102–4105 before pairing give their reasons; 4200 or a bad `ready` gives `wrong_key` and the client closes 4200; a close with no code before pairing gives `relay_unreachable`; a binary frame before pairing gives `protocol_error`; a silent relay gives `timeout` at the limit (test with a short limit).

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

