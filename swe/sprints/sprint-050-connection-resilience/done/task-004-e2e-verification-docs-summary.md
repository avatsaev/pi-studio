# Task 004 — Summary

## What was done

No new product code (per scope). Delivered: full-workspace verification gates, live smoke
testing against a real daemon + real Chromium browser, docs sync, and spec closure.

### 1. Full workspace build/typecheck/lint/test

- `npm run build` — succeeds (all 7 packages, dependency order).
- `npm run typecheck` (`tsc -b`) — succeeds, no errors.
- `npm run lint` (`oxlint`) — 0 errors. Warnings only (pre-existing `suspicious`-category rules
  across the repo, unrelated to this sprint's files beyond the two documented, justified
  exceptions in `worker-timers.ts`/`worker-timers.test.ts` — see task-002's summary).
- `npm test` (`vitest run`) — **135 test files, 1434 tests, all pass.**

### 2. Live verification against a real daemon in a real browser

Environment: `packages/server`'s daemon (both the mock-provider `dev-main.js` and, for the
terminal-handler regression check, the full `main.js` with a scratch `PI_STUDIO_HOME`), the
web-client's own Vite dev server (`npm run dev`, same-origin `/daemon-ws` unused — connected
directly to `ws://127.0.0.1:6767`), driven via a real headless Chromium tab (CDP).

**What was genuinely exercised, with observed (not expected) results:**

- **Disconnect is never resurrected.** Connected, clicked Disconnect (daemon log: clean `code:
  1000` close). Dispatched three `hidden → visible` `visibilitychange` cycles plus two `online`
  events via `document.dispatchEvent`/`window.dispatchEvent`. **Observed:** the daemon log shows
  no new `ws client connected` line afterward — zero reconnect attempts. Spec acceptance box
  ticked.
- **`reconnectNow()` / Worker-backed timers, focused-tab path.** Reconnected, then killed and
  restarted the daemon process while the tab stayed focused. **Observed:** the daemon log shows a
  new `ws client connected` line ~1 second after the daemon came back up (matching the rung-1
  `initialDelayMs`/jitter, not a throttled multi-minute gap), and the UI toolbar returned to
  "connected" with no user action. `page.workers()` (Puppeteer's live-worker inspector) showed a
  `blob:` URL dedicated Worker present after this cycle — confirming `createWorkerTimers()`'s
  **real Worker path**, not the `setTimeout` fallback, backed this reconnect.
- **Probe happy path.** With a healthy `open` connection, fired a real `hidden → visible`
  `visibilitychange`. **Observed:** the connection stayed `connected` throughout (the `ping()` the
  probe issues resolved normally; no disruption), and a terminal opened afterward remained fully
  responsive (typed `echo probe-did-not-break-terminal`, output appeared).
- **Regression sweep.** Against the full daemon (`main.js`, needed because `dev-main.js`'s minimal
  handler set has no `create_terminal_request` handler — noted below): created a real terminal
  (`create_terminal_request` → PTY spawn logged server-side, `slot: 1`), typed
  `echo pi-studio-e2e-ok`, and observed the echoed output round-trip through the binary terminal
  frames. File explorer tree rendered the real repository listing throughout every connect/
  disconnect/reconnect cycle above.

**What was NOT exercised, and why (stated rather than fabricated):**

- **Throttled-tab reconnect (≥6 min hidden, past Chrome's intensive-throttling threshold).**
  Requires the tab to be genuinely backgrounded (occluded by another real, focused window) for
  several real wall-clock minutes — overriding `document.visibilityState`/dispatching a synthetic
  `visibilitychange` event does not trigger Chrome's actual timer-throttling behavior, which is
  driven by the browser's own page-occlusion tracking, not the JS-visible property. This task's
  automated environment has no second real window to hold focus for that duration.
- **Stale socket after real OS sleep (≥5 min).** This task's environment cannot invoke a genuine
  host-level sleep without disconnecting its own tool access (the daemon, dev server, and this
  agent's own session all run in the same environment). A devtools-offline toggle was considered
  and rejected as a substitute: it produces a clean `close` event, which exercises the *ordinary*
  reconnect path and proves nothing about the half-open-socket case this scenario targets (this
  spec's own Notes section makes the same point about the offline-toggle substitute).

Both gaps are recorded, not silently dropped, in the spec's Acceptance Criteria and TODO(verify)
sections (see below) — the relevant boxes are left unticked with a one-line explanation of what
*was* and was not proven, rather than marked done on inference.

### 3. Docs sync

- `packages/web-client/AGENTS.md`:
  - Source-layout `lib/connection/` entry extended with `worker-timers.ts`, `resume-action.ts`,
    `resume-triggers.ts` (one-line responsibilities each, cross-referencing the new Invariants
    entry).
  - New `## Invariants` bullet, **"Connection resume triggers (sprint-050)"**: the full resume
    trigger contract (which signals, `attachResumeTriggers()`'s module-scope installation and why,
    the decision-table outcomes, the probe's `PROBE_TIMEOUT_MS`/close-code-4000 convention, the
    never-resurrect-a-disconnect rule, and why the probe branch never calls `reconnectNow()`).
- `packages/client/AGENTS.md`: confirmed task-001's `reconnectNow()` entry is present and accurate
  (re-read; no changes needed).

### 4. Spec closure (`clean-room-scope/features/connection-resilience.md`)

- **Acceptance Criteria** — 4 of 7 boxes ticked with the specific evidence line (automated test
  file + count, or the live observation); 3 left unticked with a one-line note distinguishing what
  was verified (the mechanism / happy path) from what was not (the specific long-duration timing
  claim), per this task's instruction to state reality rather than infer completion.
- **TODO(verify)** — the Safari/Firefox item updated with task-004's Chromium finding (Worker path
  confirmed active; the throttling-immunity timing claim itself still unmeasured, Safari/Firefox
  still untested) rather than left as a stale placeholder. The CSP item was already resolved
  during planning (task-002's finding); left as-is.

## Files changed

- `packages/web-client/AGENTS.md` — modified (source layout + new Invariants bullet).
- `clean-room-scope/features/connection-resilience.md` — modified (Acceptance Criteria +
  TODO(verify) sections).
- No `packages/client/AGENTS.md` change needed (already correct from task-001).

## Commands run + results

- `npm run build` — succeeds.
- `npm run typecheck` — succeeds.
- `npm run lint` — 0 errors.
- `npm test` — **1434/1434 pass** (135 test files).
- Live: `npm run dev:daemon` (mock provider) and, for the terminal-handler regression check,
  `node packages/server/dist/daemon/main.js` with a scratch `PI_STUDIO_HOME` (full RPC surface,
  `pi` provider — no model credentials exercised, only the terminal/WS/connection layer);
  `npm run dev` (web-client, Vite); a real headless Chromium tab via CDP for all interactions
  described above. All ephemeral processes and the scratch home directory were torn down after
  verification.

## Acceptance criteria status (this task's own, from task-004's file)

- [x] All four live scenarios attempted, each with a recorded observation (what was seen). Two
      (Disconnect-never-resurrected, regression sweep) fully confirmed; two (throttled-tab ≥6 min,
      sleep ≥5 min) explicitly could not be genuinely reproduced in this environment — recorded as
      such, with the closest available partial evidence (focused-tab reconnect timing, probe
      happy-path) documented instead of a fabricated pass.
- [x] Full suite green: `npm test`, `npm run build`, `npm run typecheck`, `npm run lint`.
- [x] `packages/web-client/AGENTS.md` documents the three new modules and the trigger contract;
      `packages/client/AGENTS.md` documents `reconnectNow()` (verified already present).
- [x] The spec's acceptance boxes reflect reality; both TODO(verify) items resolved or explicitly
      restated as unverified.
- [x] This summary records the evidence.

## Follow-ups / TODO(verify)

Carried forward in the spec itself (not duplicated here):
- Genuine ≥5-minute intensive-throttling timing measurement in a real backgrounded Chrome tab.
- Genuine ≥5-minute real-OS-sleep stale-socket detection measurement.
- Safari/Firefox worker-timer-throttling-immunity verification.

None of these are reachable from this task's automated environment; they need a human operator
with a real machine, a real second monitor/window, and permission to sleep the host.
