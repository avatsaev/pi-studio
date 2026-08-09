# Provider Auth — CLI-Local Login (`pi-studio auth`)

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [cli.md](cli.md), [agent-providers.md](agent-providers.md),
> [provider-auth-rpc.md](provider-auth-rpc.md) (independent sibling — no dependency either way),
> [../architecture/config.md](../architecture/config.md)

## Purpose

Close the largest onboarding gap in Pi-Studio: after `npm i -g @av-pi-studio/cli`, a user has no
first-class way to authenticate model providers (API key or subscription OAuth for Claude/Codex/…).
Today they must hand-edit Pi's `auth.json` or discover `pi-studio pi` → `/login` inside a foreign
TUI. Pi's own CLI has **no headless login** (`pi auth` supports only `check|api_key|bearer_token`,
all read-side), so this is a genuine gap, not duplication.

This scope adds a native `pi-studio auth` command group that **reuses Pi's own auth engine
programmatically** — `ModelRuntime.login()/logout()/checkAuth()` from
`@earendil-works/pi-coding-agent` — so credentials land in the exact `auth.json` that
daemon-spawned `pi --mode rpc` processes already read.

**Design tenets (shared with the sibling scopes):**

1. **Single credential store = Pi's `auth.json`.** Pi-Studio never invents its own store, never
   copies credentials, never renders secrets back.
2. **Reuse, don't reimplement.** All provider flows (API-key entry, Anthropic/Codex OAuth, device
   codes, token refresh) are Pi's code; Pi-Studio only implements the `AuthInteraction` callback
   surface (`prompt`/`notify`).
3. **Loose coupling.** This scope is entirely local (CLI process ↔ filesystem). Zero protocol,
   daemon, or web-client involvement. Remote/browser auth is the sibling scopes' job.

## Public Contract

### Commands (registered on the existing commander `program`)

| Command | Inputs | Behavior | Exit |
|---------|--------|----------|------|
| `pi-studio auth login [provider]` | optional provider id; `--type <api_key\|oauth>`; `--api-key <key>` (headless api_key path); global `--pi-home` | Runs Pi's login flow interactively; persists credential to `auth.json` | 0 on stored credential, `EXIT_ERROR` otherwise |
| `pi-studio auth status` | `--json` | Per-provider configured/unconfigured, auth type, and source (stored key, stored oauth, env var name) | 0 always (status is informational) |
| `pi-studio auth logout <provider>` | provider id | Removes the stored credential for the provider | 0 on success |

- `login` with **no provider argument** renders a picker of login-capable providers
  (name, OAuth `loginLabel` such as "Sign in with …", subscription badge from `isSubscription`,
  current configured state).
- `login <provider>` with **both** api_key and oauth available and no `--type` → one `select`
  prompt for the method.
- `--api-key <key>` short-circuits interaction for scripting/CI: requires an explicit provider,
  implies `--type api_key`, stores the key without prompting.
- All commands honor the existing global `--pi-home` flag and `PI_STUDIO_PI_HOME` env var
  (same precedence as the `pi-studio pi` proxy).

### Pi API surface consumed (facts, verified against `pi-coding-agent@0.84.1`)

| API | Used for |
|-----|----------|
| `ModelRuntime.create({ authPath, modelsPath, refreshOnCreate })` | Runtime construction; `refreshOnCreate: false` — no network on CLI startup |
| `runtime.getProviders(): Provider[]` | Picker: `id`, `name`, `auth.apiKey?/auth.oauth?` (+ `loginLabel`, `isSubscription`) |
| `runtime.checkAuth(providerId): Promise<AuthCheck \| undefined>` | Status: `{ type: "api_key"\|"oauth", source? }`, `undefined` = unconfigured |
| `runtime.login(providerId, type, interaction)` | The login flow itself |
| `runtime.logout(providerId)` | Credential removal |
| `AuthInteraction` | `{ prompt(AuthPrompt): Promise<string>; notify(AuthEvent): void; signal? }` |

`AuthPrompt` kinds: `text`, `secret`, `select`, `manual_code`. `AuthEvent` kinds: `info`,
`auth_url`, `device_code`, `progress`. These enums are the whole interaction contract.

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/cli/src/auth-runtime.ts` | `AuthRuntime` seam over Pi's `ModelRuntime` (lazy dynamic import) + `resolvePiAuthPaths` (daemon-parity `<piHome>/agent/auth.json` derivation) + `AuthInteractionLike` local type |
| `packages/cli/src/auth-commands.ts` | Command registration + orchestration (`login`/`status`/`logout`); consumes `CliContext.auth ?? defaultAuthRuntime(...)` |
| `packages/cli/src/auth-interaction.ts` | Terminal `AuthInteraction` implementation (`@inquirer/prompts` on stderr, masked secrets, QR, serialized notify queue) |
| `packages/cli/src/cli-core.ts` | Add optional `auth?: AuthRuntime` slot on `CliContext` (mirrors the `pi`/`daemon`/`relay`/`update` injectable-runtime pattern) |
| `packages/cli/package.json` | Add **direct** dependencies `@earendil-works/pi-coding-agent` (version identical to `packages/server`'s) and `@inquirer/prompts` |

## Behavior & Algorithms

```
function authLogin(providerArg?, opts):
    authPath, modelsPath = resolvePiPaths(opts.piHome ?? env.PI_STUDIO_PI_HOME)
        # piHome set   -> <piHome>/agent/auth.json, <piHome>/agent/models.json
        # piHome unset -> omit -> Pi defaults (getAuthPath(), respects PI_CODING_AGENT_DIR)
    runtime = await (lazy import pi-coding-agent).ModelRuntime.create({authPath, modelsPath, refreshOnCreate: false})

    provider = providerArg ?? select(from runtime.getProviders() where auth.oauth or auth.apiKey.login)
    type = opts.type ?? opts.apiKey ? "api_key"
         ?? only-one-available ? that-one
         ?? select(["api_key", oauth.loginLabel ?? "oauth"])

    if opts.apiKey:                # headless path
        interaction = prefilled(secret -> opts.apiKey)   # any other prompt kind -> error
    else:
        interaction = terminalInteraction(abortController.signal)

    credential = await runtime.login(provider, type, interaction)
    print success (provider, credential.type, auth.json path)
```

Terminal interaction mapping (all writes to stderr except final results). Rendering is
`@inquirer/prompts`, lazy-imported at first prompt so no non-interactive path loads it:

| Contract element | Terminal rendering |
|------------------|--------------------|
| `prompt {secret}` | Masked input (`password`, `*` mask — the typed value is never echoed) |
| `prompt {text, manual_code}` | Single-line `input` with the placeholder appended as a hint |
| `prompt {select}` | Arrow-key picker. ≤8 options → `select`; more → `search` (type-to-filter over label and id), so the ~40-provider list is filtered by typing rather than scrolled. Never a numbered list — the option `id` is returned, and the interaction layer prints no list of its own |
| `notify {auth_url}` | Print URL + instructions; **also render terminal QR** (reuse the existing `qr.ts` helper) — the SSH/headless-box case is exactly where a phone camera beats copy-paste |
| `notify {device_code}` | Print `userCode` prominently + verification URL (+ QR) |
| `notify {info, progress}` | Single status lines |

- **Notify/prompt ordering:** `notify()` is fire-and-forget per the `AuthInteraction` contract but
  its QR step is async, and Pi fires `notify({auth_url})` immediately followed by `prompt(...)`.
  Notifies therefore run through a serial queue that `prompt()` awaits before touching the
  terminal; otherwise the prompt's query is written first and the QR's first row is appended to
  that same line, wrecking the code. This makes `info`/`progress` render one microtask later than
  a direct write would — deliberate, since a synchronous line would jump ahead of a queued QR.
- **Cancellation:** inquirer traps Ctrl+C itself while a prompt is live (raw mode), so a
  process-level `SIGINT` listener never fires there; it surfaces as an `ExitPromptError` rejection,
  which `createTerminalIo` maps to `controller.abort()` + `AuthPromptAbortedError("flow")`. Between
  prompts, the command's own `process.once("SIGINT", ...)` covers the gap. Either way the pending
  prompt rejects and the command exits `EXIT_ERROR` with "login cancelled"; handler removed on
  completion.
- **Lazy import:** `@earendil-works/pi-coding-agent` is imported dynamically **inside** the command
  handlers only. `pi-studio --help` and all unrelated commands must not load it (its main entry
  drags the Pi TUI module graph).
- **`status`:** iterate `getProviders()`; for each, `checkAuth()` → configured + type + source.
  Table by default, stable JSON array with `--json`.

## Data & Persistence

- **Reads/writes only Pi's `auth.json`** (0600, written by Pi's `AuthStorage` under file locking).
  No new Pi-Studio state files. Concurrency with a running daemon is safe by construction: Pi's
  `FileAuthStorageBackend` lock is the same one daemon-spawned `pi` processes use for token refresh.
- Path resolution must mirror the daemon's `piHomeEnv()` (`packages/server/src/agent/provider-registry.ts`)
  so CLI-written credentials are found by daemon-spawned agents given the same `piHome` setting.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| `@earendil-works/pi-coding-agent` unresolvable | Error message with install guidance; `EXIT_ERROR` (mirror `pi-commands.ts` fallback wording) |
| Unknown provider id | Error listing valid login-capable provider ids; `EXIT_ERROR` |
| Provider has no login for requested `--type` | Error naming the types the provider supports |
| Non-TTY stdin without `--api-key` | Fail fast with guidance ("interactive login needs a TTY; use --api-key for api_key providers") — never hang |
| `--api-key` with an OAuth-only provider | Error; no partial writes |
| Login flow throws (network, denied consent) | Print provider error message; no credential written; `EXIT_ERROR` |
| SIGINT mid-flow | Abort via signal (inquirer's `ExitPromptError` during a live prompt, the process handler between prompts); pending prompt rejects; `EXIT_ERROR` |
| `logout` for provider without stored credential | Succeeds idempotently, notes nothing was stored |
| Version skew CLI↔server on pi-coding-agent | Prevented structurally: direct dep pinned to the same range as server; the publish script already aligns workspace versions |

## Dependencies

- Internal: `cli-core.ts` (`CliContext`, `GlobalOptions`, `EXIT_ERROR`), `qr.ts`, commander
  `program.ts` registration.
- External: `@earendil-works/pi-coding-agent` (new direct dep of `packages/cli`).
- **Not** dependencies: `@av-pi-studio/client`, the daemon, the protocol package.

## Acceptance Criteria

- [x] `pi-studio auth login` with no args lists login-capable providers and completes an api_key
      login end-to-end, writing the credential to the resolved `auth.json`. Verified live (real PTY,
      fake key — task-004/006): picker renders, secret prompt masks input, `auth.json` written at
      mode `0600`.
- [ ] `pi-studio auth login anthropic` (or any OAuth provider) drives the OAuth flow: URL + QR
      printed, `manual_code` prompt honored, credential persisted on success. **Not exercised
      live** — no real subscription account available in the sprint's verification environment
      (task-006); covered by task-004's unit tests at the method-selection/dispatch level only, not
      as a full round-trip against a real provider. Record as not-exercised per task-006's own
      allowance, not a false pass.
- [x] `pi-studio auth login <p> --api-key K` stores the key with zero interactive prompts (works
      piped/non-TTY). Verified live (task-005/006): headless `--api-key`, `echo | auth login`
      fail-fast non-TTY guard.
- [x] `pi-studio auth status` reflects: stored key, stored oauth, env-var-sourced key
      (`AuthCheck.source`), and unconfigured — and `--json` output is machine-stable. Verified live
      against all four states (task-003/006), including the ambient `OPENAI_API_KEY` case.
- [x] `pi-studio auth logout <p>` removes the credential; subsequent `status` shows unconfigured.
      Verified live (task-006), including the post-logout ambient-credential note.
- [x] With `--pi-home <dir>`, all commands operate on `<dir>/agent/auth.json`, and a daemon started
      with the same `piHome` picks the credential up (agent run succeeds) — **fully verified live**
      (task-006): fresh store, login, status, logout all resolved the same throwaway path; a daemon
      started against that path spawned `pi --mode rpc`, authenticated with a real Moonshot AI
      ("Kimi K2") credential written by `pi-studio auth login moonshotai --api-key`, and completed a
      real turn ("Hello to you."). Path-parity is also asserted by test
      (`auth-runtime.test.ts` vs. `provider-registry.ts`'s `piHomeEnv()`).
- [x] `pi-studio --help` does not construct Pi's `ModelRuntime` (corrected from an earlier, broader,
      and false claim that it does not *import* `pi-coding-agent` at all — it does, transitively,
      via `daemon-commands.ts`'s pre-existing static `@av-pi-studio/server` import, unrelated to
      this feature and present before it; confirmed live with a `node:module` resolve/load hook
      trace, task-006). The claim this feature actually owns and keeps true: `ModelRuntime.create()`
      — the expensive part (auth-store init, model list load, provider rebuild) — is never invoked
      for `--help`/`ls`/any non-`auth` command, confirmed by directly instrumenting the installed
      `ModelRuntime.create` and observing zero calls for `--help`/`ls`, exactly one for
      `auth status` (task-006).
- [x] Unit tests cover command orchestration with an injected fake `AuthRuntime` (no real Pi import,
      no network), matching the `pi-commands.test.ts` pattern. `auth-runtime.test.ts` (13),
      `auth-interaction.test.ts` (15), `auth-commands.test.ts` (31) — 59 tests total.

## TODO(verify) — resolved (task-006)

- [x] Whether `ModelRuntime.create` without `modelsPath` tolerates a missing models.json on a fresh
      machine (expected yes — first-run must work before any Pi state exists). **Confirmed yes** —
      `auth-runtime.test.ts`'s real (unmocked) Pi integration test asserts this directly:
      `ModelRuntime.create` with `authPath` set and no `models.json` present on disk succeeds.
- [x] Whether any bundled OAuth flow spawns a localhost callback server on a fixed port (collision
      with a running daemon is unlikely but worth confirming during implementation). **Confirmed —
      most do, on fixed ports, bound to `127.0.0.1`** (read directly from the installed
      `@earendil-works/pi-ai` package's OAuth implementations, `auth/oauth/*.js`): `anthropic` uses
      port `53692`, `openai-codex` uses port `1455`, `radius` uses port `1456`; `openrouter` binds
      an OS-assigned ephemeral port (`listen(0, …)`) instead of a fixed one. All are overridable via
      `PI_OAUTH_CALLBACK_HOST` where fixed. None of the three fixed ports collide with Pi-Studio's
      own defaults (daemon `6767`, relay `7000`). `github-copilot` uses a device-code flow (no local
      server at all) — consistent with its `auth.json` entry shape (`refresh`/`access` tokens, no
      redirect-based exchange).
- [x] Exact provider ids exposed by `getProviders()` for the picker copy (e.g. subscription vs
      api-key variants of the same vendor). **Confirmed — 40 providers** (live `auth status`
      against the real registry, task-006): `amazon-bedrock`, `ant-ling`, `anthropic`,
      `azure-openai-responses`, `baseten`, `cerebras`, `cloudflare-ai-gateway`,
      `cloudflare-workers-ai`, `deepseek`, `fireworks`, `github-copilot`, `google`, `google-vertex`,
      `groq`, `huggingface`, `kimi-coding`, `minimax`, `minimax-cn`, `mistral`, `moonshotai`,
      `moonshotai-cn`, `nvidia`, `openai`, `openai-codex`, `opencode`, `opencode-go`, `openrouter`,
      `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, `radius`, `together`,
      `vercel-ai-gateway`, `xai`, `xiaomi`, `xiaomi-token-plan-ams`, `xiaomi-token-plan-cn`,
      `xiaomi-token-plan-sgp`, `zai`, `zai-coding-cn`. Split by login method: 33 api-key-only, 1
      oauth-only (`openai-codex`), 6 support both (`anthropic`, `github-copilot`, `kimi-coding`,
      `openrouter`, `radius`, `xai`) — confirming the picker's "single method → no prompt, both →
      select" branch (task-004) exercises real, not just hypothetical, provider shapes.
