# Task 002 — Onboarding & device-pairing screens

- **Sprint:** sprint-013-app-navigation-screens
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Implement the welcome/onboarding screen and the QR device-pairing flow.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § Onboarding & pairing
- `clean-room-scope/architecture/relay-e2ee.md` (offer/pairing crypto — produced in sprint-017)
- `clean-room-scope/features/desktop-app.md` § Local vs. remote daemon mode (desktop-only "Use this
  computer" action; toggle itself is built in sprint-018/task-001)

## What to build
- Welcome screen: logo/title/subtitle, platform-dependent actions (web: direct + paste-link; native:
  scan QR + direct + paste-link; **desktop adds "Use this computer"**, which sets
  `desktopDaemonMode = "embedded"` via the sprint-018/task-001 bridge method, starts the local daemon,
  and routes into it once online), settings link + version, add-host / paste-link modals, and
  auto-redirect away when a host is already online.
- Pair-scan screen: native camera QR (web shows unsupported + back); permission handling; decode +
  validate the encrypted connection offer (`#offer=` fragment), probe + upsert, route by `source`
  (onboarding → host root; settings → host settings).
- App-wide deep-link `#offer=` listener.

## Out of scope
- The relay E2EE handshake internals (sprint-017) — consume the pairing/offer contract here.

## Acceptance criteria
- [ ] Welcome shows the right actions per platform (including desktop's "Use this computer") and
      auto-redirects when a host is online.
- [ ] On desktop, "Use this computer" switches to embedded daemon mode, starts the local daemon without
      a relaunch, and routes into its host root once online.
- [ ] Scanning a valid offer probes, upserts the connection, and routes by source; web shows an
      unsupported message.
- [ ] A deep-link offer imports app-wide.

## Test / verification plan
- Tests: welcome action set per platform + auto-redirect; offer decode/validate + source-based routing
  (mock client).

## Notes
- Pairing crypto lands in sprint-017; this task uses its offer/validate contract.
