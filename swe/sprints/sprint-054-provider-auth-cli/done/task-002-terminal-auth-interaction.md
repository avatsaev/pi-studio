# Task 002 — Terminal `AuthInteraction` (prompts, notifications, QR)

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done
- **Type:** feature
- **Area:** packages/cli — provider auth
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Implement the terminal side of Pi's login contract: a testable `AuthInteraction` that renders every
`AuthEvent` kind and answers every `AuthPrompt` kind from a TTY, including QR rendering for OAuth
URLs and device codes.

## Context / why

This is the *entire* UI adaptation layer — Pi owns all provider flow logic (API-key entry,
Anthropic/Codex OAuth, device codes, token exchange); Pi-Studio only supplies `prompt`/`notify`.
Getting the four prompt kinds and four event kinds right here makes every provider work, including
ones added to Pi later.

Verified contract (`pi-ai` auth types, shipped inside `pi-coding-agent@0.84.1`):

- `AuthPrompt`: `{type:"text"|"secret", message, placeholder?}` | `{type:"select", message, options:[{id,label,description?}]}` | `{type:"manual_code", message, placeholder?}`, plus an optional
  **per-prompt `signal`** that aborts just that prompt (used when a localhost OAuth callback wins the
  race against manual code entry).
- `AuthEvent`: `{type:"info", message, links?}` | `{type:"auth_url", url, instructions?}` |
  `{type:"device_code", userCode, verificationUri, intervalSeconds?, expiresInSeconds?}` |
  `{type:"progress", message}`.
- `prompt()` returns the entered text, or the **option id** for `select`. Rejects on cancel/abort.

## Scope references

- `swe/features/provider-auth-cli.md` § Behavior & Algorithms (readline interaction mapping table),
  § Error Handling (non-TTY, SIGINT)
- `packages/cli/src/qr.ts` — `renderQrToTerminal()`, already used for daemon pairing
- `packages/cli/src/output.ts` — `OutputSink` (`write`/`error`), the existing stdout/stderr seam
- `packages/cli/src/auth-runtime.ts` — `AuthInteractionLike` (task-001)
- Create: `packages/cli/src/auth-interaction.ts`, `packages/cli/src/auth-interaction.test.ts`

## What to build

- **`packages/cli/src/auth-interaction.ts`:**

  ```ts
  export interface TerminalIo {
    question(query: string): Promise<string>;        // echoed line input
    secret(query: string): Promise<string>;          // masked, no echo
    isTty: boolean;
    close(): void;
  }
  export function createReadlineIo(): TerminalIo;                       // node:readline/promises
  export function createTerminalInteraction(opts: {
    io: TerminalIo;
    sink: OutputSink;
    signal: AbortSignal;                             // flow-wide abort (SIGINT)
    qr?: (text: string) => Promise<string>;          // defaults to renderQrToTerminal
  }): AuthInteractionLike;
  ```

- **Prompt rendering** (all prompt/notify output goes to `sink.error`, i.e. **stderr**, so
  `--json`-style stdout stays clean for later scripting):
  - `secret` → `io.secret()`, masked, no echo of typed characters.
  - `text` / `manual_code` → `io.question()`, placeholder rendered as a hint suffix.
  - `select` → numbered list (`1) label — description`), accepts a 1-based index **or** an exact
    option id; re-asks once on invalid input, then rejects.
  - Honor **both** signals: the flow-wide `signal` and `prompt.signal`. Abort while a prompt is
    pending → reject with a distinguishable error (`AuthPromptAbortedError`) and print a short note
    for the `prompt.signal` case ("resolved in the browser — continuing").
- **Notify rendering:**
  - `auth_url` → instructions + URL, then the QR block. This is the headless/SSH case the scope
    calls out: a phone camera beats copy-paste out of a remote shell.
  - `device_code` → the `userCode` on its own prominent line, the verification URI, QR of that URI,
    and expiry when provided.
  - `info` → message plus any `links` (url + optional label), one per line.
  - `progress` → single status line.
  - QR rendering must never break a flow: on failure, fall back to URL-only output.
- **Non-TTY:** `createTerminalInteraction` does not decide policy; it exposes `io.isTty` so the
  command layer (task 005) can fail fast. A prompt attempted on a non-TTY io rejects immediately
  rather than hanging.

## Out of scope

- Command registration and flow orchestration (tasks 003–005).
- The `--api-key` prefilled interaction (task 005).

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

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Tests: add `packages/cli/src/auth-interaction.test.ts` driving `createTerminalInteraction` with a
  fake `TerminalIo` + recording `OutputSink` + a fake `qr`. Cover the full prompt/event matrix, both
  abort paths, and the stderr-only assertion. Run
  `npx vitest run packages/cli/src/auth-interaction.test.ts`.
- Manual: none required here — task 006 exercises the real TTY path end to end.

## Notes

- Use `node:readline/promises`. **The readline interface must be constructed with
  `output: process.stderr`** — readline writes the query text and echoes typed input to its output
  stream, so an interface on the default stdout would violate the stderr-only acceptance criterion.
  (Input stays `process.stdin`.) Masked input: `terminal: true` and suppress echo for the secret
  question (mute the output stream during the question, restore after); keep that mechanism inside
  `createReadlineIo` so tests never touch it.
- Do not buffer or log prompt values anywhere, not even at debug level.
