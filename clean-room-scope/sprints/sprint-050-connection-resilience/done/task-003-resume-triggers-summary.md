# Task 003 — Summary

## What was built

- **`resume-action.ts`** — pure, DOM-free `resolveResumeAction({ status, managerActive,
  probeInFlight })` implementing the spec's decision table exactly: `closed` + active →
  `reconnect-now`; `open` + active + no probe in flight → `probe`; `open` + active + probe in
  flight → `none` (single-probe guard); `connecting`/`closing`/`idle` → `none`; `managerActive:
  false` → `none` unconditionally (the never-resurrect-a-disconnect guard, checked first). The
  `signal` parameter from the spec's first draft is intentionally omitted per the spec's own
  documented deviation — no table row branches on it.
- **`resume-triggers.ts`** — `attachResumeTriggers()` subscribes to `visibilitychange` (acting
  only on `hidden → visible`) and `online`. On each signal it reads `useConnectionStore.getState()`
  fresh (never captured — the store replaces `daemon`/`reconnection` on every `connect()`), feeds
  `resolveResumeAction`, and executes: `reconnect-now` → `reconnection.reconnectNow()`; `probe` →
  `daemon.ping(PROBE_TIMEOUT_MS)`, and on rejection, after an identity check
  (`store.daemon === <the probed instance>`) to guard against a disconnect/reconnect racing the
  probe, `daemon.close(4000, "stale-connection-probe")` — never an explicit `reconnectNow()`
  there (commented at the call site per the task's instruction, citing the spec's invariant-6
  section). Owns the module-local `probeInFlight` boolean, cleared in a `finally`. `PROBE_TIMEOUT_MS
  = 5_000` exported as specified.
- **`main.tsx`** — calls `attachResumeTriggers()` at module scope, after `createRoot(...).render(...)`,
  not inside a React effect (comment explains why: `<StrictMode>`'s double-invoked dev effects).

## Files changed

- `packages/web-client/src/lib/connection/resume-action.ts` — created.
- `packages/web-client/src/lib/connection/resume-action.test.ts` — created.
- `packages/web-client/src/lib/connection/resume-triggers.ts` — created.
- `packages/web-client/src/main.tsx` — modified (one import + one call, module scope).

## Commands run + results

- `npx vitest run packages/web-client/src/lib/connection/resume-action.test.ts` — **6/6 pass**
  (covers every decision-table row, including the `managerActive: false` short-circuit across
  every status × probeInFlight combination).
- `npx vitest run packages/web-client` — **609/609 pass** (full package suite).
- `npx tsc -b packages/web-client` — succeeds, no type errors.
- `npm run build:web-client` — succeeds.
- `npx oxlint` + `npx oxfmt` on the four touched/created files — 0 errors, no outstanding diff.

## Acceptance criteria status

- [x] `resolveResumeAction` returns exactly the table for every row, including the
      `managerActive: false` short-circuit.
- [x] Becoming visible with a dropped connection calls `reconnectNow()` and nothing else (code
      path: `resolveResumeAction` returns `"reconnect-now"` only for `closed` + active, and the
      wiring's `reconnect-now` branch calls only `reconnection.reconnectNow()`, `return`s
      immediately).
- [x] Becoming visible with a live-looking connection issues one `ping`; resolution results in no
      further action (the `.then` path is empty by construction — only `.catch`/`.finally` do
      anything).
- [x] A probe that times out closes the socket with code 4000; the manager's `closed`-transition
      rung-1 retry reconnects — wired exactly as the spec requires, no explicit `reconnectNow()`
      on this path (code-level: no such call exists in the probe branch).
- [x] Rapid visibility flapping never produces overlapping probes — `probeInFlight` is read by
      `resolveResumeAction` before a new probe starts and set/cleared around the `ping()` call.
- [x] A late probe rejection after a disconnect/reconnect is harmless — the identity check
      (`store.daemon === daemon`) guards the `close()` call.
- [x] Triggers are attached exactly once under `<StrictMode>` in dev — installed at module scope
      in `main.tsx`, not inside a component/effect, so React's dev-mode double-invocation of
      effects/renders never touches this call site.

Per the task's own Test/verification plan, the DOM wiring and live probe/reconnect behavior are
**not** re-verified by a jsdom test here (this repo deliberately has no jsdom environment) — that
verification is task-004's job.

## Follow-ups / TODO(verify)

- Live end-to-end verification of both failure modes (throttled-tab reconnect, stale-socket-after-
  sleep) is task-004's scope, as planned.
