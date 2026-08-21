# Task 001 — Browser-reachable scripted dialog trigger (mock provider) — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 09:00 UTC
- **Status:** done

## What was implemented

A pure parser, `parseUiScript(prompt): UiScriptStep[] | null`, that recognises `#ui ...` prompts and
describes the dialog(s) to raise, plus wiring in `MockAgentSession.startTurn` that raises those
dialogs through the existing `uiSubscribers`/`respondToUi` channel instead of running the normal
scripted echo turn. Every documented recipe from the task is implemented:

- `#ui select` / `confirm` / `input` / `editor` — one representative dialog each, field names
  (`title`, `message`, `options`, `placeholder`, `prefill`) matching the visual spec's § 00 wire
  table exactly.
- `#ui unknown` — raises method `pickRange` (verbatim from § 05's unrecognised-method mock),
  `expectsResponse: true`.
- `#ui select:9` / `select:empty` / `select:long` — nine options (§ 12's live capture), a real empty
  `options: []`, and the self-numbered live-captured payload from § 03 ("[Color] Which color do you
  pick?" / "1. Red — …" / "2. Blue — …" / "3. Type something.") reproduced verbatim.
- `#ui input:multiline` — the § 03 live-captured hard-break + bracketed-prefix title, verbatim
  (`"[Color] Which color do you pick?\n\nType your answer:"`).
- `#ui <method> timeout=<seconds>` — sets `timeoutMs` for `select`/`confirm`/`input`; **rejected**
  (parses to `null`) for `editor`, since Pi's editor has no `timeout` field on the real wire (the
  visual spec's § 00 table lists one in error — filed as a spec correction in task-009).
- `#ui multi <n>` — raises `n` dialogs concurrently (`await: false` on every step); the turn
  completes once every one of them has been answered.
- `#ui help` — no dialog (`parseUiScript` returns `[]`, distinct from `null`); the mock replies with
  the full recipe list as assistant text.

After a dialog resolves, the mock emits an `assistant_message` naming what it received
(`value: "Allow"`, `confirmed: false`, `cancelled: true`, …) — this is dev/test-only tooling, so
unlike the web-client's presentation rules (task-004) it may legitimately echo a typed value, since
its purpose is to prove the round trip during manual verification.

### Dev daemon + recipe list (for later hand-off sections)

```
PI_STUDIO_HOME=/tmp/pi-studio-dev npm run dev:daemon
```

Then, in the web-client (pointed at that dev daemon) or any WS client, create/open a `mock`-provider
session and send one of:

```
#ui select                one dialog, two short options (Allow / Block)
#ui confirm                title + message
#ui input                  single-line field with a placeholder
#ui editor                 multi-line field, prefilled
#ui unknown                a method Pi has never defined, still answerable (Cancel only)
#ui select:9               nine options — past the stacking+scroll threshold
#ui select:empty           an empty options array
#ui select:long            self-numbered options, captured verbatim from a live run
#ui input:multiline        a title with a hard break and a bracketed extension prefix
#ui <method> timeout=<s>   adds a deadline in seconds (rejected for editor)
#ui multi <n>              raises n dialogs at once, none awaited individually
#ui help                   this list
```

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/providers/mock/ui-script.ts` | created — pure `parseUiScript`/`getUiScriptHelpText` |
| `packages/server/src/agent/providers/mock/ui-script.test.ts` | created — parser unit tests (19 tests) |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | modified — `startTurn` dispatches to a new scripted-turn path; `respondToUi` resolves pending scripted promises alongside its existing `uiResponses` recording |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | modified — added a `#ui script trigger` describe block (6 tests); moved the `makeSession` test helper to module scope as `makeMockSession` (lint: consistent-function-scoping) |

## How it satisfies the scope

- **Acceptance:** `parseUiScript` returns `null` for ordinary prompts, including ones merely
  mentioning `#ui` later in the text (`ui-script.test.ts`).
- **Acceptance:** every recipe's `method`/payload keys match § 00's table; `select:empty` really
  emits `options: []` (asserted via `toHaveProperty`, not just a falsy check).
- **Acceptance:** `#ui multi 3` raises three simultaneously-pending dialogs
  (`mock-provider.test.ts`, distinct `requestId`s, none awaited before the next is raised).
- **Acceptance:** `timeout=` honoured for `select`/`confirm`/`input`, rejected for `editor`.
- **Acceptance:** answering echoes the answer; cancelling echoes the cancellation.
- **Acceptance:** `#ui help` lists every recipe, raises no dialog.
- **Acceptance:** existing mock-provider tests pass unchanged (all 18 pre-existing tests still pass).

No production/`pi` code touched — the mock provider was already dev/test-only and unreachable from
any production path; nothing here changes that.

## Build & test results

```
$ npx vitest run packages/server/src/agent/providers/mock/
 ✓ ui-script.test.ts (19 tests)
 ✓ mock-provider.test.ts (18 tests)
 Test Files  2 passed (2)
      Tests  37 passed (37)

$ npm run build:server
(clean)

$ npm run clean && npm run build       # full monorepo build, to rule out stale .tsbuildinfo
(clean — all packages, including web-client's Vite build)

$ npm run typecheck
(clean)

$ npm run lint
0 errors; only pre-existing warnings elsewhere in the repo. One warning I introduced
(`consistent-function-scoping` on the test helper) was fixed by moving it to module scope.

$ npx oxfmt packages/server/src/agent/providers/mock/{ui-script.ts,ui-script.test.ts,mock-provider.ts,mock-provider.test.ts}
Finished in 102ms on 4 files using 32 threads.

$ npm run fmt:check
57 pre-existing files fail (none of the 4 files touched by this task) — unrelated repo drift, not
introduced or worsened by this change.
```

## Acceptance criteria

- [x] `parseUiScript` returns `null` for ordinary prompts, including ones that merely contain `#ui`
      later in the text.
- [x] Each documented recipe produces a `ProviderUiRequest` whose `method` and payload keys match
      § 00's table; `select:empty` really emits an empty array rather than omitting `options`.
- [x] `#ui multi 3` raises three dialogs that are all pending simultaneously.
- [x] `timeout=` is honoured for `select`/`confirm`/`input` and rejected for `editor`.
- [x] Answering a scripted dialog produces assistant text naming the answer the provider received;
      cancelling produces text showing the cancellation.
- [x] `#ui help` lists every recipe and raises no dialog.
- [x] Existing mock-provider tests still pass unchanged.

## Follow-ups / TODO(verify)

- None. This task builds the instrument only; visual sign-off of the rendered cards happens in
  tasks 005+ once there is something to render, using the recipe list above.
