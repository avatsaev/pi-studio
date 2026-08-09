# Task 004 — `pi-studio auth login` (interactive: picker, method choice, flow, cancel) — Summary

- **Sprint:** sprint-054-provider-auth-cli
- **Completed:** 2026-08-07
- **Status:** done

## What was implemented

`packages/cli/src/auth-commands.ts` — `auth login [provider] [--type api_key|oauth]`, the sprint's
headline command, extending the existing `auth` group:

- `runAuthLogin(ctx, opts, providerArg, cmdOpts, io?)` — exported orchestration function; `auth
  login`'s Commander action calls it, and tests call it directly with a fake `TerminalIo`.
- **Pre-flight** (before any prompt, only reachable with an explicit provider argument): `--type`
  literal validation, unknown-provider-id (shared `unknownProviderMessage` helper, refactored out of
  task-003's `runAuthLogout` for reuse), and `--type` unsupported-by-provider (`typeUnsupportedError`
  naming the types the provider does support).
- **Provider picker** (`pickProviderInteractively`) — only when no provider argument is given: bounded
  `checkAuthBounded()` per provider (task-003's shared helper), rendered as a `select` `AuthPromptLike`
  through the interaction layer (task-002) — never writes prompt text directly, per the task's own
  orchestration/rendering split. Labels show method badges, `oauthLoginLabel`, an `[subscription]`
  marker, and an `[already configured]` marker.
- **Method resolution** (`resolveLoginMethod`) — `--type` wins if given (pre-validated); a
  single-method provider needs no prompt; a dual-method provider gets one `select` prompt labelled
  with the provider's OAuth `loginLabel` when present.
- **Flow execution** — one `AbortController` per invocation, `io ?? createReadlineIo(controller)`
  (`io` left unresolved as a plain optional parameter, not a default-parameter expression, so no
  readline interface — and no Pi import further down the chain — is ever constructed for a
  pre-flight-error exit or when a test supplies its own fake). `runtime.login(provider.id, type,
  interaction)` on success prints the provider, credential type, and resolved `auth.json` path, plus
  a one-line pointer that agents pick up the new credential on their next spawn (no daemon connection
  is made — this command stays local, per the task's own scoping).
- **Error handling** — a rejecting `login()` prints `errorMessage(error)`; a cancelled flow prints
  "login cancelled". `finally` always removes the `SIGINT` listener and closes `io`.

`packages/cli/src/auth-interaction.ts` — **amended** (see below) during this task's real-terminal
manual verification, which surfaced two real bugs unit tests couldn't reach.

## Two real bugs found and fixed during manual verification

Both were invisible to task-002's own unit tests (which drive `createTerminalInteraction` against a
**fake** `TerminalIo`, never the real `createReadlineIo()`/real `node:readline`), and only surfaced
once this task exercised the full flow against a real PTY.

1. **Secret masking was a silent no-op on current Node.** `askMasked`'s `_writeToOutput` override —
   the classic hook older Node password-prompt packages use — doesn't exist anymore; on this repo's
   Node (v24.13.0) it's a genuine private class field, not merely `_`-prefixed. Verified directly: a
   real PTY session typing an API key showed it in **plaintext** in the transcript. **Fix:**
   temporarily replace the output stream's own public `write()` instead (verified: readline's echo
   funnels through it on any Node version). Re-verified against a real PTY: the entered key no longer
   appears anywhere in the terminal output.
2. **SIGINT during an active prompt never reached `process.once("SIGINT", ...)`.** Once readline's
   raw mode is engaged (`terminal: true`), Ctrl+C is trapped by readline itself — confirmed via a
   focused diagnostic that a bare `process.on("SIGINT", ...)` handler simply never fires for the
   lifetime of an open readline interface, and that Node's own *default* handling (no `rl.on` 'SIGINT'
   listener registered) silently rejects the pending question and prints its own "Aborted with
   Ctrl+C" — bypassing this command's cancellation/message logic entirely. **Fix, two parts:**
   - `createReadlineIo` now takes the flow's `AbortController` and registers `rl.on("SIGINT", () =>
     controller.abort())` — the only reliable way to detect Ctrl+C once raw mode is engaged, and
     registering a listener also suppresses readline's own default reject+print behavior, handing
     control back to this code.
   - Every `question()`/`secret()` call now threads a signal into `rl.question(query, {signal})` —
     `node:readline/promises`'s own documented external-cancellation mechanism — so the pending read
     rejects **promptly** on abort instead of dangling forever (which, combined with bug 1's `write()`
     override, meant `output.write` stayed silently monkeypatched for the rest of the process — every
     later message, including "login cancelled" itself, was swallowed).
   - A third, related fix: even with both of the above, Pi's *own* `runtime.login()` implementation
     independently races `interaction.signal` (the documented "abort the whole flow" part of the
     `AuthInteraction` contract) and, on abort, throws its **own** generic `AbortError` — not this
     module's `AuthPromptAbortedError`. `runAuthLogin`'s catch now checks `controller.signal.aborted`
     directly (authoritative — this process owns that controller) rather than relying solely on
     `instanceof AuthPromptAbortedError`, so a real cancellation is correctly reported regardless of
     which layer's error object happens to win the race.

`TerminalIo.question`/`secret` gained an optional `signal` parameter (backward compatible: existing
fakes with fewer declared parameters still satisfy the interface); `promptSelect` now takes one too,
so Ctrl+C during the provider picker or method-select prompt (both before `runtime.login()` even
starts) also cancels cleanly instead of leaving a dangling read.

## Files created / changed

| File | Change |
|------|--------|
| `packages/cli/src/auth-commands.ts` | modified — added `auth login`, `unknownProviderMessage` extracted for reuse |
| `packages/cli/src/auth-commands.test.ts` | modified — added the `auth login` test suite |
| `packages/cli/src/auth-interaction.ts` | modified — masking fix, native-signal cancellation (see above) |

## How it satisfies the scope

Maps to `swe/features/provider-auth-cli.md` § Behavior & Algorithms (`authLogin` pseudocode) and
§ Error Handling & Edge Cases. Method-selection rules, pre-flight ordering, and the SIGINT/cancel
contract match the pseudocode and the review-fixed task text exactly. No scope creep: `--api-key`
and the non-TTY guard remain task-005's; no daemon/RPC interaction was added.

## Build & test results

```
$ npm run build:cli
tsc -b packages/cli && chmod +x packages/cli/dist/cli.js
(success)

$ npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/cli/src/auth-commands.ts packages/cli/src/auth-commands.test.ts packages/cli/src/auth-interaction.ts packages/cli/src/auth-interaction.test.ts
(exit 0, no findings)

$ npx oxfmt --check packages/cli/src/auth-commands.ts packages/cli/src/auth-commands.test.ts packages/cli/src/auth-interaction.ts packages/cli/src/auth-interaction.test.ts
All matched files use the correct format.

$ npx vitest run packages/cli/src
Test Files  14 passed (14)
     Tests  201 passed (201)
```

`packages/cli/src/auth-commands.test.ts` (`auth login` suite, 11 new tests): picker showing
configured-state and subscription badges and proceeding with the selection; single-method provider
gets zero method prompts; dual-method provider gets exactly one, rendering the OAuth `loginLabel`;
`--type` mismatched against the provider in both directions errors before any prompt (`io.question`
never called); unknown provider id errors with the valid id list; a scripted `secret`-prompt api_key
flow reports success with provider/type/path; a scripted `auth_url`-notify + `manual_code`-prompt
oauth flow completes and reports success; SIGINT during a pending prompt (via `process.emit("SIGINT")`
against the fake-io path, asserting `process.listenerCount("SIGINT")` returns to baseline) prints
"login cancelled" and exits nonzero; a rejecting fake `login()` prints the provider error with the
secret proven absent from both output channels; re-login on an already-configured provider proceeds
and calls `login()` again.

**Manual verification, real Pi, no fakes** (`node packages/cli/dist/cli.js --pi-home
/tmp/pi-auth-test auth login`, via a real PTY session, cleaned up after):

1. No-args picker rendered all ~40 real Pi providers with correct method badges, OAuth login labels,
   and `[subscription]` markers (Anthropic, GitHub Copilot, Kimi, OpenAI Codex, xAI all showed it
   correctly).
2. Selected MiniMax (api-key-only) by index — **no** method prompt appeared, exactly as designed.
   Entered a fake key; command reported success; `auth status` afterward showed
   `minimax  MiniMax  api key  stored credential`.
3. Ran `auth login openai` (provider positional, api-key-only) directly — no picker, no method
   prompt, straight to the secret prompt. **Before the masking fix**, the entered key appeared in
   plaintext in the transcript (bug 1 above); **after the fix**, re-ran and confirmed the key never
   appears anywhere in the output.
4. Confirmed `/tmp/pi-auth-test/agent/auth.json` exists at mode `0600` (`stat -c %a` = `600`).
5. Ran `auth login anthropic` (dual-method) — the method-select prompt correctly listed "1) API key"
   / "2) OAuth"; selected API key, reached the secret prompt.
6. Sent Ctrl+C at the pending secret prompt. **Before the fixes**, this printed either readline's own
   internal "Aborted with Ctrl+C" (bug 2) or, after the first partial fix, a raw
   `AbortError: This operation was aborted` (Pi's own `interaction.signal` race, third fix above) —
   **neither** the intended message. **After all three fixes**, re-ran against `auth login google
   --type api_key` (Gemini, api-key-only, to isolate the secret-prompt case) and confirmed the exact
   sequence: prompt shown → Ctrl+C → `login cancelled` printed → process exits with code 1, no hang,
   no leftover terminal corruption.
7. Repeated the Ctrl+C test with **no** provider argument, cancelling at the **picker** stage
   (`select` prompt, not `secret`) — same clean result: `login cancelled`, exit 1. Confirms the
   native-signal threading also covers `promptSelect`, not just `secret`.
8. `pi-studio auth logout not-a-real-provider` (from task-003, re-verified with this task's changes
   still applied) still exits 1 and lists every valid id — no regression.

## Acceptance criteria

- [x] `auth login` with no args prompts a provider picker showing configured state and subscription
      markers, and proceeds with the selection — unit-tested and manually verified against real Pi.
- [x] Single supported method → no method prompt; two methods → one prompt using the OAuth
      `loginLabel` when present — unit-tested and manually verified (Anthropic).
- [x] `--type` mismatched against the provider errors before any prompt, `EXIT_ERROR`, naming the
      supported types.
- [x] Unknown provider id errors with the valid id list, `EXIT_ERROR`.
- [x] A successful fake api_key flow reports success with provider/type/`auth.json` path, `EXIT_OK`
      — unit-tested and manually verified (real credential written, mode 0600).
- [x] A successful fake oauth flow (`notify auth_url` → `prompt manual_code` → resolve) completes and
      reports success.
- [x] SIGINT during a pending prompt aborts the flow, prints "login cancelled", exits `EXIT_ERROR`,
      and leaves no SIGINT handler or open readline behind — unit-tested (listener-count assertion)
      **and** manually verified against a real PTY at both the secret-prompt and picker stages, after
      fixing two real bugs this verification step exists to catch.
- [x] A rejecting `login()` prints the provider error, `EXIT_ERROR`, no secret in any output.
- [x] Re-login on an already configured provider is permitted and overwrites the credential.

## Follow-ups / TODO(verify)

- **Not closed:** whether any bundled OAuth flow binds a fixed localhost callback port that could
  collide with a running daemon. Closing this requires completing a real OAuth login (browser
  redirect + callback) against a real provider account, which needs live credentials/browser
  interaction unavailable in this environment. What *was* verified: the terminal-side plumbing for
  an OAuth flow (`auth_url`/`device_code` notify rendering with QR, `manual_code` prompt, the
  per-prompt-vs-flow-wide abort race task-002 built specifically for this callback-server race) is
  exercised by both the unit test (scripted oauth flow) and structurally by the method-select manual
  test (reached the OAuth branch, stopped at the secret/method boundary since real credentials
  aren't available). The port-collision question itself is Pi's own OAuth implementation detail, out
  of this module's control either way.
- Task-005 (`--api-key` headless path, non-TTY guard) and task-006 (E2E across a real daemon) build
  on this directly — task-006 in particular should redo a **live-run** module-load trace given the
  scope of changes here (task-003's summary already flagged the pre-existing `@av-pi-studio/server`
  eager-import finding; that guidance still applies unchanged).
