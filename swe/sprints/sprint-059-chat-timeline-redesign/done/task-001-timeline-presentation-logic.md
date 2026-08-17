# Task 001 — Timeline presentation logic: diff stats, output summary, kind badges, raw status

- **Sprint:** sprint-059-chat-timeline-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (timeline logic)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Add the pure, unit-testable presentation logic the redesigned `ToolCard` needs — per-kind badge
label + tint token, edit-diff `+N / −N` counts, an output-size summary — and carry the wire's
free-form tool `status` string through to the row so the card can render unknown statuses as text
instead of forcing them into `"running"`.

## Context / why

The redesign's tool card header is `[KIND BADGE] path/command  +21 −0  ✓ completed` with an
`output · 214 lines` strip. None of those three values exist today:

- `tool-mapping.ts` has `toolLabel()` (returns the raw kind) and `toolIcon()`, but no badge label
  or tint-token mapping.
- Nothing counts diff lines or output lines.
- `reducer.ts:130-131` collapses the wire status into `"running" | "completed" | "error"`:
  `event.status === "completed" || event.status === "error" ? event.status : "running"`. The wire
  field is a free-form `z.string().optional()` (`packages/protocol/src/messages.ts:289`), and the
  design spec § 04 requires *"status is a free-form string — render unknown values as plain muted
  text, never crash"*. The normalized enum stays (it drives the card's border/wash treatment); the
  raw string rides alongside it for display.

This project's Vitest runs in a **node** environment with no jsdom, so display logic that deserves
a test must live in a pure `.ts` module — the same split `sprint-058/task-005` and
`sprint-051/task-001` used. That is why this task exists separately from the component work.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 04 (tool badge per `ToolCallDetail`
  kind; status treatment; `output · N lines`; `+21 −0`), § 02 (token mapping), § 07 (guardrails)
- `swe/features/timeline-rendering.md` § Tool-call cards, § Diff rows
- `packages/protocol/src/messages.ts:225-255` — `ToolCallDetail` (`output` on every kind, `diff` on
  `edit`), `:285-290` — `tool_call` event with free-form `status`
- `packages/web-client/src/timeline/tool-mapping.ts` — extend
- `packages/web-client/src/timeline/row-model.ts:9,70-77` — `ToolCallStatus`, `ToolRow`
- `packages/web-client/src/timeline/reducer.ts:109-160` — `mergeTool`, `onToolCall`
- Modify: `tool-mapping.ts`, `row-model.ts`, `reducer.ts`
- Tests: `tool-mapping.test.ts`, `reducer.test.ts`

## What to build

**1. Badge descriptor per tool kind** (`tool-mapping.ts`). One function returning the uppercase
label and the CSS token *name* that tints the badge — text, background and border all derive from
that single token via `color-mix` in CSS (§ 04's one-token recipe), so this returns one token, never
three colors:

- `shell` → `SHELL` · `accent` · primary field `command`
- `read` → `READ` · `accent` · `path`
- `write` → `WRITE` · `statusSuccess` · `path`
- `edit` → `EDIT` · `statusWarning` · `path`
- `search` → `SEARCH` · `accent` · `query`
- `fetch` → `FETCH` · `accent` · `url`
- `task` → `TASK` · `foregroundMuted` · `description`

`task`'s treatment is also the fallback for any kind not in the table. Use `statusSuccess`, **not**
`success` — `success` aliases the accent on dark variants (`theme/colors.ts:246`), which would make
the WRITE badge indistinguishable from READ.

**2. Diff stats** — count added/removed lines in a unified-diff string: lines starting with `+`/`-`
excluding the `+++`/`---` file headers. Returns `{ added, removed }`. Empty/absent diff → zeros.

**3. Output summary** — line count for a tool's `output`, for the `output · N lines` strip. Must not
report a phantom trailing line for output ending in `\n`, and must distinguish empty output (no
strip) from one blank line.

**4. Primary field text** — the header's mono field is the tool's *own* primary field (full `path`,
full `command`), not the basename. `toolInlineDetail()` deliberately shortens to a basename/first
line for today's collapsed header; the redesigned header shows the full value with CSS ellipsis, so
expose the untruncated value (`toolDetailText()` already yields it — re-export intent explicitly
rather than having the component reach past the mapping module).

**5. Raw status passthrough.** Add `statusText?: string` to `ToolRow`, set from the event's raw
`status` when present. `status` (the normalized enum) is unchanged, so every existing consumer and
`BADGE_VARIANT`-style map keeps working. Field is optional — hydrated rows without a status omit it.

## Out of scope

- Any component or CSS change (tasks 002–004).
- Changing the normalized `ToolCallStatus` union, or adding a `"canceled"` member — that belongs to
  sprint-058/task-005; see Notes.
- Protocol changes. The wire already carries everything needed.
- Timestamps on rows (see the sprint's Notes in PLAN.md — deferred by decision).

## Acceptance criteria

- [ ] Every `ToolCallDetail` kind maps to its documented label + tint token; an unrecognized kind
      falls back to the `task` treatment without throwing.
- [ ] No mapping returns `success`; `write` returns `statusSuccess`.
- [ ] Diff stats count `+`/`-` body lines and ignore `+++`/`---` headers; a diff with no changes,
      an empty string, and an absent `diff` all yield `{ added: 0, removed: 0 }`.
- [ ] Output line count: `"a\nb"` → 2, `"a\nb\n"` → 2, `""` → 0 (no strip), `"\n"` → 1.
- [ ] The primary-field helper returns the **full** path/command, not a basename or first line.
- [ ] `applyStreamEvent` on a `tool_call` with `status: "awaiting_approval"` yields a row with
      normalized `status: "running"` **and** `statusText: "awaiting_approval"`.
- [ ] A `tool_call` with no `status` yields a row with no `statusText`; a subsequent event carrying
      one sets it; the normalized `status` semantics are byte-for-byte unchanged from today.
- [ ] All new helpers are pure — no React, store, or DOM imports — so they run under the repo's
      node-environment Vitest with no new test infrastructure.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/web-client/src/timeline/tool-mapping.test.ts` and
  `packages/web-client/src/timeline/reducer.test.ts`; run
  `npx vitest run packages/web-client/src/timeline`.

## Notes

- **Sprint-058 overlap.** `sprint-058/task-005` (planned, unstarted) also edits `row-model.ts` and
  `reducer.ts`: it adds a `"canceled"` member to `ToolCallStatus` and closes open tool rows on turn
  terminal. The two changes are additive and independent — this task adds a field, that one adds a
  union member. Whichever lands second merges by hand; neither invalidates the other. Do **not**
  pre-add `"canceled"` here.
- Keep the badge table and the icon table (`ICON_BY_KIND`) as separate exports keyed by the same
  union so the compiler flags a new protocol kind in both places.
