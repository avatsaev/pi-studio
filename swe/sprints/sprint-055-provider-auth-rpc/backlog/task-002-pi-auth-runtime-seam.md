# Task 002 — Daemon Pi auth runtime seam + `resolvePiAgentDir` path parity

- **Sprint:** sprint-055-provider-auth-rpc
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent/provider-auth, agent/provider-registry)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal

Give the daemon a lazily-constructed, injectable seam onto Pi's auth engine
(`ModelRuntime`), writing to **exactly** the `auth.json` that daemon-spawned `pi --mode rpc`
children read.

## Context / why

Credentials the daemon writes are worthless unless spawned agents read the same file. That path is
currently derived by a **module-private** `piHomeEnv()` in
`packages/server/src/agent/provider-registry.ts:57-64`, composed in `buildPiClient` (line 75) as:

```
env: { ...piHomeEnv(config.daemon.piHome), ...override?.env }
```

so the real precedence is **`agents.providers.pi.env.PI_CODING_AGENT_DIR` > `daemon.piHome` > Pi's
own default**. The new service must reuse that rule, not re-derive it — this is the one intentional
coupling point between the auth family and the spawn path.

Sprint-054 built the CLI-side equivalent (`packages/cli/src/auth-runtime.ts`) and its verification
produced facts this task must honour:

- `checkAuth()` **can hang**; sprint-054 shipped a 3 s bound degrading to `"unknown"`.
- `ModelRuntime.create` tolerates a missing `models.json` (proven against the real package).
- Login capability = `provider.auth?.apiKey?.login !== undefined` or `provider.auth?.oauth !== undefined`.
- A single malformed provider entry must be skipped, never fail the whole listing.

**Lazy `import()` here is not a startup optimization.** The daemon already statically imports
`@earendil-works/pi-coding-agent` (`agent/providers/pi/session-hydration.ts` imports
`SessionManager`), so the module graph is already paid for. It is lazy so a daemon whose Pi runtime
cannot be constructed still boots and serves every other RPC — and so construction failure is
**retried** on the next call rather than poisoning the service for the daemon's lifetime.

## Scope references

- `swe/features/provider-auth-rpc.md` § Behavior & Algorithms (runtime bullet, `list` bullet),
  § Error Handling (runtime-unavailable row)
- `swe/architecture/config.md` — `daemon.piHome`, provider overrides
- `packages/server/src/agent/provider-registry.ts` — `piHomeEnv` (57), `buildPiClient` (66-85)
- `packages/server/src/config/daemon-config.ts` — `PersistedConfig`
- `packages/cli/src/auth-runtime.ts` — the CLI sibling; **reference only, do not import or modify**
  (another agent owns `packages/cli` this sprint)
- Create: `packages/server/src/agent/provider-auth/pi-auth-runtime.ts` (+ `.test.ts`)

## What to build

**1. Export the path rule** from `provider-registry.ts`:

```ts
/** Resolved Pi agent dir + the auth/models paths inside it; undefined = Pi's own defaults. */
export function resolvePiAgentDir(config: PersistedConfig): { agentDir?: string };
export function resolvePiAuthPaths(config: PersistedConfig): { authPath?: string; modelsPath?: string };
```

Refactor `piHomeEnv` to build on it so there is exactly one derivation. Honour the real precedence
including the `agents.providers.pi.env.PI_CODING_AGENT_DIR` override. `buildPiClient`'s behavior
must not change.

**2. Create the seam** `packages/server/src/agent/provider-auth/pi-auth-runtime.ts`:

- Structural type mirrors of pi-ai's `AuthPrompt` / `AuthEvent` / `AuthInteraction` (they are not
  exported from the package main entry). Declare them locally so no call site imports a Pi type;
  they remain structurally assignable to Pi's real types. Mirror the four prompt kinds
  (`text`/`secret`/`select`/`manual_code`, `select` carrying `options: {id,label,description?}[]`)
  and the four event kinds (`info`/`auth_url`/`device_code`/`progress`).
- `PiAuthRuntime` interface: `listProviders()`, `checkAuth(providerId)`, `login(providerId, type,
  interaction, signal?)`, `logout(providerId)`, `authPathLabel()`.
- `createPiAuthRuntime(paths, opts?)` — production implementation:
  - Cached-promise lazy `await import("@earendil-works/pi-coding-agent")` →
    `ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false })`.
  - **On failure, clear the cached promise** so the next call retries.
  - `listProviders()` filters to login-capable providers, maps to `{ id, name, authTypes,
    oauthLoginLabel, oauthIsSubscription }`, and skips a malformed entry rather than throwing.
  - `checkAuth()` bounded (default 3000 ms, injectable for tests) → `{ configured: true|false|"unknown",
    type?, source? }`.
  - `logout()` delegates, then re-checks so the caller can report an ambient credential surviving
    removal.

## Out of scope

- Flow registry, prompt correlation, session pushes (task-003).
- RPC handlers and bootstrap wiring (task-004).
- Any change to `packages/cli` — including "sharing" its seam. Consolidation, if ever wanted, is a
  later chore once sprint-054 is fully done.

## Acceptance criteria

- [ ] `resolvePiAuthPaths(config)` returns `<piHome>/agent/auth.json` + `.../models.json` for a
      `daemon.piHome` config, honours an `agents.providers.pi.env.PI_CODING_AGENT_DIR` override
      above it, and returns empty (Pi defaults) when neither is set.
- [ ] The resolved `authPath` is byte-identical to the `PI_CODING_AGENT_DIR` a spawned agent gets
      from `buildPiClient` for the same config — asserted directly, including the override case.
- [ ] `piHomeEnv`/`buildPiClient` behavior is unchanged (existing `provider-registry.test.ts` passes
      untouched).
- [ ] No Pi import happens until the first runtime-backed method call; the module is imported at
      most once across repeated calls.
- [ ] A failed `ModelRuntime.create` is retried on the next call (second call succeeds after a
      transient failure) — asserted with a mock that fails once then succeeds.
- [ ] `listProviders()` returns only login-capable providers, carries `oauthLoginLabel` /
      `oauthIsSubscription`, and skips a malformed entry without throwing.
- [ ] `checkAuth()` on a provider that never settles resolves to `configured: "unknown"` within the
      bound (fake timers — no wall-clock wait).
- [ ] `logout()` reports `stillConfigured: true` when a re-check still shows the provider configured.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/agent/provider-auth/pi-auth-runtime.test.ts` covering the
  criteria above with a mocked `@earendil-works/pi-coding-agent`; add path-parity cases to
  `packages/server/src/agent/provider-registry.test.ts`. Run
  `npx vitest run packages/server/src/agent`; all pass.
- Include one real-package (`vi.importActual`) test that `ModelRuntime.create` succeeds against a
  temp dir with no pre-existing `models.json`, mirroring sprint-054/task-001's approach.

## Notes

- Keep the seam free of session/flow concepts — it is a thin runtime adapter; the flow engine is
  task-003's. This split is what lets task-003 be tested with no Pi at all.
- `login()` takes the flow signal so Pi's own `interaction.signal` race works; remember Pi throws
  its **own** `AbortError` on abort (sprint-054/task-004), so callers must not match on error type.
- Do not log credential values anywhere in this module.
