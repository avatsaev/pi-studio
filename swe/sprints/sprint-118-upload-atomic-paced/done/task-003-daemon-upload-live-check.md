# Task 003 — Live check of the daemon's upload changes with the browser client and the SDK

- **Sprint:** sprint-118-upload-atomic-paced
- **Status:** done
- **Type:** test
- **Area:** packages/server, docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
The two daemon changes are seen working against a real production daemon, with numbers for the spec's open questions.

## Context / why
Unit tests use a slowed writer and a stand-in socket. This run uses the real `ws` socket, a real disk, the web client and the relay.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 10, § Acceptance criteria (the R3 and R4 rows), § TODO(verify) (R4 on the browser's connection and over a relay; R3's file in the explorer)
- `swe/av-swe.config.json` (`liveChecks`), `docs/desktop-client-handoff.md` § 2 (the sprint 096 and 097 measurements, for the method)

## What to build
- An isolated production daemon (its own `PI_STUDIO_HOME`, a free port). With an SDK client in Node: a 600 MiB upload completes with a matching SHA-256; one aborted near 200 MiB, and one whose client process is killed, leave no file and no `.pistudio-upload-*.part`; the same two onto an existing file leave it unchanged.
- During a 600 MiB upload: the daemon's resident memory before, peak and after; how often reading stopped; and the round trip of a `ping` sent every 100 ms on the same connection (median and maximum).
- The same upload from the web client (headless Chromium, Files explorer): completes, hash matches; what the explorer showed of the temporary file.
- Through a local relay: an upload from one client while a second client pings; the second client's round trips.
- The numbers go into the summary and into the spec's § TODO(verify) items they answer; `docs/desktop-client-handoff.md` § 2 is updated for R3 and R4.

## Out of scope
- Any code change beyond a fix for a defect this run finds (a defect gets its own test).

## Acceptance criteria
- [ ] Every run above is done and reported with its numbers; no run touched `~/.pi-studio` or port 6767.
- [ ] The spec's R4 and R3 TODO(verify) items are answered or narrowed in the spec.
- [ ] Root gates pass: `npm run build && npm run typecheck && npm run lint && npm test`.

## Test / verification plan
- `npm run build`, then `PI_STUDIO_HOME=<scratch> PI_STUDIO_LISTEN=127.0.0.1:<free port> npm run start:server`
- The root gates above

## Notes
- No disk here is slow enough to force the pacing by itself: if reading never stopped in the real run, say so; the unit test of task-002 is then the evidence for the bound.
