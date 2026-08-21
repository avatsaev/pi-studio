# Task 004 — Daemon: serve a reflowable `Restore` frame from the headless screen model — Summary

- **Sprint:** sprint-053-terminal-fidelity
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

**Serialization** — `ScreenBuffer` gained `serialize(): string`, backed by
`@xterm/addon-serialize@0.14.0` loaded into the same headless `@xterm/headless@6.0.0` `Terminal`
instance `capture()`/`snapshotText()` already use. **Version note deviates from the task's own
prediction**: the task warned the 0.x line "targets xterm 5" and suggested picking a 6.x-paired
beta. I verified empirically instead of guessing — a scratch script pairing
`@xterm/addon-serialize@0.14.0` (latest *stable*, no declared peer range at all) with
`@xterm/headless@6.0.0` round-trips SGR colours, cursor position, and text correctly. The addon's
real implementation only touches `buffer.active` cells/modes, a surface that has been stable
across this xterm major regardless of which package line declares a peer on it — using a
production dependency on an actual beta release for an addon that already works stably would have
been the worse choice. `ScreenBuffer.serialize()` bounds output to `RESTORE_SCROLLBACK_LINES = 200`
lines of history beyond the viewport (`addon.serialize({ scrollback: 200 })`), verified against a
500-line-history terminal producing a sub-10KB payload rather than the full history.

**CJS/UMD interop** (the task's own warning materialized exactly as predicted): both
`@xterm/headless` and `@xterm/addon-serialize` ship UMD bundles Node's ESM loader cannot statically
read, so both are loaded through `createRequire`. **One TypeScript-interop wrinkle beyond what the
task anticipated**: `@xterm/addon-serialize`'s published types declare `activate(terminal:
Terminal)` against `@xterm/xterm` (the *browser* package) specifically, which is not structurally
assignable to `@xterm/headless`'s own `ITerminalAddon` (which wants ITS `Terminal` type) — resolved
with a documented `as unknown as ITerminalAddon` cast at the one `loadAddon()` call site, justified
by the same empirical verification above. Also complied with a session rule requiring top-level
`import type` over inline `import("pkg").Type` annotations — both CJS interop blocks (`@xterm/
headless`'s pre-existing one and the new `@xterm/addon-serialize` one) now use `import type {
X as Y } from "pkg"` + a typed `require()` destructure, rather than `as typeof import("pkg")`.

**Manager**: `subscribe(slot, sink, opts?)` gained an `opts.restoreMode` parameter (`RestoreMode =
"basic" | "reflowable"`, exported). Basic (default, unchanged) sends the `Snapshot` byte-ring
frame; reflowable sends exactly one `Restore` (`0x05`) frame carrying `screenModel.serialize()`
instead — never both, never neither, matching the existing single-sink-write structure exactly.

**RPC**: `subscribe_terminal_request`'s negotiation was tightened per the task's explicit
instruction — previously `requestedMode ?? "basic"` passed through whatever string the client sent
verbatim even when eligible, so a typo'd/future value would be echoed back as though it had been
served. Now: `deps.restoreModesEnabled && clientReflowable && requestedMode === "reflowable" ?
"reflowable" : "basic"` — any other value, including the literal wrong string two pre-existing
tests were using (`"reflow"` — see below), is served and echoed as `"basic"`. The negotiated mode
is passed straight through to `manager.subscribe`.

**Pre-existing test bug found and fixed**: `terminal-rpcs.test.ts`'s "restore-mode gating" describe
block used the wire literal `"reflow"` instead of the real `"reflowable"` in both of its tests —
they were unknowingly exercising (and asserting correct-looking behavior for) exactly the
loose-negotiation bug this task's own spec calls out. Fixed both, and used the fix as the basis for
a fourth new test (`"reflow"` typo is served+echoed as basic even when otherwise eligible) — a
direct regression test for the tightening itself, not just for the intended-literal case.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/package.json` | added `@xterm/addon-serialize@^0.14.0` |
| `packages/server/src/terminal/screen-buffer.ts` | `serialize()`, `RESTORE_SCROLLBACK_LINES`, addon loading; also fixed the pre-existing `@xterm/headless` CJS-interop import to use top-level `import type` |
| `packages/server/src/terminal/screen-buffer.test.ts` | 3 new tests (SGR colour round-trip, cursor position round-trip, bounded scrollback) |
| `packages/server/src/terminal/terminal-manager.ts` | `RestoreMode` type export; `subscribe()` gained `opts?.restoreMode` |
| `packages/server/src/terminal/terminal-manager.test.ts` | 2 new tests (reflowable → Restore only; basic/no-opts → Snapshot only) |
| `packages/server/src/terminal/terminal-rpc.ts` | tightened `restoreMode` negotiation; passes it to `manager.subscribe` |
| `packages/server/src/terminal/terminal-rpcs.test.ts` | fixed the `"reflow"`→`"reflowable"` literal bug in both existing gating tests, added frame-opcode assertions to them, added 2 new tests (daemon-feature-disabled fallback; typo'd-value regression) |
| `swe/features/terminals.md`, `swe/features/feature-panels-ui.md` | resolved the two "Restore payload format"/"snapshot serialization format" TODO(verify) items with the concrete choice made |
| `packages/server/AGENTS.md` | documented `subscribe`'s new `opts`, `onTerminalExit` (task-003, previously undocumented), `restoreMode` negotiation, and `terminals_update`'s broadcast shape |
| `packages/web-client/AGENTS.md` | documented `use-terminal-exit-watch.ts` (task-003), `TerminalPanel`'s appearance conformance (task-002) and exited-state banner (task-003), `ThemeBoundary`'s context/hooks (task-001) — all previously undocumented; corrected a now-stale claim that xterm reads the raw `baseFontSize.sm` literal |
| `AGENTS.md` (root) | added `terminals_update` to the § Protocol overview push-family list |

## How it satisfies the scope
Matches `terminals.md` § Restore / snapshot tier 2 exactly: negotiated per subscription, `Restore`
opcode `0x05` (already existed, unused until now), no new protocol schema/opcode. The basic tier
(mandatory fallback) is untouched — same byte-ring `Snapshot`, same `SnapshotRing`/`capture`/
`snapshotText` code paths, all their existing tests pass unmodified.

## Build & test results
```
$ npx vitest run packages/server
 Test Files  65 passed (65)
      Tests  790 passed (790)

$ npx tsc -b packages/server --force
(clean)

$ npx oxlint packages/server/src/terminal
(only the pre-existing, unrelated `key` consistent-function-scoping warning in terminal-rpc.ts)

$ npx oxfmt --check <every changed file>
(clean, after one auto-fix pass)

$ npm run build:server
(clean)
```

## Acceptance criteria
All seven boxes ticked — every one is directly unit-tested (frame-opcode assertions, not just
`restoreMode` field checks) rather than inferred. No live daemon+client manual pass was run: the
task's own manual step needs a capability-advertising client, which does not exist until task-005;
running it now would mean either building a throwaway scratch client (duplicate work) or waiting for
task-005 to land. Deferred to task-006's consolidated sweep, once task-005 gives a real client to
drive it with — consistent with how task-003 was closed in this same sprint.

## Follow-ups / TODO(verify)
- None new. Client-side consumption (advertising the capability, requesting the mode, handling the
  `Restore` frame) is task-005, as scoped.
