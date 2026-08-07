# Task 001 — Onboarding & device-pairing screens

- **Sprint:** sprint-019-navigation-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** sprint-018 (chrome/primitives); sprint-013/task-002 (onboarding/pairing models)

## Goal
Build the `/welcome`, add-host, and `/pair-scan` screens — the first-run and host-connection flows.

## Scope references
- `clean-room-scope/features/app-navigation-screens.md` § welcome, § onboarding, § pairing
- `clean-room-scope/architecture/relay-e2ee.md` (pairing payload; relay itself is sprint-023)

## What to build
- `/welcome` screen: product intro (branded), primary "Connect a host" / "Add host" actions, community
  links; consume the sprint-013 welcome model.
- Add-host flow: manual host entry (URL/host:port + optional password), validation, save → connect;
  method chooser modal (manual vs scan).
- `/pair-scan`: QR scan via `getUserMedia` + a QR decode lib, parse the pairing payload, connect;
  graceful "camera unavailable / enter manually" fallback (and desktop behavior).
- Wire successful connect → boot resolver → host home.

## Out of scope
- Relay transport/crypto (sprint-023). Home/sessions (task-002). Settings host management (task-004).

## Acceptance criteria
- [ ] `/welcome` renders branded intro + actions and routes to add-host/scan.
- [ ] Manual add-host validates + saves + connects (mock client) and lands on the host home.
- [ ] `/pair-scan` decodes a pairing payload and connects; camera-unavailable falls back to manual.

## Test / verification plan
- Tests: welcome model→actions; add-host validation + save (mock store/client); pairing-payload parse
  → connection params (reuse sprint-013 pairing model).

## Notes
- QR camera access is web `getUserMedia`; on Electron the same path works. No native camera module.
