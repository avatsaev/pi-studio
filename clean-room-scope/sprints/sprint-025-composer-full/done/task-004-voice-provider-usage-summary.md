# Task 004 — Voice dictation & provider usage footer — Summary

- **Sprint:** sprint-025-composer-full
- **Completed:** 2026-07-06
- **Status:** done (voice dictation deferred by explicit user instruction)

## Scope note

The user explicitly instructed **"voice integration can be skipped for now"**
during this sprint. Accordingly, this task delivers the **provider usage
footer** end to end and **defers voice dictation / realtime voice**. The pure
voice state models (`voice.ts`: `DictationState`, `RealtimeVoiceState`, phase
machine) already exist from sprint-015 and remain tested; only the runtime
wiring (MediaRecorder, Web Audio volume meter, STT) is deferred. Tracked below
as a follow-up.

## What was implemented (provider usage)

1. **Per-agent live usage → session store.** Added `setAgentUsage(agentId,
   usage)` (deep-merges into `AgentEntry.usage`) and wired `agent_usage` /
   `agent_usage_update` daemon events in `subscribeSessionStore` to populate it.

2. **Usage formatting (`usage-format.ts`, pure).**
   - `formatTokens` (950 → "950", 1234 → "1.2k", 1.5M → "1.5M"),
     `formatCost` ($0.03), `totalTokens`, `hasUsage`.
   - `formatUsageLabel(usage, modelLabel)` → the compact footer label
     `"Claude Sonnet · 1.2k tokens · $0.03"` (segments omitted when absent;
     `undefined` when nothing to show → footer hides).
   - `usageBreakdown(usage)` → input/output/cached/cost rows for the popover.
   - Provider *account* usage helpers from `provider-usage.md`: `deriveTone`
     (>90 danger / 70–90 warning / <70 default), `resolveWindow` (usedPct from
     remainingPct, tone, at-risk), `mostRelevantWindow` (at-risk first, else
     highest used%) for the compact composer window.

3. **Usage hooks (`use-usage.ts`).**
   - `useAgentUsage(agentId, modelLabel)` → `{ label, breakdown }`, live via the
     session store.
   - `useProviderUsageSupported(serverId)` — reads `server_info.features
     .providerUsageList`.
   - `useProviderUsage(serverId, client, supported)` — React Query for
     `provider_usage_list_request`, enabled only when connected + supported;
     5-minute stale time; no refetch on focus/reconnect (manual refresh only).

4. **Composer footer.** Shows the live usage label; clicking it opens a
   breakdown popover (input/output/cached tokens + cost), dismissed by
   re-clicking. Hidden entirely when no usage is advertised. Wired in
   `AgentPane` via `useAgentUsage` (model label from the agent entry).

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/composer/usage-format.ts` | created (pure formatting + tone/window helpers) |
| `packages/app/src/composer/usage-format.test.ts` | created (14 tests) |
| `packages/app/src/hooks/use-usage.ts` | created (usage hooks) |
| `packages/app/src/store/session-store.ts` | modified (`setAgentUsage` action) |
| `packages/app/src/hooks/use-session-hooks.ts` | modified (`agent_usage` event wiring) |
| `packages/app/src/store/session-store.test.ts` | modified (+2 usage tests) |
| `packages/app/src/components/timeline/Composer.tsx` | modified (usage label + breakdown popover) |
| `packages/app/src/components/workspace/PaneContentRouter.tsx` | modified (feed usage) |
| `packages/app/src/composer/index.ts` | modified (export usage-format) |
| `packages/app/src/hooks/index.ts` | modified (export usage hooks) |

## How it satisfies the scope

- **composer-ui.md § Provider usage** — live token/cost footer label subscribed
  to `agent.usage.update`; breakdown popover with input/output/cached/cost;
  hidden when usage not advertised.
- **provider-usage.md § Fetching / Rate-limit window bar / Surfaces** —
  `useProviderUsage` gated by `providerUsageList` with 5-min stale + manual
  refresh; `resolveWindow` + `deriveTone` + `mostRelevantWindow` implement the
  window-bar resolution and the composer's "single most relevant window"
  selection.

### Deferred (per user instruction) / boundaries
- **Voice dictation & realtime voice runtime** (MediaRecorder, Web Audio volume
  meter, STT streaming, `Cmd+Shift+V`) — deferred. Pure state models remain in
  `voice.ts` and are tested.
- **Settings → Provider Usage section** (per-host card with balance/window
  bars) — the data hook + resolution helpers are complete; the Settings card UI
  is a follow-up (sprint-028 polish / settings screen). The composer-footer
  surface is delivered here.
- **Daemon `provider_usage_list` RPC + `providerUsageList` flag** are not
  implemented in any daemon sprint (per provider-usage.md dependencies); the
  hook degrades cleanly (disabled when unsupported).

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/composer/usage-format.test.ts \
    packages/app/src/store/session-store.test.ts
 Test Files  2 passed (2)
      Tests  41 passed (41)

$ npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  118 passed (118)
      Tests  1555 passed (1555)
```

## Acceptance criteria
- [~] Mic button records / volume meter / transcribes — **deferred** (voice
      skipped per user instruction); pure state model retained + tested.
- [x] Provider usage shows live token/cost count during agent execution —
      `formatUsageLabel` + `useAgentUsage` + `agent_usage` event wiring
      (`usage-format.test.ts`, `session-store.test.ts`).
- [x] Usage popover shows breakdown; hides when usage not advertised —
      `usageBreakdown` + Composer footer popover; `formatUsageLabel` returns
      undefined (footer hidden) when no usage.
- [~] Voice keyboard shortcut — **deferred** with voice.

## Follow-ups / TODO(verify)
- Voice dictation + realtime voice runtime wiring (MediaRecorder / Web Audio /
  STT), and the `Cmd+Shift+V` / `Cmd+D` shortcuts.
- Settings → Provider Usage per-host card UI (data layer ready).
- Daemon `provider_usage_list_request/response` + `providerUsageList` feature
  flag (daemon-side work, no completed sprint yet).
- Footer "most relevant window" tie-breaking rule when several windows share the
  same used% (provider-usage.md TODO).
