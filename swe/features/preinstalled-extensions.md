# Preinstalled Pi Extensions — Curated Packs

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [cli.md](cli.md), [agent-providers.md](agent-providers.md),
> [provider-auth-cli.md](provider-auth-cli.md) (same `piHome` derivation contract),
> [../architecture/config.md](../architecture/config.md),
> [../architecture/daemon-bootstrap.md](../architecture/daemon-bootstrap.md),
> [../architecture/persistence.md](../architecture/persistence.md)

## Purpose

A fresh Pi-Studio install runs a bare `pi` agent. Pi has a rich package ecosystem
([pi.dev/packages](https://pi.dev/packages) — extensions, skills, prompts, themes installed via
`pi install npm:<pkg>`), but discovering and installing the good ones is manual work every user
repeats. This scope makes Pi-Studio ship a **curated set of preinstalled Pi extensions**: after
install/update, the daemon ensures a maintained list of recommended packages is present in the
bundled Pi's global settings, grouped into **audience packs** (`core` baseline for everyone;
opt-in extras per audience, e.g. `swe`, `science`, `data`).

The curated list is **pure data inside this repo** — one TS module — not published meta-packages.
Rejected alternatives, for the record:

- **npm meta-packs** (`@av-pi-studio/ext-pack-*` bundling curated deps via `bundledDependencies`):
  requires republishing to bump any curated extension, redistributes third-party code in our
  tarballs, adds 4+ artifacts to the lockstep publish, and forces users to disable individual
  extensions via brittle path filters into pack internals instead of pi's native
  `pi remove`/`pi config`.
- **Per-project `.pi/settings.json`** (piggybacking pi's project-settings auto-install-on-trust):
  duplicates installs under every project's `.pi/npm/`, writes into user repos, and couples sync
  timing to project trust instead of daemon lifecycle.

**Design tenets:**

1. **Additive only, forever.** Pi-Studio adds settings entries; it never removes one, never re-adds
   one the user removed, and never edits one the user has touched. Users who also use `pi`
   standalone must never fight Pi-Studio over `settings.json`.
2. **Pi's machinery, not ours.** Installation is `pi install <spec>` against the bundled binary —
   inheriting `npmCommand` wrappers, git-source handling, and pi's settings semantics. Pi-Studio
   never hand-writes `packages` entries into `settings.json`.
3. **Pi-Studio curates the *set*; the user owns the *versions*.** Sources are **unpinned**
   (`npm:pi-web-access`, not `npm:pi-web-access@0.22.0`). First install resolves to whatever is
   current; from then on the extension is an ordinary pi package that the user updates with
   `pi update` like any other. Pi-Studio has no opinion about versions and no version-bump chore.
   This is not laziness — it is forced by tenet 1: `pi update` **skips pinned npm specs**
   (`updateConfiguredSources`: `if (!parsed.pinned)`, pi 0.84.1
   `dist/core/package-manager.js:840`), so a pin written by Pi-Studio would permanently exclude
   that extension from the user's own updater and make us the bottleneck for every upstream bug fix.
4. **Sync is dumb, idempotent, and non-blocking.** Safe to run on every daemon boot; never delays
   daemon readiness; failure degrades to "try again next boot".
5. **Every package succeeds or fails alone.** A pack is a *selection*, never a transaction: one
   package that 404s, needs credentials, times out, or crashes its own postinstall must never
   prevent the other packages in that pack from installing, and must never fail the sync as a whole.
   Partial success is a first-class outcome, reported per package with an actionable reason. Nothing
   is ever rolled back — successful installs stay installed.

## Public Contract

### The manifest (single source of truth)

`packages/server/src/extensions/curated-packs.ts` — a typed const, `satisfies CuratedPackCatalog`:

```ts
export const CURATED_PACKS = {
  core: {
    title: "Baseline",
    description: "Recommended for everyone",
    packages: [
      // Background commands + attachable PTY/TUI sessions — long-running work without blocking a turn.
      { source: "npm:@99percentpeople/pi-background-tasks", addedIn: "0.0.73" },
      // Todo list for the model, rendered as a live overlay that survives /reload.
      { source: "npm:@juicesharp/rpiv-todo", addedIn: "0.0.73" },
      // Web search, URL fetch, repo cloning, PDF/YouTube extraction.
      { source: "npm:pi-web-access", addedIn: "0.0.73" },
      // Powerline-style status bar.
      { source: "npm:pi-powerline-footer", addedIn: "0.0.73" },
      // Structured questionnaire tool: typed multiple-choice/free-text prompts instead of the
      // model guessing when it lacks information it should ask for.
      { source: "npm:@juicesharp/rpiv-ask-user-question", addedIn: "0.0.93" },
    ],
  },
  // swe: { ... }, science: { ... }, data: { ... } — future audience packs, added over time
} satisfies CuratedPackCatalog;
```

No `source` carries a version or ref. The manifest answers "which extensions do we recommend",
never "which version of them" — so it needs no maintenance when upstream publishes.

| Field | Meaning |
|-------|---------|
| pack key | Stable slug (`core`, `swe`, …). `core` MUST exist; it is always implicitly selected. |
| `title`, `description` | Display copy for CLI tables and future UI pickers. |
| `packages[].source` | Pi source spec, **unpinned**: `npm:<name>` or `git:<url>` with no `@version`/`@ref` suffix. Unpinned npm sources stay eligible for the user's `pi update`; unpinned git sources track the default branch. See tenet 3 for why a pin here would be actively harmful. |
| `packages[].addedIn` | The **aligned workspace package version** on disk when the entry was added (docs/UI/audit only; not load-bearing for sync). This is the version every `packages/*/package.json` shares — currently `0.0.73`. A new entry is stamped with the *current* version and ships in the following release; this keeps the guard test's `addedIn <= current` check green between the curation edit and the release bump. Read it at runtime from `packages/server/package.json`; the root `package.json` deliberately has **no** `version` field (it is a private workspace root that `scripts/publish.sh` never bumps — the field was removed rather than left to drift), so there is no second version line to confuse it with. |
| `packages[].deprecated?` | Tombstone. `deprecated: true` stops offering an entry to pi-homes that never received it; existing installs are untouched. |

**Identity** of an entry = pi's own dedup key (npm package name; git URL without ref) extracted
from `source`. Invariants, enforced by a guard test (`curated-packs.test.ts`, same idiom as
`theme/token-integrity.test.ts`):

- Every `source` parses as a valid pi spec and carries **no** version/ref pin — the guard test
  rejects `npm:foo@1.2.3` and `git:…@ref` alike, so a well-meaning "let's freeze this one" edit
  can't silently remove an extension from the user's `pi update`.
- No identity appears in more than one pack (**disjointness** — anything two audiences want is
  promoted to `core`; this is what makes multi-pack selection safe against double-loading).
- Pack keys are stable slugs; `core` exists; `addedIn` is a valid semver, and is `<=` the current
  `packages/server/package.json` version — this catches a typo'd or future-dated version. (The root
  `package.json` carries no version at all, so it cannot be pasted in by mistake.)
- No `source` contains a placeholder (`<ref>`, `<version>`, `<pkg>`) — catches a half-finished
  curation edit before it reaches a release.

#### How updates actually reach users (verified against pi 0.84.1)

Pi-Studio installs each curated extension **once** and then stays out of the way; all subsequent
version movement is pi's, driven by the user. Verified in
`@earendil-works/pi-coding-agent/dist/core/package-manager.js`:

| Source form | `pi update` behavior | Consequence for us |
|---|---|---|
| `npm:<name>` (ours) | `updateConfiguredSources` adds it to `npmCandidates` (`!parsed.pinned`), `shouldUpdateNpmSource` compares installed vs. latest, then installs `<name>@latest` | The user's own `pi update` keeps curated extensions current. Exactly what we want. |
| `npm:<name>@<ver>` (rejected) | **Skipped** — `if (!parsed.pinned)` excludes it | Would freeze the extension until a Pi-Studio release. Rejected by tenet 3. |
| `git:<url>` no ref (none shipped today) | `updateGit` → `getLocalGitUpdateTarget` → fetch + reset to the tracked default branch | If a git-hosted entry is ever curated, the owner's pushes reach users via their own `pi update` — no tag, SHA, or manifest edit needed. |
| `git:<url>@<ref>` (rejected) | `updateGit` fetches that exact ref and resets to it | Content frozen at `<ref>`; also needs a tag/SHA the repo doesn't have. |

Two consequences worth being explicit about, because they are the real cost of not pinning:

- **No reproducibility across machines.** Two users installing a week apart can get different
  versions. Accepted: these are third-party dev-tool extensions, not a locked dependency graph, and
  the pinned alternative buys reproducibility only by disabling the user's updater.
- **Curation vouches for the package, not a version.** An upstream release ships to users without
  Pi-Studio review. Accepted for the same reason `npm install foo` is accepted everywhere; the
  security read at inclusion time is about the project and maintainer, not a frozen tarball.
  A user who wants determinism can pin it themselves — and because a hand-edited entry becomes
  `user_modified` permanently (§ Behavior), Pi-Studio will never touch it again. Determinism is
  therefore available opt-in, per user, without us imposing it on everyone.


### Daemon config (`config.json` + env overlay, existing `overlayEnv` pattern)

| Key | Default | Env override | Purpose |
|-----|---------|--------------|---------|
| `daemon.extensions.autoSync` | `true` | `PI_STUDIO_EXTENSIONS_AUTOSYNC` (`"false"`/`"0"` disable) | Master switch. When off, Pi-Studio never touches pi's settings — the whole feature is inert. |
| `daemon.extensions.packs` | `[]` (i.e. `core` only — `core` is implicit and not listed) | `PI_STUDIO_EXTENSION_PACKS` (CSV of pack slugs) | Selected audience packs, additive to `core`. Unknown slugs are logged and ignored (forward compat: an old daemon reading config written by a newer one). |

**`core` is not opt-outable through the selection model.** `selectEntries` unconditionally prepends
`core`, so `packs: []`, `packs: ["swe"]`, and an omitted key all yield `core` plus whatever extras
were named. There is no slug, flag, or payload shape that deselects it, and none may be added — no
`--no-core`, no `"!core"` negation, no empty-array special case. Avoiding the baseline is
intentionally reachable only via `autoSync: false` (the whole-feature kill switch that offline,
air-gapped, and CI installs need, and the escape hatch if a curated package turns bad upstream) or
per-extension via pi's own `pi remove`, which no Pi-Studio code path may override (tenet 1). Only the
optional audience packs (`swe`, `science`, `data`, …) are user-selectable.

**Open decision — what deselecting an optional pack means.** Today deselect is *stop offering*, not
*uninstall*: entries already installed stay installed and keep reporting `installed` (§ Acceptance
Criteria — "no removals on deselect"). This is unobservable in v1, since only `core` ships and `core`
cannot be deselected, so the choice is deliberately deferred — but it MUST be settled **before the
first optional pack ships**, because "I opted out of the science pack and the science extensions are
still loaded" is a support-ticket generator. Candidate resolution: on an explicit
`extension_packs_set_request` that drops a pack, uninstall only that pack's entries whose
`settings.json` entry still byte-matches `installedSpec` (i.e. ones Pi-Studio installed and the user
never touched) — never on a bootstrap sync, never `core`, never a `user_modified`/`user_removed`
entry. That needs a second action type in the planner and executor, which today know only `install`.

Schema additions follow house rules: `.passthrough()`, optional with defaults, no migration.

### State file — `$PI_STUDIO_HOME/extensions-state.json`

```jsonc
{
  "version": 1,
  "piHomes": {
    "<effective agent dir, absolute>": {          // see "Effective pi-home" below
      "offered": {
        "<identity>": {
          "installedSpec": "npm:pi-web-access",         // what sync last wrote, verbatim
          "atVersion": "0.0.73",                        // aligned workspace version at install time
          "at": "2026-08-12T12:00:00Z"
        }
      },
      "failures": {                                   // survives restarts so `failed` + reason
        "<identity>": {                               // are still reportable after a reboot
          "source": "npm:pi-lens",
          "reason": "not_found",
          "message": "npm ERR! 404 Not Found - GET https://registry.npmjs.org/pi-lens",
          "attempts": 3,
          "at": "2026-08-12T12:00:00Z"
        }
      },
      "lastSync": { "at": "2026-08-12T12:00:00Z", "outcome": "partial" }
    }
  }
}
```

- `offered` records **intent, not presence**: an identity enters `offered` only after a
  *successful* `pi install`, and once present it is never installed again — a user's later
  `pi remove` sticks forever.
- `installedSpec` is the byte-compare ancestor for the ownership rule (§ Behavior).
- `atVersion` is the aligned workspace version (read from `packages/server/package.json`, the same
  line as `addedIn` — never the root `package.json`). Diagnostics only; sync never branches on it.
- `failures` is written on every failed install and **deleted for that identity on the next
  success**. `attempts` increments across syncs, so a persistently broken package is visibly
  distinguishable from a one-off blip in `extensions list` without any extra bookkeeping.
  A failure record never blocks a retry — it is diagnostics, not state machine.
- `lastSync` persists the derived summary so `extension_packs_list_request` can report the previous
  run's outcome on a freshly-booted daemon that hasn't synced yet.
- Zod schema with `.passthrough()` + optional fields; atomic write (temp + rename), like the other
  `$PI_STUDIO_HOME` stores.

**Effective pi-home key:** the directory spawned agents actually receive as `PI_CODING_AGENT_DIR`,
resolved to an absolute path — precedence `agents.providers.pi.env.PI_CODING_AGENT_DIR` (wins) >
`join(daemon.piHome, "agent")` > pi's default `join(os.homedir(), ".pi", "agent")`. One shared
derivation (the `resolvePiAgentDir` contract — § Dependencies) feeds the state key, the executor's
install env, and the spawn path, so install location and agent load location cannot diverge. Both
non-default branches are `~`-expanded and resolved to an absolute path **inside that one
derivation**, not by each consumer separately: the bundled Pi CLI's own `normalizePath` expands a
leading `~/` but never resolves a relative path, so a raw `~`-prefixed or relative `daemon.piHome`
would otherwise install into one directory (wherever this process resolves it to) while a spawned
agent loads from another (wherever Pi resolves it to) — silently, permanently, since a successful
install marks the identity `offered` and the next sync's `noop` gives no signal anything is wrong.
A daemon repointed at a fresh pi-home sees no state for that key and offers the full set there.

### RPC surface (flat snake_case; explicit `HandlerRegistry.register()` in `bootstrap.ts`;
schemas in `packages/protocol` per append-only rules)

| RPC | Request payload | Response payload |
|-----|-----------------|------------------|
| `extension_packs_list_request` → `extension_packs_list_response` | `{}` | `{ autoSync, selected: string[], packs: PackInfo[], lastSync?: { at, outcome } }` — `lastSync` is the persisted summary (§ State file), never a full report |
| `extension_packs_set_request` → `extension_packs_set_response` | `{ packs?: string[] }` | List-response shape plus `ok: boolean`, `error?: string`, and `report?: SyncReport` — the full report of the sync this request triggered, computed **after** it completes |

`PackInfo`: `{ id, title, description, packages: EntryInfo[] }`.

`EntryInfo`: `{ source, identity, addedIn, deprecated?, status, lastError? }` where `status` ∈
`installed | user_removed | user_modified | pending | failed | deprecated`.
Status comes from the pure planner (§ Behavior) run in dry-run mode — one code path for "what we'd
do" and "what we report", no drift. `lastError` is present only for `status: "failed"` and carries
`{ at, attempts, reason, message }` — see § Executor for the `reason` taxonomy.

`SyncReport` — the outcome of a sync run, returned in full by the RPC that triggered it, never
reduced to a single boolean. Only the `{ at, outcome }` summary is persisted (§ State file):

```ts
type SyncReport = {
  at: string;                  // ISO timestamp of sync completion
  outcome: "ok" | "noop" | "partial" | "failed" | "skipped";
  installed: string[];         // identities newly installed this run
  failures: {                  // ONE ENTRY PER FAILED PACKAGE — never truncated, never collapsed
    identity: string;
    source: string;
    pack: string;              // which pack it belongs to
    reason: ExtensionFailureReason;
    message: string;           // captured stderr tail (bounded, e.g. 2 KB), human-readable
  }[];                         // every failure retries on the next sync trigger — no per-row flag
};
```

`outcome` is derived, not independently tracked: `noop` = the plan was empty (the healthy steady
state of every boot after the first); `ok` = actions ran, zero failures; `partial` = at least one
success **and** at least one failure; `failed` = every attempted action failed; `skipped` = sync
could not start at all (no usable pi binary, unreadable `settings.json` — see § Error Handling).
`noop` and `skipped` are deliberately distinct — `noop` is a quiet healthy day, `skipped` is a
broken environment; collapsing them would hide real breakage inside routine logs. A `partial`
outcome is an ordinary, fully-supported end state — **not** an error condition for the daemon.

`extension_packs_set_request` carries the **selection change and the manual-sync trigger in one
append-only shape**, distinguished by whether `packs` is present:

- **`packs` present** — validate the slugs against the catalog, persist `daemon.extensions.packs` to
  `config.json`, then run `sync("selection")` (subject to `autoSync`).
- **`packs` absent** — change nothing and persist nothing; run `sync("manual")`, which is
  **deliberately not gated** by `autoSync` (§ Error Handling: `extensions sync` remains the explicit
  manual path when auto-sync is off). This is what `pi-studio extensions sync` sends, so the command
  needs neither a third RPC pair nor a wasteful list-then-set round trip that would rewrite
  `config.json` just to trigger a run.

Validation failures are **domain payloads, not `rpc_error`**: an unknown slug answers `ok: false` +
`error` with no persistence and no sync, mirroring `file_watch_subscribe_response`. (`rpc_error`
carries only transport-level codes, so a handler cannot express a domain failure through it.) A
**malformed `packs`** (present, but not an array of strings) is rejected the same way rather than
coerced: the handler reads an unvalidated `Record<string, unknown>`, and coercing would read as
"deselect everything" and persist an empty selection — silent data loss. `report`
is present exactly when a sync ran — i.e. on every `ok: true` response.

The CLI passes a generous per-call timeout (10 minutes) for `select`/`sync`: a first-run install of
several packages can legitimately exceed the SDK's default 30 s `rpcTimeoutMs`, and an RPC timeout must
never be misread as a failed sync (root invariant 6 — the sync keeps running server-side either way).
No push/broadcast type in v1 — the response carries the result. (If live progress is ever needed,
copy the per-session `send()` family pattern of `checkout_status_update`.)

`PiStudioClient` gains `listExtensionPacks()` / `setExtensionPacks(packs)` facade methods.

### CLI commands (registered on the existing commander `program`)

| Command | Behavior | Exit |
|---------|----------|------|
| `pi-studio extensions list` | Table (or `--json`) of packs, entries, per-entry status, selection, `autoSync` state. Failed entries render with their `reason` and a truncated `message`, plus `attempts` when > 1. Talks to the daemon via RPC when connected; a `--local` mode running the planner in-process (no daemon) mirrors the `auth` group's daemon-free operation and honors `--pi-home`. | 0 (listing failures is not itself a failure) |
| `pi-studio extensions select <packs...>` | Sets the selected packs (replaces the list; `core` always implicit) and syncs. Prints the `SyncReport`: installed count, then **every** failure as its own line (`✗ <source> (<pack>): <reason> — <message first line>`), then a "these will be retried automatically; run `pi-studio extensions sync` to retry now" footer. | `0` on `ok`/`noop`; `EXIT_ERROR` otherwise (`partial`, `failed`, `skipped`) — successful installs are always kept and reported |
| `pi-studio extensions sync` | Force a sync now (e.g. after a manual `--pi-home` change, or with `autoSync` off as a manual mode). Same reporting and exit-code rules as `select`. | `0` / `EXIT_ERROR` as above |

A non-zero exit on `partial` is deliberate: it makes CI/provisioning scripts notice, while the
human-readable output makes clear that the rest of the pack did install and nothing needs undoing.

### New/changed files

| File | Responsibility |
|------|----------------|
| `packages/server/src/extensions/curated-packs.ts` | The manifest + `CuratedPackCatalog` types + identity extraction helpers |
| `packages/server/src/extensions/sync-planner.ts` | **Pure** three-way-merge planner: `(manifest, selectedPacks, state, settingsJson) → SyncPlan` (list of `install` actions + per-entry statuses). No I/O. |
| `packages/server/src/extensions/sync-executor.ts` | Runs a `SyncPlan`: spawns `pi install <spec>` per action via the bundled binary, updates the state file. Injectable spawn seam for tests (mirrors the CLI's `DaemonRuntime` fake pattern). |
| `packages/server/src/extensions/extensions-service.ts` | Orchestration: reads settings.json + state, invokes planner/executor, serializes concurrent sync requests (in-process mutex), exposes `sync()`/`describe()` to handlers and bootstrap |
| `packages/server/src/config/daemon-config.ts` | `daemon.extensions` schema + env overlay rows |
| `packages/server/src/daemon/bootstrap.ts` | Instantiate service; fire-and-forget `sync()` after the WS server is listening. **Not** wired into `dev-bootstrap.ts` (mock-only dev daemon must not touch pi state). |
| `packages/protocol/src/…` | The two RPC message pairs (append-only) |
| `packages/server/src/…` (handlers) | `extension_packs_list` / `extension_packs_set` handlers + registration |
| `packages/client/src/…` | `PiStudioClient.listExtensionPacks()` / `.setExtensionPacks()` |
| `packages/cli/src/extensions-commands.ts` | The `extensions` command group |

## Behavior & Algorithms

### Planner — pure three-way merge

Inputs: manifest (what we curate now), state (what we previously did), pi's global
`settings.json` `packages` array for the effective pi-home (current reality, possibly
hand-edited). Per identity across `core` + selected packs:

```
function planEntry(entry, state, settings):
    id = identity(entry.source)

    if entry.deprecated: return { status: "deprecated" }            # tombstone: no action, ever

    offered = state.offered[id]
    if not offered:
        preexisting = findByIdentity(settings.packages, id)         # string or object form
        if preexisting:
            return { status: "user_modified" }                      # already theirs — adopt, don't install
        return { status: "pending", action: install(entry.source) } # genuinely new here

    current = findByIdentity(settings.packages, id)                 # string or object form
    if current is absent:
        return { status: "user_removed" }                           # user ran `pi remove` — final
    if current != offered.installedSpec:                            # byte-compare; object form ≠ string
        return { status: "user_modified" }                          # user repinned/filtered — theirs now
    return { status: "installed" }
```

The load-bearing rule: **sync's only action is installing an entry it has never successfully
installed before, and that isn't already present in `settings.json` under any form.** The second
half of that rule exists because `pi install` is not additive-safe on its own: pi's own
`addSourceToSettings` matches an existing entry by version-insensitive identity
(`packageSourcesMatch`/`getSourceMatchKeyForSettings`, `package-manager.js:1120-1124`) and, when the
stored string differs from the incoming normalized one, **rewrites it in place**
(`package-manager.js:610-618`) — so installing over a curated identity the user already added
themselves (a common case: Pi-Studio is frequently added to an existing `pi` user's setup) would
silently destroy their pin or object-filter form on the very first sync, before that identity was
ever offered. The planner already receives `settingsPackages`; checking it before planning an
install for a never-offered identity closes the hole without adding a new status — the outcome is
exactly `user_modified` (theirs, not ours), consistent with the case below where the entry differs
*after* being offered.

Once an identity enters `offered`, **or** is found already present before ever being offered, no
future plan ever contains an action for it — `user_removed` and `user_modified` are terminal,
reporting-only statuses, derived by byte-comparing the current settings entry against
`installedSpec` (any user edit — a version pin, the object-filter form — permanently transfers
ownership). If a curated package ever genuinely moves (renamed upstream, or a `git:` source later
published to npm), that is a **new identity**: deprecate the old entry and add a new one; no
in-place rewrite path exists. Combined with `offered`-as-intent, this yields the full
non-interference guarantee of tenet 1, and makes tenet 4 true in practice: after the first run, a
normal boot plans zero actions, spawns no processes, and reports `outcome: "noop"`.

Identities present in `settings.json` but not in the manifest (the user's own packages) are never
examined, never reported, never touched.

### Executor — per-package failure isolation

**Hard requirement: one package failing NEVER aborts the sync.** Each `install(spec)` action is an
independent, fully isolated unit of work. The executor runs *every* planned action to completion
regardless of how many earlier ones failed, then returns the aggregate `SyncReport`. There is no
fail-fast path, no "abort remaining on error", and no exception that escapes a single action's
scope: the per-action body is wrapped so that a spawn error, non-zero exit, timeout, or unexpected
throw is captured as a `failures[]` row and execution continues with the next action.

For each action, sequentially (installs share npm caches and pi's settings file; parallelism buys
little and risks races):

```
report = { installed: [], failures: [] }

for action in plan.actions:                     # ALWAYS the full list — no early break
    try:
        cmd  = [process.execPath, resolveBundledPiCli(), "install", action.source]
        env  = { ...process.env,
                 PI_CODING_AGENT_DIR: effectivePiHomeKey(config),  # SAME derivation as the state key and the spawn path
                 GIT_TERMINAL_PROMPT: "0",      # never hang waiting on git credentials
                 GIT_SSH_COMMAND: "ssh -oBatchMode=yes",  # ssh prompts (host key, passphrase) fail fast too
                 npm_config_yes: "true" }       # never hang on an npm prompt
        result = spawn(cmd, env, timeout: 180 s)   # injectable seam; kills the process tree

        if result.exitCode == 0:
            state.offered[id]  = { installedSpec: action.source, atVersion, at: now }
            delete state.failures[id]                       # clears any prior failure record
            report.installed.push(id)
        else:
            recordFailure(id, classify(result), tail(result.stderr, 2 KB))
    except any error:                            # spawn failed, ENOENT, timeout, unexpected throw
        recordFailure(id, classify(error), String(error))
    finally:
        writeState()                             # after EVERY action, success or failure

return { ...report, at: now, outcome: derive(report) }
```

`recordFailure` increments `state.failures[id].attempts`, stores `reason`/`message`/`at`, and
appends a row to `report.failures` — it never records the identity in `offered`, so the entry is
naturally retried on the next sync trigger (no retry bookkeeping needed).

State is written after **each** action (not batched), so a crash or daemon kill mid-sync loses
neither the successes already achieved nor the failure diagnostics already gathered.

**Failure classification** (`ExtensionFailureReason`) — derived from exit code + stderr pattern,
used for actionable reporting rather than control flow:

| `reason` | Typical cause | Reported guidance |
|----------|---------------|-------------------|
| `not_found` | 404 — package doesn't exist, typo'd, unpublished, or a git repo/branch that isn't there | Curation bug on our side; user action won't help |
| `unauthorized` | 401/403 — private registry, missing/expired npm or git credential | User can fix by authenticating their registry |
| `network` | DNS failure, ECONNREFUSED, ETIMEDOUT, registry 5xx | Transient; retried automatically |
| `timeout` | Exceeded the per-package timeout (process tree killed) | Transient or a hung postinstall |
| `install_failed` | Non-zero exit for any other reason (build/postinstall failure, disk full, EACCES) | Message carries pi/npm's own stderr |
| `spawn_failed` | Could not launch the pi binary at all for this action | Environment problem |
| `unknown` | Unclassifiable | Message carries the raw error |

Classification is best-effort and **never** affects whether the sync continues, whether other
packages are attempted, or whether the entry is retried later — all three are unconditional.
`unknown` is a fully acceptable outcome; a misclassification is a cosmetic bug, not a functional one.

`resolveBundledPiCli()` returning `null` is the one whole-sync abort (nothing can be installed at
all): the report is `outcome: "skipped"` (broken environment — deliberately distinct from a healthy
`noop`) with a single clear log line, and no `failures[]` rows are
fabricated for packages that were never attempted.

### Lifecycle — when sync runs

1. **Daemon bootstrap** (production only): after the WS server is accepting connections,
   fire-and-forget with structured pino logging (`extensions-sync` child logger). Never blocks or
   delays readiness. This is what makes "pi-studio update ⇒ extensions update" true: a new release
   ships a new manifest, the daemon restart runs sync, newly curated entries get installed.
2. **`extension_packs_set_request`** (selection change).
3. **`pi-studio extensions sync`** (manual/headless).

No timers, no watchers, no retry loops — a failed sync is retried by the next trigger.

First-ever sync for a pi-home is **not consent-gated** (this is the "preinstalled" product
promise) but must be loud: one `info` log line per installed package, one `warn` line per failed
package (`identity`, `reason`, `message`), and a summary line naming the counts and every failed
source (`installed N of M recommended extensions into <agent dir>; K failed: <sources> (will retry
on next start) — disable via daemon.extensions.autoSync=false /
PI_STUDIO_EXTENSIONS_AUTOSYNC=false`). A partial sync logs at `warn`, never `error`: nothing is
broken and the daemon is fully usable. A one-time client-facing notice is deferred to the future UI
sibling scope (`preinstalled-extensions-ui.md`, not yet scoped — mirrors the `provider-auth-ui.md`
precedent).

### Concurrency

- In-process: `extensions-service` serializes syncs behind a promise-chain mutex; a sync requested
  while one runs awaits the running one's completion and then re-plans (config may have changed).
- Cross-process (two daemons sharing a pi-home): accepted as benign in v1 — `pi install` of the
  same spec twice is idempotent, pi's own settings writes go through pi, and our state file write
  is last-writer-wins over identical content. Logged at `debug`. An advisory lockfile is a
  documented future hardening, not built now.

## Data & Persistence

- **Reads** pi's global `settings.json` at `<effective agent dir>/settings.json` (planner input;
  read-only — tolerate absent file ⇒ empty `packages`). **Never writes it** — all mutations go
  through `pi install`.
- **Writes** `$PI_STUDIO_HOME/extensions-state.json` (schema above; atomic rename; 0600 not
  required — contains no secrets).
- `$PI_STUDIO_HOME/config.json` gains the `daemon.extensions` subtree via the normal config
  persistence path (written on `extension_packs_set_request`).
- Root `AGENTS.md` persistence-layout tree and env-var table, `packages/server/AGENTS.md`,
  `packages/cli/AGENTS.md`, and `packages/protocol/AGENTS.md` must be updated in the implementing
  sprint (docs-sync rule).

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| npm registry / network unreachable | Every package attempt fails with `reason: "network"`; each logged `warn`; none recorded as offered; all retried on next trigger. `outcome: "failed"`. Daemon fully functional throughout. |
| **One package fails, others succeed** | **The remaining actions all still run** — failure is isolated per package, there is no fail-fast. Successes are committed to state and reported in `installed`; the failure appears in `SyncReport.failures[]` with `reason` + `message` and as `status: "failed"` + `lastError` on the entry. `outcome: "partial"`. This is a normal end state, not a daemon error. |
| Several packages fail in one sync | **Every** failure gets its own `failures[]` row and its own `warn` line — the list is never truncated, sampled, or collapsed into a count. The summary line names all failed sources. |
| Curated source is 404 / unpublished / typo'd | `reason: "not_found"`; that entry alone is skipped forever-until-fixed (retried each sync, cheap); the rest of the pack installs normally. Signals a curation bug — the guard test catches malformed specs pre-release, but a package that is simply gone from the registry only shows up at runtime. |
| Private/authenticated registry, missing credential | `reason: "unauthorized"`; reported with guidance that the user's registry auth is needed; other packages unaffected. |
| Package installs but its own postinstall/build fails | `reason: "install_failed"` with pi/npm's stderr tail; not recorded as offered (so a later fixed version retries); other packages unaffected. |
| `resolveBundledPiCli()` → `null` | The only whole-sync abort — nothing is installable. `outcome: "skipped"`, one `warn`, no fabricated per-package failures; statuses report `pending`. (Reachable only in broken installs — server depends on `pi-coding-agent` directly.) |
| `autoSync: false` | Bootstrap and set-request never execute actions; `extensions sync` CLI still works as the explicit manual path; list RPC still reports statuses (dry-run planner needs no writes). |
| Unknown pack slug in config | Logged `warn`, ignored (newer-config-on-older-daemon tolerance). |
| State file unreadable/corrupt | **Fail-safe = do nothing**: treat every manifest identity as already offered (wrong-and-quiet beats wrong-and-mutating), log `error` once. Never reset/overwrite the corrupt file automatically. |
| `settings.json` unreadable (malformed JSON) | Skip sync for that pi-home with `warn` (`outcome: "skipped"`) — planner must not act on a reality it can't read; `pi install` would likely fail on it anyway. |
| User already has a curated identity installed before it was ever `offered` (pre-existing pin, object filter, or plain match) | Adopted, never installed over: `pi install` would let pi's own settings-merge rewrite it in place (version-insensitive identity match). Status `user_modified`, zero actions, exactly as if the entry had been offered and then edited. |
| User removed a curated extension via `pi remove` | `offered` remembers ⇒ never re-added. Status `user_removed`. |
| User hand-edited a curated entry (repin, object filters) | Never touched again. Status `user_modified`. |
| Entry `deprecated` in a later manifest | Existing installs untouched — deprecated entries produce no actions at all, only statuses; never offered to fresh pi-homes. |
| `daemon.piHome` / a provider env override is `~`-prefixed or relative | Expanded and resolved to an absolute path inside the single `resolvePiAgentDir` derivation (§ Public Contract — Effective pi-home key), so the state key, the executor's install env, and the agent's spawn env are always byte-identical. Never left for pi's own (narrower) `~`-only expansion to diverge from ours. |
| Fresh/second pi-home (`--pi-home`, `daemon.piHome` change) | No state under the new key ⇒ full offer set applies there; old key's state is retained untouched. |
| Docker daemon with ephemeral home | If `$PI_STUDIO_HOME` / pi-home aren't volume-mounted, each container recreate re-offers (harmless, re-installs into the fresh pi-home). Document the volume requirement in `docker/README.md`. |
| `pi update` / `pi update --extensions` run by the user | **Works, and is the intended update path** (tenet 3). Our unpinned npm sources are eligible (`!parsed.pinned`) and move to latest (an unpinned git source, if one is ever curated, would reset to its tracked default branch). The settings entry *string* is unchanged either way, so `installedSpec` still matches and sync stays a no-op — pi moves the code, we keep ownership bookkeeping. |
| Concurrent daemons, same pi-home | Benign race (see § Concurrency); logged. |
| Timeout on a hung `pi install` | Kill process tree, treat as failure, retry next trigger. |

## Dependencies

- Internal: `provider-registry.ts` (`piHomeEnv` — its path rule is extracted/exported as
  `resolvePiAgentDir` and shared, rather than adding a parallel derivation; the executor env and the
  state key MUST both come from it), `rpc-transport.ts` (`resolveBundledPiCli`),
  `daemon-config.ts`, `bootstrap.ts`, protocol package, client SDK, CLI `program.ts`/`cli-core.ts`.
- External: none new. (`@earendil-works/pi-coding-agent` is already a server dependency.)
- **Not** dependencies: web-client (UI is a future sibling scope), relay, mock provider
  (`dev-bootstrap` excluded by design).

## Acceptance Criteria

- [ ] Fresh daemon boot (production bootstrap, empty state, default config) installs every
      non-deprecated `core` entry into the effective pi-home's global settings via `pi install`;
      `pi list` (pi's own command) shows them; daemon readiness (WS accept) is not delayed by the
      sync (verify ordering in logs).
- [ ] Second boot with unchanged manifest performs zero installs and reports `outcome: "noop"`
      (idempotency; assert via executor spawn-seam call count in tests and log absence live).
- [ ] Guard test rejects any pinned source (`npm:foo@1.2.3`, `git:…@ref`), so the "user owns
      versions" tenet cannot be broken by a future edit.
- [ ] **Manual release check (live network — not part of the automated suite):** a curated
      extension installed unpinned is then moved by the user's own `pi update` (real `pi update`,
      real registry): the extension's installed version changes, the `settings.json` entry string
      does not, and the next sync still reports `installed` with zero actions — i.e. pi owns
      versions and sync stays out of the way.
- [ ] A hand-pinned entry and a `pi remove`d entry are both left alone forever (`user_modified` /
      `user_removed` observable via `extensions list`); neither ever plans an action again.
- [ ] An identity the user installed themselves **before** Pi-Studio's first sync (pinned, object
      form, or plain) is never installed over: zero `pi install` calls for that identity, status
      `user_modified`, and the user's `settings.json` entry is byte-unchanged after the sync.
- [ ] `pi-studio extensions select <pack>` (exercised with a test catalog containing a second pack —
      the shipped catalog starts with `core` only) persists the selection to `config.json`, installs
      that pack's entries, and leaves them in place when the pack is later deselected (no removals
      on deselect).
- [ ] `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` (and `daemon.extensions.autoSync: false`) ⇒ boot
      performs no installs and never spawns `pi`; `pi-studio extensions sync` still works.
- [ ] With `--pi-home <dir>` / `daemon.piHome`, sync operates on `<dir>/agent/settings.json` and a
      daemon-spawned `pi --mode rpc` session actually loads a curated extension (end-to-end proof
      that install location == agent load location — the path-parity guarantee).
- [ ] With `daemon.piHome` (or the provider env override) set to a `~`-prefixed or a relative path,
      `resolvePiAgentDir`'s result, the executor's `PI_CODING_AGENT_DIR`, and the spawned agent's
      `PI_CODING_AGENT_DIR` are all byte-identical and absolute (no test may use only already-
      absolute inputs, which cannot distinguish the fixed derivation from the broken one).
- [ ] **Partial-failure isolation (primary):** with an injected spawn seam where the 2nd of 4
      planned installs fails, the executor still attempts all 4; the 3 successes are present in
      `settings.json` and recorded in `offered`; the report is `outcome: "partial"` with exactly one
      `failures[]` row carrying `identity`/`source`/`pack`/`reason`/`message`; the failed entry
      reports `status: "failed"` + `lastError` in `extension_packs_list_response`; the next sync
      retries **only** the failed one (assert spawn-seam call count == 1).
- [ ] **Multiple failures are all reported:** 3 of 5 installs fail with three different causes
      (404, 401, timeout) ⇒ 3 distinct `failures[]` rows with `reason` `not_found`/`unauthorized`/
      `timeout`, 3 `warn` log lines, both successes committed, `outcome: "partial"`, CLI exits
      `EXIT_ERROR` while printing all three failures and the two successes.
- [ ] **A throwing/crashing install cannot abort the run:** a spawn seam that throws (not just
      exits non-zero) on one action still yields a complete report and all later actions attempted.
- [ ] Failure diagnostics survive a restart: after a partial sync, killing and rebooting the daemon
      still reports `failed` + `reason` for the failed entry (from `extensions-state.json`
      `failures`), and `attempts` increments on each subsequent failed sync.
- [ ] A previously failed package succeeding on a later sync clears its `failures` record and flips
      it to `installed` (no stale error surface).
- [ ] Offline boot (npm unreachable): daemon healthy, every failure logged and reported
      (`outcome: "failed"`), `offered` not polluted; next online sync completes the installs.
- [ ] `extension_packs_list_request` statuses match planner dry-run for all six statuses across the
      scenarios above; `extension_packs_set_request` with an unknown slug fails validation without
      side effects.
- [ ] Guard test enforces manifest invariants (parse, no version/ref pins, disjoint identities,
      stable slugs, `core` exists); planner unit tests cover every branch of `planEntry` with no
      I/O; executor tests use an injected spawn seam (no real pi, no network).
- [ ] A security-minded read of each shipped `core` package (project + maintainer — per § How
      updates actually reach users, the review is per-project, not per-version) is done and
      recorded before the first release that ships the manifest.
- [ ] Docs updated per docs-sync rule (root + server + cli + protocol AGENTS.md, persistence tree,
      env-var table, `docker/README.md` volume note).

## TODO(verify) — resolve against the live pi CLI while implementing

- [x] `pi install` writes the **global** settings file under `PI_CODING_AGENT_DIR` when that env
      var is set — **verified** (pi 0.84.1, task-001, 2026-08-13): `PI_CODING_AGENT_DIR=<dir> node
      <cli> install npm:pi-powerline-footer` writes `<dir>/settings.json` directly (not
      `<dir>/agent/settings.json` — `PI_CODING_AGENT_DIR` already *is* the agent dir, matching
      `piHomeEnv`'s `join(piHome, "agent")` derivation), containing
      `{"packages":["npm:pi-powerline-footer"]}`. The real `~/.pi/agent` was left untouched. No
      redirection mechanism beyond the env var is needed; the write-path story in § Public Contract
      stands as written.
- [x] `pi install <spec>` exit code and behavior when the identical spec is already installed —
      **verified** (pi 0.84.1, task-001): `pi install npm:pi-powerline-footer` run twice against the
      same `PI_CODING_AGENT_DIR` exits `0` both times (`added 1 package` then `up to date`);
      `settings.json` gains **no** duplicate entry (`{"packages":["npm:pi-powerline-footer"]}`
      unchanged after the second run). Confirms the benign-race stance.
- [x] `pi install` for an unpinned npm source resolves to the current latest — **verified** in
      `package-manager.js` (`updateNpmBatch` installs `<name>@latest` for unpinned specs;
      `shouldUpdateNpmSource` compares installed vs. latest).
- [x] Whether `pi install` requires a TTY for any code path — **verified no** (pi 0.84.1, task-001):
      `pi install <spec> < /dev/null` (stdin not a TTY) completes without hanging or prompting for
      both a successful and a failing install; the bundled `cli.js` contains zero occurrences of
      `readline`/`createInterface`/`inquirer`/`prompts(` — there is no interactive-prompt code path
      for `install` to hit, on any platform, not just "none observed". The executor needs no
      additional non-interactive flag beyond the three env-var guards already in the spec.
- [x] Whether `pi update` skips pinned specs — **verified** (pi 0.84.1,
      `package-manager.js:836-847`): pinned **npm** specs are excluded from update candidates
      (`if (!parsed.pinned)`); **git** sources are always included, with a ref fetching/resetting to
      that ref and no ref following the tracked default branch. This is the evidence behind tenet 3.
- [x] Whether `pi install` failures are distinguishable enough to classify — **partially verified**
      (pi 0.84.1, task-001): a 404 (nonexistent npm package) exits `1` and npm's own markers survive
      **verbatim** on stderr — `npm error code E404` and `npm error 404 Not Found - GET
      https://registry.npmjs.org/<pkg> - Not found` — so `classify()` can reliably match `not_found`
      on exit code + `E404`/`404 Not Found`. The `unauthorized` (401/403) case stays `[ ]` — task-001
      has no private-registry package to probe against (the curated `core` set is all public), and a
      real `E401`/`E403` needs a registry the runner lacks credentials for. Fallback (per this task's
      own notes, carried into task-005): `classify()` treats `unauthorized` as best-effort pattern
      matching on `401`/`403`/`E401`/`E403` in stderr with no live verification; a miss collapses to
      `install_failed`/`unknown`, which is acceptable — classification is cosmetic, never control
      flow (design tenet 5 / § Executor).
- [x] Whether a failed `pi install` can leave a partially-written entry in `settings.json` —
      **verified no** (pi 0.84.1, task-001): a failing install into a **fresh** `PI_CODING_AGENT_DIR`
      leaves no `settings.json` at all; a failing install against a directory with an **existing**
      `settings.json` (one prior successful install) leaves that file byte-identical — no entry is
      ever added for the failed package, partial or otherwise. The planner's `user_removed`/`pending`
      distinction needs no revision: an identity is either fully present (successful install) or
      fully absent (failed install, or never attempted).
- [x] Initial `core` pack contents — **decided** (see the manifest above): 4 unpinned npm sources.
      `@juicesharp/rpiv-ask-user-question` and `@luxusai/pi-hindsight` were in an earlier draft and
      were **cut before the manifest ever shipped** — deleted outright rather than tombstoned with
      `deprecated: true`, since that flag exists for entries already offered to real pi-homes and
      would otherwise leave dead data and a permanent `deprecated` row in the CLI/UI for something no
      user ever received. Re-adding either later is a pure-data edit stamped with the then-current
      `addedIn`. The per-entry security read (pi's own docs: packages run with full system access,
      and every entry is third-party-maintained) is a release-blocking acceptance criterion above,
      not a side note here.
