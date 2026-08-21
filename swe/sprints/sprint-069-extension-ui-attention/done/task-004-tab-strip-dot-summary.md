# Task 004 — Pane tab strip attention dot — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

`tab-attention.ts`'s `tabAttentionStatus` gained a third argument, `hasPendingQuestion: boolean`
(sourced by the caller from `useAgentUiPending`, keeping this module store-free per its existing
contract), and its return type changed from a bare `DotAgentStatus` to a full `StatusDotInput` —
needed so the caller can carry `requiresAttention`/`attentionReason: "question"` through to the
dot, exactly like tasks 001/003. Needs-input is checked before the `sessionStatus === undefined`
gap: it's a distinct signal from a completely different store, so an offline-restore ordering gap
on the session store must not suppress a pending-question signal that already landed via the
agent-ui store.

`TabStrip.tsx`'s `TabItem` now reads the tab's bound session's `agentId` (a third primitive
selector alongside the existing `sessionStatus` one, same re-render discipline) and passes
`pending.length > 0` through. The dot renders with task-002's `pulse` prop (only for the
`"question"` reason) and a `"Needs input"` accessible name via `StatusDot`'s new `aria-label` prop
(added this task, mirroring task-003's approach — `role="img"` when set, `role="presentation"`
otherwise, unchanged for every other caller).

**Tight-strip concession.** `.tab` gained `container-type: inline-size` and a
`@container tab (max-width: 140px) { .tabNeedsInput .tabClose { display: none; } }` rule. The
140px threshold sits just above the pre-existing 128px `min-width` floor (unchanged — lowering it
risked regressing sprint-061's "soft pills give space back" fix, which this task's own Notes
flagged as a real prior regression) so the concession engages only once a needs-input tab is
genuinely squeezed, not at its comfortable 200px `max-width`. The label already ellipsises first
for free — it's `.tab`'s only `flex: 1 1 auto` child; icon/dot/close are all `flex: none` — so this
rule is strictly the *last* concession, matching § 08's stated order.

**Per-tab context menu, built new.** `swe/UI design/redesign 0.1.0/Extension Dialogs Visual
Spec.html` § 08 assumes one exists; it didn't (`features/workspace-ui.md` marked it explicitly
unimplemented). Shipped minimal — right-click → Close only — as `TabContextMenu.tsx`, following
`SessionContextMenu.tsx`'s Radix cursor-anchored pattern exactly: a new `ui-store.ts` slot
(`tabMenu: { tabId, x, y } | null` + `openTabMenu`/`closeTabMenu`), mounted once in
`TabPanelHost.tsx` (not once per `TabStrip` — there is one strip per pane but the menu is global
chrome). Gated on `tab.closable`, matching the existing `.tabClose` gate. Without this, a
dot-replaced `×` would make an inactive, narrow tab uncloseable except by activating it first — the
exact trap § 08's rule exists to avoid.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/tab-attention.ts` | modified — `hasPendingQuestion` source, `StatusDotInput` return |
| `packages/web-client/src/features/workspace/tab-attention.test.ts` | modified — updated + new coverage |
| `packages/web-client/src/features/workspace/TabStrip.tsx` | modified — pending source, context-menu wiring, dot render |
| `packages/web-client/src/features/workspace/TabStrip.module.css` | modified — `container-type`, tight-strip `@container` rule |
| `packages/web-client/src/features/workspace/TabContextMenu.tsx` | created — minimal per-tab right-click menu |
| `packages/web-client/src/features/workspace/TabPanelHost.tsx` | modified — mounts `TabContextMenu` once |
| `packages/web-client/src/stores/ui-store.ts` | modified — `tabMenu` slot + actions |
| `swe/features/workspace-ui.md` | modified — needs-input + per-tab context menu no longer marked unimplemented |
| `packages/web-client/AGENTS.md` | modified — 4 stale sections corrected (source layout, sprint-068 scope note, tab-strip trap, "needs input is unsourced" invariant) |

## How it satisfies the scope

Matches § 08's Pane tab strip subsection (dot before `×`, 6px gap via the existing `gap:
var(--pi-spacing-7)` on `.tab`, inactive tabs only — enforced by `activeInPane` in
`tabAttentionStatus`, unchanged from before this task — no count/label, tight-strip order) and §
07's existing attention pattern. The `packages/web-client/AGENTS.md` invariant that flatly said
"`needs input` is unsourced in this client and must not be faked" is now false and was corrected in
the same change, per the doc-sync rule — leaving it would have actively misled the next person who
reads it before touching this code.

## Build & test results

```
$ npx tsc -b --force
(clean — no output)

$ npx vitest run packages/web-client/src/features/workspace/ packages/web-client/src/stores/
Test Files  15 passed (15)
Tests  295 passed (295)

$ npm run lint
(zero warnings on any file touched by this task)

$ npx oxfmt --check <changed files>
(reformatted TabContextMenu.tsx once on creation; re-checked clean)

$ npm run build:web-client
✓ built in 10.89s
```

## Acceptance criteria

- [x] An inactive tab whose session has a pending question shows the dot before the `×`; the active
      tab does not, even with its own pending question — `activeInPane` gate unchanged, tested for
      both the sessionStatus-independent and session-store-gap cases.
- [x] Narrowing the pane ellipsises the tab label before either control is affected; narrowing
      further replaces the `×` with the dot, close remains reachable from the context menu — CSS
      container query engages only below the tab's natural shrink range; `TabContextMenu.tsx` is
      the escape hatch.
- [x] The dot clears when the question resolves — driven entirely by `useAgentUiPending`'s live
      array, same mechanism as tasks 001/003.
- [x] Non-session tabs are unaffected — `tab.kind !== "chat"` gate unchanged, tested for all four
      non-chat kinds.
- [x] Screen readers get a name for the dot — `aria-label="Needs input"` via `StatusDot`'s new prop.
- [x] No raw px/hex — the one new literal (`140px` in the `@container` condition) is a query
      breakpoint, not a paintable value; the existing `@media (max-width: 575px)` rule two lines
      above it in the same file is the established precedent for this class of literal.

## Follow-ups / TODO(verify)

- Manual visual sign-off deferred to task-009's consolidated matrix and this task's own
  hand-off: two tabs in one pane, `#ui confirm` in the inactive one, then drag the pane narrow to
  watch the concession order (ellipsis → dot-replaces-×), then right-click to close.
- The context menu is deliberately minimal (Close only) — the reference app's fuller set (copy
  resume command, rename, close-to-the-left/right) remains unimplemented and is now documented as
  such in `features/workspace-ui.md` rather than silently absent.
