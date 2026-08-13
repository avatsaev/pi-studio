# Task 003 — Summary

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done

## What was built

- **Config** (`packages/server/src/config/daemon-config.ts`): `daemon.extensions` subtree
  (`autoSync: boolean` default `true`, `packs: string[]` default `[]`), `.passthrough()`, no
  migration. Two `overlayEnv` rows: `PI_STUDIO_EXTENSIONS_AUTOSYNC` (`"false"`/`"0"` disable,
  everything else including unset leaves the current value), `PI_STUDIO_EXTENSION_PACKS` (CSV,
  trimmed — same idiom as `PI_STUDIO_HOSTNAMES`).
- **Shared pi-home derivation** (`packages/server/src/agent/provider-registry.ts`): sprint-055
  (`resolvePiAgentDir`'s originally-planned owner) has not landed yet — its `backlog/` is untouched
  — so this task created it here per the coordination note in its own file, with exactly the
  contract sprint-055 anticipated: `resolvePiAgentDir(config): string | undefined`, precedence
  `agents.providers.pi.env.PI_CODING_AGENT_DIR` (wins) > `join(daemon.piHome, "agent")` > `undefined`
  (Pi's own default). `piHomeEnv` was refactored to build on it (`buildPiClient`'s observable
  behavior is unchanged — the existing test suite passes untouched, plus new path-parity cases were
  added). This is now the **one** derivation in the tree; sprint-055, whenever it lands, should
  import this instead of re-deriving.
- **State store** (`packages/server/src/extensions/extensions-state.ts`): `extensionsStatePath`,
  `loadExtensionsState` (returns the literal string `"unreadable"` on corrupt JSON or a schema
  mismatch — never defaults, never rewrites the file), `saveExtensionsState` (atomic, via the
  existing `atomicWriteJson`), `ExtensionsState`/`PiHomeState` types, and `effectivePiHomeKey`
  (wraps `resolvePiAgentDir`, applies Pi's own default `<home>/.pi/agent` when unset, `resolve()`s
  to guarantee an absolute path).

## Test / verification results

- `npx vitest run packages/server/src/extensions packages/server/src/config
  packages/server/src/agent/provider-registry.test.ts` — 6 files, **63 tests, all pass** (31 in
  `extensions/`, 14 in `config/`, 8 in `provider-registry.test.ts`, 10 pre-existing elsewhere in
  `config/`).
- `npm run build:server` — pass.
- `npm run typecheck` — pass.
- `npx oxlint packages/server/src/extensions packages/server/src/config packages/server/src/agent`
  — clean on every changed file (pre-existing warnings elsewhere in `agent/` untouched by this task).
- `npx oxfmt --check <changed files>` — clean (scoped auto-fix pass on two files first).

## Acceptance criteria

- [x] `persistedConfigSchema.parse({})` yields `daemon.extensions = { autoSync: true, packs: [] }`.
- [x] `overlayEnv` maps `PI_STUDIO_EXTENSIONS_AUTOSYNC=false`/`=0` → `false`, leaves it `true`
      otherwise; parses `PI_STUDIO_EXTENSION_PACKS="a, b ,c"` → `["a","b","c"]`.
- [x] An unknown slug in `daemon.extensions.packs` loads without error.
- [x] Round-trip `saveExtensionsState`/`loadExtensionsState` is deep-equal, written atomically (no
      temp file left on success).
- [x] A `.passthrough()`-shaped document with unknown extra fields (top-level and per-pi-home)
      survives the round trip.
- [x] Malformed JSON → `"unreadable"`; file byte-identical afterward.
- [x] Absent file → a valid empty state (`version: 1`, no pi-homes), not `"unreadable"`.
- [x] `effectivePiHomeKey` returns `<piHome>/agent` for `daemon.piHome`, Pi's default when unset,
      honours the provider-env override above both, always absolute.
- [x] `effectivePiHomeKey(config)` is byte-identical to the spawned `PI_CODING_AGENT_DIR` for the
      same config, plain and override cases both asserted directly in
      `provider-registry.test.ts`; existing `provider-registry.test.ts` cases pass untouched.

## Notes for downstream tasks

- Task 004 (planner) consumes `PiHomeState | "unreadable"` directly — no further plumbing needed.
- Task 005/006: `effectivePiHomeKey` is the single source for both the executor's install env and
  the state key; import it, never re-derive.
- If/when sprint-055 lands, its task-002 should import `resolvePiAgentDir` from here rather than
  creating a second copy — flagged in that sprint's own coordination note.
