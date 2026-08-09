# Task 001 — Pi auth runtime seam + auth-path resolution

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done
- **Type:** feature
- **Area:** packages/cli — provider auth
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Give the CLI a single, injectable seam onto Pi's auth engine (`ModelRuntime`) plus the path
resolution that guarantees CLI-written credentials are the ones daemon-spawned agents read — with
the Pi package loaded **lazily** so unrelated commands never pay for it.

## Context / why

Everything else in this sprint (status, logout, login, headless key) sits on this seam. Two things
must be right here or every later task inherits the bug:

1. **Path parity with the daemon.** `packages/server/src/agent/provider-registry.ts` derives
   `PI_CODING_AGENT_DIR = <piHome>/agent` and the CLI's `piProxyEnv()`
   (`packages/cli/src/pi-commands.ts:69-77`) mirrors it. Auth must resolve
   `<piHome>/agent/auth.json` by the same rule, or a user logs in and their agents still fail.
2. **Lazy load.** `@earendil-works/pi-coding-agent`'s main entry pulls the whole Pi TUI module
   graph. A top-level import would tax `pi-studio --help` and every unrelated command.

Verified facts about the Pi API this seam wraps (`pi-coding-agent@0.84.1`, main entry exports):
`ModelRuntime.create({ authPath?, modelsPath?, refreshOnCreate? })`, `getProviders()`,
`checkAuth(providerId)`, `login(providerId, type, interaction)`, `logout(providerId)`.

## Scope references

- `swe/features/provider-auth-cli.md` § Public Contract (Pi API surface consumed), § Behavior &
  Algorithms (path resolution), § Data & Persistence
- `swe/features/cli.md` § Command tree (where `auth` will slot in)
- `packages/cli/src/pi-commands.ts` — `PiRuntime`/`defaultPiRuntime()`/`piProxyEnv()`: the pattern
  to mirror exactly
- `packages/cli/src/cli-core.ts` — `CliContext` (new injectable slot), `GlobalOptions.piHome`
- `packages/server/src/agent/provider-registry.ts` — `piHomeEnv()`, the parity reference
- Create: `packages/cli/src/auth-runtime.ts`, `packages/cli/src/auth-runtime.test.ts`
- Modify: `packages/cli/package.json`, `packages/cli/src/cli-core.ts`

## What to build

- **Dependency:** add `@earendil-works/pi-coding-agent` as a direct dependency of
  `packages/cli/package.json`, with the **same version range as `packages/server`** (`^0.84.1`
  today). Both packages must resolve one copy; the release script already aligns workspace versions.

- **`packages/cli/src/auth-runtime.ts`:**

  ```ts
  export interface PiAuthPaths { authPath?: string; modelsPath?: string }   // undefined ⇒ Pi defaults
  export function resolvePiAuthPaths(opts: GlobalOptions, env?: NodeJS.ProcessEnv): PiAuthPaths

  export interface AuthProviderInfo {
    id: string; name: string;
    canApiKeyLogin: boolean; canOAuthLogin: boolean;
    oauthLoginLabel?: string; oauthIsSubscription?: boolean;
  }
  export interface AuthStatusInfo { configured: boolean; type?: "api_key" | "oauth"; source?: string }

  export interface AuthRuntime {
    listProviders(): Promise<AuthProviderInfo[]>;
    checkAuth(providerId: string): Promise<AuthStatusInfo>;
    login(providerId: string, type: "api_key" | "oauth", interaction: AuthInteractionLike): Promise<{ type: string }>;
    logout(providerId: string): Promise<void>;
    authPathLabel(): string;   // resolved auth.json path, for success messages
  }
  export function defaultAuthRuntime(paths: PiAuthPaths): AuthRuntime
  ```

  - `resolvePiAuthPaths`: `piHome = opts.piHome ?? env.PI_STUDIO_PI_HOME`; when set →
    `{ authPath: <piHome>/agent/auth.json, modelsPath: <piHome>/agent/models.json }`; when unset →
    `{}` so Pi's own `getAuthPath()` (which honors `PI_CODING_AGENT_DIR`) decides.
  - `defaultAuthRuntime`: creates the `ModelRuntime` **once, on first method call**, via
    `await import("@earendil-works/pi-coding-agent")` inside the function body, with
    `refreshOnCreate: false` (no network at startup). Cache the promise.
  - `listProviders` maps Pi `Provider` → `AuthProviderInfo`, filtered to providers that can actually
    log in (`auth.oauth` present, or `auth.apiKey.login` present). Never throw on a single bad
    provider — skip it.
  - `checkAuth` maps `AuthCheck | undefined` → `AuthStatusInfo` (`undefined` ⇒
    `{ configured: false }`).
  - `AuthInteractionLike` is the local structural type matching pi-ai's `AuthInteraction`
    (`prompt(p): Promise<string>`, `notify(e): void`, `signal?`) — declared here so callers and
    tests never need a Pi type import.

- **`CliContext`:** add optional `auth?: AuthRuntime` (documented like the existing `pi`/`daemon`/
  `relay`/`update` slots) so command tasks inject fakes.

## Out of scope

- Any command registration, prompting, or output rendering (tasks 002–005).
- Docs updates (task 006).

## Acceptance criteria

- [x] `resolvePiAuthPaths` returns `<piHome>/agent/auth.json` + `.../models.json` for both
      `--pi-home` and `PI_STUDIO_PI_HOME` (flag wins), and `{}` when neither is set.
- [x] Resolved `authPath` is byte-identical to the path the daemon's `piHomeEnv()` implies for the
      same `piHome` — asserted as the literal `join(piHome, "agent", "auth.json")`. Note
      `piHomeEnv()` is **module-private** in `provider-registry.ts`: cite it as the reference in a
      comment; do NOT try to import it.
- [x] `defaultAuthRuntime()` performs **no** import of `@earendil-works/pi-coding-agent` until a
      runtime method is first called; the module is imported at most once across repeated calls.
- [x] `AuthRuntime` is fully implementable by a test fake with no Pi types imported.
- [x] `packages/cli/package.json` declares `@earendil-works/pi-coding-agent` at the same version
      range as `packages/server/package.json`.

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Tests: add `packages/cli/src/auth-runtime.test.ts` — path resolution matrix (flag / env / both /
  neither), daemon parity assertion, lazy-import assertion (spy on a module-loader indirection or
  assert `defaultAuthRuntime()` constructs without touching the network/filesystem and only loads on
  first call), provider mapping + filtering, `checkAuth` mapping. Run
  `npx vitest run packages/cli/src/auth-runtime.test.ts`.
- Manual: `node -e "…"` or `npx vitest` timing is not required; the lazy-load guarantee is asserted
  by test, and end-to-end by task 006.

## Notes

- Version alignment is the mitigation for the CLI↔server skew risk called out in the scope's error
  table — keep the ranges identical, do not float the CLI's.
- `refreshOnCreate: false` is deliberate: `auth login` must work on a machine with no Pi state and
  no network reachability to model catalogs.
- TODO(verify) inherited: that `ModelRuntime.create` tolerates a missing `models.json` on a fresh
  machine. Cover it with a temp-dir test here rather than deferring.
