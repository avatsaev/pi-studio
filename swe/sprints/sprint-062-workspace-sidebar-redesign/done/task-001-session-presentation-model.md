# Task 001 — Sidebar session presentation model (pure)

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client — features/sessions
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

A pure module that turns a `SessionEntry` into the sidebar's row presentation (state kind, meta
text, optional short failure reason, `StatusDot` input, italic-title flag) and a workspace's
sessions into the collapsed band's attention dot — unit-tested, with no React and no store access.

## Context / why

Design spec § 03 replaces today's meta line (`cwd · agentId · N msgs`,
`SessionItem.tsx:49-52`) with **status only**, and defines five row states:

| § 03 state | Visual |
|---|---|
| running | `Spinner`/ring in `accentBright`, meta `running` |
| needs input | `StatusDot` `statusWarning`, meta in `statusWarning` |
| turn failed | `StatusDot` `statusDanger`, row tint `color-mix(destructive 10%, transparent)`, meta `turn failed` + a short reason |
| idle | no dot, meta `foregroundMuted` |
| empty | italic title, meta `no messages` at `opacity-50` |

Two of those need decisions this app's data model forces, which is why the logic lands in a pure
module instead of being smeared across JSX:

**(a) `needs input` has no source and must not be faked.** The web client has no permission
plumbing at all — nothing in `packages/web-client/src` references the daemon's
`agent.permission.*` RPCs, and the protocol status enum this client stores
(`SessionEntry.status: AgentStatus | "idle"` = `initializing | idle | running | error | closed`)
has no `waiting` member; `status-map.ts`'s `MAP` is the single translation point into the design
system's wider dot vocabulary and never produces `waiting`. Same call sprint-061/task-004 made for
the tab strip's needs-input dot: **not implemented, documented as unsourced**, never invented.

**(b) `turn failed · <short reason>` *is* sourceable, with no protocol work.**
`hooks/agent-stream-events.ts:41-42` sets `status: "error"` on `turn_failed`, and
`timeline/reducer.ts:202-205` appends `{ kind: "error", text: event.error || "turn failed" }` to
that same session's timeline — which the sidebar already holds, because `SessionEntry.timeline` is
part of the store entry the rows render from. The reason is therefore the **last** `kind: "error"`
row's text, looked up only when the session is in the failed state.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (session rows, STATE → TOKEN
  table, "No timestamps, no cost"), § 02 (token mapping), § 07 (DO NOT: don't hand-roll a
  spinner/dot; don't invent state)
- `swe/features/app-navigation-screens.md` § Global navigation shell (§ Sidebar content)
- `packages/web-client/src/stores/session-store.ts:19-37` — `SessionEntry` (`status`, `timeline`,
  `userMessageCount`, `title`)
- `packages/web-client/src/timeline/row-model.ts:98-126` — `ErrorRow`, `TimelineState.rows`
- `packages/web-client/src/timeline/reducer.ts:202-217` — `onTurnFailed` / `onError` row text
- `packages/web-client/src/hooks/agent-stream-events.ts:35-46` — turn events → session status
- `packages/web-client/src/features/sessions/status-map.ts` — `toDotStatus`
- `packages/web-client/src/ui/status-dot.ts:17-66` — `StatusDotInput`, `statusDotColor`
- Create: `packages/web-client/src/features/sessions/session-presentation.ts` (+ `.test.ts`)

## What to build

One new module, `features/sessions/session-presentation.ts`, exporting:

```ts
export type SidebarSessionState = "running" | "failed" | "empty" | "idle";

export interface SidebarSessionView {
  state: SidebarSessionState;
  /** Meta-line label: "running" | "turn failed" | "no messages" | "idle". */
  meta: string;
  /** Second meta segment — the failure reason. Non-null only when state === "failed". */
  reason: string | null;
  /** `StatusDot` props, or null when no dot/ring renders (idle, empty). */
  dot: StatusDotInput | null;
  /** True for a never-used session — § 03 renders its title italic. */
  titleItalic: boolean;
}

export function sidebarSessionView(session: SessionEntry): SidebarSessionView;

/** Collapsed workspace band: a dot only when a child needs attention, else null. */
export function workspaceAttentionDot(sessions: SessionEntry[]): StatusDotInput | null;
```

Rules:

1. **State precedence** — `error` → `failed`; `running` → `running`; otherwise `userMessageCount
   === 0 && timeline.rows.length === 0` → `empty`; else `idle`. `initializing` and `closed` fall
   into `idle` (a permanently green "finished" dot on every closed session is decoration, not
   status — same reasoning sprint-061/task-004 applied to tab dots).
2. **Dot** — build it through `toDotStatus`, so this module adds no second status vocabulary:
   `running` → `{ status: "running" }` (the primitive already renders the `accentBright` spinning
   ring for exactly that input, `StatusDot.tsx:31-39` — nothing hand-rolled), `failed` →
   `{ status: "error" }` → `statusDanger`, `idle`/`empty` → `null` (do **not** pass
   `showInactive`; § 03's idle state has no dot, unlike today's `SessionItem`).
3. **Reason** — only for `failed`: scan `timeline.rows` **backwards**, stop at the first
   `kind === "error"`, take its `text`, keep the first line, `trim()`, and cap at 120 chars (the
   row ellipsises visually; the cap just keeps a multi-KB provider error out of the DOM). No
   trailing `…` glyph — CSS `text-overflow` owns that. No error row (possible after a reload
   hydrates status without history) → `reason: null`, meta still `turn failed`.
4. **`workspaceAttentionDot`** — `{ status: "error" }` when any session is in the `failed` state,
   else `null`. Running is deliberately **not** attention (§ 03: "optional `StatusDot` when
   collapsed and a child needs attention"); with needs-input unsourceable, `error` is the only
   real attention signal this client can observe.
5. The scan in rule 3 runs **only** in the failed branch, so the common path stays O(1) —
   `SessionList` re-renders every row on every stream event today (it selects the whole `sessions`
   record), and this module must not add per-event work per row.

## Out of scope

- Any component, CSS or markup change (tasks 002–004).
- Any new store field, selector, protocol field, or permission plumbing.
- A `needs input` state, a `waiting` status, per-session cost or timestamps.

## Acceptance criteria

- [ ] `sidebarSessionView` returns `running`/`failed`/`empty`/`idle` per the precedence in rule 1,
      including `initializing`/`closed` → `idle`.
- [ ] A failed session's `reason` is the **last** error row's text (not the first), single-line,
      trimmed, ≤ 120 chars; a failed session with no error row yields `reason: null`.
- [ ] `reason` is `null` for every non-failed state.
- [ ] `dot` is `null` for `idle` and `empty`; `{ status: "running" }` for running; a
      `statusDanger`-colored input for failed (assert via `statusDotColor`, not a literal).
- [ ] `titleItalic` is true only for `empty`.
- [ ] `workspaceAttentionDot` returns a `statusDanger` input when any child failed, `null` for a
      mix of running/idle/empty children, and `null` for an empty array.
- [ ] No React or zustand import in `session-presentation.ts`, and no runtime store access. The
      only store touch-point is the type-only `import type { SessionEntry }` from
      `stores/session-store.js` — the exact shape `workspace-grouping.ts:7` already uses.

## Test / verification plan

- Tests: create `packages/web-client/src/features/sessions/session-presentation.test.ts`; run
  `npx vitest run packages/web-client/src/features/sessions/session-presentation.test.ts` — all
  pass. Table-driven over the four states + precedence + reason extraction + workspace
  aggregation. Pure `.ts` + node env, per project convention (no jsdom).
- Typecheck/build: `npm run build:web-client` succeeds.
- Format: `npx oxfmt <changed files>`.

## Notes

- `SessionEntry.timeline` is `EMPTY_TIMELINE` for a fresh draft, so rule 1's `empty` check needs
  no null guard, but keep it total anyway — a restored entry could carry rows with a zero
  `userMessageCount` (history hydration counts user rows separately).
- Do not re-export `toDotStatus`; keep `status-map.ts` the single translation point.
