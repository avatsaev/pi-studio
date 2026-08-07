# Task 002 — Summary

## What was built

- **`packages/web-client/src/lib/connection/worker-timers.ts`** — `createWorkerTimers()`
  returns `{ setTimer, clearTimer }` backed by a lazily-created, module-level shared Worker built
  from an inline `Blob` → `URL.createObjectURL` source (no separate asset, no bundler config).
  Worker protocol: main → worker `{ id, ms }` to arm, `{ id, cancel: true }` to cancel; worker →
  main `{ id }` on fire, correlated via a `Map<number, () => void>` on the main side (deleted on
  fire/cancel — no unbounded growth) and a `Set` of pending ids inside the worker (so a message
  racing a same-tick cancel is dropped instead of firing after cancellation). Falls back to plain
  `setTimeout`/`clearTimeout`, latched permanently on first failure, if `Worker` construction
  throws or is unavailable (this repo's Vitest/Node environment has no DOM `Worker`, so the
  fallback is what every unit test exercises).
- **`worker-timers.test.ts`** — 6 cases against the fallback path only (fire, cancel-before-fire,
  no-side-effect-at-import, Node's natural `Worker === undefined` fallback, a stubbed throwing
  `Worker` constructor invoked exactly once across two `setTimer` calls — proving the latch — and
  a fire+cancel pair proving no dangling callback fires later). Each test does
  `vi.resetModules()` + a fresh dynamic import so the module-level singleton backend doesn't leak
  state between cases. File header states plainly that the Worker path itself is unverified here.
- **`connection-store.ts`** — the single `new ReconnectionManager(daemon)` call site now injects
  `createWorkerTimers()`'s `setTimer`/`clearTimer`. Nothing else in the store changed.

## Files changed

- `packages/web-client/src/lib/connection/worker-timers.ts` — created.
- `packages/web-client/src/lib/connection/worker-timers.test.ts` — created.
- `packages/web-client/src/lib/connection/connection-store.ts` — modified (construction site
  only).

## Commands run + results

- `npx vitest run packages/web-client/src/lib/connection/worker-timers.test.ts` — **6/6 pass**.
- `npx vitest run packages/web-client` — **603/603 pass** (full package suite — confirms the
  store change is inert).
- `npx tsc -b packages/web-client` — succeeds, no type errors.
- `npm run build:web-client` (`vite build`) — succeeds.
- `npx oxlint` on the three touched files — 0 errors. Two pre-existing-category `unicorn/
  require-post-message-target-origin` warnings remain on `worker.postMessage(...)` calls inside
  `worker-timers.ts`: this rule is written for `Window.postMessage(message, targetOrigin)` /
  `MessagePort.postMessage`; a dedicated `Worker`'s `postMessage(message, transfer?)` has no
  `targetOrigin` parameter at all, so the rule's own suggested fix (inserting
  `worker.location.origin` as a second argument) would silently pass a string where the API
  expects an array of `Transferable`s — a real bug, not a fix. Left as the warning it is (this
  rule lives in the config's `suspicious` category, `"warn"`, not `"correctness"`/`"error"`;
  `npm run lint` exits 0). A `unicorn/prefer-add-event-listener` warning on `worker.onmessage =`
  was fixed (switched to `addEventListener`) since that one was a legitimate improvement with no
  downside. A `typescript/no-extraneous-class` warning on the test file's stubbed `class { … }`
  (needed because the code under test does `new Worker(url)`) is an unavoidable false positive
  and was left as-is.
- `npx oxfmt` on the three touched files — ran, no outstanding diff.

## Acceptance criteria status

- [x] `createWorkerTimers()` returns working `setTimer`/`clearTimer`; a timer armed for N ms
      fires once, and `clearTimer` before N ms prevents it from firing at all.
- [x] Importing `worker-timers.ts` constructs no Worker; the Worker is created on first
      `setTimer`.
- [x] With `Worker` unavailable or throwing, both functions still behave correctly via the
      `setTimeout` fallback, and the fallback decision is latched (Worker construction is not
      retried per call).
- [x] Fired and cancelled timers leave no entry behind in the pending-callback map.
- [x] `connection-store.ts` constructs `ReconnectionManager` with the injected timers;
      connect/disconnect/reconnect behavior is otherwise unchanged and the existing web-client
      suite passes.

## Follow-ups / TODO(verify)

- The Worker code path itself (not just the fallback) is unverified by automated tests, per this
  repo's no-DOM-Worker Vitest environment — live verification is task-004's job, as this task's
  own Test/verification plan states.
- CSP question already resolved during sprint planning (see the spec's TODO(verify) and this
  task's own Notes section): `docker/web-client.nginx.conf.template` sets no CSP header at all
  today, so blob-URL workers are unconstrained in the hosted deployment.
