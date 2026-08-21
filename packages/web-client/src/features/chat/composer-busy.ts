/**
 * `isComposerBusy` — the composer's busy/lockup derivation (sprint-068/task-002). Extracted purely
 * so a regression test can pin the one property that keeps a dialog-blocked turn from ever locking
 * the composer: **once a turn is `running`, busy tracks `steering` alone — never `sending`.**
 *
 * Why this matters: `client.agent(id).send(...)`'s promise does not resolve until the WHOLE turn
 * completes (`packages/server/src/agent/agent-service.ts` `runTurn` awaits `session.run`, which in
 * turn waits for a terminal stream event — root invariant 6, `rpcTimeoutMs` ≠ socket death). A turn
 * can be blocked arbitrarily long on a pending extension dialog (`agent_ui_request`), so `sending`
 * (gated on that promise) can stay `true` — or flip to `false` after a client-side
 * `RpcTimeoutError` — for the entire time a dialog is pending. `running`, by contrast, is driven by
 * the stream's `agent_update` broadcast, sent the instant the turn starts and cleared only when it
 * truly ends. `Composer.tsx`'s own `user_message` broadcast additionally arrives synchronously,
 * before the provider even begins running the turn (`runTurn`'s "if provider never emits a
 * user_message, emit one ourselves" fallback fires before `session.run` is awaited), so the
 * optimistic row is always reconciled long before any dialog could possibly appear — see
 * `timeline/reducer.ts`'s `markUserMessageFailed`, whose own no-op-once-reconciled guard is what
 * keeps a late `send()` rejection (timeout or otherwise) from ever clobbering an already-confirmed
 * row back into a spurious failure.
 */
export function isComposerBusy(running: boolean, sending: boolean, steering: boolean): boolean {
  return running ? steering : sending;
}
