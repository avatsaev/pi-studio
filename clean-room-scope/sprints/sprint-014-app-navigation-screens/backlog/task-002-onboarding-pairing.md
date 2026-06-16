# Task 002 — Onboarding & device-pairing screens

- **Sprint:** sprint-014-app-navigation-screens
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Implement the welcome/onboarding screen and the QR device-pairing flow.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Onboarding & pairing
- `clean-room-scope/architecture/relay-e2ee.md` (offer/pairing crypto — produced in sprint-018)

## What to build
- Welcome screen: logo/title/subtitle, platform-dependent actions (web: direct + paste-link; native:
  scan QR + direct + paste-link), settings link + version, add-host / paste-link modals, and auto-redirect
  away when a host is already online.
- Pair-scan screen: native camera QR (web shows unsupported + back); permission handling; decode +
  validate the encrypted connection offer (`#offer=` fragment), probe + upsert, route by `source`
  (onboarding → host root; settings → host settings).
- App-wide deep-link `#offer=` listener.

## Out of scope
- The relay E2EE handshake internals (sprint-018) — consume the pairing/offer contract here.

## Acceptance criteria
- [ ] Welcome shows the right actions per platform and auto-redirects when a host is online.
- [ ] Scanning a valid offer probes, upserts the connection, and routes by source; web shows an
      unsupported message.
- [ ] A deep-link offer imports app-wide.

## Test / verification plan
- Tests: welcome action set per platform + auto-redirect; offer decode/validate + source-based routing
  (mock client).

## Notes
- Pairing crypto lands in sprint-018; this task uses its offer/validate contract.
