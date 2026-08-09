# Task 005 — Headless `--api-key` path + non-TTY guard — Summary

- **Sprint:** sprint-054-provider-auth-cli
- **Completed:** 2026-08-07
- **Status:** done

## What was implemented

`packages/cli/src/auth-interaction.ts`:

- `createApiKeyInteraction({ apiKey, sink, signal, qr? })` — a prefilled `AuthInteractionLike`
  sibling to `createTerminalInteraction`. A `secret` prompt resolves with `apiKey` immediately
  (no terminal I/O, no echo); any other prompt kind (`text`/`select`/`manual_code`) rejects with
  `"provider requires interactive login; run without --api-key"` — the provider needs a real
  interactive flow (e.g. an OAuth device code) that a bare string can't satisfy. `notify` events
  render through the same `notifyFor` renderer `createTerminalInteraction` uses, so progress/error
  events stay visible even in the headless path.

`packages/cli/src/auth-commands.ts` — `runAuthLogin` extended:

- New `cmdOpts.apiKey` parameter (Commander's `--api-key <key>` camelCases to this automatically).
- Validation order, all before the Pi runtime is touched:
  1. `--type` value sanity (existing, task-004).
  2. `--api-key` + `--type oauth` together → error, zero runtime calls.
  3. `--api-key` without a provider argument → error, zero runtime calls.
- **Non-TTY guard**, interactive path only: when `cmdOpts.apiKey === undefined`, an `io` is
  constructed (or the injected fake used) and checked via `io.isTty` *before* `runtimeOf()`/
  `listProviders()` — a false `isTty` fails immediately with guidance naming `--api-key` and the
  provider-argument requirement, explicitly noting OAuth providers can't be authenticated
  headlessly. The `--api-key` path never constructs or touches `io` at all (proven in tests with a
  poisoned `TerminalIo` that throws on any method call).
- `requestedType` derivation: `--api-key` implies `"api_key"` unconditionally (no need to fall
  through to `--type`, since the two are mutually exclusive by the validation above).
- Pre-flight provider-capability check (`typeUnsupportedError`) unchanged in position — it already
  ran before interaction construction for task-004's `--type`, so `--api-key` against an
  oauth-only provider hits the same guard, before any prompt and before `runtime.login()` is ever
  called.
- `interaction` is now `createApiKeyInteraction(...)` when `--api-key` is set, else the existing
  `createTerminalInteraction(...)`.

`registerAuthCommands`: added `.option("--api-key <key>", "...")` to the `login` subcommand, with
help text noting shell-history/process-listing visibility per the task's Notes.

## Files created / changed

| File | Change |
|------|--------|
| `packages/cli/src/auth-interaction.ts` | modified — added `createApiKeyInteraction` |
| `packages/cli/src/auth-commands.ts` | modified — `--api-key` option, non-TTY guard, `runAuthLogin` rewired |
| `packages/cli/src/auth-commands.test.ts` | modified — 9 new tests |

## How it satisfies the scope

Maps to `swe/features/provider-auth-cli.md` § Public Contract (`--api-key`) and § Error Handling &
Edge Cases (non-TTY rows). No env-var key-reading mechanism was added — the task explicitly calls
this out as intentionally out of scope (the shell already does `--api-key "$VAR"`), and no such
path exists in the implementation. `auth status`/`auth logout` were not touched at all — they never
construct a `TerminalIo` or check `isTty`, so the "still work on a non-TTY" acceptance row holds
structurally, not by a new code path.

## Build & test results

```
$ npm run build:cli
tsc -b packages/cli && chmod +x packages/cli/dist/cli.js
(success)

$ npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/cli/src
(exit 0, no findings)

$ npx oxfmt --check packages/cli/src/auth-commands.ts packages/cli/src/auth-commands.test.ts packages/cli/src/auth-interaction.ts
All matched files use the correct format.

$ npx vitest run packages/cli/src
Test Files  14 passed (14)
     Tests  210 passed (210)
```

`packages/cli/src/auth-commands.test.ts` gained 9 tests across three new `describe` blocks:

- **`auth login --api-key (headless)`** (6 tests): zero-prompt completion with a *poisoned*
  `TerminalIo` (every method throws) proving the headless path never touches terminal I/O at all;
  the key never appears in recorded stdout/stderr; missing-provider error; `--type oauth` +
  `--api-key` rejected with zero `listProviders()` calls; an oauth-only provider rejected after
  lookup with zero `login()` calls; a non-`secret` prompt from the fake runtime's `login()`
  rejects with the documented message.
- **`auth login — non-TTY guard`** (1 test): `isTty: false` fake `io`, no `--api-key` → fails with
  guidance mentioning both `--api-key` and "tty", `listProviders()` never called, `io.close()`
  called, and `ModelRuntime.create` (the mocked Pi entry point) never invoked.
- **`auth status / auth logout on non-TTY stdin`** (2 tests): both commands still exit 0 driven
  through the full `run()` entry point — confirming they're structurally unaffected by the guard.

## Manual verification (real PTY / real CLI binary, `--pi-home /tmp/pi-home-005`)

```
$ node packages/cli/dist/cli.js --pi-home /tmp/pi-home-005 auth login openai --api-key sk-test-headless-123
openai: logged in (api_key). Credential stored at /tmp/pi-home-005/agent/auth.json.
Agents pick this up automatically on their next spawn — no restart needed.
EXIT: 0

$ cat /tmp/pi-home-005/agent/auth.json
{ "openai": { "type": "api_key", "key": "sk-test-headless-123" } }

$ node packages/cli/dist/cli.js --pi-home /tmp/pi-home-005 auth login --api-key sk-x
--api-key requires an explicit provider argument, e.g. `auth login openai --api-key K`.
EXIT: 1

$ node packages/cli/dist/cli.js --pi-home /tmp/pi-home-005 auth login openai --api-key sk-x --type oauth
--api-key implies --type api_key; it cannot be combined with --type oauth.
EXIT: 1

$ node packages/cli/dist/cli.js --pi-home /tmp/pi-home-005 auth login openai-codex --api-key sk-x
Provider "openai-codex" does not support --type api_key. Supported: oauth.
EXIT: 1
(openai-codex confirmed oauth-only via listProviders() against the real registry)

$ node packages/cli/dist/cli.js --pi-home /tmp/pi-home-005 auth login < /dev/null
Interactive login needs a TTY; use --api-key <key> with an explicit provider for a non-interactive
setup (scripts, CI, provisioning). OAuth providers cannot be authenticated this way — they need a
real interactive login.
EXIT: 1
```

Test artifacts (`/tmp/pi-home-005`) cleaned up after verification.

## Acceptance criteria

- [x] `auth login <p> --api-key K` completes with zero prompts and stores the key, exit `EXIT_OK`
      — verified in both unit tests (poisoned `io`) and real PTY (`auth.json` contents inspected).
- [x] The key appears in no sink output — verified in unit test and by inspection of real command
      stdout above (only the provider id and credential type are echoed, never the key).
- [x] `--api-key` without a provider argument errors, exit `EXIT_ERROR`.
- [x] `--api-key` + `--type oauth` errors at parse time (zero `listProviders()` calls); `--api-key`
      against an oauth-only provider errors after lookup, before any login flow (zero `login()`
      calls) — both verified in unit tests and the real `openai-codex` run above.
- [x] A provider whose api-key flow asks a non-`secret` prompt fails with the documented message.
- [x] Non-TTY stdin without `--api-key` fails fast, never constructs the Pi runtime (verified via
      the mocked `ModelRuntime.create` never being invoked) — real PTY run above also confirms no
      hang.
- [x] `auth status` and `auth logout` still work on a non-TTY (existing code paths unchanged;
      confirmed with two new tests routed through the full `run()` entry point).

## Follow-ups / TODO(verify)

- None. Task-006 (e2e verification and docs) is next; it should fold the `--api-key` headless flow
  into its live-run sequence and note the `AGENTS.md` § Invariants amendment already flagged by
  task-003/004 (CLI now runs Pi's auth engine in-process, lazily, for the `auth` command group).
