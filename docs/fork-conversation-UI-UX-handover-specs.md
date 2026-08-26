# Conversation Fork — UI/UX Designer Handover

> Audience: UI/UX designer producing mockups. Self-contained — no codebase reading required.
> Engineering spec (for reference): `swe/features/conversation-fork.md`
> Status: scoped, awaiting design + implementation. Contact: engineering via this repo.

---

## 1. What the feature is (one paragraph)

Pi-Studio's web app shows a chat transcript between a user and an AI coding agent. **Fork** lets
the user rewind the conversation to any of their own earlier messages: everything after that point
is abandoned (the agent genuinely forgets it), and the original message text is placed back into
the message composer so the user can edit and re-send it. Think "undo / branch from here" for an
AI conversation. It is one of the most-loved features of the agent's terminal UI; we are bringing
it to the browser.

**User mental model to design for:** "this conversation went wrong at message N — take me back
there and let me try again."

---

## 2. Where it lives — the two entry points

### Entry point A — hover action on a user message (primary)

- The transcript renders the user's own messages as **right-aligned bubbles** (accent-tinted fill,
  large radius, shrink-to-fit width) inside a full-width content column; assistant output flows
  left, plain, no bubble. Each row has a meta line (timestamp, dimmed at 55% opacity, brightens on
  row hover).
- A **fork icon button** appears on hover over a user-message row. It must follow the app's
  existing row-action pattern:
  - 20 × 20 px chromeless icon button ("IconButton", size `xs`) — same affordance family as the
    file-row "⋮", session-row "⋮", etc.
  - **Reserved box + opacity-on-row-hover**: the button always occupies its layout slot (nothing
    shifts when it appears); it fades in on row hover.
  - Suggested icon: a **git-fork / branch** glyph (lucide `GitFork`). Avoid a "delete/undo" glyph —
    the action creates a new branch, it doesn't destroy data.
- Placement to explore in mockups: on the meta line of the user bubble, or floating at the
  bubble's outer edge. Must not collide with the `queued` chip that can appear on the meta line,
  or with image thumbnails that render below the bubble.
- **Compact / touch layouts (< 500 px container width): hover does not exist.** The affordance
  must be always-visible (dimmed) or reachable another way (e.g., the row's overflow). Designer's
  call — precedent in this app is "hover-reveal on desktop, always-visible on compact".

### Entry point B — "Fork from…" in the session menu (secondary + fallback)

- Every conversation (session) has a **"⋮" overflow menu**. Add a **"Fork from…"** item.
- Opens a **picker dialog** listing all the user's forkable messages in chronological order
  (oldest at top). Each row: an ordinal (`#1`, `#2`, …) + the message text clamped to ~2 lines.
  Selecting a row leads to the same confirmation step as entry point A.
- This picker is also the **automatic fallback**: in a rare technical edge case the hover button
  can't be certain which message was clicked; instead of guessing, the app opens this picker so
  the user chooses explicitly. The picker must therefore stand alone as a complete flow.

---

## 3. The core flow (design the happy path first)

```
hover user message ──► click fork icon
                          │
                          ▼
                 ┌─ Confirmation dialog ─────────────────────────┐
                 │  Title: Fork conversation                     │
                 │  Preview: the target message's text            │
                 │  (clamped ~3 lines, visually quoted)           │
                 │  Body copy (draft, refine freely):             │
                 │  "Later messages leave the agent's context.    │
                 │   The original prompt is placed in the         │
                 │   composer for editing."                       │
                 │  [Cancel]                [Fork from here]      │
                 └────────────────────────────────────────────────┘
                          │ confirm
                          ▼
                 in-flight state (spinner in dialog, buttons disabled)
                          │ success
                          ▼
        dialog closes · transcript truncates to before that message
        · composer is pre-filled with the original message text
        · focus lands in the composer, ready to edit/send
```

**Non-negotiable safety property:** the confirmation dialog **always shows the exact text of the
message being forked from**. This preview is the user's guarantee of what they're rewinding to —
it must be visually prominent, not fine print.

**Composer prefill rule:** only happens when the composer is **empty**. If the user has a draft
in progress, it is never overwritten (no prefill, no prompt — the fork still succeeds).

---

## 4. Every state to mock

### Fork icon (per user-message row)

| State | Behavior |
|---|---|
| Default (desktop) | Hidden; reserved space; fades in on row hover |
| Compact/touch | Always visible (dimmed) or in row overflow — designer's call |
| Agent is busy (a turn is running) | **Not offered at all** (hidden, not disabled-greyed) — forking mid-task is not allowed |
| Message still sending / failed to send | Not offered (only confirmed messages can be forked) |
| Older server without the feature | Entire feature absent — no icon, no menu item |

### Confirmation dialog

| State | Behavior |
|---|---|
| Idle | Preview + copy + Cancel / Fork buttons |
| In-flight | Spinner on the confirm button, both buttons disabled; dialog cannot be dismissed by outside-click while in flight |
| Error | Dialog returns to idle; error surfaces as a **toast** (existing app-wide toast host); user may retry |
| Declined by an agent extension | Special case: the agent's plugins can veto a fork. Nothing changes; toast copy draft: "An extension declined the fork." Dialog closes |

### Picker dialog ("Fork from…")

| State | Behavior |
|---|---|
| Populated | Chronological list, ordinal + clamped text per row; row click → confirmation step (can be an in-dialog step swap) |
| Empty | "Nothing to fork yet" — occurs on brand-new conversations. Menu item may alternatively render disabled |
| Long list | Scrollable; consider anchoring scroll near the most recent messages (users usually fork recent history) |
| Very long single message | Clamp ~2 lines in the list, ~3 lines in the confirmation preview; never unbounded |

### After a successful fork

| Surface | Behavior |
|---|---|
| This window's transcript | All rows after the fork point disappear; view lands at the new bottom. Design question for you: instant cut vs. brief transition (see § 7) |
| Composer | Pre-filled with the original text (only if it was empty); focused |
| **Other open windows/devices** on the same conversation | Their transcript refreshes to the truncated state automatically, with **no dialog and no toast** — it just converges. Consider whether a subtle, transient cue is wanted (see § 7) |

### Known error cases (all → toast, dialog reusable)

- Forking a message in a conversation the agent hasn't replied to yet ("session not saved yet" —
  engine limitation).
- Two people fork the same conversation at nearly the same time — the second attempt fails with an
  "invalid entry" style error.
- Generic network/agent errors.

---

## 5. Design-system components to reuse (do not invent parallels)

| Need | Existing component |
|---|---|
| The hover icon | `IconButton` size `xs` (20 px, chromeless, reserved-box + opacity-on-hover recipe) |
| Both dialogs | `Dialog` primitive (used by Settings, image preview, etc.) |
| Picker rows | Existing menu/list row treatments (`MenuContent`/`MenuItem` family) |
| Errors & notices | App-wide toast host (bottom-anchored transient toasts) |
| Empty picker | `EmptyState` (centered) primitive |
| Buttons | `Button` primitive; confirm action uses the standard accent CTA, not a destructive-red — forking is non-destructive (it branches; the old branch still exists on disk) |

**Tone guidance:** this is a power-user feature in a developer tool. Confident, terse copy; one
short explanatory sentence in the confirm dialog is the ceiling. No multi-step wizards.

---

## 6. Accessibility requirements

- Fork icon: reachable by keyboard (focusable even while opacity-hidden, per the existing
  row-action pattern), `aria-label` e.g. "Fork conversation from this message", tooltip on hover.
- Confirmation dialog: standard focus trap; initial focus on **Cancel** (safe default);
  `Esc` cancels (except while in-flight).
- Transcript truncation in *other* windows should be announced to screen readers via the existing
  `aria-live` announcement region (precedent: pending-dialog announcements).
- The message preview in the confirm dialog must remain real text (selectable, screen-readable),
  not an image/snapshot.

---

## 7. Open design questions (your call — mock options if useful)

1. **Truncation transition.** Instant cut vs. a brief (~150 ms) fade/collapse of the removed rows.
   Instant is the cheap default; motion may help users understand what happened.
2. **Convergence cue in other windows.** Silent refresh vs. a subtle transient marker (e.g., a
   one-line "conversation was forked" divider that fades). Silent is the engineering default.
3. **Fork icon placement** on the bubble: meta line vs. outer edge vs. inside a per-message
   overflow. Constraint: reserved space, no layout shift, no collision with `queued` chip or
   image thumbnails.
4. **Compact-layout affordance**: always-visible dimmed icon vs. long-press/overflow.
5. Whether the picker and the confirmation are **two dialogs or two steps of one dialog**
   (engineering has no preference; one dialog with a step swap is likely smoother).

---

## 8. Out of scope — do not design

- Undoing the agent's **file edits** (file time-travel) — separate future feature; avoid any copy
  implying files are restored. The confirm-dialog copy must stay scoped to *conversation* memory.
- Clone / resume / switch-session actions.
- Any UI on the terminal (CLI) client — this is web-client only.
- Browsing or re-entering the abandoned branch after a fork (the data survives on disk, but no UI
  for it now — avoid implying it's reachable).

---

## 9. Quick reference — existing visual vocabulary

- User message: right-aligned, shrink-to-fit bubble; fill `color-mix(accent 20%, surface1)`,
  border `color-mix(accent 45%, transparent)`, radius-lg. Failed = destructive tint; pending =
  dimmed row; queued = small bordered chip on the meta line.
- Assistant output: left-flowing plain markdown on the timeline background, 20 px rail with an
  18 px disc + connector line; no bubble.
- Meta line: `"You · Mon D, HH:MM"` style, 55%-opacity timestamp that brightens on row hover.
- Transcript column is centered, max 820 px; compact form-factor threshold is 500 px container
  width.
- A running turn shows an indeterminate 2 px accent progress bar at the top of the chat panel —
  this is the same signal that hides the fork affordance.
