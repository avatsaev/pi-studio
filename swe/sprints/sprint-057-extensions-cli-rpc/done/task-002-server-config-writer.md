# Task 002 — Server-side `config.json` writer that never bakes env overrides onto disk

- **Sprint:** sprint-057-extensions-cli-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server (config)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Give the daemon its first ability to persist a config change — `daemon.extensions.packs` — by
read-merge-writing the **raw** `config.json`, so an in-memory env overlay is never written to disk.

## Context / why

The daemon has **no** config writer today. Only the CLI writes `config.json`
(`packages/cli/src/daemon-control.ts` — `setDaemonPassword`, `persistRelayEnvOverrides`), both using a
read-merge-write shape with mode `0600`. `extension_packs_set_request` must persist the new selection,
so this capability has to exist on the server side, and it is worth its own task because of one
specific trap.

**The trap:** `loadConfig` returns `overlayEnv(parsedFile, env)` — env vars are layered **in memory
only**. `daemon-control.ts:227-231` calls this out explicitly as deliberate: the overlay "never writes
back to disk". So persisting the *loaded* config object would silently bake every
`PI_STUDIO_*` override into the file permanently — turning a one-shot
`PI_STUDIO_LISTEN=0.0.0.0:7000 pi-studio daemon start` into a permanent listen change, and an
`PI_STUDIO_EXTENSIONS_AUTOSYNC=false` shell experiment into a permanent kill switch. That is a real
data-corruption bug, not a style issue, and it is invisible until someone's next boot behaves
differently.

The writer must therefore re-read the raw file, merge **only** the one key it owns, and write back —
never touching anything else, preserving unknown fields (forward compat: a newer daemon's config keys
must survive an older daemon's write).

## Scope references

- `swe/features/preinstalled-extensions.md` § Data & Persistence (`config.json` gains the
  `daemon.extensions` subtree "via the normal config persistence path"), § RPC surface
  (`extension_packs_set_request` persists the selection)
- `swe/architecture/config.md` — config precedence and env-overlay semantics
- `packages/server/src/config/daemon-config.ts:224-291` — `overlayEnv`, `loadConfig`,
  `persistedConfigSchema`, `migrateConfig`
- `packages/cli/src/daemon-control.ts:174-236` — `setDaemonPassword` / `persistRelayEnvOverrides`:
  the read-merge-write + `0600` + re-chmod idiom to mirror (reference only — do **not** import from
  or modify `packages/cli`)
- `packages/server/src/persistence/atomic-store.ts:28` — `atomicWriteJson` (temp + fsync + rename)
- Modify: `packages/server/src/config/daemon-config.ts` (+ `daemon-config.test.ts`)

## What to build

```ts
/**
 * Persist `daemon.extensions.packs` into `configPath`, merging into the RAW file contents — never a
 * loaded (env-overlaid) config. Creates the file/dir when missing. Written 0600: config.json can
 * carry the daemon password hash.
 */
export async function persistExtensionPacks(configPath: string, packs: readonly string[]): Promise<void>;
```

- Read the raw JSON (`{}` when the file is missing or unparseable — never throw the caller's RPC away
  over a corrupt config), set `daemon.extensions.packs`, write atomically, then ensure mode `0600`
  (mode only applies on create, so re-chmod like the CLI does for files written before the rule).
- Preserve every other key byte-for-byte in meaning, including unknown ones.
- Do **not** round-trip through `persistedConfigSchema` before writing: parsing would inject every
  default into the file, converting "unset, inherits the default" into "explicitly pinned", which
  silently freezes future default changes. Merge into the raw object.

## Out of scope

- The RPC handler that calls this (task 003) and the in-memory update of the running daemon's
  selection (also task 003 — the service owns that).
- Persisting any other config key. `autoSync` is deliberately **not** settable over the wire in v1;
  it stays a file/env-level kill switch.
- Any change to `packages/cli`'s two writers, or consolidation with them.

## Acceptance criteria

- [ ] Writes `daemon.extensions.packs` into a **fresh** (absent) `config.json`, creating the directory,
      with mode `0600`.
- [ ] Preserves unrelated keys on an existing file — including an unknown top-level key and an unknown
      key inside `daemon` — asserted by deep-equal on everything except the changed path.
- [ ] **Env overrides are never persisted:** with `PI_STUDIO_LISTEN`, `PI_STUDIO_EXTENSIONS_AUTOSYNC`
      and `PI_STUDIO_EXTENSION_PACKS` all set in the environment, calling the writer leaves
      `daemon.listen` / `daemon.extensions.autoSync` **absent** from the file and writes only the
      `packs` value passed as the argument. This is the task's headline test.
- [ ] Defaults are not materialised: a file containing only `{"version":1}` gains **only**
      `daemon.extensions.packs` — no `listen`, `hostnames`, or other defaults appear.
- [ ] Re-tightens a pre-existing `0644` config to `0600` (mirrors `setDaemonPassword`'s behavior).
- [ ] A corrupt/unparseable existing file does not throw; it is replaced with a document containing
      the merged key (documented behavior, asserted).
- [ ] `loadConfig(configPath, {})` after a write returns the persisted packs; with
      `PI_STUDIO_EXTENSION_PACKS` set, the env value still wins in memory (overlay precedence intact).
- [ ] Written atomically — no temp file left behind on success.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/server/src/config/daemon-config.test.ts` (it already has the temp-config
  helper); run `npx vitest run packages/server/src/config`.
- Assert file mode with `statSync(path).mode & 0o777`, as the CLI's test does.

## Notes

- Keep the function narrowly named and narrowly scoped. A generic `saveConfig(config)` is exactly the
  API that invites the env-baking bug — do not add one.
- If a future task needs to persist another key, add a sibling function or a key-path parameter; do
  not widen this one into "write the whole config".
