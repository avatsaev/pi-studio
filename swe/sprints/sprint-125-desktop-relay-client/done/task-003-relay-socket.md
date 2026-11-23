# Task 003 — Relay crate: the open channel as a `DaemonSocket`

- **Sprint:** sprint-125-desktop-relay-client
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/relay
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
After `connect`, the relay channel is a `DaemonSocket` the proxy and the engine use like any other.

## Context / why
D2: one message in, one sealed frame out; S4: a message whose sealed size is above 100 MiB closes 1009.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 5, § 6, S4, § Error handling (relay closes)
- `desktop/crates/net/src/proxy/` (the pump and its close table)

## What to build
- The socket: text and binary messages sealed with kind `0x01`/`0x02`; received frames opened and delivered by kind; a failure closes 4200 and delivers nothing; the relay's close code and reason pass through; pings answered by the WebSocket library.
- `max_message_bytes()` is the caller's limit, capped so that the sealed frame stays within 100 MiB.

## Out of scope


## Acceptance criteria
- [ ] Through the proxy, against the stand-in relay with an echo daemon half: 10,000 mixed messages arrive in order and intact; a 64 MiB message passes; `peakHeld` stays at one message plus a batch.
- [ ] A tampered frame closes 4200 on both legs; a relay close 4108 reaches the page as 4108.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

