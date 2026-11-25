/**
 * `isComposerBusy` — the composer's busy/lockup derivation (sprint-068/task-002, restated for
 * sprint-152). Extracted purely so a regression test can pin the one property: **once a turn is
 * `running`, busy tracks `steering` alone — never `sending`.**
 *
 * `sending` covers a request only. The daemon answers `send_agent_prompt` when it ACCEPTS the
 * prompt, not when the turn ends (`composer-send.ts`), so the flag is `true` for as long as the
 * materialize and send round trips take and no longer. From the answer on the session is `running`
 * (`lib/agent-status.ts`) until the turn ends, and only the one `agent_update` (`idle` or `error`)
 * the daemon sends after the turn's last row ends it: a `turn_*` row does not, because the daemon
 * still refuses a send until that update has gone out. It is also the only end signal a prompt an
 * extension handles inline has. A turn can be blocked arbitrarily long on a pending extension
 * dialog (`agent_ui_request`);
 * `running` holds through all of it. While running the composer offers Steer instead of Send, so
 * the only request that can be in flight is a steer, and that alone locks it. Before a turn runs
 * (idle or error), `sending` locks it for the length of the request, so Enter cannot send twice.
 *
 * A send the daemon refuses (`busy`, an unknown agent) or that loses its connection never makes
 * the session `running`: the optimistic row is marked failed (`timeline/reducer.ts`'s
 * `markUserMessageFailed`, which leaves a row the daemon already confirmed alone) and the reason
 * is toasted.
 */
export function isComposerBusy(running: boolean, sending: boolean, steering: boolean): boolean {
  return running ? steering : sending;
}
