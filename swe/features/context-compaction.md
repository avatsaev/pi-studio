# Feature — Context Compaction UI (manual trigger, live visibility, context meter)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: `agent-sessions.md` (session/turn lifecycle), `timeline-streaming.md` (daemon-owned
> seq/timeline rows, hydration), `timeline-rendering.md` (row renderers), `composer-ui.md`
> (submit gating, slash-command picker), `workspace-ui.md` (status bar), `ui-components.md`
> (overlay primitives), `websocket-protocol` architecture (append-only rules, server feature flags)

## Purpose

Let a user **compact a session's context on demand** from the web UI, **see every compaction as it
happens** (manual and Pi's automatic threshold/overflow compactions), and read context usage at a
glance from a **loading-bar meter** in the status bar instead of today's `42% (84k/200k)` text.

Everything below the UI already exists for the manual trigger: `agent_compact_request`
(protocol), `SlashCommandOperations.handleCompact` (server), the Pi adapter's `compact()`, and
`PiStudioClient.agent(id).compact(instructions?)` (SDK). The web-client never calls it, and no
compaction is ever visible in a timeline.

## Decisions (grilling session, 2026-10-09)

| Question | Decision |
|----------|----------|
| Trigger surfaces | (1) Click the status-bar context meter → popover with **Compact now** + optional instructions; (2) `/compact [instructions]` in the composer, as a client-side built-in |
| Agent running | **Disabled** while the agent is running (no queueing, no confirm-and-abort) |
| Meter style | Bar + short percent (`▰▰▰▱▱ 42%`); exact tokens in the tooltip and popover |
| Status-bar scope | Replace **only** the context segment's text; the total-tokens and cost segments stay unchanged |
| Meter color | Threshold colors: accent < 70 %, warning 70–90 %, danger ≥ 90 % (no auto-compact marker) |
| Feedback | Meter in-progress state + timeline **divider row** + **automatic compactions are shown too** |
| After a compaction | Meter shows an **estimate** from `estimatedTokensAfter`, marked `~`, until the next poll returns a real value |
| Cancel | Yes — reuses the existing interrupt (Stop) RPC |

## Ground truth about Pi (verified against the bundled Pi 1.1.0, 2026-10-09)

These facts drive the design; do not re-derive them from memory.

- **`compact()` aborts first.** `AgentSession.compact()` begins with `await this.abort()`, so a
  manual compaction requested mid-turn kills the in-flight run. It also aborts any in-progress
  compaction, so **a second concurrent `compact` cancels the first**.
- **Events.** Pi emits `compaction_start {reason}` and
  `compaction_end {reason, result?, aborted, willRetry, errorMessage?}`, where
  `reason ∈ "manual" | "threshold" | "overflow"` and `result` is
  `{summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter, usage?, details?}`. The manual
  path emits them around the `compact` RPC; the automatic path emits them **inside a run**: before
  the next LLM request (`_compactBeforeNextAssistantResponse`), after an `agent_end`
  (`_checkCompaction`, an overflow compaction with `willRetry` re-runs the turn), and at prompt
  start. All automatic call sites are within the window between `prompt` and `agent_settled`.
- **Errors surfaced by `compact`:** `"Nothing to compact (session too small)"`, `"Already
  compacted"`, `"Compaction cancelled"` (aborted or extension-cancelled), no-model, and
  summariser/provider failures (`"Compaction failed: …"` in `compaction_end.errorMessage`).
- **Cancel.** The `abort` RPC calls `abortCompaction()`, which cancels manual and automatic
  compaction alike. `compaction_end` then has `aborted: true`.
- **Prompts are rejected while compacting:** `"Cannot submit a prompt while compaction is in
  progress…"`.
- **Context usage after a compaction is unknown.** `getContextUsage()` returns
  `tokens: null, percent: null` until an assistant responds after the latest compaction.
- **Persistence.** A successful compaction appends a `compaction` session entry
  (`{summary, firstKeptEntryId, tokensBefore, details?, usage?, fromHook?}` plus the base entry
  `id`/`timestamp`). It does **not** store `reason` or `estimatedTokensAfter`. Failed or cancelled
  compactions write nothing.
- **`/compact` is a TUI built-in only.** `get_commands` lists extension, prompt and skill commands
  only, and the `prompt` RPC never runs built-ins. The interactive TUI matches `/compact` and
  `/compact <instructions>` before any extension command (`interactive-mode.js`), so a built-in
  always wins there. Description: `"Manually compact the session context"` (`slash-commands.js`).
- **The auto-compaction threshold** is `tokens > contextWindow − reserveTokens` (default 16384,
  settings-overridable per model). It is not exposed over RPC and is not needed by this spec.

## Current state in Pi-Studio (gaps this spec closes)

| # | Gap | Where |
|---|-----|-------|
| G1 | `compaction_start`/`compaction_end` are mapped to `null`, so they are invisible | `providers/pi/event-mapper.ts` (ignored-kinds block) |
| G2 | Stream events are recorded and broadcast **only while `AgentService.runTurn` holds a subscription**. Manual compaction runs outside any turn (`handleCompact` calls `session.compact()` directly), so even mapped events would be dropped | `agent-service.ts` `runTurn`, `providers/pi/agent.ts` `transport.onEvent` → `emit` → `subscribers` |
| G3 | `handleCompact` has no running or in-flight guard: compact mid-turn aborts the turn, and a second compact cancels the first | `slash-command-operations.ts` `handleCompact` |
| G4 | The SDK `compact()` and CLI `compactAgent` use the default 30 s RPC timeout, and real compactions can take longer | `client/src/pistudio-client.ts`, `cli/src/agent-commands.ts` |
| G5 | `applySessionStats` skips null fields (correctly, for transient poll gaps), so after a compaction the old pre-compaction percent stays on screen indefinitely | `web-client/src/hooks/use-session-stats.ts` |
| G6 | Session hydration drops `compaction` entries, so history after a daemon restart shows no compaction | `providers/pi/session-hydration.ts` |
| G7 | The mock provider's `compact()` emits no events, so the dev daemon cannot exercise the flow | `providers/mock/mock-provider.ts` |
| G8 | `agentCompactResponseSchema` does not declare `estimatedTokensAfter` (it rides `.passthrough()` untyped) | `protocol/src/messages.ts` |
| G9 | **Percent scale bug.** Pi's `contextUsage.percent` is 0–100 (`agent-session.js` `getContextUsage`: `(tokens / contextWindow) * 100`), passed through unchanged by the Pi adapter. `stats-store.ts` documents `contextPercent` as a 0–1 fraction, and `formatPercent` guesses the scale (`p <= 1 ? p * 100 : p`), so any session under 1% (0.7) displays as `70%`. The `use-session-stats` test fixture encodes the wrong 0–1 assumption | `web-client/src/stores/stats-store.ts`, `features/workspace/status-bar-format.ts`, `hooks/use-session-stats.test.ts` |

## Public contract

### Protocol (`packages/protocol`, append-only)

**New `AgentStreamEvent` variant** appended to `agentStreamEventSchema`:

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `"compaction"` | |
| `compactionId` | `string` | Correlates the started event with its terminal event. Minted by the provider adapter per compaction. Hydrated rows use the Pi entry `id` |
| `phase` | `"started" \| "completed" \| "failed" \| "canceled"` | |
| `reason` | `"manual" \| "threshold" \| "overflow"`, optional | Absent on hydrated rows (Pi does not persist it) |
| `tokensBefore` | `number`, optional | `completed` only |
| `estimatedTokensAfter` | `number`, optional | `completed` only. Absent on hydrated rows |
| `summary` | `string`, optional | `completed` only |
| `error` | `string`, optional | `failed` only |
| `willRetry` | `boolean`, optional | `true` when an overflow compaction will re-run the interrupted turn |

Wire-safe by construction: neither the SDK receive path nor the web-client reducer runs a zod parse
on `agent_stream` frames, and the reducer already ignores unknown kinds. Older clients render
nothing for this kind.

**`agentCompactResponseSchema.payload`** gets an optional `estimatedTokensAfter: number`.

**New server feature flag** `compactionEvents` in `SERVER_FEATURES` (with its `COMPAT` entry),
advertised by both bootstraps. It means: this daemon emits `compaction` stream events for manual
and automatic compactions, and enforces the running and in-flight guards.

### Server (`packages/server`)

| Surface | Contract |
|---------|----------|
| Pi event mapper | `compaction_start` → `{kind:"compaction", phase:"started", reason, compactionId: <new UUID>}` (the id is remembered as the open compaction). `compaction_end` → the terminal phase with the same id, then the open id is cleared. Phase mapping: `aborted` → `canceled`; `result` present → `completed` (with `tokensBefore`, `estimatedTokensAfter`, `summary`, `willRetry`); otherwise → `failed` with `error: errorMessage`. A `compaction_end` with no open id gets a fresh id (defensive; it still yields one terminal row) |
| `agent_compact_request` | Rejects with a `busy` error when `record.lastStatus === "running"`, or when a compaction is already in flight for the agent (daemon-side single-flight set). Otherwise subscribes to the session **for the duration of the `compact()` call**, appends and broadcasts every `compaction` event through the **same append-and-broadcast path `runTurn` uses** (extracted into one shared helper, not duplicated), and returns the payload including `estimatedTokensAfter`. Non-`compaction` events in this window are not forwarded (unchanged from today's outside-a-turn behavior). The existing `agent_update {compacted:true}` broadcast is kept |
| Process-less record | A record with no live provider session (e.g. after a daemon restart, which never auto-resumes) is resumed through `spawnOrResumeSession`, the same path `send_agent_prompt` uses, instead of failing with `has no live session`. Compacting an old, oversized session before continuing it is a primary use case. The running and in-flight guards run **before** the resume. If the agent has no in-memory timeline store yet, it is seeded from `hydrateTimeline` (the `timeline-rpc.ts` fallback rule) before the first append, so the compaction row cannot create an empty store that would then block history hydration |
| Synthetic terminal | If `compact()` rejects after a `started` event was recorded but no terminal event arrived (process crash, transport failure), the handler records and broadcasts a `failed` event with the same `compactionId` and the error message. A started row is never left without its terminal row on this path |
| Automatic compactions | No new plumbing. They happen inside `runTurn`'s subscription window, so mapping the events (G1) is enough. A `failed` compaction event is not `kind:"error"`, so `runTurn`'s final-status derivation (`turn_failed`/`error` → `"error"`) is unaffected |
| Session hydration | Each Pi `compaction` entry on the active branch becomes one `{kind:"compaction", phase:"completed", compactionId: entry.id, tokensBefore, summary}` row at its branch position, using the entry's timestamp |
| Mock provider | `compact()` emits `started`, waits a short delay (a constant, long enough to see the in-progress state in the dev daemon), emits `completed` with a non-zero `tokensBefore` and `estimatedTokensAfter`, and returns the same values |
| Interrupt | No change. `handleInterrupt` with a live session already calls `session.interrupt()` → Pi `abort` → `abortCompaction()`, and does not touch status when the agent is idle |

### Client SDK (`packages/client`)

- `agent(id).compact(customInstructions?)` passes a compaction-specific timeout
  (`COMPACT_TIMEOUT_MS`, 10 min) to `DaemonClient.request` instead of the 30 s default.
  `rpcTimeoutMs ≠ socket death` still holds: a timeout fails only this call.
- `AgentCompactResponse["payload"]` typing picks up `estimatedTokensAfter`.
- CLI `compactAgent` passes the same timeout (same defect G4, same RPC).

### Web-client (`packages/web-client`)

| Unit | Contract |
|------|----------|
| Timeline row | New `CompactionRow` in the `TimelineRow` union: `{kind:"compaction", id, compactionId, phase, reason?, tokensBefore?, estimatedTokensAfter?, summary?, error?, willRetry?, timestamp?}`. The reducer **upserts by `compactionId`**: `started` creates the row, a terminal phase updates it in place, and a terminal event with no prior row creates it directly (hydration, late join). On `turn_completed`/`turn_failed`/`turn_canceled`, any row still `started` becomes `canceled` (a crash-safety net for the automatic path) |
| Compacting selector | `isCompacting(session)` = the session timeline has a `started` compaction row **or** a local manual request is pending (the local half exists for daemons without `compactionEvents`) |
| Compact action | One shared action `compactSession(sessionId, instructions?)` used by both trigger surfaces: requires a bound `agentId`, not running, not compacting; marks local pending, calls the SDK, clears pending on settle, and returns or raises the RPC error for inline display |
| Stats estimate | On a **live** `compaction` `completed` event with `estimatedTokensAfter` (in `applyAgentStreamEvent`'s live-only side-effect switch, never on replay), set `contextTokens = estimatedTokensAfter`, `contextPercent = estimatedTokensAfter / contextWindow * 100` (when the window is known), and `contextEstimated = true`. On daemons without `compactionEvents`, apply the same from the compact RPC response. `applySessionStats` sets `contextEstimated = false` whenever a poll returns non-null tokens; null polls keep skipping, so the estimate stays until real data arrives |
| Percent scale (G9) | `contextPercent` is Pi's **0–100** scale everywhere in the client. The stats-store doc comment is corrected, and `formatPercent` drops its `p <= 1` guess and always treats the input as 0–100. The meter's fill fraction is `contextTokens / contextWindow` when both are known, falling back to `contextPercent / 100` |
| `ContextMeter` | Replaces the context segment's text in `StatusBar` (details in the UI spec below) |
| Popover primitive | New `components/primitives/Popover.tsx` wrapping `@radix-ui/react-popover` (already a dependency, unused so far; `design-system.md` § Overlays, as cited in `Dialog.tsx`, assigns Radix to dialogs, menus, tooltips and popovers). A popover, not a `DropdownMenu`, because it hosts a text input |
| `/compact` built-in | `slash-commands.ts` gains a client built-in list (one entry: `compact`, description from Pi's own built-in list, `source: "builtin"`) merged into the picker options ahead of Pi commands. On submit, a draft whose token is exactly `compact` (Pi's case-sensitive grammar) is intercepted: it never reaches `send_agent_prompt` or steer, it calls `compactSession` with the trimmed remainder as instructions, and it clears the draft on success. It shadows any Pi extension command named `compact`, matching the TUI's built-in-first precedence |
| Composer gating | `isComposerBusy` takes the compacting state into account: while compacting, Send is disabled (Pi rejects prompts) and **Stop is shown** and calls the existing interrupt. While running, a `/compact` draft cannot be submitted (Send disabled, not routed to steer) |

## UI specification

### Context meter (status bar)

```
 ┌─ status bar ────────────────────────────────────────────────────────────────────┐
 │ [📁 ~/dev/app] › [⑂ main ↑1] › [◔ ▰▰▰▰▱▱▱▱▱▱ 42%] › [🪙 16.4k] › [$ 0.42]        │
 └─────────────────────────────────────────────────────────────────────────────────┘
                                  ▲ button; click → popover
```

- The `Gauge` icon stays. Then an **80 px × 6 px** track (`surface3`, radius full) with a fill of
  width `clamp(fraction, 0, 1)` (fraction per the Percent-scale row above), then the percent text
  using `formatPercent`.
- Fill color by fraction: `< 0.70` → `--pi-color-accent`; `0.70 ≤ p < 0.90` →
  `--pi-color-statusWarning`; `≥ 0.90` → `--pi-color-statusDanger`.
- **Estimated:** the text gets a `~` prefix (`~7%`) and the fill is rendered at reduced opacity or
  hatched. The title says it is an estimate.
- **Unknown** (no stats yet, or Pi's post-compaction null with no estimate, e.g. after a reload):
  empty dashed track and `—`.
- **Compacting:** an indeterminate sweep across the track, text `Compacting…`. Under
  `prefers-reduced-motion` the bar is static and striped with no movement.
- Tooltip (`title`): `84.1k / 200k tokens` (estimated: `≈ 14.2k / 200k tokens (estimate)`).
- Accessibility: the visual is a `role="meter"` with `aria-valuemin/max/now` (and `aria-valuetext`
  for unknown, estimated and compacting). It is wrapped in a reset `<button>` (background, border
  and cursor explicitly reset) with an `aria-label` that names the action.
- No session → the segment is not rendered, as today. Session without `agentId` → the meter renders
  as unknown and the popover's action is disabled.

### Compaction popover

```
 ┌──────────────────────────────────────────┐
 │ Context                                  │
 │ ▰▰▰▰▰▰▰▰▱▱  84.1k / 200k  (42%)          │
 │                                          │
 │ Instructions (optional)                  │
 │ ┌──────────────────────────────────────┐ │
 │ │ focus on the auth refactor           │ │
 │ └──────────────────────────────────────┘ │
 │ <inline error, if the last attempt failed>│
 │                          [ Compact now ] │
 └──────────────────────────────────────────┘
```

Button states (one button, in priority order):

| Condition | Button | Note line |
|-----------|--------|-----------|
| compacting | **Cancel** (calls interrupt) | `Compacting…` (+ reason when automatic) |
| running | Compact now, disabled | `Wait for the agent to finish` |
| no `agentId` | Compact now, disabled | `Nothing to compact yet` |
| otherwise | **Compact now** | — |

An RPC error (e.g. `Nothing to compact (session too small)`, `Already compacted`, `busy`) is shown
inline in the popover. The instructions field keeps its text after a failure and clears after a
success.

### Timeline divider row

```
 ───────────── ⟳ Compacting context… (auto · threshold) ─────────────
 ───────────── ✓ Context compacted · 168k → ~14k  [▸ summary] ───────
 ───────────── ✕ Compaction failed: <error> ─────────────────────────
 ───────────── ○ Compaction canceled ────────────────────────────────
```

- A full-width centered-label divider, muted, not a chat bubble. It is never a fork or row-action
  target and does not count toward `userMessageCount`.
- `completed` reads `168k → ~14k` when `estimatedTokensAfter` is known, otherwise `168k before`
  (hydrated). The reason label is shown only when known (`manual`, `auto · threshold`,
  `auto · overflow`; overflow with `willRetry` adds `retrying turn`).
- The summary is collapsed by default. Expanding it renders the summary as markdown with the
  existing assistant-markdown renderer.

## Behavior & algorithms

```
# daemon — manual path
handleCompact(agentId, instructions):
    managed = manager.get(agentId) or raise unknown agent
    if managed.record.lastStatus == "running": raise busy("agent is running")
    if agentId in compactionsInFlight:        raise busy("compaction already in progress")
    compactionsInFlight.add(agentId)
    try:
        session = managed.session or await spawnOrResumeSession(agentId)
        if not session.compact:               raise unsupported
        if no in-memory timeline for agentId: seed it from hydrateTimeline(handle)
        openId = null; terminalSeen = false
        unsubscribe = session.subscribe(event ->
            if event.kind != "compaction": return
            if event.phase == "started": openId = event.compactionId
            else: terminalSeen = true
            appendAndBroadcast(agentId, event))   # the one helper runTurn also uses
        try:
            payload = await session.compact(instructions)
        catch err:
            if openId and not terminalSeen:
                appendAndBroadcast(agentId, {kind:"compaction", compactionId: openId,
                                             phase:"failed", error: message(err)})
            raise err
        finally:
            unsubscribe()
    finally:
        compactionsInFlight.delete(agentId)   # every path, incl. resume/unsupported failures
    broadcastAgentUpdate(agentId, {compacted: true})
    return payload

# web-client — reducer
on compaction event e:
    row = rows.find(kind == "compaction" and compactionId == e.compactionId)
    if row: update row with e's phase/fields
    else:   append new CompactionRow from e
on turn_completed | turn_failed | turn_canceled:
    for row in rows where kind == "compaction" and phase == "started": row.phase = "canceled"

# web-client — meter state
meterState(stats, compacting):
    if compacting:                       return COMPACTING
    if stats.contextTokens and stats.contextWindow: fraction = contextTokens / contextWindow
    elif stats.contextPercent is defined:           fraction = contextPercent / 100
    else:                                           return UNKNOWN
    return { fraction, estimated: stats.contextEstimated == true }
```

## Data & persistence touchpoints

- No new daemon state files. `compactionsInFlight` is an in-memory set (a daemon restart kills the
  Pi child process and any compaction with it).
- Compaction rows live in the in-memory `AgentTimelineStore` like any other event. After a daemon
  restart they are rebuilt from Pi's JSONL by session hydration (completed compactions only).
- `stats-store` gains `contextEstimated?: boolean` (client memory only).

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Compact while agent running (any client, incl. CLI) | Daemon rejects with `busy`. The web UI disables the action earlier |
| Two clients compact at once | The second gets `busy`. Both see the first compaction live through the broadcast |
| Session too small / already compacted | Pi error returned inline in the popover. A `failed` divider row records it (Pi emits `compaction_end` with `errorMessage` before throwing) |
| Cancel during compaction | Interrupt → Pi aborts → `canceled` row, meter returns to the previous value, composer re-enabled |
| Pi process dies mid-compaction | Manual path: synthetic `failed` row. Automatic path: the reducer closes the open row as `canceled` at turn end |
| Overflow compaction with `willRetry` | `completed` row labeled `retrying turn`. The turn keeps running; the meter shows the estimate, then real data at turn end |
| Reload during a compaction | The timeline refetch replays the `started` row, so the meter and composer show compacting. The terminal event arrives live |
| Reload after a compaction, before the next turn | Pi reports null usage and no estimate is cached → meter shows unknown (`—`) until the next turn |
| Compact after a daemon restart, session never resumed | The daemon resumes the Pi process first, then compacts. The meter showed unknown until then (the stats poll needs a live session) |
| Daemon without `compactionEvents` | Manual compaction still works. In-progress state comes from the local pending flag, there is no divider row, and the estimate comes from the RPC response. Automatic compactions stay invisible |
| `/compact` typed while running | Send disabled for that draft. Never sent as a steer |
| `/compact` on a fresh chat with no agent | Send disabled, same as the popover's `Nothing to compact yet` |
| SDK timeout (> 10 min) | Call fails with `RpcTimeoutError`. The socket stays up and the row state keeps following the stream events |
| Extension `session_before_compact` cancels | Pi reports `aborted` → `canceled` row. The RPC rejects with `Compaction cancelled` |

## Dependencies on other specs

- `timeline-streaming.md` — daemon-owned seq, `fetch_agent_timeline` projection (`OtherItem`
  1:1) and hydration rules. The new kind adds no projection rule.
- `composer-ui.md` — submit and stop gating, slash-command picker semantics.
- `workspace-ui.md` — the status-bar segment model.
- `ui-components.md` — the Popover primitive joins the overlay primitives.
- `websocket-protocol` architecture — the append-only variant and the server feature-flag pattern.

## Acceptance criteria

- [ ] Given an idle session with history, when the user clicks the context meter and presses
      **Compact now**, then a `Compacting context… (manual)` divider appears in **every** connected
      client's transcript, the meter shows the compacting state, Send is disabled and Stop is
      visible.
- [ ] When that compaction completes, the divider reads `Context compacted · <before> → ~<after>`
      with an expandable summary, and the meter shows `~N%` from `estimatedTokensAfter`.
- [ ] After the next turn completes and the stats poll returns real usage, the `~` and estimate
      styling are gone.
- [ ] `/compact focus on X` submitted from the composer compacts with `customInstructions:
      "focus on X"` and never produces a user-message row or a `send_agent_prompt` request.
- [ ] While the agent is running, the popover's action is disabled with `Wait for the agent to
      finish`, and a `/compact` draft cannot be submitted.
- [ ] A direct `agent_compact_request` against a running agent, or one sent while a compaction is
      in flight, is rejected with `busy` and does not abort anything.
- [ ] Pressing Cancel (popover) or Stop (composer) during a compaction produces a
      `Compaction canceled` divider and leaves the session idle and usable.
- [ ] An automatic threshold or overflow compaction during a turn shows a live divider with the
      `auto · …` reason in every client.
- [ ] After a daemon restart, a compacted session's transcript shows a `Context compacted ·
      <before> before` divider at the compaction's position.
- [ ] After a daemon restart, **Compact now** on a session that was never resumed resumes the Pi
      process and compacts, and the transcript keeps its full history above the new divider.
- [ ] The meter's fill uses accent below 70 %, warning from 70 % and danger from 90 %. Unknown
      usage renders an empty dashed track with `—`. Reduced-motion users see no animation.
- [ ] A compaction that takes longer than 30 s does not fail in the UI or the CLI.
- [ ] Against a daemon without `compactionEvents`, Compact now still works with a local in-progress
      state and no divider.
- [ ] The dev daemon (mock provider) shows the full started → completed flow.

## Out of scope

- An auto-compaction threshold marker on the meter (needs `reserveTokens` exposed over the wire).
- Toggling auto-compaction (`set_auto_compaction`), a compaction settings UI, and token or cost
  display changes beyond the context segment.
- Session-row ⋮ menu trigger and toast feedback (not selected).
- Queueing a compaction until a running turn ends.
- Forwarding non-compaction events emitted outside a turn (pre-existing behavior, unchanged).

## Resolved (verified live, sprint-074 task-009)

- **`CommandMenu` disabled rows:** supported. The built-in `compact` row renders dimmed with
  `aria-disabled="true"` while running / compacting / agentless, and is not selectable.
- **`compaction_end` before `compact` rejects:** confirmed against real Pi 1.1.0. On the manual
  failure path Pi emits `compaction_end {errorMessage}` and then throws (`Nothing to compact
  (session too small)` produced a live `failed` divider in two windows, with the RPC error shown
  inline). The `errorMessage` text is `Compaction failed: <cause>` (manual) or
  `Auto-compaction failed: <cause>` (automatic); the mapper strips that prefix so the divider does
  not read `Compaction failed: Compaction failed: ...` (found by this run).
- **`busy` wording:** `busy: agent <id> is running; wait for the turn to finish before compacting`
  (`handler_error` envelope), observed from `pi-studio agent compact` against a running agent, with
  the turn continuing undisturbed.
- **Cancel:** Stop mid-summarisation produces a `canceled` divider within ~0.3 s. Pi rejects the RPC
  afterwards (`Turn prefix summarization failed: This operation was aborted`); the web client
  classifies that as `canceled` (no inline error) because the user requested the cancel.
- **Not verified:** the old-daemon fallback (a daemon without `compactionEvents`) was not run live;
  it is covered by the web-client store/reducer tests only. Relay transport was not exercised.
