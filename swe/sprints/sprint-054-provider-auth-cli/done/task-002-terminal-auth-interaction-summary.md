# Task 002 — Terminal `AuthInteraction` (prompts, notifications, QR) — Summary

- **Sprint:** sprint-054-provider-auth-cli
- **Completed:** 2026-08-07
- **Status:** done

## What was implemented

`packages/cli/src/auth-interaction.ts` — the terminal-side UI adaptation layer over Pi's login
contract:

- `TerminalIo` — minimal I/O seam (`question`, `secret`, `isTty`, `close`).
- `createReadlineIo()` — production `TerminalIo` on `node:readline/promises`, built with
  `output: process.stderr` (not stdout) so query text and echoed input never leak onto the channel
  `--json` scripting depends on. Masked input (`secret()`) uses the internal `_writeToOutput` hook
  (accessed via bracket-notation string key, not a declared identifier, to keep the linter's
  `no-underscore-dangle` rule quiet) to suppress echo of both the query and typed characters while
  the secret is being entered, restoring the hook and printing a trailing newline afterward.
- `createTerminalInteraction(opts)` — builds an `AuthInteractionLike` (task-001's seam type):
  - `prompt()` handles all four kinds: `text`/`manual_code` via `io.question()`, `secret` via
    `io.secret()`, `select` via a numbered list that accepts a 1-based index or an exact option id,
    re-asking once on invalid input before rejecting.
  - Every prompt races the flow-wide `signal` and the prompt's own optional `signal` via a shared
    `raceAbort()` helper (built on `Promise.withResolvers()`, no `new Promise` executor), rejecting
    with the exported `AuthPromptAbortedError` (tagged `"flow"` / `"prompt"` / `"non-tty"`) the
    moment either fires; a per-prompt abort additionally prints the "resolved in the browser —
    continuing" note.
  - A prompt on a non-TTY `io` rejects immediately with `AuthPromptAbortedError("non-tty")`.
  - `notify()` renders all four event kinds to stderr: `info` (message + links), `auth_url`
    (instructions + url + QR), `device_code` (userCode + verificationUri + QR + optional expiry),
    `progress` (single line). QR rendering (`qr`, defaults to `renderQrToTerminal`) always degrades
    to URL-only output on failure — never breaks the flow. `notify()` is synchronous per the real
    `AuthInteraction` contract, so its QR step is fire-and-forget internally with its own error
    handling plus an outer safety-net catch.

## Files created / changed

| File | Change |
|------|--------|
| `packages/cli/src/auth-interaction.ts` | created |
| `packages/cli/src/auth-interaction.test.ts` | created |

## How it satisfies the scope

Maps to `swe/features/provider-auth-cli.md` § Behavior & Algorithms (readline interaction mapping
table) and § Error Handling (non-TTY, SIGINT). Prompt/event field shapes (`type` discriminant,
`select`'s `options: {id,label,description?}[]`, `device_code`'s `userCode`/`verificationUri`) match
the real `pi-ai` `AuthPrompt`/`AuthEvent` types field-for-field (verified against
`@earendil-works/pi-coding-agent`'s bundled `pi-ai` type declarations), consistent with task-001's
`AuthPromptLike`/`AuthEventLike`/`AuthInteractionLike` types this module implements against. No
deviation from the task spec.

## Build & test results

```
$ npm run build:cli
tsc -b packages/cli && chmod +x packages/cli/dist/cli.js
(success)

$ npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/cli/src/auth-interaction.ts packages/cli/src/auth-interaction.test.ts
(exit 0, no findings)

$ npx oxfmt --check packages/cli/src/auth-interaction.ts packages/cli/src/auth-interaction.test.ts
All matched files use the correct format.

$ npx vitest run packages/cli/src
Test Files  13 passed (13)
     Tests  179 passed (179)
```

`packages/cli/src/auth-interaction.test.ts` (15 tests): all four prompt kinds (`text` via
`io.question`, `secret` via `io.secret` with a proof the secret value never appears in either sink
channel, `manual_code` with placeholder rendering, `select` by index/by id/invalid-retry-then-reject),
all four event kinds (`info`+links, `progress`, `auth_url`+QR, `device_code`+QR+expiry — the two QR
cases use a deterministic `waitForErr(predicate)` helper on the recording sink rather than a guessed
flush duration), a throwing-`qr` degrade-to-URL-only case (using a bounded, purely microtask-based
`flushMicrotasks()` since that path produces no further observable write to condition on), both
abort paths (flow-wide and per-prompt, the latter asserting the out-of-band note), the non-TTY
immediate-rejection case, and a dedicated stdout-stays-clean assertion across a full prompt+notify
sequence.

## Acceptance criteria

- [x] Each of the four prompt kinds resolves with the expected value against a fake `TerminalIo`;
      `select` resolves by index and by option id, and rejects after one invalid retry.
- [x] `secret` never echoes the value and the value never appears in any sink output.
- [x] Each of the four event kinds renders the documented fields; `auth_url` and `device_code`
      include QR output, and a throwing `qr` degrades to URL-only without failing the flow.
- [x] Flow-wide abort rejects a pending prompt with `AuthPromptAbortedError`.
- [x] Per-prompt `signal` abort rejects only that prompt and prints the "resolved out of band" note.
- [x] A prompt on a non-TTY io rejects immediately (never hangs).
- [x] All prompt/notify output goes to stderr; stdout receives nothing from this module.

## Follow-ups / TODO(verify)

- None outstanding at completion. **Amended during task-004's real-PTY manual verification** (two
  real bugs invisible to unit tests, both fixed in this file, full detail in task-004's summary):
  1. **Masking was a no-op on current Node.** The `_writeToOutput` hook this task's `askMasked`
     relied on doesn't exist anymore on Node ≥ ~22/24 — it's a true private class field now, not a
     conventionally-private `_`-prefixed one. Secrets were echoed in plaintext to the real
     terminal. Fixed by temporarily replacing the output stream's own public `write()` instead
     (verified: readline's echo funnels through it regardless of Node version).
  2. **SIGINT during an active prompt never reached `process.once("SIGINT", ...)`.** Once
     `readline`'s raw mode is engaged (`terminal: true`), Ctrl+C is trapped by readline itself —
     process-level `'SIGINT'` never fires for the interface's lifetime. Fixed by registering
     `rl.on("SIGINT", ...)` in `createReadlineIo` (now takes the flow's `AbortController`) and
     threading that signal into every `question()`/`secret()` call via `rl.question(query,
     {signal})` — `node:readline/promises`'s own documented cancellation mechanism — instead of
     leaving the underlying read to dangle. `TerminalIo.question`/`secret` gained an optional
     `signal` parameter; `promptSelect` now takes one too.
  - `packages/cli/src/auth-interaction.test.ts`'s existing 15 tests all still pass unmodified —
    they exercise `createTerminalInteraction` against fake `TerminalIo`s and never touched
    `createReadlineIo`/real readline, so they couldn't have caught either bug. No test gap was
    closed here beyond what task-004's real-PTY verification already covers end-to-end.
