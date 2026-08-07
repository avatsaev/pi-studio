# Task 002 — Worker-backed timers for the reconnect ladder

- **Sprint:** sprint-050-connection-resilience
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (lib/connection)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Back `ReconnectionManager`'s backoff timers with a dedicated Web Worker so reconnect scheduling
keeps real-time accuracy in a hidden tab, instead of being clamped to browser
intensive-throttling granularity (~1 fire/minute after ~5 minutes hidden).

## Context / why

`connection-store.ts` constructs `new ReconnectionManager(daemon)` with no options, so the manager
falls back to `setTimeout`/`clearTimeout` on the main thread. Chrome's intensive throttling turns
the designed 500 ms first retry into up to a minute of dead air and rounds every subsequent rung up
to the next minute boundary — the user returns to a tab that has been disconnected for minutes when
the daemon was reachable again within seconds. Worker timers are exempt from page-visibility
throttling, and `ReconnectionManager` already accepts injected `setTimer`/`clearTimer` (added for
tests), so this is a construction-site change with no SDK modification.

## Scope references

- `clean-room-scope/features/connection-resilience.md` § Purpose (item 1); § Public Contract → New
  web-client modules (`worker-timers.ts`); § Error Handling (Worker construction throws)
- `packages/web-client/src/lib/connection/worker-timers.ts` — create
- `packages/web-client/src/lib/connection/worker-timers.test.ts` — create
- `packages/web-client/src/lib/connection/connection-store.ts` — modify (the single
  `new ReconnectionManager(daemon)` call site, line ~95)
- `docker/web-client.nginx.conf.template` — read-only check (see Notes)

## What to build

**Create `lib/connection/worker-timers.ts`:**

```ts
export function createWorkerTimers(): {
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};
```

- Worker source is an **inline string → `Blob` → `URL.createObjectURL`** — no separate asset file, no
  Vite worker plugin config, nothing for the bundler to resolve.
- Worker protocol: main → worker `{ id, ms }` to arm and `{ id, cancel: true }` to cancel; worker →
  main `{ id }` on fire. Correlate pending callbacks in a `Map<number, () => void>` keyed by a
  monotonically increasing id; delete the entry when it fires or is cancelled so the map cannot grow
  unbounded across a long-lived connection.
- **One lazily-created module-level Worker**, shared by all callers; created on first `setTimer`, not
  at import time (importing this module must have no side effects).
- **Fallback:** if `Worker`/`Blob`/`URL.createObjectURL` is unavailable or construction throws, fall
  back to plain `setTimeout`/`clearTimeout` permanently (latch the decision — do not retry Worker
  construction on every call). Behavior then equals today's; the feature degrades, never regresses.
- The returned `clearTimer` must accept a handle produced by either path and cancel correctly.

**Modify `connection-store.ts`:** pass the timers into the manager —
`new ReconnectionManager(daemon, { setTimer, clearTimer })`. Nothing else in the store changes.

## Out of scope

- Resume triggers / probes (task-003).
- Any use of worker timers for RPC or ping timeouts inside `DaemonClient` (no seam exists; explicitly
  out of scope per the spec).
- A periodic keepalive ping loop (spec § Out of scope).

## Acceptance criteria

- [ ] `createWorkerTimers()` returns working `setTimer`/`clearTimer`; a timer armed for N ms fires
      once, and `clearTimer` before N ms prevents it from firing at all.
- [ ] Importing `worker-timers.ts` constructs no Worker; the Worker is created on first `setTimer`.
- [ ] With `Worker` unavailable or throwing, both functions still behave correctly via the
      `setTimeout` fallback, and the fallback decision is latched (Worker construction is not
      retried per call).
- [ ] Fired and cancelled timers leave no entry behind in the pending-callback map.
- [ ] `connection-store.ts` constructs `ReconnectionManager` with the injected timers; connect /
      disconnect / reconnect behavior is otherwise unchanged and the existing web-client suite passes.

## Test / verification plan

- Tests: `packages/web-client/src/lib/connection/worker-timers.test.ts`.
  **Note the environment limit and do not paper over it:** this repo's Vitest runs in the Node
  environment with no DOM `Worker`, so unit tests exercise the **fallback path** (fire, cancel,
  latching, map cleanup) — stub `globalThis.Worker` to a throwing constructor for the
  explicit-failure case. The Worker path itself is **not unit-testable here**; it is verified live in
  task-004. State this in the test file header rather than implying coverage that does not exist.
- Run: `npx vitest run packages/web-client/src/lib/connection/worker-timers.test.ts`, plus the full
  web-client suite to confirm the store change is inert.
- Build: `npm run build`; typecheck `npm run typecheck`; `npx oxlint` + `npx oxfmt` on touched files
  only.

## Notes

- **CSP `TODO(verify)` — resolved during planning, re-verify if the deployment changes.** The spec
  asked whether the hosted deployment's CSP permits `worker-src blob:`.
  `docker/web-client.nginx.conf.template` sets **no `Content-Security-Policy` header at all** (no CSP
  directive anywhere under `docker/`), so blob-URL workers are unconstrained in the hosted
  deployment today. The fallback still earns its place for embedded/hardened hosts and any future
  CSP. If a CSP is ever added to that template, it must include `worker-src blob:`.
- Do not add a jsdom test environment for this — the repo deliberately has none (see the
  `text-viewer-state.ts` / `molecule-reload.ts` pure-core convention).
