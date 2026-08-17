# Task 004 — Attention `StatusDot` on background chat tabs — Summary

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

Added an 8px `StatusDot` between a chat tab's label and its × — spinning ring while that tab's
session has a turn running, `statusDanger` after a failed turn — for chat tabs that are **not** their
pane's active tab. The whole decision is one pure function, `tabAttentionStatus(tab, sessionStatus,
activeInPane)`, unit-tested table-style over every `TabKind`, active/inactive, every protocol status,
and the offline-restore gap (session absent from the store). `TabItem` reads the session's status with
a primitive-valued Zustand selector (a string or `undefined`, never the `SessionEntry` object) so a
stream event on some *other* session never re-renders every tab in the strip.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/tab-attention.ts` | created — `tabAttentionStatus(tab, sessionStatus, activeInPane)` |
| `packages/web-client/src/features/workspace/tab-attention.test.ts` | created — 4 tests, table-driven over kind/active/status/missing-session |
| `packages/web-client/src/features/workspace/TabStrip.tsx` | `TabItem`: added the primitive-valued `sessionStatus` selector, the `tabAttentionStatus` call, and a `<StatusDot status={attention} className={styles.tabDot} />` render between the label and × spans; imports added (`useSessionStore`, `StatusDot`, `ChatTabData`, `tabAttentionStatus`) |
| `packages/web-client/src/features/workspace/TabStrip.module.css` | added `.tabDot { flex: none; }` |

## How it satisfies the scope

- **No new store field.** The dot reads `SessionEntry.status` (already hydrated on reconnect, driven
  live by `hooks/agent-stream-events.ts`) through `status-map.ts`'s `toDotStatus` — the single
  protocol→dot translation point — rather than switching on protocol strings directly or inventing an
  `unread`/`requiresAttention` flag on `Tab`.
- **Only `running`/`error` earn a dot.** `idle`, `initializing`, and `closed` all map to `null` — a
  `closed → finished` session would otherwise paint a permanent `statusSuccess` dot on every finished
  chat tab's pill, which is decoration, not attention. There is no session-level "needs input" status
  in this app's protocol enum (`initializing | idle | running | error | closed`), so the mock's
  warning-colored "needs input" dot is not fabricated — task-005 records that gap in the scope doc.
- **The active tab never gets a dot.** `activeInPane` short-circuits to `null` before the status is
  even consulted — `TurnProgressBar` already sweeps 3px below the strip for a running active tab, and
  a failed turn already renders an `ErrorRow` in the timeline; a ring directly above either would be
  the same information twice.
- **A missing session never throws.** `sessionStatus === undefined` (offline-restore ordering — a chat
  tab can render before its session record lands) short-circuits to `null` before `toDotStatus` is
  ever called, verified by the "does not throw" test.
- **Cheap subscription.** The selector returns `s.sessions[sessionId]?.status` — a primitive
  `AgentStatus | "idle" | undefined` — not the `SessionEntry` object, so a timeline/model/etc. mutation
  on a different session cannot invalidate this tab's memoized selector result. (Verified by reasoning
  from the selector's return type, per the acceptance criterion's stated alternative to a live
  DevTools spot-check — the live browser spot-check itself is deferred to task-005's sweep.)
- **Reserved slot, no placeholder.** `.tabDot { flex: none; }` is the only CSS this task adds — the
  `gap: var(--pi-spacing-7)` between all of `.tab`'s flex children already came from task-002, and
  `StatusDot` itself returns `null` (renders nothing) when `status` is `null`, so no conditional
  wrapper was needed around it in `TabItem`.
- **`TurnProgressBar` untouched** — no source in `features/chat/` was touched by this task, consistent
  with its Out-of-scope.

## Build & test results

```
$ npm run build:web-client
✓ built in 12.91s

$ npm run typecheck
(clean, no output)

$ npx oxlint packages/web-client/src/features/workspace/TabStrip.tsx packages/web-client/src/features/workspace/TabStrip.module.css packages/web-client/src/features/workspace/tab-attention.ts packages/web-client/src/features/workspace/tab-attention.test.ts
(clean, no output)

$ npx oxfmt --check packages/web-client/src/features/workspace/TabStrip.tsx packages/web-client/src/features/workspace/TabStrip.module.css packages/web-client/src/features/workspace/tab-attention.ts packages/web-client/src/features/workspace/tab-attention.test.ts
Format issues found in tab-attention.test.ts → fixed with scoped `npx oxfmt`; re-checked clean.

$ npx vitest run packages/web-client/src/features/workspace
Test Files  8 passed (8)   [+1 vs task-003: tab-attention.test.ts]
     Tests  155 passed (155)  [+4]

$ npx vitest run packages/web-client/src/theme
Test Files  2 passed (2)
     Tests  7 passed (7)

$ npx vitest run packages/web-client
Test Files  58 passed (58)  [+1]
     Tests  783 passed (783)  [+4]
```

## Acceptance criteria

- [x] A pane showing a terminal tab, with a background chat tab whose turn is running, shows a
      spinning ring on that chat tab — `tabAttentionStatus` returns `"running"` for an inactive chat
      tab whose session status is `running`, and `StatusDot` renders a spinning `accentBright` ring
      for `status="running"` (`StatusDot.tsx:31-35`, unchanged); the ring's disappearance when the
      turn ends follows from the live `sessionStatus` selector re-evaluating on the next
      `agent_update`. (Live browser observation deferred to task-005.)
- [x] The same tab shows a `statusDanger` dot after a failed turn, and no dot once `idle` again —
      covered by `tab-attention.test.ts`'s status-mapping test (`"error"` → `"error"`, `"idle"` →
      `null`).
- [x] The pane's active chat tab never shows a dot, running or not — covered by the
      "active-tab-at-any-status" test (5 statuses, all `null`).
- [x] `idle`, `initializing`, `closed` produce no dot; non-chat tabs never produce one — both covered
      directly by dedicated tests.
- [x] The dot sits between the label and the ×, `flex: none`, and its presence changes neither the
      pill's width nor the label's truncation point — the × box was already reserved in task-002
      independent of the dot's presence; `.tabDot`'s own `flex: none` keeps it from ever being the
      element that shrinks.
- [x] A chat tab restored before its session lands in the store renders with no dot and no error —
      covered by the "offline restore gap" test (`sessionStatus: undefined` → `null`, wrapped in a
      `not.toThrow()` assertion).
- [x] `tab-attention.test.ts` covers every kind × active/inactive × status combination and passes — 4
      tests, all green.
- [x] Cheap re-render: the selector returns a primitive (`AgentStatus | "idle" | undefined`), not the
      `SessionEntry` object — recorded here per the acceptance criterion's stated alternative to a
      live DevTools spot-check.

## Follow-ups / TODO(verify)

- Live-browser verification (spinning ring in the actual strip, its disappearance on turn end, the
  danger dot after a real failed turn clearing on a new message, hydrated-status-on-reload producing
  an immediate ring, split-layout isolation, `dark`/`light`/`zinc` ring visibility, and a React
  DevTools highlight-updates spot-check of the cheap-subscription claim) is deferred to task-005's
  § 07 pre-ship verification sweep, per this sprint's established pattern.
