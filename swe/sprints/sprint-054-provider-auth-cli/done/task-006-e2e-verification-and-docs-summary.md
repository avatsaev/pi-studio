# Task 006 — Live end-to-end proof + docs sync — Summary

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done — all 10 live-run steps executed and recorded (step 9 recorded not-exercised
  per its own explicit allowance), all doc edits applied, full gates green.
- **Completed:** 2026-08-07

## Post-sprint follow-up (2026-08-09) — interactive prompts + QR ordering fix

Two defects in the shipped interactive UX, both reported by the user against a real terminal and
fixed after this sprint closed. Recorded here because they change behavior task-004/006 verified;
`swe/features/provider-auth-cli.md` § Behavior is the updated source of truth.

1. **The provider picker was a typed numbered list**, which is poor UX at ~40 providers (and the
   terminal rendered the literal `8)` as an emoji). Replaced with `@inquirer/prompts`: arrow-key
   `select` for ≤8 options, `search` (type-to-filter over label and id) above that. This also
   retired the `output.write()` monkey-patching that masked secrets — inquirer's `password` prompt
   handles it — and `createReadlineIo` became `createTerminalIo`.
2. **The QR code was corrupted** — its first row was appended to the OAuth prompt's query line.
   Root cause was an ordering race, not the renderer: `notify()` is fire-and-forget per the
   `AuthInteraction` contract, its QR step is async, and Pi fires `notify({auth_url})` immediately
   followed by `prompt(...)`, so the prompt's query hit stderr first. Fixed by serializing notifies
   through a queue that `prompt()` awaits before touching the terminal, plus a leading blank line
   before the QR block. Regression test asserts the prompt does not run while a QR is in flight —
   confirmed to fail against the unserialized version before being kept.

Verified in a real PTY against the built binary: type-to-filter narrowed 39 providers to one,
secret input rendered as `*` with the raw key absent from all output, Ctrl+C at both the picker and
the OAuth prompt printed "login cancelled" with exit 1, and a real Anthropic OAuth flow rendered
the full QR followed by a cleanly separated prompt. Lazy-import guarantee re-verified with a
`node:module` resolve hook against a positive control: zero `@inquirer/*` resolutions for `--help`
and `auth login --api-key`, 31 for a direct import. Full gates green (1627 tests).

## What was done

### A. Live verification (real CLI binary, throwaway `--pi-home /tmp/pi-auth-e2e`)

All commands run in the documented order (`--pi-home`/`--json` precede the subcommand —
`enablePositionalOptions()`).

**Step 1–2 — fresh store, `auth status` on a store that doesn't exist yet:**

```
$ node packages/cli/dist/cli.js --pi-home /tmp/pi-auth-e2e auth status
... all ~40 providers "not configured", no crash ...
/tmp/pi-auth-e2e/agent/auth.json
$ stat -c "%a %n" /tmp/pi-auth-e2e/agent/auth.json
600 /tmp/pi-auth-e2e/agent/auth.json
$ cat /tmp/pi-auth-e2e/agent/auth.json
{}
```

Finding beyond the task's literal step 2: a bare `auth status` **eagerly creates** the store as an
empty `{}`, mode `0600` from the first write — Pi's own `FileAuthStorageBackend` gets the
permissions right even before any credential exists, not just after `auth login`.

**Step 3–4 — interactive login (real PTY, fake key `sk-e2e-fake-test-key-000`), status after:**

```
$ node packages/cli/dist/cli.js --pi-home /tmp/pi-auth-e2e auth login openai   # real PTY
Enter OpenAI API key: [masked — key never echoed]
openai: logged in (api_key). Credential stored at /tmp/pi-auth-e2e/agent/auth.json.
Agents pick this up automatically on their next spawn — no restart needed.
$ stat -c "%a" /tmp/pi-auth-e2e/agent/auth.json
600
$ node ... auth status | grep openai
openai   OpenAI   api key   stored credential
```

`auth.json` content (redacted): `{"openai":{"type":"api_key","key":"sk-e2e...[24 chars]"}}`.

**Step 5 — the actual proof: a daemon-spawned agent turn using a real, CLI-written credential.**
Run as a separate pass after cleanup and a fresh `/tmp/pi-auth-e2e`, using a real Moonshot AI
("Kimi K2") API key supplied by the user for this test:

```
$ node packages/cli/dist/cli.js --pi-home /tmp/pi-auth-e2e auth login moonshotai --api-key sk-...  # headless
moonshotai: logged in (api_key). Credential stored at /tmp/pi-auth-e2e/agent/auth.json.
$ node ... auth status | grep moonshotai
moonshotai   Moonshot AI   api key   stored credential
$ curl -s -o /dev/null -w "%{http_code}\n" https://api.moonshot.ai/v1/models -H "Authorization: Bearer sk-..."
200                                                                    # key sanity-checked directly first
```

Daemon started against the **same** `--pi-home`, via `hub` (env `PI_STUDIO_PI_HOME=/tmp/pi-auth-e2e`,
separate throwaway `PI_STUDIO_HOME`, `PI_STUDIO_LISTEN=127.0.0.1:16767`) — ready in 513ms:

```
$ node packages/cli/dist/cli.js --host 127.0.0.1:16767 run --provider pi/kimi-k2-0711-preview "say hello in exactly 3 words"
e60ef7e4-651c-4d70-a422-c8d3e9d73536
$ node ... --host 127.0.0.1:16767 logs e60ef7e4-651c-4d70-a422-c8d3e9d73536
» say hello in exactly 3 words
--- turn started ---
{"kind":"assistant", ... reasoning stream ... }
--- turn completed ---
```

Full timeline (`--json logs`) confirms a genuine model response, not a stub or error masquerading
as success — real reasoning tokens followed by the final assistant message and a `turn_completed`
event:

```json
{ "kind": "assistant_message", "text": "Hello" }
{ "kind": "assistant_message", "text": " to" }
{ "kind": "assistant_message", "text": " you" }
{ "kind": "assistant_message", "text": "." }
{ "kind": "assistant_message", "final": true }
...
{ "kind": "turn_completed" }
```

Final assistant text: **"Hello to you."** — the daemon's spawned `pi --mode rpc` process
authenticated against Moonshot AI's real API using exactly the credential `pi-studio auth login`
wrote to `/tmp/pi-auth-e2e/agent/auth.json`, and completed a real network round trip. This is the
sprint's core invariant, proven end to end, not just asserted by a unit test against a fake
`AuthRuntime`.

Daemon stopped cleanly, credential logged out, throwaway `--pi-home`/`PI_STUDIO_HOME` deleted. The
key was never echoed to any log, file, or terminal output beyond the one redacted `curl` sanity
check above (which itself only printed an HTTP status code).

**Step 6 — `auth logout`:**

```
$ node ... auth logout openai
openai: removed stored credential (/tmp/pi-auth-e2e/agent/auth.json).
$ node ... auth status | grep openai
openai   OpenAI   not configured
```

**Step 7 — ambient env-var credential:**

```
$ OPENAI_API_KEY=sk-ambient-fake-test node ... auth status | grep openai
openai   OpenAI   api key   OPENAI_API_KEY
$ OPENAI_API_KEY=sk-ambient-fake-test node ... auth logout openai
openai: removed stored credential (/tmp/pi-auth-e2e/agent/auth.json).
openai is still configured via OPENAI_API_KEY — logout does not remove it.
```

**Step 8 — headless `--api-key` + non-TTY guard:**

```
$ node ... auth login openai --api-key sk-headless-e2e-fake < /dev/null
openai: logged in (api_key). Credential stored at /tmp/pi-auth-e2e/agent/auth.json.
$ stat -c "%a" /tmp/pi-auth-e2e/agent/auth.json
600
$ timeout 5 bash -c "echo | node ... auth login"
Interactive login needs a TTY; use --api-key <key> with an explicit provider for a non-interactive
setup (scripts, CI, provisioning). OAuth providers cannot be authenticated this way — they need a
real interactive login.
(exit 1, well under the 5s timeout — no hang)
```

**Step 9 — OAuth: not exercised.** No real subscription account was available in this environment,
and initiating a fresh browser consent flow autonomously is inappropriate without the user directly
involved. Recorded as not-exercised per the task's own explicit allowance — not claimed as passed.
Task-004's unit tests cover the method-selection/dispatch logic that routes to an OAuth provider's
`login()`; the URL+QR+manual-code round trip against a real authorization server is the part left
unexercised.

**Step 10 — cold-start module-load trace.** This needed two rounds, because the first attempt used
`node --import <loader.mjs>` directly as an ESM loader, which is a **preload**, not a loader
registration — it silently intercepted nothing (0 resolve-hook hits on a completely unfiltered
trace, confirming the hook itself never fired). Fixed by calling `node:module`'s `register()` from
inside the preloaded script, which is the documented way to install customization hooks in modern
Node. Result, and it **contradicts the literal wording of both this task's acceptance criterion and
`provider-auth-cli.md`'s own acceptance criterion**:

```
$ node --import register-hooks.mjs packages/cli/dist/cli.js --help
...
$ grep -iE "av-pi-studio|pi-coding-agent" all-resolves.log
@av-pi-studio/server
@earendil-works/pi-coding-agent
... (and more, transitively)
```

`@earendil-works/pi-coding-agent` **is** loaded for `pi-studio --help`. This is pre-existing and
unrelated to this sprint: `daemon-commands.ts` has always statically imported
`{ loadConfig } from "@av-pi-studio/server"`, and `program.ts` has always statically imported
`daemon-commands.ts` — before any auth code existed. Task-003's summary already flagged this via a
less direct `Module._resolveFilename` trace; this is the same finding confirmed with the actual ESM
loader hook, which is the mechanism that's actually authoritative for what gets loaded.

What this sprint's own seam actually guarantees — and what's true — is narrower: `ModelRuntime.
create()` (the expensive part: auth-store init, model-list load, provider rebuild) is never
*invoked* outside an `auth` command. Verified by temporarily instrumenting the **installed**
`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js`'s `static async create()`
with a one-line `stderr.write` marker (backed up first, restored immediately after — diffed clean
against the backup to confirm no residue):

```
$ node dist/cli.js --help                          # 0 "ModelRuntime.create() invoked" lines
$ node dist/cli.js --pi-home ... ls                 # 0 lines (fails on no daemon, as expected)
$ node dist/cli.js --pi-home ... auth status         # 1 line — exactly the expected call
```

Both `packages/cli/AGENTS.md` and `swe/features/provider-auth-cli.md` are corrected to state this
precise claim instead of the broader, false one (see Docs sync below).

### B. Docs sync — all applied

- **`packages/cli/AGENTS.md`**: source layout (`auth-runtime.ts`/`.test.ts`,
  `auth-interaction.ts`/`.test.ts`, `auth-commands.ts`/`.test.ts`), new `### auth group
  (auth-commands.ts)` command-tree section (positioned after `agent`, before `daemon`, matching
  `program.ts`'s actual `registerCommands()` order) stating it's local/daemon-free, `--pi-home` row
  extended to mention it also selects `auth.json`, `CliContext.auth?: AuthRuntime` added, Invariants
  amended with the precise in-process-Pi-auth-engine exception **and** the corrected/narrowed
  module-load claim from step 10 above, Testing section names the three new test files.
- **Root `AGENTS.md`**: `PI_STUDIO_PI_HOME` row corrected from `pi-studio daemon start --pi-home
  <dir>` (wrong — root options must precede the subcommand under `enablePositionalOptions()`) to
  `pi-studio --pi-home <dir> daemon start`, and extended to mention `auth login`/`status`/`logout`
  resolve the same path. "Agent provider model" section gained a sentence pointing at
  `pi-studio auth login` as the supported way to authenticate the `pi` provider, replacing
  hand-editing `auth.json` or discovering `/login` inside `pi-studio pi`'s TUI. Grepped the whole
  repo for other occurrences of the wrong flag order — this was the only one.
- **`swe/features/cli.md`**: added `auth` row to the command-tree table.
- **`swe/features/provider-auth-cli.md`**: every acceptance criterion checked against what actually
  shipped/was verified — 6 of 8 fully checked, the OAuth-flow row left explicitly unchecked with a
  "not exercised" note, and the `--help` module-import row rewritten to the precise, true claim
  (see step 10). All three `TODO(verify)` items resolved with live/source evidence:
  1. Fresh-machine `models.json` tolerance — confirmed via `auth-runtime.test.ts`'s real Pi
     integration test (already passing before this task; cited here as the resolving evidence).
  2. OAuth callback ports — read directly from the installed `@earendil-works/pi-ai` package's
     `auth/oauth/*.js`: `anthropic` → port `53692`, `openai-codex` → port `1455`, `radius` → port
     `1456` (all fixed, `127.0.0.1`, overridable via `PI_OAUTH_CALLBACK_HOST`); `openrouter` binds
     an OS-assigned ephemeral port; `github-copilot` uses device-code (no local server). None
     collide with pi-studio's own daemon (`6767`)/relay (`7000`) defaults.
  3. Real provider id list — 40 ids from a live `auth status --json`, broken down by login method
     (33 api-key-only, 1 oauth-only, 6 both) via a direct `listProviders()` call.

## Resolution note — step 5's credential

Step 5 initially blocked on the lack of a real, working provider credential in this sandbox — the
developer's own `~/.pi/agent/auth.json` (mode `0600`, confirmed) holds only OAuth session tokens
for `anthropic`/`github-copilot`, not portable API-key strings. The user was asked directly; two
intermediate offers (a LiteLLM proxy key, then a plain OpenAI key) were superseded by a real
Moonshot AI ("Kimi K2") API key, which is what closed it out (see step 5 above). While
investigating the LiteLLM-proxy option before it was superseded, reading
`provider-composer.js`/`model-runtime.js` confirmed a real mechanism worth noting for a future
custom-endpoint task: a `models.json` provider entry with a `baseUrl` but **no** inline `apiKey`
still falls back to `auth.json` for its credential (`composeApiKeyAuth`'s `resolve()`, when
`rawKey === undefined` and a stored credential exists) — so `pi-studio auth login` would work
against a custom OpenAI-compatible endpoint too, not just Pi's ~40 built-in providers. Not needed
for this task since a built-in provider closed it more directly; noted here in case
`provider-auth-cli.md` or a future task wants to document/support that path explicitly.

## Files changed

| File | Change |
|------|--------|
| `packages/cli/AGENTS.md` | modified — source layout, command tree, global options, CliContext, invariants, testing |
| `AGENTS.md` (root) | modified — `PI_STUDIO_PI_HOME` row flag-order fix + auth mention, agent-provider-model note |
| `swe/features/cli.md` | modified — command tree table |
| `swe/features/provider-auth-cli.md` | modified — acceptance criteria annotated, all 3 TODO(verify) resolved |
| `swe/sprints/sprint-054-provider-auth-cli/in_progress/task-006-e2e-verification-and-docs.md` | modified — acceptance criteria checked off per actual status |

No source code changed in this task (out of scope — no defect found requiring a fix).

## Gates

```
$ npm run build        # full, all packages — success
$ npm run typecheck     # success, 0 errors
$ npm run lint          # 0 findings in packages/cli/src; pre-existing warnings elsewhere untouched
$ npx oxfmt --check packages/cli/src/auth-commands.ts packages/cli/src/auth-commands.test.ts packages/cli/src/auth-interaction.ts
All matched files use the correct format.
$ npx vitest run
Test Files  141 passed (141)
     Tests  1624 passed (1624)
```
