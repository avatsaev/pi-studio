# Feature — Self-Update (in-UI daemon update + restart)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: `architecture/daemon-bootstrap.md` (startup, PID lock, shutdown), `features/cli.md`
> (`pi-studio update`, `daemon start/stop/restart`), `features/preinstalled-extensions.md`
> (`pi update --extensions`, the bundled-pi spawn seam), `architecture/websocket-protocol.md`
> (append-only RPC + capability gating), `features/provider-auth-ui.md` § Settings dialog shell
> (the `SETTINGS_CATEGORIES` registry this feature extends), `features/connection-resilience.md`
> (the reconnect loop a restart relies on)

## Purpose

Let a user update Pi-Studio **from the web UI** instead of finding a terminal: an "update available"
indicator in the main toolbar, a CTA that opens **Settings → Update**, and a single action that
installs the new npm package, updates already-installed Pi extensions, and **restarts the daemon
automatically** — with an explicit warning that running agents and open terminals will be
interrupted.

Three real defects are fixed as a precondition, not as a bonus:

1. `server_info.version` is a hardcoded placeholder everywhere: the literal `"1.0.0"` twice in
   `bootstrap.ts` (direct-WS deps at :688, relay handshake at :792) and `"0.1.0-dev"` in
   `dev-bootstrap.ts:344`. No client can learn the daemon's real version today.
2. `startDaemon().close()` never enumerates live agents, so `pi --mode rpc` children (spawned
   non-detached, stdio piped) are **not killed on shutdown** — every existing restart path
   (`pi-studio daemon restart`, Ctrl-C, desktop quit) can leave orphaned agent processes holding
   session files. A self-update restart would inherit that bug and make it routine.
3. `packages/desktop/AGENTS.md` asserts the daemon removes its PID lock on shutdown. It does not —
   `writePidLock` is write-only and nothing deletes `pi-studio.pid`.

## Ground truth (verified against the repo, 2026-08-26)

These facts drive the design; do not re-derive them from memory.

### Versioning & distribution

- Every workspace package carries **one aligned version** (`0.0.100` at time of writing), rewritten
  by `scripts/publish.sh`; the root `package.json` deliberately has **no** `version` field.
  `@av-pi-studio/cli` is the user-facing global install (`bin: { "pi-studio": "dist/cli.js" }`) and
  it depends on `@av-pi-studio/server`, so **updating the CLI updates the daemon**. This lockstep is
  the invariant that makes a single-package update meaningful.
- `SERVER_VERSION` already exists — but only inside `packages/server/src/extensions/curated-packs.ts`
  (`createRequire(import.meta.url)("../../package.json").version`), used solely for extensions-sync
  bookkeeping (`atVersion`). It is never wired to the wire protocol.
- `serverInfoPayloadSchema.version` is already an **optional string on the wire**
  (`packages/protocol/src/messages.ts:60-68`). No schema change is needed to report a real version,
  and **no consumer reads it today** (grep: zero non-test references), so correcting the value
  cannot break a client.
- `packages/cli/src/update-control.ts` is a working, unit-tested update engine:
  `npm view <pkg> version` (`execFile`, 15 s timeout, **all errors → `null`, never throws**),
  `npm install -g <pkg>@<version>` (`execFile`, 120 s timeout), `installWithStaleStagingRetry`
  (npm's `ENOTEMPTY: … rename '…' -> '<staging>'` self-heal, `maxRetries = 3`), and
  `compareVersions` — **numeric `x.y.z` only, not semver** (no prerelease/build metadata), justified
  by the publish pipeline only ever emitting plain `major.minor.patch`.
- `packages/cli/src/update-commands.ts` (`pi-studio update [--check]`) installs and then
  **unconditionally** runs `pi update --extensions` via `runPiProxy`, whose failure does not abort
  the run (exit code is `cliExit || extensionsExit`). It **never touches the daemon**.

### Daemon lifecycle

- `startDaemon(opts): DaemonHandle` (`packages/server/src/daemon/bootstrap.ts:220`) —
  `opts = { host, port, home?, configPath?, serverId?, logger?, extensionsInstallSpawn? }`;
  handle = `{ httpServer, serverId, home, provider, logger, close() }`.
- The actual bind comes from `opts.host`/`opts.port`, resolved in `daemon/main.ts` from
  `PI_STUDIO_LISTEN ?? "0.0.0.0:6767"` — **not** from `config.json`'s `daemon.listen` (a pre-existing
  inconsistency this feature must not depend on). A restart therefore has to carry the *effective*
  listen forward, not re-read config.
- `close()` (`bootstrap.ts:887-894`) does: `terminalManager.killAll()` (tree-kills PTY trees),
  `fileWatchService.close()`, `relayHandle?.close()`, `await wsHandle.close()`, `httpServer.close()`.
  It does **not** touch agent sessions and does **not** delete the PID lock.
- `AgentSession` already exposes `interrupt()` and `close()`
  (`agent/provider-contract.ts:236-237`); the Pi adapter's `close()` tree-kills its child
  (`providers/pi/rpc-transport.ts:256-261`). `AgentManager.listAll()` enumerates every tracked agent
  with its live `session`. A correct sweep is therefore expressible with existing API only.
- Shutdown is triggered exclusively by `SIGINT`/`SIGTERM` handlers in `daemon/main.ts:36-37`
  (`await handle.close(); process.exit(0)`).
- `writePidLock(home)` (`bootstrap.ts:179-186`) writes `String(process.pid)` as **plain text**
  (not JSON). Nothing in `packages/server` reads it, checks staleness, or refuses a second daemon;
  `packages/cli/src/daemon-control.ts` is the only reader (`readDaemonPid`).
- CLI restart = `stopDaemon()` (fire-and-forget SIGTERM, **no wait for exit**) immediately followed by
  `ensureLocalDaemonAndPair()`, which *probes health first* and skips starting if something still
  answers. **No wait-for-process-exit primitive exists anywhere in the repo**, so the existing
  restart carries a genuine stop/start race.
- `subprocessStarter` (`cli/src/daemon-control.ts`) is the detached-spawn precedent:
  `spawn(process.execPath, ["--input-type=module", "-e", code], { detached: true, stdio: "ignore", env })`
  where `code` inlines an **absolute** `file://` URL resolved via
  `import.meta.resolve("@av-pi-studio/server")` — deliberately not a bare specifier, because npm
  nesting under a global install breaks bare resolution in a `node -e` child.
- `waitForDaemon(runtime, host, port, { attempts = 40, delayMs = 150 })` polls
  `GET /api/health` (1500 ms per probe). `/api/health` answers `{"status":"ok"}` and is exempt from
  both the Host allowlist and auth (`http/http-server.ts:62-68`).
- **There is no `setInterval` anywhere in `packages/server/src`.** `ScheduleService.tick()` exists but
  production code never drives it from a timer. A recurring update check is the daemon's *first*
  background timer and must own its own `clearInterval` in `close()`.

### Broadcast & RPC plumbing

- `broadcast(sessions, message)` (`bootstrap.ts:248`) wraps in a `session` envelope and sends to each
  session, swallowing per-session errors; `getActiveSessions()` merges direct-WS **and relay**
  sessions. `terminal-rpc.ts`'s `terminals_update` is the canonical "push to every client
  unconditionally, no subscribe RPC" precedent — exactly the shape this feature needs.
- `HandlerRegistry.register(type, handler)` / `registerAlias(alias, canonical)`;
  `RpcHandlerContext = { session, message, requestId? }` — handlers close over services, `broadcast`,
  and `logger` at registration time. Registration blocks: `bootstrap.ts:289+`, `dev-bootstrap.ts:118+`.
- `SERVER_FEATURES` + `SERVER_FEATURE_COMPAT` in `packages/protocol/src/client-capabilities.ts`;
  every new flag needs both entries plus the `client-capabilities.test.ts` key list.

### Pi CLI reuse

- `resolveBundledPiCli()` (`agent/providers/pi/rpc-transport.ts:66-85`) resolves
  `@earendil-works/pi-coding-agent`'s `dist/cli.js` via `import.meta.resolve` with a `node_modules`
  upward walk as fallback; returns `null` if unresolvable.
- `extensions/sync-executor.ts` spawns `[process.execPath, cli, "install", <source>]` through the
  injectable `InstallSpawn` seam (`{ command, env, timeoutMs } → { exitCode, stderr, timedOut? }`),
  `INSTALL_TIMEOUT_MS = 180_000`, stderr tail capped at `STDERR_TAIL_MAX = 2048`, with a
  string-matching failure classifier (`timeout` / `not_found` / `unauthorized` / `network` /
  `install_failed` / `spawn_failed` / `unknown`). If the CLI is unresolvable it returns `skipped`
  rather than falling back to a PATH `pi`. **`pi update --extensions` is reachable through this exact
  seam** with different argv.
- Nothing server-side has ever queried the npm registry over HTTP; there is no fetch wrapper. The
  only npm interaction is subprocess-based.

### Docker & install provenance

- `docker/daemon.Dockerfile` is a **workspace-checkout build**, not a global npm install: it
  `npm ci`s the monorepo, builds `dist/`, and runs `CMD ["node", "packages/server/dist/daemon/main.js"]`
  from `/repo` with `PI_STUDIO_HOME=/data`, `PI_STUDIO_LISTEN=0.0.0.0:6767`. `@av-pi-studio/cli` is
  **not installed in the image at all**.
- Consequently a container's on-disk layout is indistinguishable from a repo checkout by path
  inspection alone, and `npm i -g` inside it would be both useless (ephemeral layer) and wrong.
- **No install-kind concept exists anywhere in the codebase**; `npm root -g` / `npm prefix -g` are
  used nowhere.

### Web client

- `SETTINGS_CATEGORIES` (`features/settings/SettingsDialog.tsx`) is the extension point:
  `{ id, label, icon, component (lazy), available: (caps) => boolean }`, currently one entry
  (`providers`). The dialog takes `{ open, onOpenChange }` only — **no `initialCategory` prop** — and
  holds the selected id in local state seeded from `categories[0]`.
- The Settings **gear button in `ConnectionBar.tsx` renders only when `providerAuthCapable`**
  (`Boolean(serverInfo?.features?.["providerAuth"])`). An always-reachable update CTA requires
  changing that gate.
- Toolbar brand/version text uses `__BRAND_TITLE__` / `__APP_VERSION__`, Vite `define`s from
  `vite.config.ts` — the **web bundle's own** version, unrelated to the daemon's.
- Push routing is decentralized: one `client.connection.onSessionMessage(...)` subscription per hook
  with a local type guard (`use-checkout-status.ts` is the reference). There is no central dispatcher.
- Reconnect is automatic: `ReconnectionManager` (`packages/client/src/reconnect.ts`) owns the
  exponential backoff and takes an **injectable** `setTimer`/`clearTimer` pair defaulting to plain
  `setTimeout`; the Worker-backed timer implementation that keeps a throttled background tab honest
  is `packages/web-client/src/lib/connection/worker-timers.ts`, injected at
  `connection-store.ts:109-110` (`packages/client` knows nothing about Workers).
  `DaemonClient.connect()` re-sends the full `hello` every time, so `serverInfo`/features rehydrate
  on their own. `connection-presentation.ts` has no distinct "reconnecting" state — a reconnect
  renders as `connecting`.
- Attention signalling reuses `StatusDot` (`pulse` modifier is box-shadow-only, layout-neutral);
  toasts are `useToastStore.getState().show(content, { variant, durationMs })` with
  `durationMs: null` = sticky; screen-reader announcements go through `speak()` only.
- Busy counts are available client-side: running agents = `session-store` entries with
  `status === "running"` (the store mirrors the daemon-wide `list_agents` projection);
  terminals must come from the daemon (`list_terminals_request` / `terminals_update`), **not** from
  `tab-store`, which only knows terminals this browser opened.
- `packages/client`: `PiStudioClient` wraps one `DaemonClient` (flat methods + a few scoped handles),
  RPCs go through `daemon.request<T>(type, params)` (own `randomId()`, `rpcTimeoutMs` default
  30 s), pushes through `daemon.onSessionMessage` + a local type guard, capability gating through
  `daemon.hasFeature(flag)`. `AgentUiController` is the convention for "resync on every transition to
  `open`, guarded by a generation counter".

## Non-goals

- **No Electron auto-update.** `features/desktop-app.md`'s `electron-updater` flow is a different
  axis (app binary + release channels). A desktop-embedded daemon reports an install kind whose
  `canApply` is false and defers to the app updater.
- **No standalone "restart daemon" button.** Restart exists only as the tail of an update.
- **No downgrade/rollback, no channel selection (`latest` only), no changelog fetching.**
- **No update of the `pi-studio ui` static-asset server or a remotely hosted SPA** (nginx,
  `app.molagent.ai`). Those are separate processes/deployments; the UI only *reports* a version
  mismatch (§ Web client).
- **No supervisor.** There is no systemd/launchd unit in this repo; the daemon owns its own respawn.
- **No semver semantics.** `compareVersions` stays numeric `x.y.z`, matching the publish pipeline.

## Install kinds — the gate

Detected once at boot, reported on the wire, and the sole thing that decides whether the apply
button exists.

| Kind | How it is detected | `canApply` | UI |
|---|---|---|---|
| `npm-global` | server package root is inside `npm root -g` | **true** | "Update & restart" button |
| `docker` | `PI_STUDIO_INSTALL_KIND=docker`, baked into `docker/daemon.Dockerfile` | false | read-only panel: `docker compose pull && docker compose up -d` |
| `source` | server package root is `<repo>/packages/server` under a root `package.json` declaring `workspaces` | false | read-only panel: `git pull && npm run build && npm start` |
| `unknown` | anything else (project-local `node_modules`, `npx`, unresolvable) | false | read-only panel: "update the way you installed it" |

`PI_STUDIO_INSTALL_KIND` (any of the four values) always wins, so a packager can declare provenance
explicitly. It is read directly by the update module rather than added to `persistedConfigSchema`:
it is **build-time provenance, not user configuration**, and a `config.json` field would invite users
to lie about it and then fail an `npm i -g` they can't perform.

```
detectInstallKind(env, selfUrl, npmRootG):
    if env.PI_STUDIO_INSTALL_KIND in {npm-global, docker, source, unknown}: return it
    pkgRoot = resolve(dirname(fileURLToPath(selfUrl)), "../..")   # <server-pkg>/dist/update → <server-pkg>
    if pkgRoot contains a "node_modules" segment:
        g = npmRootG()                       # `npm root -g`, cached for process lifetime
        return (g and pkgRoot startsWith g) ? "npm-global" : "unknown"
    root = pkgRoot/../..                     # candidate monorepo root
    return (root/package.json declares "workspaces") ? "source" : "unknown"
```

Docker is a workspace checkout on disk, so **the env marker is load-bearing**, not a convenience:
without it a container reports `source`, which is merely wrong-flavoured advice rather than a
dangerous action, but still advice the user cannot act on.

## Public contract

### Server feature flag

`SERVER_FEATURES.selfUpdate` (+ `SERVER_FEATURE_COMPAT` entry + `client-capabilities.test.ts` key
list). It means **"this daemon speaks the `update_*` family"** — *not* "this daemon can update
itself". Capability and permission are deliberately separate: every daemon advertises the flag so
the read-only panel and the indicator work everywhere (user decision), and `canApply` in the payload
carries the permission.

### New RPCs (flat snake_case, real `messages.ts` schemas, all `.passthrough()`)

| RPC | Inputs | Outputs | Errors |
|---|---|---|---|
| `update_check_request` | `refresh?: boolean` | `update_check_response { payload: UpdateStatus }` | none — a failed registry lookup is reported *inside* `UpdateStatus.lastCheckError`, never as `rpc_error` |
| `update_apply_request` | `targetVersion?: string` | `update_apply_response { payload: { ok, updateId?, error? } }` | `rpc_error` only for malformed input; refusals answer `ok: false` + `error` |

`refresh: true` forces a registry lookup (bypasses the cache); omitted/false answers from cache.
`targetVersion`, when present, **must equal the cached `latestVersion`** — a stale browser tab must
not be able to pin an arbitrary version, and an absent value means "whatever the cache says now".

### New pushes (real union members, broadcast to `getActiveSessions()`)

| Push | When | Payload |
|---|---|---|
| `update_status` | on every status change (boot check, 6 h check, manual refresh, apply start/failure) **and** to each session right after `server_info` | `UpdateStatus` |
| `update_progress` | on every apply stage transition | `UpdateProgress` |

These get **real schemas and union membership** — the `agent_ui_*` treatment (`messages.ts:1409+`),
not the `sessionMessageBaseSchema` passthrough treatment used by `checkout_status_update` /
`file_changed` / `provider_auth_flow_event`, and emphatically not `terminals_update`'s treatment:
that one has **no protocol schema at all** (zero matches in `packages/protocol/src`; it is a bare
fan-out object built inline in `terminal/terminal-rpc.ts`, which `bootstrap.test.ts:701` documents as
such). `terminals_update` is the precedent for the *delivery shape* — unconditional broadcast to
every session, no subscribe RPC — and deliberately **not** the precedent for the typing. Daemon-wide
state that drives a persistent cross-client indicator and gates a destructive, irreversible action
earns a validated schema; a client must not have to hand-roll a type guard to decide whether it may
offer a button that restarts the host.

```ts
// UpdateStatus
{
  packageName: string;        // "@av-pi-studio/cli"
  currentVersion: string;     // SERVER_VERSION — the running daemon, never a literal
  latestVersion?: string;     // absent when never checked or check failed
  updateAvailable: boolean;   // compareVersions(latest, current) > 0
  installKind: string;        // open string: npm-global | docker | source | unknown
  canApply: boolean;          // installKind === "npm-global" && !applyInProgress
  autoCheck: boolean;         // whether the 6 h timer is running
  checkedAt?: WireTimestamp;
  lastCheckError?: string;
  applyInProgress: boolean;
}

// UpdateProgress
{
  updateId: string;           // daemon-minted UUID, one per apply attempt
  stage: string;              // open string, see below
  targetVersion: string;
  ok?: boolean;               // present only on a terminal stage
  message?: string;           // human-readable detail; stderr tail on failure (≤2048 chars)
  at: WireTimestamp;
}
```

`stage` is an **open string**, never a narrowed enum (append-only rule — a later daemon must be able
to add a stage without an old client rejecting the frame). Documented values, in order:
`starting` → `installing_studio` → `updating_extensions` → `restarting`, plus terminal `failed`.
`installKind` is likewise an open string, following `EntryStatus`/`SyncOutcome` precedent.

### Extended existing surfaces (all append-only)

| Surface | Addition | Why |
|---|---|---|
| `server_info.version` | real `SERVER_VERSION` in **all three** handshake sites (`bootstrap.ts:688` direct-WS `deps.version`, `bootstrap.ts:792` relay, `dev-bootstrap.ts:344`) | replaces the `"1.0.0"`/`"0.1.0-dev"` placeholders; the UI's version display and mismatch hint depend on it |
| `GET /api/health` | `{ status: "ok", version: SERVER_VERSION }` | lets the restart waiter *verify the new version booted*, not merely that something answers; unauthenticated by design already, and a version string is not a secret |
| `startDaemon().close()` | agent-session sweep + `clearInterval` for the check timer + PID-lock removal | correctness for **every** shutdown path, not just update (user decision) |
| `packages/server` exports | new `src/version.ts` (`SERVER_VERSION`, `PACKAGE_NAME`), consumed by `curated-packs.ts` instead of defining it | one version source; `curated-packs.test.ts`'s dist-resolution assertion moves with it |
| Client SDK | `checkForUpdate(refresh?)`, `applyUpdate(targetVersion?)`, `onUpdateStatus(cb)`, `onUpdateProgress(cb)`, `selfUpdateAvailable()` | mirrors the provider-auth/extension-UI method+subscription+capability triple |
| CLI | `pi-studio update` gains the restart step; `update-control.ts` becomes a thin adapter over the server's engine | one implementation (user decision) |

### Config & environment

| Key | Default | Meaning |
|---|---|---|
| `daemon.update.autoCheck` (config.json) / `PI_STUDIO_UPDATE_AUTOCHECK` (env, wins) | `true` | `false` ⇒ no boot check, no 6 h timer; `update_check_request { refresh: true }` still works |
| `PI_STUDIO_INSTALL_KIND` | unset (detect) | `npm-global` \| `docker` \| `source` \| `unknown`; baked as `docker` in `docker/daemon.Dockerfile` |

Mirrors the `daemon.extensions.autoSync` / `PI_STUDIO_EXTENSIONS_AUTOSYNC` precedent exactly. The
6 h interval is a module constant, injectable through service deps for tests — **not** an env var
(nobody needs to tune it, and an env var would need validation nobody would read).

### Engine placement (layering decision)

The engine moves to **`packages/server/src/update/`**; `packages/cli` imports it. The daemon cannot
import from `cli` (the dependency runs the other way), and duplicating the ENOTEMPTY self-heal is
exactly the kind of hard-won fix that gets repaired in one copy only. This is a **third** documented
narrow exception in `packages/cli/AGENTS.md`, alongside the extensions-planner and auth-engine ones:
`cli` imports **pure/process-control modules** from `server`, never daemon lifecycle.

```
packages/server/src/update/
  install-kind.ts     detectInstallKind, npmRootGlobal (cached)
  npm-registry.ts     npmLatestVersion (seam), compareVersions, staleStagingDirFrom,
                      installWithStaleStagingRetry, npmGlobalInstaller (seam)
  process-wait.ts     waitForProcessExit(pid, { timeoutMs, pollMs, alive? })
  restart.ts          serverEntryPath(), spawnRestartWaiter()
  update-service.ts   UpdateService: cache, timer, single-flight, apply pipeline
  update-rpc.ts       registerUpdateHandlers(registry, deps)
```

`packages/cli/src/update-control.ts` keeps its `UpdateRuntime` seam (its command tests inject it) but
re-exports the server implementations; the pure-function unit tests (`compareVersions`,
`staleStagingDirFrom`, `installWithStaleStagingRetry`) move to `packages/server`, while
`update-commands.test.ts` stays and gains restart assertions.

## Behavior & algorithms

### Version truth

```
SERVER_VERSION = createRequire(import.meta.url)("../package.json").version   # src/version.ts
```

Same mechanism as today's `curated-packs.ts` (valid from both `src/` and `dist/`), just relocated so
`bootstrap.ts` and `http-server.ts` can use it without importing an extensions module. Because the
publish pipeline keeps every package on one version, `SERVER_VERSION` is a faithful stand-in for the
installed `@av-pi-studio/cli` version, which is what the registry is asked about.

### Check

```
on boot (after the WS server is listening, fire-and-forget like extensions sync):
    if autoCheck: void check("boot")
    if autoCheck: timer = setInterval(() => void check("periodic"), 6h); timer.unref()

check(reason):
    if applyInProgress: return                 # never move the target mid-apply
    latest = npmLatestVersion(PACKAGE_NAME)    # `npm view` — resolves null on ANY failure
    if latest is null:
        status.lastCheckError = "could not reach npm"; status.checkedAt = now
    else:
        status.latestVersion = latest
        status.updateAvailable = compareVersions(latest, SERVER_VERSION) > 0
        status.lastCheckError = undefined; status.checkedAt = now
    if status changed materially: broadcast(getActiveSessions(), {type:"update_status", ...status})
```

`npm view` (not an HTTPS fetch to `registry.npmjs.org`) because it is the existing, tested
implementation, it honours the host's `.npmrc` — registry mirror, proxy, private-registry auth — and
a daemon that only asks every 6 hours does not need to avoid a subprocess. The check is a **network
call in a spawned process**, so it is fire-and-forget with its own 15 s timeout and cannot delay boot
or reject into the RPC path.

`timer.unref()` matters: an un-unref'd 6 h interval would keep the event loop alive and stop the
process from exiting naturally. `close()` must still `clearInterval` it — unref only affects exit,
not the callback firing during a shutdown window.

### Apply pipeline

```
apply(session, targetVersion?):
    if not canApply:            return {ok:false, error:"this installation cannot self-update (<kind>)"}
    if applyInProgress:         return {ok:false, error:"an update is already in progress"}
    target = targetVersion ?? status.latestVersion
    if target is undefined:     return {ok:false, error:"no known target version — check first"}
    if targetVersion and targetVersion != status.latestVersion:
                                return {ok:false, error:"stale target version — re-check"}
    if compareVersions(target, SERVER_VERSION) <= 0:
                                return {ok:false, error:"already up to date"}

    applyInProgress = true; updateId = uuid()
    broadcast update_status                       # every client greys out its button
    answer {ok:true, updateId}                    # the RPC returns HERE; the rest is push-driven
    void runApply(updateId, target)

runApply(updateId, target):
    progress(starting)
    progress(installing_studio)
    try: npmGlobalInstall(PACKAGE_NAME, target)   # 120s, ENOTEMPTY self-heal ×3
    catch e:
        progress(failed, ok:false, message: classify(e))
        applyInProgress = false; broadcast update_status; return       # NOT restarted

    progress(updating_extensions)
    cli = resolveBundledPiCli()                   # resolved AFTER install → the NEW pi
    if cli: spawn([node, cli, "update", "--extensions"], 180s)   # failure ⇒ warn only
    else:   progress message notes the skip

    progress(restarting)
    spawnRestartWaiter({ oldPid: process.pid, entry: serverEntryPath(), env: carriedEnv(), home })
    await sleep(FLUSH_MS)                          # let the last push reach the sockets
    await gracefulShutdown()                       # the same close() every path uses
    process.exit(0)
```

Three ordering rules, each load-bearing:

1. **The RPC answers before the work starts.** The apply takes minutes and ends by killing the
   socket; a long-lived request would just hit `rpcTimeoutMs` (30 s) and lie. Progress is a broadcast
   so *every* client — including one that connected mid-update — sees the same story.
2. **Extensions run after the npm install, never before.** The point is to update extensions with the
   *new* bundled pi, and `resolveBundledPiCli()` is an `existsSync` check performed at call time, so
   post-install resolution naturally lands on the new file.
3. **Nothing else happens between install and restart.** Replacing the package directory under a
   running process means any *later* lazy `import()` would load new-version code into an old-version
   process. The window is closed by restarting immediately; the apply path itself performs no dynamic
   imports after the install, and the extensions step is a child process (which *should* be new).

An install failure explicitly **does not** restart: the old version is still running and working, so
a restart would only add an outage to a failure. An extensions failure **does** continue: extension
sync re-runs on the next boot anyway (`features/preinstalled-extensions.md`), so blocking a
successful daemon update on it would be strictly worse.

### Restart handoff

The daemon cannot outlive itself, so a third process bridges the gap. It is spawned **before**
shutdown and waits for the old PID to disappear — which is what makes the handoff race-free, unlike
the CLI's existing stop-then-probe restart.

```
spawnRestartWaiter({oldPid, entry, env, home}):
    code = `<inline ESM: waiter body below>`
    spawn(process.execPath, ["--input-type=module","-e",code],
          {detached:true, stdio:"ignore", env}).unref()

# waiter body — a fresh process, so it reads the NEW code off disk
waitForProcessExit(oldPid, timeoutMs: 30_000, pollMs: 200)   # process.kill(pid,0) → ESRCH = gone
for attempt in 1..3:
    child = spawn(node, [resolveEntry()], {detached:true, stdio:"ignore", env}); child.unref()
    if pollHealth(host, port, attempts:40, delayMs:150):     # GET /api/health
        log({ from, to: health.version }); exit 0
    log(attempt failed); sleep(1s)
log("daemon did not come back; run `pi-studio daemon start`"); exit 1

resolveEntry():
    if exists(entry): return entry                       # pre-install path, normally still valid
    g = npmRootGlobal()                                  # layout changed between versions
    try g/@av-pi-studio/server/dist/daemon/main.js
    then g/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js
    else fail loudly
```

- **`entry` is `serverEntryPath()`**, derived from `fileURLToPath(import.meta.url)` inside the update
  module (`…/dist/update/restart.js` → `…/dist/daemon/main.js`), computed **before** the install and
  re-validated by the waiter. `process.argv[1]` is unusable: the CLI starts the daemon with
  `node -e`, so there is no script path.
- **The env is carried, not re-derived**: `PI_STUDIO_HOME`, `PI_STUDIO_LISTEN` (set to the daemon's
  *effective* `host:port`, since `config.json`'s `daemon.listen` is not what binds),
  `PI_STUDIO_PI_HOME`, and the rest of `process.env`. Re-deriving would silently rebind
  `0.0.0.0:6767` → `127.0.0.1:6767` and cut off every remote client.
- **The waiter is a self-contained inline `-e` script — it MUST NOT `import` anything from the
  package.** It is the one piece of code that has to survive the package directory being swapped out
  from under it: a `node <dist>/update/restart-waiter.js` variant would execute *whatever the new
  version happens to put at that path* (or nothing, if the file was renamed), which is precisely the
  fragility the waiter exists to absorb. It needs only `child_process`, `http`, `fs`, and
  `process.kill` — all built-ins.
- **The waiter appends to `$PI_STUDIO_HOME/logs/update-restart.log` itself** (`fs.appendFileSync`).
  It is spawned `stdio: "ignore"`, so anything it does not write to that file is lost — and a failed
  restart with no diagnostics is the single worst outcome this feature can produce.
- The waiter deliberately does **not** reuse `pi-studio daemon start`: that path defaults to
  `127.0.0.1:6767`, prints a pairing QR, and probes-then-skips, none of which is right here.

### Shutdown correctness (fixes every path, not just update)

```
close():                                  # bootstrap.ts
    clearInterval(updateCheckTimer)
    for m in agentManager.listAll():      # NEW — tree-kills each `pi --mode rpc` child
        try await m.session?.close() catch { log }
    terminalManager.killAll()
    fileWatchService.close()
    relayHandle?.close()
    await wsHandle.close()
    await httpServer.close()
    rm(join(home,"pi-studio.pid"))         # NEW — best-effort, matches desktop's stated invariant
```

The agent sweep is bounded (a per-session timeout, then move on) so one wedged provider cannot hang
shutdown forever — a restart that never restarts is worse than an orphan. PID-lock removal makes
`packages/desktop/AGENTS.md`'s documented invariant true instead of aspirational, and prevents a
stale PID from pointing the CLI's `stop` at an unrelated recycled process.

### Guards

- **Single-flight.** One in-flight apply per daemon, enforced by `applyInProgress` (also mirrored on
  the wire so every client's button greys out). A second request answers `ok: false`.
- **No auth expansion.** The `update_*` handlers are ordinary session RPCs: whoever passed
  `PI_STUDIO_PASSWORD` (or the relay's E2EE pairing) already controls agents that can run arbitrary
  shell commands on this host. An update is strictly *less* privileged than what the caller can
  already do, so no new permission tier is introduced.
- **Relay clients may apply.** Updating your home daemon from a phone is a headline use case, not an
  edge case. The relay session is in `getActiveSessions()`, so it receives progress like any other —
  and then loses the socket like any other.

## Web client

### Toolbar indicator

- A CTA pill next to the Settings gear in `ConnectionBar`: `↑ v0.0.101` (label uses the target
  version, not the word "new"), with `StatusDot`'s existing `pulse` modifier for the attention
  affordance. Click → opens Settings **on the Update category**.
- Rendered only when `updateAvailable` is true. Never when merely `applyInProgress` on someone else's
  screen — that case shows in the panel and via toast.
- **The gear's visibility gate changes**: today it is `providerAuthCapable`; it becomes "at least one
  settings category is available". Otherwise a daemon without `providerAuth` would have an update
  panel with no way to reach it.
- `SettingsDialog` gains an `initialCategory?: string` prop (it currently has none), and `ui-store`'s
  `openSettings()` gains an optional category argument — the minimum change that makes the CTA land
  on the right panel.
- One `speak()` announcement when the indicator first appears, per the announcer-store rule that
  `speak()`/`clearWhenIdle()` are the only sanctioned writers.

### Settings → Update panel

New `SETTINGS_CATEGORIES` entry (`id: "update"`, lazy-loaded panel), `available: (caps) => caps.selfUpdate`
where `caps.selfUpdate = Boolean(serverInfo?.features?.["selfUpdate"])`.

| State | Content |
|---|---|
| Idle | daemon version, UI version, latest version, install kind, "last checked" + Refresh |
| Update available, `canApply` | the above + **Update & restart** button |
| Update available, `!canApply` | the above + copyable per-kind instructions (§ Install kinds) and why (e.g. "this daemon runs from a git checkout") |
| Check failed | `lastCheckError` inline + Retry; never a blocking error state |
| Confirm | modal: "N agents running, M terminals open — they will be interrupted", target version, Cancel / Update |
| Applying | stage list with the current `update_progress` stage; buttons disabled; sticky toast |
| Restarting | "daemon restarting…" — the reconnect loop drives this; the socket is expected to drop |
| Done | "updated to v0.0.101" + **Reload** button + version-mismatch hint if the UI bundle differs |
| Failed | `stage: failed` message (stderr tail), Retry, and a note that the daemon was **not** restarted |

### Confirm counts

Running agents come from `session-store` (`status === "running"`), which mirrors the daemon-wide
`list_agents` projection. Terminals come from the **daemon** (`list_terminals_request` on opening the
confirm modal, refreshed by `terminals_update`), *not* from `tab-store` — `tab-store` only knows
terminals this browser opened, so a second client's terminals would be silently uncounted and the
warning would understate the damage.

### Restart & reconnect

The socket dies mid-update by design. `ReconnectionManager` already handles it with backoff and
re-sends `hello`, so no new transport work is needed. What is needed:

- A generation-guarded resync on every transition to `open` (the `AgentUiController` pattern):
  re-read `server_info.version` and re-issue `update_check_request`.
- **Success detection** = a reconnect whose `server_info.version` equals the target. Then: clear
  `applyInProgress`, success toast, offer **Reload**.
- **No auto-reload** (user decision): a forced `location.reload()` would discard composer state,
  scroll position, and open dialogs. The panel offers the button and explains why the UI may lag the
  daemon; a persistent hint shows both versions whenever `__APP_VERSION__ !== serverInfo.version`.
- New `self-update-store.ts` (plain Zustand, no middleware — house convention) fed by a
  `use-self-update.ts` hook subscribing via `client.connection.onSessionMessage`, plus a
  `resetSelfUpdateStoreForTests` entry in `test/reset-stores.ts`.

## Data & persistence touchpoints

- **No new persisted entity, no migration.** Update status is pure in-memory cache, recomputed on
  boot; the whole point is that it is cheap and derived.
- `config.json`: one new nested block, `daemon.update` → `{ autoCheck: boolean = true }`, following
  the `daemon.extensions` shape (`z.object({...}).default({})`, `config/daemon-config.ts:118-124`).
  Note the real compatibility mechanism here: `persistedConfigSchema` is **not** `.passthrough()` —
  it is a plain `z.object`, so Zod *strips* keys it does not know. An older daemon therefore ignores
  the field rather than failing, and unknown keys survive a write because there is no generic
  `saveConfig`: every writer is a targeted read-merge-write helper that persists through a permissive
  `z.record(z.string(), z.unknown())` rather than round-tripping `persistedConfigSchema`
  (`persistExtensionPacks`, `config/daemon-config.ts:327-357`, with the explicit "do NOT round-trip"
  comment at :348; the CLI's `setDaemonPassword`/`persistRelayEnvOverrides` do the same). A new
  `autoCheck` writer — if one is ever added — must follow that shape.
- `$PI_STUDIO_HOME/logs/update-restart.log` — new, written only by the restart waiter.
- `$PI_STUDIO_HOME/pi-studio.pid` — now **removed** on graceful shutdown (previously leaked).

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| `npm view` unreachable / times out | `latestVersion` untouched, `lastCheckError` set, `checkedAt` updated; no indicator change; panel shows Retry. Never an `rpc_error` |
| Registry reachable but package unpublished/404 | same as above (`npmLatestVersion` collapses every failure to `null`) — no crash, no bogus "downgrade available" |
| `npm i -g` fails EACCES (root-owned prefix) | `stage: failed` with the stderr tail + actionable hint ("run `pi-studio update` from a terminal, or fix your npm prefix"); daemon keeps running the old version; **no restart** |
| `npm i -g` hits npm's ENOTEMPTY staging bug | self-healed by `installWithStaleStagingRetry` (≤3 retries) before being reported |
| `pi update --extensions` fails or pi CLI unresolvable | warning in the progress message; update **continues** to restart; next boot's extensions sync retries |
| Two clients click Update simultaneously | first wins; second gets `ok: false, "an update is already in progress"`; both see identical `update_progress` broadcasts |
| A client connects mid-apply | `server_info` is followed by an `update_status` with `applyInProgress: true`; its panel joins the in-flight run instead of offering a button |
| Old daemon never exits within 30 s | waiter proceeds anyway; the new daemon's `listen` fails with `EADDRINUSE`, health polling fails, waiter retries ×3, then logs the `pi-studio daemon start` recovery line |
| New daemon fails to boot (bad install, breaking change) | waiter retries ×3 with health verification, logs to `update-restart.log`; clients stay in reconnect. Documented recovery: `pi-studio daemon start` |
| Layout changed so the pre-install entry path vanished | waiter re-resolves through `npm root -g` (both hoisted and nested layouts) before giving up |
| `PI_STUDIO_LISTEN` absent from the daemon's env | waiter carries the **effective** `host:port` explicitly, so the restart binds identically |
| Install kind is `docker`/`source`/`unknown` | `canApply: false`; apply refuses server-side even if a client forges the request; panel shows instructions |
| Desktop-embedded daemon | reports its own install kind, `canApply: false`, deferring to `electron-updater` (`features/desktop-app.md`) |
| `autoCheck: false` | no boot check, no timer, `autoCheck: false` on the wire; panel shows "automatic checks disabled" + Refresh, which still works |
| Agent mid-turn at restart | interrupted (user decision); the confirm modal stated the count. Pi's own session JSONL is intact, so the session resumes on the new daemon |
| A provider hangs in `session.close()` during the sweep | per-session timeout, log, continue — shutdown must not hang |
| Client on a version whose UI predates the daemon's features | existing capability-flag doctrine applies (a flag the UI doesn't know is ignored); the version-mismatch hint tells the user to reload |

## Dependencies on other specs

- `architecture/daemon-bootstrap.md` — startup, PID lock, and the shutdown sequence this feature
  corrects (agent sweep, PID-lock removal, timer teardown).
- `features/cli.md` — `pi-studio update` becomes a consumer of the shared engine and gains the
  restart step; `daemon-control.ts` gains `waitForProcessExit`, closing its pre-existing
  stop/start race.
- `features/preinstalled-extensions.md` — the bundled-pi resolution + `InstallSpawn` seam reused for
  `pi update --extensions`, and the boot-time sync that makes an extensions failure non-fatal.
- `architecture/websocket-protocol.md` — append-only schemas, open-string enums, capability gating.
- `features/provider-auth-ui.md` — the `SETTINGS_CATEGORIES` shell and the gear button whose
  visibility gate changes.
- `features/connection-resilience.md` — the reconnect loop the restart depends on.
- `features/desktop-app.md` — the *other* update axis; must stay disjoint.

## Acceptance criteria

- [ ] `server_info.version` reports the real package version on the direct-WS path, the relay path,
      **and** the dev daemon; `GET /api/health` reports `{status,version}`.
- [ ] A daemon installed via `npm i -g @av-pi-studio/cli` reports `installKind: "npm-global"`,
      `canApply: true`; a repo checkout reports `source`; the docker image reports `docker`; all
      three report `updateAvailable` correctly against a real registry lookup.
- [ ] With no update available, the toolbar shows no indicator; publishing/faking a newer version and
      hitting Refresh makes the indicator appear in **every** connected client without a reload.
- [ ] Clicking the indicator opens Settings directly on the Update panel.
- [ ] The confirm modal's counts match reality, including a terminal opened by a *different* client.
- [ ] Apply on an `npm-global` install: the new version is installed, `pi update --extensions` runs,
      the daemon restarts unattended, every client reconnects on its own, and the panel ends in
      "updated to v<target>" with a Reload button.
- [ ] After that restart there are **no orphaned `pi --mode rpc` processes** and no stale
      `pi-studio.pid` (verified with a process listing before/after, with at least one live agent and
      one open terminal).
- [ ] A second Update click during an apply is refused with `ok: false` and changes nothing.
- [ ] An install failure (simulated EACCES) surfaces the stderr tail in the panel, leaves the daemon
      running the old version, and does **not** restart.
- [ ] An extensions-step failure does not prevent the restart, and the next boot re-syncs.
- [ ] `canApply: false` installs show version info + instructions and **no** button; a forged
      `update_apply_request` against them is refused server-side.
- [ ] `PI_STUDIO_UPDATE_AUTOCHECK=false` stops the boot check and the timer; a manual Refresh still
      works.
- [ ] The restart carries the original listen address: a daemon bound `0.0.0.0:6767` is still bound
      `0.0.0.0:6767` afterwards, and a **relay-connected** client survives the whole flow.
- [ ] `pi-studio update` from a terminal performs the same install + extensions + daemon restart, and
      shares its engine with the daemon (no duplicated npm logic).
- [ ] `close()` still shuts down cleanly when the update subsystem was never used, and the daemon
      exits promptly on Ctrl-C (no interval keeping the loop alive).

## TODO(verify)

- **Does `pi --mode rpc` exit on stdin EOF when its parent dies?** The design does not depend on it
  (the sweep is explicit and correct either way), but the answer determines whether the orphan bug is
  currently *latent* or *live*, which is worth knowing when writing the regression test. Verify by
  starting a daemon, spawning an agent, `SIGKILL`ing the daemon (bypassing `close()`), and listing
  processes.
- **`npm root -g` availability in every supported environment.** Node images ship npm, and a global
  install implies npm, but confirm the daemon's `PATH` contains `npm` when started detached by the
  CLI from a GUI-launched shell (macOS `launchd` sessions have famously thin `PATH`s). If it does
  not, `detectInstallKind` degrades to `unknown` and hides the button — a safe failure, but a
  needlessly annoying one worth measuring before shipping.

## Resolved during scoping

**`pi-studio ui` does not need restarting after an update.** `resolveWebClientDist()`
(`packages/cli/src/web-server.ts:36-54`) resolves `@av-pi-studio/web-client`'s `dist/web` root
**once** at startup, but `handleRequest` does a fresh `readFile(candidate)` **per request**
(`web-server.ts:105-108`). An in-place `npm i -g` replaces the files under that same path, so a
browser reload serves the new bundle from the still-running `ui` process — the Reload button needs no
"restart `pi-studio ui`" note. The only exposure is a request landing mid-swap (a transient 404/500
on one asset, healed by the reload the panel is already asking for).
