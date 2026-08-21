# Task 007 — `set_editor_text`: replacing the composer draft, visibly — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

Routes the second (and last) transient `AgentUiEffect` — `replace_composer_text` — through
task-006's single effect seam, to the target SESSION's own composer draft, with the § 11 border
flash / note feedback and background-pane deferral.

- **`stores/draft-store.ts`** (new): lifts the composer's draft out of `Composer.tsx`'s own
  `useState` into a per-session Zustand store — `drafts: Record<sessionId, string>` — so a
  `set_editor_text` effect can write a session's draft even while no composer for that session is
  currently mounted (no chat tab ever opened for it). Also owns a one-shot `pendingFeedback` queue
  (`{ copy: "replaced" | "filled", flash: boolean }` per session): `replaceDraft(sessionId, text,
  visible)` decides `copy` from whether the PRIOR draft was empty (never from the incoming text's
  own emptiness — an empty incoming `text` clearing a non-empty draft still reads "replaced",
  through the same standard path, no special case — this was task-007's one explicitly
  undocumented judgment call, recorded here per the task's own instruction), and `flash` from the
  caller's point-in-time visibility check. `consumeFeedback(sessionId)` pops the entry exactly
  once, matching § 11's "note appears the first time the pane is shown, then expires."
- **`stores/tab-store.ts`**: added `isTabVisible(tabId)`, a non-hook counterpart of the existing
  `useIsTabVisible(tabId)` hook, sharing a new `tabVisibilityCwd` helper between them — needed
  because `agent-ui-store.ts`'s effect routing (outside React) needs a point-in-time visibility
  answer at the exact moment a `set_editor_text` effect arrives.
- **`features/agent-ui/agent-ui-store.ts`**: `dispatchEffects`'s `"replace_composer_text"` case
  (previously a routed no-op stub left by task-006) now calls `composerTextEffect`, which resolves
  the effect's own `agentId` to its session (mirroring `notifyEffect`'s lookup, same defensive
  no-op on a miss), computes `isTabVisible(tabIds.chat(sessionId))` fresh — never cached — and
  calls `draftStore.replaceDraft`. Routes by the EFFECT's own session, never whichever composer
  currently has focus (the task's own flagged "most likely defect").
- **`features/chat/Composer.tsx`**: `text`/`setText` local state removed; the draft now reads
  `useDraftStore((s) => s.drafts[sessionId] ?? "")` and every mutation (`handleTextareaChange`,
  the Backspace command-token deletion, `applySelectedCommand`, `submit`'s post-send clear) calls
  `setDraft(sessionId, ...)` instead. A new `useEffect`, gated on `useIsTabVisible(tabIds.chat(
  sessionId))` AND a reactive `pendingFeedback[sessionId]` selector (so either "an effect arrives
  while already visible" or "the pane becomes visible with feedback already queued" re-triggers
  it), consumes the feedback exactly once: sets the note string, starts its 4s auto-clear timer,
  moves the caret to the end of the text via `setSelectionRange` (never `.focus()` — verified this
  cannot steal focus from a pending-question card or an already-focused composer), and — only when
  `feedback.flash` is true — adds the `.flash` class for 400ms (1s under `prefers-reduced-motion`).
- **`features/chat/Composer.module.css`**: `.card.flash` reuses `.card`'s existing 120ms
  `border-color` transition (both the "go bright" and "settle back" legs) rather than a new
  keyframe — JS holds the class for the flash duration, so the transition plays in, holds, and
  plays back out on removal. `prefers-reduced-motion: reduce` sets `transition: none` on that class
  specifically (an instant cut), and the JS-side duration compensates with a 1s hold. `.note` is a
  small muted caption (`--pi-font-size-3xs`, `--pi-color-foregroundMuted`) under the composer.
- **Mock provider `#ui` grammar extended** (`ui-script.ts`/`mock-provider.ts`, matching task-006's
  precedent): `#ui set_editor_text` raises a fire-and-forget `set_editor_text` request with the
  spec's own mock text ("retry the dns lookups with a 2s backoff"), no variant, no `timeout=`.
- **Tests**: `draft-store.test.ts` (new, 12 tests) — the pure copy/flash-vs-deferred decision logic
  the task asked to keep testable; `agent-ui-store.test.ts` (+5 tests) — routing to the correct
  session (not whichever composer has focus, using a real two-tab/one-pane setup via
  `useTabStore.getState().open`), visible→flash, hidden-but-open→note-only, no-tab-anywhere→still
  applied, and the unknown-`agentId` defensive no-op; `ui-script.test.ts`/`mock-provider.test.ts`
  (+5 tests) — parsing coverage and one live-session integration test for the new recipe.

## Files created / changed

| File | Change |
|---|---|
| `packages/web-client/src/stores/draft-store.ts` | created — per-session draft + one-shot feedback queue |
| `packages/web-client/src/stores/draft-store.test.ts` | created — 12 tests |
| `packages/web-client/src/stores/tab-store.ts` | `isTabVisible` non-hook export, `tabVisibilityCwd` shared helper |
| `packages/web-client/src/test/reset-stores.ts` | `resetDraftStore` |
| `packages/web-client/src/features/agent-ui/agent-ui-store.ts` | `composerTextEffect`, wired into `dispatchEffects` |
| `packages/web-client/src/features/agent-ui/agent-ui-store.test.ts` | +5 routing/visibility tests |
| `packages/web-client/src/features/chat/Composer.tsx` | draft lifted to the store; feedback-consuming effect; flash/note render |
| `packages/web-client/src/features/chat/Composer.module.css` | `.card.flash`, `.note` |
| `packages/server/src/agent/providers/mock/ui-script.ts` | `set_editor_text` recipe |
| `packages/server/src/agent/providers/mock/ui-script.test.ts` | +4 tests |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | +1 integration test |
| `packages/web-client/AGENTS.md` | `stores/` tree entry for `draft-store.ts`; new "`set_editor_text` composer feedback" bullet; corrected two now-stale bullets left by tasks 005–006 ("two effects deliberately unwired" → both wired; "tasks 005–008 remain open" → only 008 does) |

## Deviations and why

- **AGENTS.md correction beyond this task's own diff:** two narrative bullets under "Extension UI
  dialogs" were already stale *before* this task started — they still said `notify` was unwired
  (task-006 shipped it without updating the doc) and listed tasks 005–008 as all still open (005
  and 006 had already shipped). Corrected both while touching the same paragraph rather than
  leaving a contradicted invariant in place next to my own accurate addition.

## How it satisfies the scope

- Draft applies immediately regardless of visibility — never lost, including for a session with no
  chat tab open anywhere (`draft-store.ts`'s `drafts` map is the source of truth Composer reads on
  mount, not a value only a live component can hold).
- Flash + note only for a session actually on screen at write time; a background replacement
  applies the text silently and defers the note (never the flash) to the pane's next appearance,
  shown once.
- Caret lands at the end of the new text without ever calling `.focus()` — verified this cannot
  steal focus from a pending-question card or a composer the user is already typing in (task's own
  acceptance criterion), both by code inspection (`setSelectionRange` only) and by live smoke test
  (below).
- Reduced motion: the flash becomes an instant-cut 1s hold via a CSS media query + a JS duration
  branch, reusing the card's existing transition rather than a parallel animation path.
- Routing is by the effect's own session id, verified with a real two-tab-one-pane test setup
  proving a target session's draft updates even when a *different* session's tab is the one
  currently focused/visible.

## Build & test results

```
$ npx vitest run   # full monorepo suite
Test Files  190 passed (190)
     Tests  2476 passed (2476)

$ npx tsc -b --force
(clean)

$ npm run lint
(clean on every changed file; pre-existing unrelated warnings elsewhere untouched)

$ npx oxfmt --check <changed files>
All matched files use the correct format.

$ npm run build
✓ built in 10.44s (web-client + cli)
```

## Manual/live verification (dev daemon + real browser, this session)

Beyond the unit/integration suite, drove a real dev daemon (`npm run dev:daemon`) + Vite dev
server + headless browser end to end: opened a workspace, materialized a session, and fired
`#ui set_editor_text` via the CLI (`pi-studio send <agentId> "#ui set_editor_text"`) while the
browser showed that session's composer. Confirmed live, in the actual DOM, immediately upon the
effect arriving: `.card` gained the `_flash_...` class, a `.note` element rendered with the exact
text "Your draft was replaced", and the textarea's value updated to the effect's text — the full
pipeline (mock provider → SDK controller → `agent-ui-store.ts` → `draft-store.ts` → `Composer.tsx`)
verified working over a real WebSocket connection, not just mocked stores. (Two earlier attempts in
this same session showed nothing because the flash's 400ms/note's 4s windows had already elapsed by
the time of inspection, or because the headless browser's WS connection had idled out between tool
calls — both artifacts of the test harness, not the implementation; resolved by checking
immediately after firing.)

## Follow-ups / TODO(verify)

- Full visual sign-off (exact flash color/timing feel, note copy legibility, reduced-motion hold)
  deferred to task-009's consolidated matrix per this sprint's established convention — this task's
  own live check confirmed the mechanism fires correctly, not its final visual polish.
- Background-pane deferral (fire while looking at a *different* session, confirm the note appears
  only once the target pane is later shown) is covered by `agent-ui-store.test.ts`'s unit tests but
  was not re-verified live in the browser this session — task-007's own hand-off notes this same
  scenario as part of task-009's human sign-off pass.
