# Task 005 — Headless `--api-key` path + non-TTY guard

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done
- **Type:** feature
- **Area:** packages/cli — provider auth
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-004

## Goal

Make `auth login` usable from scripts, CI, and provisioning tooling: a fully non-interactive
api-key path, and a fail-fast (never hang) guard when interaction is impossible.

## Context / why

The interactive flow from task 004 is the human path. Two adjacent realities need handling:

1. **Scripted setup** — `pi-studio auth login openai --api-key "$OPENAI_KEY"` in a Dockerfile,
   provisioning script, or CI job, with no prompts at all.
2. **Accidentally non-interactive** — a piped or redirected stdin. Without a guard, a readline
   question against a non-TTY resolves EOF or hangs; a hung provisioning job is the worst outcome.

## Scope references

- `swe/features/provider-auth-cli.md` § Public Contract (`--api-key`), § Error Handling & Edge Cases
  (non-TTY rows)
- `packages/cli/src/auth-commands.ts` (task-004), `packages/cli/src/auth-interaction.ts` (task-002 —
  `TerminalIo.isTty`)
- Modify: `packages/cli/src/auth-commands.ts`, `packages/cli/src/auth-interaction.ts`,
  `packages/cli/src/auth-commands.test.ts`

## What to build

- **`--api-key <key>` option** on `auth login`:
  - Requires an explicit provider argument (no picker) and implies `--type api_key`; passing
    `--type oauth` with it is an error (rejected at option parsing, before anything loads).
  - Provider-capability validation (oauth-only provider → error) necessarily loads the Pi runtime
    (`listProviders()` is a runtime call) but happens **before the login flow starts** — no prompt
    is issued and nothing is written on the error path.
  - Uses a **prefilled interaction**: a `secret` prompt resolves with the key; **any other prompt
    kind rejects** with a clear message ("provider requires interactive login; run without
    --api-key"). `notify` events still render (so progress/errors remain visible).
  - Emits no prompt text and never echoes the key.
  - Reading the key from an env var is intentionally *not* added — the shell already does that
    (`--api-key "$VAR"`), and a second mechanism would fork the contract.
- **Non-TTY guard:** when stdin is not a TTY and the invocation would need any interactive prompt
  (no `--api-key`), fail before touching the Pi runtime with guidance naming `--api-key` and the
  need for a provider argument. Exit `EXIT_ERROR`.
- `auth status` / `auth logout` remain fully usable on a non-TTY (they never prompt) — the guard
  applies to `login` only.

## Out of scope

- OAuth in non-interactive environments (structurally impossible without a browser; the guard's
  message must not imply otherwise).
- Reading keys from files or stdin.

## Acceptance criteria

- [x] `auth login <p> --api-key K` completes with zero prompts and stores the key (fake runtime
      records the credential), exit `EXIT_OK`.
- [x] The key appears in **no** sink output (stdout or stderr).
- [x] `--api-key` without a provider argument errors, exit `EXIT_ERROR`.
- [x] `--api-key` with `--type oauth` errors at parse time; `--api-key` against an oauth-only
      provider errors after provider lookup but **before any login flow starts** — no prompt, no
      credential write in either case.
- [x] A provider whose api-key flow asks anything other than a `secret` prompt fails with the
      documented message and no partial write.
- [x] Non-TTY stdin without `--api-key` fails fast with guidance (test asserts it returns, does not
      hang, and never constructs the Pi runtime).
- [x] `auth status` and `auth logout` still work on a non-TTY.

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint` succeed.
- Tests: extend `packages/cli/src/auth-commands.test.ts` with a non-TTY fake `TerminalIo`
  (`isTty: false`) and a fake runtime. Cover every acceptance row, including the "no key in output"
  assertion over the full recorded sink. Run `npx vitest run packages/cli/src/auth-commands.test.ts`.
- Manual: `echo | node packages/cli/dist/cli.js --pi-home /tmp/pi-auth-test auth login` exits
  non-zero immediately with guidance; `node packages/cli/dist/cli.js --pi-home /tmp/pi-auth-test
  auth login <provider> --api-key sk-test-xxx < /dev/null` stores the key, and `auth status` shows
  it configured.

## Notes

- Prefer `io.isTty` (from task-002's `TerminalIo`) over reading `process.stdin.isTTY` directly in the
  command layer, so tests control it without touching globals.
- A key passed on the command line is visible in shell history and process listings — mention this
  briefly in the `--api-key` help text.
