# Task 003 — Host: `launch` (initial connect intent and agent deep link) — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Host gained `launch: { initialConnect(): ConnectIntent | null; agentDeepLink: { current, subscribe, consume } }`. Browser implementation in `host/browser-launch.ts`: pure `parseBrowserConnectIntent(location)` with today's grammar (own-URL `#offer=` and `?pair=` always connect, `?host=` only with `connect=1`, `?connect=1` alone connects to the bar's current host), `#agent=` via `hashchange`, `consume` = `history.replaceState(stripAgentParam(href))`. `useConnectionBoot` now calls pure `applyConnectIntent(intent, deps)`; `useAgentDeepLinkBoot` calls pure `startAgentDeepLinkBoot(source)`; `applyPendingAgentDeepLink` consumes through the host (the `AgentDeepLinkDeps.replaceUrl` dep renamed `consumeSource`). The test host can script the intent, a boot-time deep link and emit later ones.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,browser-host}.ts` | launch member |
| `packages/workbench/src/host/browser-launch.ts` | created |
| `packages/workbench/src/host/launch.test.ts` | created (10 tests) |
| `packages/workbench/src/hooks/{use-connection,use-agent-deep-link-boot}.ts` | host-driven + pure cores |
| `packages/workbench/src/features/sessions/apply-agent-deep-link{,.test}.ts` | consume via host |
| `packages/workbench/src/lib/agent-deep-link.ts` | dep renamed consumeSource |
| `packages/workbench/src/test/test-host.ts` | launch scripting |
| `packages/workbench/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-host-adapter.md` § Member contracts (`launch.*`), § Supporting types. Deviation: `ConnectIntent.url` is optional (spec: required) so `?password=`/`?cwd=`-only pre-fills and `?connect=1` without a host keep working exactly as before; the connect call uses the bar's fields after pre-fill, as the old code did, and omits the password for a pairing link.

## Build & test results
```
$ rg "window\.location|window\.history|location\.(hash|search|href)|history\.replaceState" packages/workbench/src -g '!*.test.*'
only host/browser-launch.ts (plus two comments in html-sandbox.ts about the iframe's own location)
$ npx vitest run packages/workbench/src/host packages/workbench/src/hooks packages/workbench/src/features/sessions packages/workbench/src/lib
32 files / 271 tests passed
$ npm run build -> OK; typecheck -> OK; oxlint -> exit 0; oxfmt --check (35 changed files) -> clean
$ npx vitest run packages/workbench packages/web-client -> 112 files / 1474 tests passed

Browser (vite dev :5394, dev daemon :6790 with two mock agents A/B):
- ?host=127.0.0.1:6790&connect=1#agent=A -> connected, A's chat opened, `agent=` stripped from the URL;
- location.hash = agent=B while open -> B's chat opened without reload, fragment stripped again;
- ?pair=<encoded pairing link with host hint> -> connected; the pairing link itself (#offer=…&host=…) -> connected;
- ?host=127.0.0.1:6790 (no connect=1) -> address field pre-filled, "Connect" button shown, not connected.
```

## Acceptance criteria
- [x] No workbench source outside the browser host reads `window.location`/`window.history`.
- [x] Every URL form that worked before still works (checked in the browser; grammar unit-tested).
- [x] `initialConnect()` returning `null` → nothing pre-filled, no connect (unit test).
- [x] A deep link delivered through `subscribe` opens the agent without reload (unit test + browser hashchange).
- [x] Existing deep-link and connection tests pass.
- [x] `docs/desktop-client-handoff.md`: host section describes `launch` and the `ConnectIntent` shape.

## Follow-ups / TODO(verify)
- None.
