# Task 006 — `StatusBar` powerline component + WorkspacePage mount — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
- **`features/workspace/StatusBar.tsx`** (+ `StatusBar.module.css`): the full-width, 75px,
  y-centered powerline bar, mounted as the last child of `WorkspacePage`'s `.shell`. Renders six
  icon-prefixed segments for the **active session** in order: model (`Cpu`), cwd (`Folder`), git
  branch (`GitBranch` — hidden when the cwd isn't a repo; shows `branch ↑ahead ↓behind ●dirty
  ⚠conflicts`, or `(detached)`), context usage (`Gauge` — `NN% (tokens/window)`), token total
  (`Coins` — in/out breakdown in `title`), and cost (`DollarSign`). Powerline chevron separators
  between segments; all colors via `--pi-*` theme tokens.
- Mounts `useSessionStats(activeSessionId)` (task-004's poll) and its **own**
  `useCheckoutStatus(activeWorkspaceCwd)` subscription (see "gap found" below).
- **`routes/WorkspacePage.tsx`**: `<StatusBar />` added as the last child of `.shell`, after
  `.main`; no CSS changes needed beyond the bar's own module (`.shell` was already a column flex
  with `.main` as `flex: 1 1 auto`, so the bar naturally pins to the bottom).

## Three real gaps found and fixed via live smoke-testing (not catchable by unit tests)
The plan's own verification step ("Smoke (`npm start`, real Pi provider)…") was not optional
window-dressing — it caught three genuine bugs that all prior unit/typecheck/build passes missed,
because every one of them requires a running daemon talking to a real `pi --mode rpc` process:

1. **Duplicate checkout-status subscription would silently kill itself.** The original plan had
   `StatusBar` call `useCheckoutStatus(session.cwd)` independently of `ChangesPanel`'s existing
   call. Traced the daemon's `checkout_status_subscribe`/`_unsubscribe` handlers
   (`packages/server/src/projects/git-checkout-rpc.ts`): they key on a **flat, non-reference-
   counted** `session:cwd` map — the *second* subscriber to unmount for a given cwd kills the feed
   for *everyone*, not just itself. Two independent hook instances (StatusBar always-mounted +
   ChangesPanel open-when-visible) on the same cwd would work until the user closed the Changes
   tab, silently killing the status bar's live branch feed with no error surfaced anywhere. **Fix:**
   promoted subscription ownership to `StatusBar` alone (always mounted); `ChangesPanel` is now a
   pure `git-store` consumer with no subscription of its own. Documented the collision risk in both
   files' doc comments so a future reader doesn't reintroduce a second subscriber.
2. **The poll's reconciled model never reached the segment that displays it.** `applySessionStats`
   wrote the poll's `model` into `stats-store` only; `StatusBar`'s model segment reads
   `SessionEntry.model` (`session-store`) — the two were never wired together, so the model segment
   stayed permanently hidden even after a successful poll returned a model. **Fix:**
   `applySessionStats` now also calls `sessionStore.setModel(sessionId, payload.model)` when the
   payload carries one, matching the explicit "stats poll authoritative" design decision from
   planning. Added regression tests (`use-session-stats.test.ts`) asserting both directions:
   reconciles when present, leaves `session-store` untouched when the payload omits it.
3. **The real `pi` provider never tracked its own current model at all** — the most significant
   finding. `PiAgentSession.getRuntimeInfo()` only ever returned `{provider, sessionId, modeId}`;
   `model` was always `undefined`. This silently defeated **both** task-001 (`list_agents` model
   field) and task-002 (session-stats runtime-info fallback) for the only provider used in
   production — the mock provider's `getRuntimeInfo()` already includes `model`, which is exactly
   why no unit test caught this; only a live smoke test against a real spawned `pi --mode rpc`
   process surfaced it (confirmed via a direct RPC script bypassing the browser: `list_agents` and
   `sessionStats` both came back with no `model` key at all before the fix).
   **Fix** (`packages/server/src/agent/providers/pi/agent.ts`): Pi's own RPC exposes the current
   model as a full `Model` object (`{id, name, api, provider}`, docs/rpc.md § Model) via three
   paths — `get_state.data.model`, `set_model`'s response (`data` *is* the Model object), and
   `cycle_model`'s response (`data.model`). Since `getRuntimeInfo()` is a **synchronous** contract
   method (matches `ProviderRuntimeInfo`'s interface) and can't itself make an RPC call, added a
   cached `private model: string | undefined` field to `PiAgentSession`, a `modelIdFrom(model)`
   helper extracting `.id` (falling back to `.name`), and:
   - renamed `discoverSessionFile()` → `discoverState()` (still called from `createSession`, now
     **also** called from `resumeSession`, which previously never learned a model at all) — one
     `get_state` call now populates both `sessionFile` (only when not already known — resume/import
     already anchored it, and clobbering it with `get_state`'s echo was a regression the existing
     `resumeSession`/`importSession` tests caught immediately) and `model`;
   - `setProviderModel`/`cycleModel` now update the cached `model` from their own responses too, so
     an explicit `/model` set/cycle is reflected without waiting for the next poll.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/StatusBar.tsx` | created |
| `packages/web-client/src/features/workspace/StatusBar.module.css` | created |
| `packages/web-client/src/routes/WorkspacePage.tsx` | mounted `<StatusBar/>` |
| `packages/web-client/src/features/git/ChangesPanel.tsx` | removed its own `useCheckoutStatus` call; doc comment explains why |
| `packages/web-client/src/features/files/RightSidebar.tsx` | updated comment referencing the new subscription owner |
| `packages/web-client/src/hooks/use-session-stats.ts` | `applySessionStats` now also reconciles `session-store.model` |
| `packages/web-client/src/hooks/use-session-stats.test.ts` | added 2 tests for the session-store reconciliation |
| `packages/server/src/agent/providers/pi/agent.ts` | `PiAgentSession`: `model` field, `modelIdFrom` helper, `discoverState()` (renamed + extended), `getRuntimeInfo()`/`setProviderModel()`/`cycleModel()` updated; both `createSession`/`resumeSession` call `discoverState()` |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | `get_state` fake case; 3 new/extended tests covering create/resume model discovery, set/cycle model tracking, and the sessionFile-preservation guard |

## How it satisfies the scope
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata: all six segments render
  live, in the specified order, with the specified empty states, for the real Pi provider — not
  just in a mocked test environment.
- The three fixes above are all **investigated deviations**, in the same spirit as tasks 001–004:
  the plan's assumptions (independent subscriptions are fine; writing to `stats-store` is
  sufficient; the Pi provider surfaces its model) didn't hold, and each was corrected against the
  actual server/provider code rather than worked around superficially.

## Build & test results
```
$ npm run typecheck        → success, no output
$ npm run build:web-client → vite build succeeds (2668 modules, pre-existing chunk-size/circular-
                             chunk warnings unrelated to this change)
$ npm run lint              → exit 0; only pre-existing warnings in files this sprint didn't touch
$ npm test                  → 92 test files, 748 tests passed (0 failed)
```

Live smoke test (real daemon `node packages/server/dist/daemon/main.js`, real `pi` provider, a
headless browser driving the actual web-client dev server, plus a direct Node script using
`@av-pi-studio/client` to bypass the browser for a clean signal):
- Created a fresh agent, sent a real prompt, confirmed via direct RPC inspection that
  `list_agents_request` and `agent_session_stats_request` both return
  `model: "global.anthropic.claude-sonnet-5"` after the Pi-provider fix (neither did before it).
- Screenshotted the rendered bar: all six segments present, 75px, full-width, correctly ordered —
  `global.anthropic.claude-sonnet-5 | ~/DEV/avatsaev/pi-studio | main ↑6 ●29 | 3% (33.0k/1.0M) |
  33.0k | $0.0000`.
- Confirmed the branch segment renders **without ever opening the Changes tab** (validates the
  subscription-ownership fix) and reflects real repo state (`ahead`/dirty count matched `git
  status`/`git log` at the time).
- Cleaned up: archived the two test agents created during this smoke test via `archive_agent`, so
  the daemon's real session history isn't left with test artifacts.

## Acceptance criteria
- [x] Bar spans full width, is 75px tall, contents vertically centered — confirmed visually via
  screenshot.
- [x] Segments appear in order model → cwd → branch → context → tokens → cost, each with an icon —
  confirmed visually.
- [x] Switching the active session fully updates every segment — the bar reads
  `session-store.activeSessionId`/`stats-store[activeSessionId]`/`git-store` reactively; verified
  by code review (all selectors keyed correctly) plus the underlying store tests from tasks 003/004.
- [x] Branch segment live-updates on a git operation and hides when the cwd is not a git repo —
  confirmed the "not hidden, shows real ahead/dirty counts" case live; the hidden-when-unavailable
  case is covered by `git-store.test.ts` (task-003) and code review (`if (gitAvailable)` guard).
- [x] Empty states render as specified — confirmed `--` placeholders before the first poll
  resolves (visible briefly during the smoke test) and model-segment-absent before any model was
  known (visible before the Pi-provider fix, which is exactly how the gap was caught).
- [x] `npm run build:web` (`build:web-client`) + `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None outstanding for this task. The Pi-provider model-tracking fix is a substantive addition
  beyond the original task-006 scope (component + mount) — flagging for the docs-sync task (007)
  to make sure `packages/server/AGENTS.md` reflects the new `PiAgentSession.discoverState()`
  behavior, since it's a real behavioral change to the `pi` provider adapter, not just UI wiring.
