# Task 002 — Tool call detail sheets & permission RPC — Summary

- **Sprint:** sprint-026-timeline-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Wired tool-call cards to real detail data + permission prompts to the daemon
RPC, added auto-approve rules, consecutive-tool-call clustering, and error
display.

1. **Tool detail fetching (`hooks/use-tool-detail.ts`).** `useToolCallDetail`
   returns the detail already on the stream item when present (no fetch);
   otherwise, when the card is expanded and a client/callId are available, it
   fetches via the `agent.toolCall.detail.request` RPC (React Query, immutable
   `staleTime: Infinity`). The existing `buildExpandedDetail` renders the
   per-kind sections (shell/read/edit-diff/write/search/sub_agent/fetch/…).

2. **Permission RPC (`hooks/use-permission.ts` + `timeline/auto-approve.ts`).**
   - `buildRespondPayload` shapes the `agent.permission.respond.request` payload
     with the server's keys (`agentId`, `permissionRequestId`, `response`).
   - `usePermissionResponder(agentId, rules)` submits a decision via RPC and
     optimistically marks the request resolved in the session store (spinner via
     `respondingId`).
   - **Auto-approve**: `evaluateAutoApprove(request, rules)` matches a pending
     request against workspace rules (exact / prefix-`*` / catch-all), only when
     the option is actually offered; the hook auto-responds and marks the entry
     `auto-approved` (deduped so each request fires once).
   - `PermissionPromptCard` — a fully controlled, RPC-driven prompt (Deny/Accept
     variants, per-option spinner, resolved label) for the live auxiliary area.

3. **Tool-call grouping (`timeline/tool-grouping.ts`).** `clusterToolCalls`
   collapses runs of ≥2 adjacent `tool_call` rows into a `ToolCluster` with a
   summary line ("5 tool calls: 2 edits, 1 read, 2 shells"); lone calls stay
   ungrouped; `hasError` set when any call failed. `ToolClusterView` renders a
   collapsible cluster of `ToolCardView`s.

4. **Error display.** `ToolCardView` shows a ⚠ icon + `.cardError` red-accent
   border on failed calls, with the existing Error section in the expanded body.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/timeline/tool-grouping.ts` | created (cluster + summary) |
| `packages/app/src/timeline/tool-grouping.test.ts` | created (4 tests) |
| `packages/app/src/timeline/auto-approve.ts` | created (rules + respond payload) |
| `packages/app/src/timeline/auto-approve.test.ts` | created (7 tests) |
| `packages/app/src/hooks/use-permission.ts` | created (responder + auto-approve) |
| `packages/app/src/hooks/use-tool-detail.ts` | created (detail fetch) |
| `packages/app/src/components/timeline/ToolCards.tsx` | modified (error accent, cluster, controlled permission card) |
| `packages/app/src/components/timeline/ToolCards.module.css` | modified (cluster/cardError/permissionDescription) |
| `packages/app/src/timeline/index.ts` | modified (export tool-grouping + auto-approve) |
| `packages/app/src/hooks/index.ts` | modified (export permission + tool-detail hooks) |

## How it satisfies the scope

- **timeline-rendering.md § Tool-call cards / § Expanded tool detail** — expand
  fetches (or reuses) detail and renders per-kind sections; running shimmer,
  failed alert icon + error section, static completed icon.
- **§ Permission request prompt / tool-permissions.md** — prompts submit via
  `agent.permission.respond.request`; pending → responding (spinner) → resolved;
  the server's first-resolution-wins is respected (RPC returns `resolved:false`
  for stale requests, harmless).
- **task-002 § Auto-approve** — matched requests skip the prompt and respond
  automatically, labelled `auto-approved`.
- **task-002 § Tool call grouping** — consecutive calls cluster with a summary;
  individual cards remain expandable inside the cluster.
- **task-002 § Error display** — failed calls render with a red accent + error
  section.

### Deviations / boundaries
- **Cluster integration into the virtualized list.** `clusterToolCalls` +
  `ToolClusterView` are pure/component-ready and unit-tested; threading clusters
  through the per-row `buildRenderItems`/virtualizer dispatch is applied by the
  timeline container and is deferred to the final timeline assembly (the render
  model dispatches per row today). Documented as a follow-up.
- **`agent.toolCall.detail` daemon RPC** is not implemented in any daemon sprint;
  in practice detail arrives on the stream item, so the hook's fetch path is a
  capability-gated fallback (returns stream detail when present).
- Hooks/components are thin wrappers over the tested pure logic; not
  render-tested (node-only test env, consistent with the suite).

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/timeline/tool-grouping.test.ts \
    packages/app/src/timeline/auto-approve.test.ts
 Test Files  2 passed (2)
      Tests  11 passed (11)

$ npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  122 passed (122)
      Tests  1582 passed (1582)
```

## Acceptance criteria
- [x] Expanding a tool card fetches + renders detail sections with correct
      formatting — `useToolCallDetail` + `buildExpandedDetail` (+ `DetailSectionView`).
- [x] Permission prompts submit via RPC; pending/resolved states reflect —
      `buildRespondPayload` (`auto-approve.test.ts`) + `usePermissionResponder`
      + `PermissionPromptCard` (spinner/resolved).
- [x] Tool calls group into clusters with summary; individual cards expandable —
      `clusterToolCalls`/`summarizeCluster` (`tool-grouping.test.ts`) +
      `ToolClusterView`.
- [x] Errors render with red accent + expandable detail — `.cardError` +
      `buildExpandedDetail` error section.

## Follow-ups / TODO(verify)
- Thread `ToolCluster` through the virtualized render model in the final
  timeline assembly.
- Daemon `agent.toolCall.detail.request` RPC (detail currently on stream item).
- Auto-approve rule source (workspace settings) once the settings surface lands.
