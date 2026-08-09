# Task 004 — `pi-studio auth login` (interactive: picker, method choice, flow, cancel)

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done
- **Type:** feature
- **Area:** packages/cli — provider auth
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal

Deliver the sprint's headline command: an interactive `pi-studio auth login [provider]` that picks a
provider, picks an auth method, runs Pi's real login flow through the terminal interaction, and
persists the credential — replacing "hand-edit auth.json or find `/login` in a foreign TUI".

## Context / why

This is the actual onboarding fix. Everything it needs already exists after tasks 001–003: the
runtime seam, the interaction layer, and the command group. What is left is orchestration and the
two selection decisions (which provider, which method), plus clean cancellation.

Method selection rules, from the scope:

- `--type` given → use it (error if the provider does not support it).
- Provider supports exactly one login method → use it, no prompt.
- Provider supports both → one `select` prompt, labelled with the provider's OAuth `loginLabel`
  (e.g. "Sign in with Claude subscription") when present.

## Scope references

- `swe/features/provider-auth-cli.md` § Public Contract (Commands), § Behavior & Algorithms
  (`authLogin` pseudocode), § Error Handling & Edge Cases
- `packages/cli/src/auth-runtime.ts` (task-001), `packages/cli/src/auth-interaction.ts` (task-002)
- `packages/cli/src/auth-commands.ts` (task-003) — extend, do not fork
- `packages/cli/src/cli-core.ts` — `EXIT_OK`, `EXIT_ERROR`
- Modify: `packages/cli/src/auth-commands.ts`, `packages/cli/src/auth-commands.test.ts`

## What to build

- **`auth login [provider]`** with `--type <api_key|oauth>`, honoring the global `--pi-home`.
- **Provider picker** (no positional arg): reuse the interaction's `select` prompt over
  `listProviders()`, each row showing name, method badges, subscription marker
  (`oauthIsSubscription`), and current configured state from `checkAuth()`. Selecting an already
  configured provider is allowed (re-login) and says so.
- **Method selection** per the three rules above.
- **Flow execution:**
  - Create one `AbortController` for the flow; install a SIGINT handler that aborts it; **always**
    remove the handler and `io.close()` in a `finally`.
  - `runtime.login(provider, type, interaction)` → on resolve print a success line naming the
    provider, the credential type, and the resolved `auth.json` path; exit `EXIT_OK`.
  - On reject: distinguish **cancelled** (abort error from task-002) → "login cancelled",
    `EXIT_ERROR`; from **flow failure** (network, denied consent, provider error) → print the
    provider's message, `EXIT_ERROR`. Never print a partially-entered secret in either path.
- **Pre-flight validation** (before any prompt or Pi call that could write):
  - unknown provider id → error listing valid ids;
  - `--type` unsupported by the provider → error naming the supported types.
- **Post-login hint:** if a daemon is running with a different `piHome` than the one just written,
  we cannot know — so instead print a one-line pointer that agents pick the credential up on their
  next spawn (no daemon connection is made; this command stays local).

## Out of scope

- `--api-key` non-interactive path and the non-TTY guard (task 005).
- Any daemon RPC, restart, or agent notification.

## Acceptance criteria

- [x] `auth login` with no args prompts a provider picker built from `listProviders()`, showing
      configured state and subscription markers, and proceeds with the selection.
- [x] `auth login <provider>` with a single supported method starts that flow with **no** method
      prompt; with two methods it prompts once, using the OAuth `loginLabel` when present.
- [x] `--type oauth` on an api-key-only provider (and vice versa) errors before any prompt, exit
      `EXIT_ERROR`, with the supported types named.
- [x] Unknown provider id errors with the valid id list, exit `EXIT_ERROR`.
- [x] A successful fake api_key flow (`prompt secret` → resolve) reports success with provider,
      type, and `auth.json` path, exit `EXIT_OK`.
- [x] A successful fake oauth flow (`notify auth_url` → `prompt manual_code` → resolve) completes
      and reports success.
- [x] SIGINT during a pending prompt aborts the flow, prints "login cancelled", exits `EXIT_ERROR`,
      and leaves no SIGINT handler or open readline behind.
- [x] A rejecting `login()` prints the provider error and exits `EXIT_ERROR`, with no secret in any
      output.
- [x] Re-login on an already configured provider is permitted and overwrites the credential.

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint` succeed.
- Tests: extend `packages/cli/src/auth-commands.test.ts` — fake `AuthRuntime` whose `login()` drives
  the passed interaction through scripted prompt/notify sequences (api_key, oauth-with-manual-code,
  abort, error). Assert selection logic, exit codes, output content, and handler/readline cleanup.
  Run `npx vitest run packages/cli/src/auth-commands.test.ts`.
- Manual (real Pi, no fakes): `node packages/cli/dist/cli.js --pi-home /tmp/pi-auth-test auth login`
  → pick a provider → complete an api-key login → `auth status` shows it configured → the file
  `/tmp/pi-auth-test/agent/auth.json` exists with mode 0600. Then Ctrl+C a fresh `auth login` at the
  prompt and confirm the process exits cleanly with code 1.

## Notes

- Keep orchestration in `auth-commands.ts` and rendering in `auth-interaction.ts`; the command layer
  must not write prompts directly.
- OAuth flows may open a localhost callback server (Pi's code, not ours) — the manual-code prompt is
  designed to race it. Task-002's per-prompt abort handling is what makes that race terminate
  cleanly; exercise it in the oauth test.
- TODO(verify) inherited: whether any bundled OAuth flow binds a fixed localhost port that could
  collide with a running daemon. Check during the manual run and record the finding in the summary.
