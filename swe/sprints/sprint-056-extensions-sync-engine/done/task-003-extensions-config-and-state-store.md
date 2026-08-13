# Task 003 — `daemon.extensions` config + `extensions-state.json` store + shared pi-home derivation

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **Type:** feature
- **Area:** packages/server (config, extensions, agent/provider-registry)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal

Add the two config keys with their env overrides, the persisted `extensions-state.json` store, and a
**single** derivation of the effective pi-home key that both this feature and the spawn path share.

## Context / why

Three small pieces of plumbing that everything downstream needs, grouped because they are all
"where does state live" and share one test file's worth of setup.

The state file is what makes tenet 1 (*never re-add what a user removed*) enforceable across
restarts: `offered` records **intent, not presence**, so an identity that ever installed successfully
is never offered again, and a user's later `pi remove` sticks forever. `failures` survives restarts
so `failed` + `reason` are still reportable on a freshly-booted daemon.

The pi-home derivation is the one intentional coupling point with the spawn path: state is keyed by
the **effective agent dir**, which must be byte-identical to the directory `piHomeEnv()`
(`provider-registry.ts:57-64`) points spawned agents at. Get this wrong and Pi-Studio installs into a
directory no agent reads.

> **Cross-sprint coordination.** `sprint-055-provider-auth-rpc`/task-002 also exports this rule, as
> `resolvePiAgentDir(config)` / `resolvePiAuthPaths(config)`, refactoring `piHomeEnv` onto it and
> honouring the real precedence `agents.providers.pi.env.PI_CODING_AGENT_DIR` > `daemon.piHome` >
> Pi's default. Sprint 055 runs first by numeric order, so: **if `resolvePiAgentDir` already exists,
> import it and add nothing.** If sprint 055 has not landed, create it here with exactly that
> contract and precedence, so the sprints converge instead of forking a second derivation. Either
> way there must be exactly one derivation in the tree when this task is done.

## Scope references

- `swe/features/preinstalled-extensions.md` § Daemon config, § State file —
  `$PI_STUDIO_HOME/extensions-state.json`, § Public Contract (Effective pi-home key), § Data &
  Persistence, § Error Handling (state-file-corrupt row, unknown-slug row)
- `swe/architecture/config.md` — `config.json` + env overlay conventions
- `swe/architecture/persistence.md` — store conventions
- `packages/server/src/config/daemon-config.ts:224-291` — `overlayEnv`, `persistedConfigSchema`,
  `loadConfig`
- `packages/server/src/persistence/atomic-store.ts:28` — `atomicWriteJson` (temp + fsync + rename)
- `packages/server/src/persistence/entity-stores.ts:149-186` — the `<x>Path(home)` / `load<X>` /
  `save<X>` single-file-store idiom (loops/chat) to mirror
- `packages/server/src/agent/provider-registry.ts:57-75` — `piHomeEnv`, `buildPiClient`
- Create: `packages/server/src/extensions/extensions-state.ts` (+ `.test.ts`)
- Modify: `packages/server/src/config/daemon-config.ts` (+ its test)

## What to build

**1. Config** — `daemon.extensions` subtree on `persistedConfigSchema`, `.passthrough()`, optional
with defaults, no migration:

| Key | Default | Env override |
|---|---|---|
| `daemon.extensions.autoSync` | `true` | `PI_STUDIO_EXTENSIONS_AUTOSYNC` (`"false"`/`"0"` disable) |
| `daemon.extensions.packs` | `[]` (`core` is implicit, never listed) | `PI_STUDIO_EXTENSION_PACKS` (CSV of slugs) |

Add both rows to `overlayEnv` following the existing row style (see the `PI_STUDIO_HOSTNAMES` CSV
handling for the list case). Unknown slugs are **not** rejected at config load — they are carried and
reported later by `selectEntries` (forward compat: an old daemon reading config a newer one wrote).

**2. State store** — `packages/server/src/extensions/extensions-state.ts`:

```ts
export function extensionsStatePath(home: string): string;               // <home>/extensions-state.json
export async function loadExtensionsState(home: string): Promise<ExtensionsState | "unreadable">;
export async function saveExtensionsState(home: string, state: ExtensionsState): Promise<void>;
export type PiHomeState = ExtensionsState["piHomes"][string];            // per-pi-home slice — task 004's planner input
export function effectivePiHomeKey(config: PersistedConfig): string;     // absolute agent dir
```

Zod schema exactly per the spec's shape — `version: 1`, `piHomes[<absolute agent dir>]` →
`{ offered: Record<identity, { installedSpec, atVersion, at }>, failures: Record<identity, { source,
reason, message, attempts, at }>, lastSync?: { at, outcome } }` — `.passthrough()`, optional fields,
`atomicWriteJson`. Only the `{ at, outcome }` **summary** is persisted for `lastSync`; the full
`SyncReport` is a return value, never a stored document.

**Corrupt-state fail-safe is a distinct return value**, not a thrown error and not an empty state:
`loadExtensionsState` returns `"unreadable"` so the caller can apply the spec's rule — treat every
manifest identity as already offered (wrong-and-quiet beats wrong-and-mutating), log `error` once,
**never** reset or overwrite the file. Returning an empty state here would silently re-offer
everything, i.e. exactly the wrong behavior. Statuses are unreliable in that mode by design; do not
assert specific ones.

`effectivePiHomeKey` = `resolve(join(<agent dir>, ...))` where the agent dir comes from the shared
derivation (see the coordination note): `join(daemon.piHome, "agent")` when set, else
`join(os.homedir(), ".pi", "agent")`, with the provider-env override winning above both. Always
absolute.

## Out of scope

- Planner (task 004), executor and the writing of `offered`/`failures` rows (task 005), service and
  bootstrap (task 006).
- Reading or writing pi's `settings.json` — task 006 owns that read; nothing here touches it.
- Any protocol/client/CLI surface (sprint B).

## Acceptance criteria

- [ ] `persistedConfigSchema.parse({})` yields `daemon.extensions = { autoSync: true, packs: [] }`.
- [ ] `overlayEnv` maps `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` and `=0` to `autoSync: false`, leaves
      it `true` for unset/other values, and parses `PI_STUDIO_EXTENSION_PACKS="a, b ,c"` to
      `["a","b","c"]` (trimmed) — mirroring the existing `PI_STUDIO_HOSTNAMES` CSV behavior.
- [ ] An unknown slug in `daemon.extensions.packs` loads without error (reported downstream, not
      rejected here).
- [ ] Round-trip: `saveExtensionsState` → `loadExtensionsState` returns a deep-equal document,
      written atomically (a temp file is never left behind on success).
- [ ] A `settings`-shaped document with **unknown extra fields** survives the round trip
      (`.passthrough()`), proving a newer daemon's file loads on an older one.
- [ ] Malformed JSON → `loadExtensionsState` returns `"unreadable"`; the file on disk is byte-identical
      afterwards (never rewritten, never deleted).
- [ ] Absent file → a valid empty state (`version: 1`, no pi-homes), **not** `"unreadable"`.
- [ ] `effectivePiHomeKey` returns `<piHome>/agent` for a `daemon.piHome` config, Pi's default when
      unset, honours the `agents.providers.pi.env.PI_CODING_AGENT_DIR` override above both, and is
      always absolute.
- [ ] `effectivePiHomeKey(config)` is byte-identical to the `PI_CODING_AGENT_DIR` a spawned agent
      receives from `buildPiClient` for the same config — asserted directly, including the override
      case. Existing `provider-registry.test.ts` passes untouched.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/extensions/extensions-state.test.ts`; extend
  `packages/server/src/config/daemon-config.test.ts` with the two env rows and the default; add the
  path-parity case to `packages/server/src/agent/provider-registry.test.ts` (only if this task is the
  one that creates `resolvePiAgentDir` — if sprint 055 already did, its test covers it).
- Run `npx vitest run packages/server/src/extensions packages/server/src/config packages/server/src/agent`.

## Notes

- The state file needs **no** `0600` mode — it contains no secrets (unlike `config.json` and
  `daemon-keypair.json`).
- A daemon repointed at a fresh pi-home simply finds no state under the new key and offers the full
  set there; the old key's state is retained untouched. Cover that in the round-trip test.
- Do not add a migration path. Forward compat is optional fields + defaults + `.passthrough()`,
  per house rules.
