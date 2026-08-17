# Task 004 — Attention `StatusDot` on background chat tabs

- **Sprint:** sprint-061-workspace-tab-strip-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (workspace)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-002

## Goal

Surface a chat tab's state on the tab itself: an 8px `StatusDot` (spinning ring while a turn runs,
`statusDanger` after a failed turn) between the label and the ×, for chat tabs that are **not** the
active tab in their pane — so a pane whose visible tab is a terminal still tells you that the chat
behind it is working or has failed.

## Context / why

§ 07:

> An unread/attention tab shows a `StatusDot` before the × instead of a badge.

**There is no per-tab state to read.** `stores/tab-store.ts:68-80`'s `Tab` has `id`, `kind`, `label`,
`closable`, `data`, `workspaceCwd` — no unread/dirty/attention flag, and inventing one means owning
read-receipt semantics (what marks a tab read? focus? scroll to bottom?) that § 07 does not specify and
nothing else in the app tracks. What **does** exist is the session: a `chat` tab carries
`ChatTabData.sessionId` (`tab-store.ts:31-47`) and `session-store.ts`'s `SessionEntry.status` is
already hydrated from the daemon on reconnect and driven live by
`hooks/agent-stream-events.ts:32-43`. So the dot is a projection of session status, not new state.

**Which statuses earn a dot.** The protocol's vocabulary is `initializing | idle | running | error |
closed` (`features/sessions/status-map.ts:11-17`); the design system's dot vocabulary is wider
(`ui/status-dot.ts:5-12`, which has a `waiting` bucket) but nothing populates a session-level
"needs input" — permission requests live only on timeline tool rows. Mapping every status through
`toDotStatus` would therefore paint a permanent `statusSuccess` dot on every `closed` session's tab
(`closed → finished`) and an `accent` dot on `initializing`, which is decoration, not attention. Only
two states are worth a glance away from the pane: **running** (work in progress) and **error** (the
last turn failed). Everything else → no dot. The mock's warning-colored dot is its "needs input"
state; the honest equivalent in this app today is nothing at all, and task 005 records that gap in the
scope doc rather than faking it.

**Active tab gets no dot.** The pane body already states its own status — `TurnProgressBar` sweeps 3px
below the strip while running (`ChatPanel.tsx:26`), and a failed turn renders an `ErrorRow`. A
spinning ring directly above a sweeping progress bar is the same information twice, and § 07's own mock
puts the dot on an *inactive* tab. So the dot is the background-tab affordance, and the bar is the
foreground one; together they cover both cases with no overlap.

**Why the progress bar does not move into the strip.** § 07 says the bar "hangs off the strip's bottom
edge — 2px, full pane width, immediately under the border". That is already literally where it
renders: `TurnProgressBar.module.css`'s `.track` is `position: absolute; inset-inline: 0; top: 0`
inside `ChatPanel`, and `pane-layout-view.ts:70-77` lays every panel out at
`calc(<pane top> + var(--pane-strip-height))` — the panel's top edge *is* the strip's bottom border,
spanning the full pane width. sprint-060/task-001 chose that mount deliberately (PLAN.md:1195-1201) to
keep the pane's active-tab session out of `TabPanelHost`. Re-hosting it in chrome would add that
plumbing, buy nothing visually, and collide with § 06's pane-header sprint. It stays put.

## Scope references

- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (leading glyph / status dot /
  close order), § 07 DO NOT (don't hand-roll a dot — `StatusDot` exists)
- `swe/features/workspace-ui.md:178-180` — "Each chip: icon (+ status dot), label, close button"
- `packages/web-client/src/components/primitives/StatusDot.tsx:21-48` — the primitive; `role="presentation"`,
  8px dot, spinning ring for `running`
- `packages/web-client/src/ui/status-dot.ts:16-67` — `StatusDotInput`, `statusDotColor` (returns
  `null` for `idle`/`archived` without `showInactive`)
- `packages/web-client/src/features/sessions/status-map.ts:11-21` — the protocol→dot translation point
- `packages/web-client/src/features/sessions/SessionItem.tsx:46` — the existing `StatusDot` consumer to
  match
- `packages/web-client/src/stores/tab-store.ts:31-47,68-80` — `ChatTabData.sessionId`, `Tab`
- `packages/web-client/src/stores/session-store.ts:19-31` — `SessionEntry.status`
- `packages/web-client/src/hooks/agent-stream-events.ts:32-43` — what moves the status live
- `packages/web-client/src/features/chat/TurnProgressBar.tsx`, `ChatPanel.tsx:26` — the foreground
  affordance this complements
- Create: `features/workspace/tab-attention.ts` + `tab-attention.test.ts`
- Modify: `TabStrip.tsx` (`TabItem`), `TabStrip.module.css`

## What to build

**1. `tab-attention.ts` — the whole decision, as one pure function.** Something with the shape
`tabAttentionStatus(tab, sessionStatus, activeInPane) => AgentStatus | null` (name the args as you
like; keep the signature free of stores and of React). It returns `"running"` or `"error"` only when
the tab is a `chat` tab, is **not** the pane's active tab, and its session's status maps to one of
those; `null` in every other case (non-chat kind, active tab, missing session, `idle`,
`initializing`, `closed`). Return the dot vocabulary's own type so the value passes straight into
`StatusDot`. This is the sprint's one piece of real logic, so it gets a real unit test.

**2. `tab-attention.test.ts`.** Table-driven over the cases that matter: each `TabKind`; active vs
inactive in pane; every protocol status; a chat tab whose session is absent from the store (offline
restore ordering — must be `null`, never a throw).

**3. Render it.** In `TabItem`, read the status with a primitive-valued selector —
`useSessionStore((s) => (tab.kind === "chat" ? s.sessions[tab.data.sessionId]?.status : undefined))`
or equivalent — call the pure function, and render
`<StatusDot status={attention} className={styles.tabDot} />` between the label span and the ×.
`StatusDot` already returns `null` when there is nothing to show, so no conditional wrapper is needed.
`.tabDot { flex: none; }` (already reserved in task 002's rule set). Do **not** pass `showInactive`.

**4. Keep the subscription cheap.** The selector must return a primitive string/undefined, not the
session object — a `SessionEntry` selector re-renders every tab on every timeline mutation. Hooks are
unconditional: call the selector for every tab and branch inside it, never behind an `if`.

## Out of scope

- Any new store field: no `unread`, no `requiresAttention`, no read receipts. If a real unread model is
  ever wanted, it is its own scoped feature with a definition of "read".
- A session-level `waiting` / needs-input status, or plumbing permission requests up from timeline
  rows. Task 005 documents the gap.
- A count badge, a title-bar/favicon badge, notification sounds, or a sidebar change (§ 03's sprint
  owns `SessionList`).
- Dots on `file`/`diff`/`terminal`/`molecule` tabs (a dirty-file indicator is a different feature with
  no state behind it today).
- Moving, resizing or restyling `TurnProgressBar` — see Context.
- Making the dot interactive or announced: `StatusDot` is `role="presentation"` by design, and the
  running turn is already announced by `TurnProgressBar`'s live region.

## Acceptance criteria

- [ ] A pane showing a terminal tab, with a background chat tab whose turn is running, shows a
      spinning accent-bright ring on that chat tab; the ring disappears when the turn ends.
- [ ] The same tab shows a `statusDanger` dot after a failed turn, and no dot once the session is
      `idle` again.
- [ ] The pane's **active** chat tab never shows a dot, running or not — the progress bar covers it.
- [ ] `idle`, `initializing` and `closed` sessions produce no dot; non-chat tabs never produce one.
- [ ] The dot sits between the label and the ×, never shrinks, and its presence does not change the
      pill's width or the label's truncation point (the × box is already reserved from task 002).
- [ ] A chat tab restored before its session lands in the store renders with no dot and no error.
- [ ] `tab-attention.test.ts` covers every kind × active/inactive × status combination and passes.
- [ ] Opening a chat pane while another pane's chat runs does not re-render every tab on each stream
      event (spot-checked with React DevTools' highlight-updates, or by reasoning from the selector's
      return type — record which).

## Test / verification plan

- Build: `npm run build:web-client`. Typecheck: `npm run typecheck`.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>`.
- Tests: `npx vitest run packages/web-client/src/features/workspace/tab-attention.test.ts`, then
  `npx vitest run packages/web-client`.
- Manual (`npm start`, real provider or mock): open a chat + a terminal in one pane, start a turn,
  switch to the terminal tab and watch the chat tab's ring; let the turn finish; force a failing turn
  and confirm the danger dot, then send a new message and confirm it clears; reload mid-turn (hydrated
  status must produce the ring immediately); in a split layout confirm only the running session's tab
  is dotted; check `dark`, `light` and `zinc` (the ring uses `accentBright` — on `zinc` it must still
  be visible against an inactive pill's transparent background).

## Notes

- `statusDotColor` returns `"accent"` for `running` but `StatusDot` overrides it to `accentBright` for
  the spinning ring (`StatusDot.tsx:31-35`) — expect a ring, not a blue circle, and do not restyle the
  primitive to match the mock's flat dot.
- `toDotStatus` is the single translation point between the protocol enum and the dot enum
  (`status-map.ts:1-6`). Route through it rather than switching on protocol strings directly, so a new
  protocol status has exactly one place to be mapped.
- Keep `tab-attention.ts` in `features/workspace/`, next to the other pure pane modules
  (`pane-tree.ts`, `pane-dnd.ts`, `pane-layout-view.ts`), all of which are pure + unit-tested; that is
  the established shape for testable logic in this feature folder.
