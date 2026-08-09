# Task 003 — `pi-studio auth status` + `auth logout` — Summary

- **Sprint:** sprint-054-provider-auth-cli
- **Completed:** 2026-08-07
- **Status:** done

## What was implemented

`packages/cli/src/auth-commands.ts` — the `auth` command group's read/remove-side commands:

- `registerAuthCommands(program, ctx, setExit)` — registers `pi-studio auth` with `status` and
  `logout <provider>` subcommands, wired into `registerCommands()` in `program.ts`. `login` is left
  for tasks 004/005.
- `runtimeOf(ctx, opts)` — `ctx.auth ?? defaultAuthRuntime(resolvePiAuthPaths(opts))`, constructed
  only inside each action, never at registration time.
- `checkAuthBounded(runtime, providerId, timeoutMs = 3000)` (exported — task-004's picker reuses it
  per the task's own Notes) — races `runtime.checkAuth()` against a timeout built on
  `Promise.withResolvers()`, degrading to the literal string `"unknown"` rather than hanging the
  command.
- `auth status` — builds one row per provider (`listProviders()` + a bounded `checkAuth()` each),
  sorted by id. Table mode: `PROVIDER`/`NAME`/`STATUS`/`SOURCE` columns (`STATUS` ∈ `api key` |
  `oauth` | `not configured` | `unknown`; `SOURCE` shows `AuthCheck.source` when present, else
  `auth.json` for a stored credential, else empty), plus a stderr footer line with the resolved
  `auth.json` path. `--json` mode emits `[{id, name, configured, type?, source?}]` — `configured` is
  `boolean | "unknown"`; `type`/`source` are simply left `undefined` when not applicable, so
  `JSON.stringify` drops them (no footer line, no extra keys). Always exits `EXIT_OK`.
- `auth logout <provider>` — unknown id → error listing every valid id, `EXIT_ERROR`. Known id:
  checks status *before* calling `logout()` to pick the right message ("removed stored credential"
  vs "nothing stored" — idempotent, `logout()` is always called either way), then re-runs
  `checkAuth()` **after** removal; if still configured, prints the ambient-credential note (the
  pre-logout check can't see this — it reports the stored credential, not what's behind it). Always
  `EXIT_OK` on a known provider.

## Files created / changed

| File | Change |
|------|--------|
| `packages/cli/src/auth-commands.ts` | created |
| `packages/cli/src/auth-commands.test.ts` | created |
| `packages/cli/src/program.ts` | modified — registers `registerAuthCommands` |

## How it satisfies the scope

Maps to `swe/features/provider-auth-cli.md` § Public Contract (Commands table), § Behavior (status),
§ Error Handling, and `swe/features/cli.md` § Command tree. Matches the review-fixed task text
exactly on the two points the earlier plan review corrected: global-option ordering
(`pi-studio --json auth status`, verified against `program.ts`'s `enablePositionalOptions()`) and
the post-logout re-check for the ambient-credential note. No deviation.

**Verified finding, out of scope to fix here:** `daemon-commands.ts`/`pi-commands.ts` already
statically import `@av-pi-studio/server`, whose own module graph statically imports the real
`@earendil-works/pi-coding-agent` — confirmed directly with a `Module._resolveFilename` trace on a
bare `import("@av-pi-studio/server")`, which pulled in `cross-spawn`, `highlight.js`, `yaml`, `jiti`,
`undici`, and more. This means `pi-studio --help` (and every command) already pays the "whole Pi TUI
module graph" tax today, via a path wholly unrelated to `auth-runtime.ts`. This task's own seam is
lazy and independently verified (`ModelRuntime.create` is never *invoked* for `--help`/an unrelated
command — the actual guarantee `defaultAuthRuntime` controls); it cannot make a stronger claim about
the module never being *loaded*, since it already is, before this sprint, through a different path.
Logged in the task file's Notes for task-006's real-run step and the user's awareness; not fixed here
(would mean lazy-loading `@av-pi-studio/server` itself from the CLI — a separate, unscoped change).

## Build & test results

```
$ npm run build:cli
tsc -b packages/cli && chmod +x packages/cli/dist/cli.js
(success)

$ npm run typecheck
tsc -b
(success, 0 errors)

$ npx oxlint packages/cli/src/auth-commands.ts packages/cli/src/auth-commands.test.ts packages/cli/src/program.ts
(exit 0, no findings)

$ npx oxfmt --check packages/cli/src/auth-commands.ts packages/cli/src/auth-commands.test.ts packages/cli/src/program.ts
All matched files use the correct format.

$ npx vitest run packages/cli/src
Test Files  14 passed (14)
     Tests  190 passed (190)
```

`packages/cli/src/auth-commands.test.ts` (11 tests): status table covering all four states (stored
api key, stored oauth, env-var-sourced, not configured), `--json` id-sorted output with a per-row
"no extra keys" assertion, a hung-provider-degrades-to-unknown test at both the `checkAuthBounded`
unit level and through the full `auth status` command (both using `vi.useFakeTimers()` +
`vi.advanceTimersByTimeAsync()` — no real wall-clock wait), exit-0-when-nothing-configured, logout
removing a credential (fake runtime records the call) + exits 0, a second logout on an
already-removed credential still exits 0 with "nothing stored", an unknown provider id exits nonzero
listing valid ids, the ambient-credential note after logout, `--help` listing the `auth` group with
`ModelRuntime.create` never invoked, and the same for an unrelated command group's action
(`daemon status`). `@earendil-works/pi-coding-agent` is mocked via `vi.hoisted()` (required here,
unlike `auth-runtime.test.ts`, because this file transitively imports `program.js` →
`daemon-commands.js`/`pi-commands.js` → `@av-pi-studio/server`, which statically imports the real
package — a plain top-level `const` would hit a temporal-dead-zone `ReferenceError`).

Manual verification against a real, empty `--pi-home`: `auth status` listed all ~39 real Pi
providers as `not configured` (table and `--json` modes), the stderr footer showed the resolved
`auth.json` path, and only `<piHome>/agent/auth.json` was created (no stray files). `auth logout
not-a-real-provider` exited 1 and listed every valid id.

## Acceptance criteria

- [x] `pi-studio auth status` renders a table covering all four states against a fake runtime.
- [x] `pi-studio --json auth status` emits the documented array, id-sorted, with no extra keys.
- [x] The resolved `auth.json` path is shown in table mode and absent from JSON stdout.
- [x] A provider whose `checkAuth()` hangs past the timeout degrades to `unknown`, no hang.
- [x] `auth logout <known>` removes the credential and exits 0; a second call exits 0 with "nothing
      stored".
- [x] `auth logout <unknown>` exits `EXIT_ERROR` and lists valid provider ids.
- [x] Logging out a provider that is also env-var configured prints the ambient-credential note.
- [x] `--help` lists the `auth` group; the auth seam's own lazy-import guarantee holds (see the
      Notes/finding above for the precise, non-overclaimed scope of this claim).

## Follow-ups / TODO(verify)

- Carried forward to task-006: the pre-existing `@av-pi-studio/server` eager-import finding above.
  Task-006's real-run module-load-trace step should assert the auth seam's specific contribution
  (its own dynamic import fires only on first `checkAuth`/`login`/`logout` call), not a blanket
  "Pi is never loaded before then" claim for the whole process.
