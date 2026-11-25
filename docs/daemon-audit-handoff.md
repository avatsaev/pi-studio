# Daemon audit handoff

A read-only audit of the daemon (`packages/server`), with two questions answered:

1. What is bad about the daemon today, and what can be fixed or dropped now?
2. What becomes possible if the browser web client is dropped and the desktop app is the only
   graphical client?

Written 2026-11-24 against commit `3e25cec5` on `feat/single-binary-daemon`, daemon version
`0.0.130`. Line numbers are from that commit and will drift. Nothing in the repository was changed
by the audit; this file is its only output.

The findings are a snapshot of that commit. Before acting on one, re-check it against the code:
other agents were changing the tree while the audit ran. The [Decisions](#decisions) section is the
part that is kept current: it records what the owner approved, rejected and left open, because not
all of it will be implemented at once.

## How to read the findings

Each finding carries one of three evidence levels:

- **Run**: observed on a throwaway daemon (temporary `PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME`,
  random port, extension sync and update check switched off).
- **Checked**: read in the code and confirmed a second time with a targeted search or read.
- **Read**: read in the code once, by one reader. Treat these as leads to confirm, not as proven.

Findings marked *unverified* depend on behaviour outside the files that were read.

Backward compatibility was not treated as a constraint (the project has no users), so compatibility
shims, aliases and version gates are listed as things to delete.

## Contents

Start with [Decisions](#decisions).

1. [Summary](#1-summary)
2. [Measurements](#2-measurements)
3. [Security findings](#3-security-findings)
4. [Agent subsystem findings](#4-agent-subsystem-findings)
5. [Transport, lifecycle and configuration findings](#5-transport-lifecycle-and-configuration-findings)
6. [Files, terminals, git and persistence findings](#6-files-terminals-git-and-persistence-findings)
7. [Extensions, skills and viewer settings findings](#7-extensions-skills-and-viewer-settings-findings)
8. [Structure findings](#8-structure-findings)
9. [What can be dropped today](#9-what-can-be-dropped-today)
10. [Suggested order of work](#10-suggested-order-of-work)
11. [Dropping the web client](#11-dropping-the-web-client)
12. [Parts that were checked and found sound](#12-parts-that-were-checked-and-found-sound)
13. [Open questions](#13-open-questions)
14. [How to reproduce](#14-how-to-reproduce)

---

## Decisions

Recorded 2026-11-24. Nothing here is implemented yet. Each entry says what was decided, what goes
with it, and what to check first.

| Item | Decision |
|---|---|
| Chat rooms, loops, schedules | **Approved: drop** |
| Service proxy, its config and three env vars | **Approved: drop** |
| `agent/mcp-server.ts` | **Approved: drop** |
| Git write operations, stash, GitHub PR RPCs, diff subscribe | **Rejected: keep.** Needed later for the desktop client |
| Mode support (`plan` / `default` / `full-access`) | **Approved: drop** |
| Mock provider and dev daemon in the published package | **Approved: move out of the published package** |
| Dead config keys | **Approved: drop** (the five listed below) |
| CORS and the HTTP password check | **Approved: drop**, with the service proxy |
| `provider-snapshot.ts`, `reconciliation.ts`, `workspace-activity.ts`, `PiAgentSession.history` | **Approved: delete all four** |
| `extends: "pi"` profiles | **Approved: drop** |
| Compatibility shims: `migrateConfig`, `registerAlias`, `legacyRespondToPermissionSchema`, the legacy `checkout` kind, the `normalize` option, the always-true switches | **Approved: drop** |
| `.passthrough()` on wire schemas and on disk schemas, `version: 1` in state files | **Keep** |
| Relay parking of 0.0.120 daemons | **Deferred.** Recommended to wait for the single-protocol-version change; the owner accepted the drops and the keeps and did not comment on this one |
| The nine improvements (table below) | **Approved, all nine** |
| Web client: drop it, or keep it | **Keep it, as a second-class "Lite".** The desktop app is the first-class client |
| The five things Lite gives up (table below) | **Approved, all five** |
| Lite connects through the relay only | **Approved.** No opt-in switch for direct browser connections |
| What Lite keeps | **Approved:** chat, sessions, dialogs, todos, model and thinking pickers, read-only files, diffs and git status |
| Can Lite start new agents | **Approved: yes, with two limits** (existing folders only, and a cap per device) |
| Serving the desktop viewers' bytes from Rust | **Parked.** The analysis below is kept for when it is picked up |
| Milestones M1 to M9 | **Approved**, with the small fixes folded in. M1–M3 planned as sprints 146–150. See [Milestones](#milestones) |

Not yet put to the owner: the rest of section 9 (the unreferenced project, workspace and terminal
RPCs, the unused contract members other than the mode ones, the upload journal, the top-level
`version` config key), the smaller fixes in sections 3 to 8 that are not part of the nine
improvements, and the parts of section 11 that the Lite decision does not cover.

### Approved improvements

Approved 2026-11-24, in this order. The owner approved them on a plain-language description of what
changes for the user, which is the middle column. Nothing is implemented yet.

| # | Improvement | What changes for the user | Findings | Watch out for |
|---|---|---|---|---|
| 1 | Block websites from reaching the daemon; require a password when it is open to the network | Websites are turned away, except the hosted app. A daemon opened to the network without a password refuses to start and says why. | S1, S2 | The owner starts the daemon on `0.0.0.0` without a password, so a password has to be set first. The allowlist must include the hosted app, the local dev server and the desktop webview; requests with no `Origin` (CLI, the desktop app's Rust side) pass. |
| 2 | Recover when the agent process crashes | A crashed turn shows as failed, and the next message starts Pi again. A second message while one is running is refused cleanly. | A1, A2, A3, A4 | Refusing a send while running is a behaviour change for any client that queues by sending twice. |
| 3 | Keep conversation history safe | History is saved to disk as it happens and is there after a restart, whatever the user does first. | A5, A6 | Do the small part first (seed the timeline in `runTurn`). The file format is new persisted state under `$PI_STUDIO_HOME/agents/`. A little more disk per conversation. |
| 4 | Answer immediately on create and send | A new conversation appears at once; long turns no longer show a false error; a brief disconnect no longer confuses the app. | A7 | A wire change. The workbench, the SDK and the CLI's `run` and `send` must change in the same release as the daemon. Fixture and changelog procedure applies. |
| 5 | Stop the daemon cleanly, every time | Stop, restart and update always finish in a bounded time and leave no stray processes. | T1 | The update pipeline ends in this shutdown; re-run `scripts/daemon-update-check/` after the change. |
| 6 | Notice dead connections and protect against slow ones | The connected-clients list is accurate, memory stays steady, and one bad connection cannot slow the others. | T2, T3 | A user on a very poor connection sees a reconnect where today they see a long freeze. |
| 7 | Check every request before acting on it | A malformed request is refused at once with a clear message. No visible change in the app. | T4 | It will surface the CLI commands that already send the wrong shape (F8); most of those go with the orchestration drop. |
| 8 | Never overwrite a damaged settings or data file | A damaged file is set aside under a new name and reported. A damaged main configuration stops the daemon from starting instead of running unprotected. | S5, F2 | Refusing to start is a new failure the CLI and the desktop Daemons screen must report clearly. |
| 9 | One start-up path for the real and the development daemon | Nothing visible. What is tested matches what ships. | Section 8 | Do it after the approved drops, and together with moving the mock provider and dev daemon out of the published package. |

### Approved drops: scope

**Chat rooms, loops, schedules.**

- Goes: `orchestration/` (chat, loop and schedule services, `cron.ts`), `daemon/orchestration-rpc.ts`,
  the schedule and loop executors and `lastAssistantText` in `bootstrap.ts`, the stubbed
  `schedule_list_request` in `dev-bootstrap.ts`, the `onRecoverLoops` hook in `agent-manager.ts`, and
  the chat, loop and schedule stores and schemas in `persistence/`.
- Goes in the CLI: the `chat`, `loop` and `schedule` command groups in
  `packages/cli/src/feature-commands.ts`.
- Goes in the docs: the `chat/`, `loops/` and `schedules/` rows of the persistence layout in the root
  `AGENTS.md`, the feature specs under `swe/features/`, and the CLI pages under `fern/`.
- Side effects, all wanted: finding F8 disappears, `loop_run_request` stops being a way to run a
  shell command from a client (S1), and five of the six `registerAlias` calls and all the field
  aliases go with it.
- Checked: no external-client fixture names these families.
- Existing `chat/`, `loops/` and `schedules/` folders under `$PI_STUDIO_HOME` are left on disk and
  ignored.

**Service proxy.**

- Goes: `proxy/`, `daemon.serviceProxy.*`, `PI_STUDIO_SERVICE_PROXY_LISTEN`, `_PUBLIC_BASE_URL` and
  `_ENABLED`, the `onRequest` hook of the HTTP server, and the rows for those variables in the root
  `AGENTS.md`.
- Once it is gone the HTTP server answers `/api/health` and nothing else, so CORS and the HTTP
  password check protect nothing. **Approved: drop both.** Goes: `applyCors` and the
  `Access-Control-*` headers in `http/http-server.ts`, `daemon.cors.allowedOrigins`, and
  `authenticateHttp` with `bearerFromAuthHeader` in `auth/password-auth.ts`.
- Stays: the password check on the WebSocket upgrade (`authenticateUpgrade`), which is a separate
  path, and the Host check. `/api/health` was already exempt from both checks.
- Checked: no client fetches `/api/health` from a page, so nothing depends on the CORS headers. The
  CLI probes it from Node.

**`agent/mcp-server.ts`.**

- Goes: the file, its test, its export from `agent/index.ts`, the `mcpConfigPath` option of
  `buildPiArgs` (`providers/pi/agent.ts:98-102`), `supportsMcpServers` on both providers, and the
  `daemon.mcp.*` config keys.
- `supportsMcpServers` is also a field of the provider manifest schema in
  `packages/protocol/src/provider-manifest.ts:24`. Removing a wire field follows the fixture and
  changelog procedure if a fixture carries it; check before deleting.

**Mode support.**

- Goes on the daemon: `setMode` and the mode fields of `PiAgentSession`, the three modes in
  `agent/manifest.ts`, the contract members `getAvailableModes`, `getCurrentMode` and `listModes`, the
  mode handler in `session-operations.ts`, and `modeId` in the agent record schema.
- Goes in the clients: the CLI's `mode` command and `--mode` flag (`packages/cli/src/agent-commands.ts`),
  and the mode methods of `PiStudioClient`.
- Check first: the workbench's `Composer.tsx` and `ModelMenu.tsx` mention modes; confirm whether that
  is this feature or something else before deleting.
- The provider manifest on the wire carries `modes`. Same fixture rule as above.

**Mock provider and dev daemon out of the published package.**

- Today `dist/test-support/`, `dev-bootstrap.js`, `dev-main.js` and the mock provider all ship in
  `@av-pi-studio/server`, and `daemon/index.ts` exports `startDevDaemon`.
- Users of the dev daemon that must keep working from source: `npm run dev:daemon`, nine end-to-end
  tests in `packages/server`, three in `packages/cli` (`agent-todos-sdk-e2e`, `agent-ui-sdk-e2e`,
  `file-transfer-sdk-e2e`, which import `startDevDaemon` from `@av-pi-studio/server`), and
  `packages/server/scripts/record-external-fixtures.ts` (imports `dist/test-support/`).
- So the move needs a second, unpublished entry point for those importers, not a deletion.
- Fix with it: `handleCreate` defaults a missing provider to `"mock"` (A10). It must default to `"pi"`
  or reject. The mock also has to leave `agent/manifest.ts` and `resolveProviderClient` in the
  production build.
- The single binary must not contain them either.

**Dead config keys.**

- Approved: `daemon.mcp.*`, `log.*`, `worktrees.root`, `daemon.appendSystemPrompt`,
  `providers.local.modelsDir`.
- `daemon.appendSystemPrompt` was re-checked: `buildPiClient` never passes it on, so
  `PiClientDeps.appendSystemPrompt` is never set and goes too. The per-agent `config.systemPrompt`
  is a different thing and works.
- `worktrees.root`: the worktree service is kept (git decision below) and has a `root` option. Either
  wire the key or delete it; deleting was approved.
- The top-level `version` key is also unread but was not in the approved list.

### Rejected drop: git write, stash, GitHub and diff subscribe

These RPCs stay because the desktop client will use them. That turns their findings into work to do
before the first client calls them:

- F7: a timeout, a larger output buffer and `GIT_TERMINAL_PROMPT=0` on every git and `gh` call.
- S6: `--` before client-supplied positional arguments.
- F7: `checkout_diff_subscribe` never refreshes and is not disposed when its session closes.
- F9: `WorktreeService` and `GitHubService` are built without most of their dependencies, so setup
  commands never run and archiving a worktree does not archive its agents.
- T4: none of these handlers validate their input.
- The structured-generation stubs for commit message, PR title, PR body and branch name belong to
  these RPCs and therefore stay too.
- The always-true switches `checkoutRefreshEnabled` and `setAutoMergeEnabled` can still be removed.

### Approved: delete four pieces of code with no production caller

| Code | Size | What it is | Decision |
|---|---|---|---|
| `PiAgentSession.history` and `streamHistory` | a few lines, plus one contract member | An array that keeps every stream event of an agent for the life of its Pi process. Its only reader, `streamHistory`, is called by tests only. The timeline store already holds the same events. | **Delete.** It is an unbounded memory leak with no reader. |
| `agent/provider-snapshot.ts` | 107 lines, 71 of tests | A per-directory cache of a provider's models and modes: probes once, shares one probe between concurrent callers, re-probes only on an explicit refresh. Built by tests only. | **Delete.** See below. |
| `projects/reconciliation.ts` | 90 lines, 88 of tests | A start-up repair that merges duplicate projects with the same root path and archives the emptied ones. Never called. | **Delete**, and fix the cause instead. |
| `projects/workspace-activity.ts` | 95 lines | A pure function that turns agent statuses into one status per workspace, with a running subagent counted against its root parent's workspace. Never called. | **Delete.** |

Detail for each:

- **`history`.** `emit()` pushes every event (`providers/pi/agent.ts:249`), so a long conversation
  holds every text chunk twice, once here and once in the timeline. Removing it means removing
  `streamHistory` from `provider-contract.ts` and reworking the tests that read it (one real use in
  `pi-adapter.test.ts`, stubs in four other test files). The mock provider keeps its own private
  array, which it uses to script its answers.
- **`provider-snapshot.ts`.** It was designed for the model picker, and it would solve a real
  finding: today `resolve_default_model` caches forever with no invalidation, and listing models
  without a live session starts a Pi process on every call (A11). The case for deleting anyway: half
  of what it caches is modes, which are being dropped; its contract is "refresh only when told", and
  no RPC tells it; and it is small enough that the cache is better written where it is used when A11
  is fixed. The owner chose to delete it; A11 still needs its own fix.
- **`reconciliation.ts`.** Duplicate projects come from a lost-update race in
  `WorkspaceRegistryService` (F2): two concurrent `open_project_request` calls each read the file,
  then each write it. A per-file write queue makes duplicates impossible, and then there is nothing
  to repair. The registry matters more now that the git RPCs are kept, which is a reason to fix the
  race, not to keep the repair.
- **`workspace-activity.ts`.** Production uses a five-line `statusOf` in `bootstrap.ts` instead. The
  function's `attention` state came from the permission system retired on 2026-11-13, and its
  `needsAttention` input has no source anywhere in the code. If the desktop client later wants a
  status badge per workspace, the escalation rule is one paragraph in its header comment and can be
  rewritten from that.

### Compatibility shims

The earlier summary listed these as one item to drop. They are not all alike. The owner approved the
six drops, confirmed the three keeps, and did not comment on the one deferral.

| Shim | Where | Decision |
|---|---|---|
| `migrateConfig`, `migrateProviderSettings`, the `allowedHosts` rename | `config/daemon-config.ts:164-215` | **Drop.** They rewrite two old `config.json` shapes on load. The owner's own `config.json` uses neither (checked). |
| `registerAlias` and its aliases | `ws/router.ts:54`, `agent/session-operations.ts:56` | **Drop.** Five of the six calls go with the orchestration drop. The sixth, `cancel_agent`, has no sender. With no alias left, the alias map in the router goes too. |
| `legacyRespondToPermissionSchema` | `packages/protocol/src/messages.ts:444`, in the message union at `:2232` | **Drop.** It is the old name of a message of the retired permission system. It is a wire schema, so check the fixtures first. |
| `normalizeWorkspaceKind` accepting `checkout` | `projects/workspace-registry.ts:27` | **Drop.** The owner's `workspaces.json` has no such kind (checked). |
| The `normalize` option of `loadStore` | `persistence/atomic-store.ts:63` | **Drop.** No caller. |
| Always-true switches: `checkoutRefreshEnabled`, `setAutoMergeEnabled`, `restoreModesEnabled` | `bootstrap.ts`, `git-checkout-rpc.ts:69`, `github-service.ts:97`, `terminal-rpc.ts:86` | **Drop.** Each is passed `true` at its only call site. |
| `.passthrough()` on wire schemas (177 uses) | `packages/protocol/src/messages.ts` | **Keep.** See below. |
| `.passthrough()` on disk schemas (20 uses) | `persistence/entity-schemas.ts`, `extensions/extensions-state.ts`, `files/upload-journal.ts` | **Keep.** See below. |
| `version: z.literal(1)` in state files | `extensions/extensions-state.ts:60`, `files/upload-journal.ts:10`, viewer settings | **Leave.** One line each; removing them gains nothing, and the viewer-settings one is on the wire. |
| Relay parking of 0.0.120 daemons | `packages/relay/src/relay-server.ts`, `control.ts` (about 37 lines) | **Deferred** (recommendation, not yet confirmed). See below. |

Why four are not simple drops (the `version` reason is in the table):

- **`.passthrough()` on wire schemas.** It does two jobs that are not about old users. The push
  families with no schema of their own (`checkout_status_update`, `file_changed`, `terminals_update`,
  `provider_auth_flow_event`) are validated through the passthrough base schema. And the desktop app
  and the daemon are released separately, so a client does meet a daemon that sends a field it does
  not know. Removing passthrough is only safe together with the single-protocol-version change
  (section 11.2, item 7), which refuses mismatched versions outright.
- **`.passthrough()` on disk schemas.** It is what lets an older daemon keep a field a newer one
  wrote. That happens for real: the self-update rolls back to the previous version when the new one
  fails to start. It costs nothing at run time. The real weaknesses of these schemas are separate:
  the `z.unknown()` arrays, the dead `timeline` field of the agent record, and the silent fallback to
  defaults (F2).
- **Relay parking.** The relay holds sockets from a daemon that speaks the old relay protocol so that
  a client is told `daemon_outdated` (close code 4105) instead of waiting forever. The parking is the
  only thing that produces that code, and the code is handled in four places: the TypeScript relay
  transport, the Rust relay crate, the Rust transfer engine and the desktop host. Dropping the
  parking alone leaves those four dead; dropping all of it means a relay deployment and a desktop
  release for no change in behaviour. The single-protocol-version change needs exactly this "your
  daemon is too old" signal, so do the two together and give the code a real producer.

### Approved: drop `extends: "pi"` profiles

- **What it is.** An entry under `agents.providers` in `config.json` with an id other than `pi`, plus
  `extends: "pi"` and a `label`. It runs the Pi adapter under that id with its own `command` and
  `env`, optionally with a replaced or extended model list (`models`, `additionalModels`) and its own
  session folder for imports (`params.sessionDir`).
- **What it is for.** Running a Pi fork, or a second Pi installation with its own home, beside the
  built-in one.
- **How it is reached.** Only by editing `config.json` by hand and then passing the id to the CLI's
  `--provider`. The workbench always creates agents with `provider: "pi"`
  (`packages/workbench/src/stores/materialize.ts:115`), so a profile cannot be picked in the UI. The
  owner's `config.json` has no provider entries at all (checked).
- **It is half supported.** Everything else in the daemon assumes the built-in Pi's home: provider
  auth, skills, extension sync and title generation all resolve `agents.providers.pi` only
  (`agent/pi-home.ts:34`). A profile with its own home gets no Settings support and no synced
  extensions, so no todo list either.
- **What would go.** `extends` and the rule that a custom id needs it and a label
  (`config/daemon-config.ts:27`, `:46-62`), `models`, `additionalModels`, `params.sessionDir`,
  `applyModelOverrides` (which replaces a method on the client object at run time),
  `ProviderRegistry.replaceMetadata`, `PROVIDER_CLIENT_FACTORIES`, `listImportableSessions`, and
  `extends` in the protocol's provider manifest. Three more fields of the same schema are read by
  nothing at all and go regardless: `disallowedTools`, `enabled`, `order`.
- **What stays.** Overriding the built-in `pi` entry's `command` and `env`. That is how a custom Pi
  binary path and a custom Pi home are set, and it is used.
- **Decision: drop.** The cost is losing the ability to run a second Pi side by side from the
  CLI. If that is ever wanted, it needs a design in which auth, skills and extensions follow the
  profile's home; the current code would not be the starting point.

### Web client as "Lite", desktop first

Decided 2026-11-24. The web client stays, as a remote companion with limited rights. Section 11
describes dropping it entirely; this section replaces that as the plan. Nothing is implemented yet.

**What Lite gives up, all approved:**

| Lite gives up | What it unlocks |
|---|---|
| Connecting straight to a daemon by address and password. Lite connects only with a pairing link, through the relay. | The daemon's direct port turns away every request that carries an `Origin`, so S1 is closed by design. The local daemon can move to a Unix socket or named pipe for the desktop app and the CLI (section 11.2, item 1), and SSH can forward to it (item 6). The password in the page URL and in browser storage goes. `pi-studio ui` goes, and with it about 28 MB of web app in the CLI package and the single binary; `workbench`, `ui-library` and `web-client` no longer need publishing to npm. |
| Full power. Lite has a limited role: no terminal, no file write, delete or upload, no Settings (provider credentials, skills, extensions, daemon update). | The daemon's first permission model, with two roles (S2). A compromise of the hosted app can no longer open a shell, read credentials or replace the daemon directly. |
| The shared password. Each Lite device gets its own credential at pairing; the desktop app keeps a key in the OS keychain. | One device can be revoked without rotating the daemon's key. Fixes S3. |
| The full message set. Lite speaks a small, stable subset. | The desktop app and the daemon can require an exact version match (section 11.2, item 7). The feature flags shrink to the Lite subset, which the external-client fixtures can pin. |
| Uploads and large downloads. Lite views files up to a size cap. | Uploads run only on the desktop's separate transfer connection, so the control connection is never paused (F5). The desktop's `--transfers page` mode goes. |

**Accepted costs:**

- Lite needs the relay even on the same network, and a self-hoster must run it.
- Opening the web UI over the network against a local daemon stops working. Use the desktop app, or
  pair.
- Web development against a local daemon needs an explicit developer switch.

**Known limit of the limited role.** Lite can send a prompt, and an agent can run commands. The role
removes the direct routes (terminal, file writes, credentials, daemon update); it does not make a
compromised hosted app harmless.

**What stays while Lite exists:** the TypeScript side of the relay channel, the hosted app with its
Docker image and release steps, and the JSON ping.

**Effect on what was approved earlier:**

- Improvement 1 becomes simpler: no allowlist of web origins on the direct port, only "refuse any
  `Origin`", plus the developer switch.
- The approved CORS drop is unaffected.
- "Reject every upgrade that carries an `Origin`" and "delete `pi-studio ui`" move from section 11
  (drop the web client) to this plan.

**Suggested grouping.** The first three rows are one piece of work: two doors (a trusted local one, a
paired remote one), two roles, a credential per device. Rows four and five can follow.

#### Approved: Lite can start new agents, with two limits

Decided 2026-11-24: yes, with the two limits below. The cap's number is not chosen yet.

- The extra risk is smaller than it looks, because Lite can already prompt an existing agent.
- What starting an agent adds: a choice of folder (anywhere on the machine, which needs the
  folder-browsing and folder-creating requests of `OpenWorkspaceDialog`), a choice of model (cost),
  and one Pi process per agent with nothing limiting how many.
- Limit 1: Lite starts agents only in folders that already have a workspace or an agent, picked from
  a list. Opening a new folder stays on the desktop.
- Limit 2: a cap on how many agents a Lite device may have running.

#### Parked: the desktop viewers' bytes from Rust

Parked by the owner on 2026-11-24. No trial is planned. Until this is picked up, viewing on the
desktop keeps using the page-side transfer code, and so does Lite, so `FileTransferClient` and
`browser-files.ts` stay. The question of moving Lite to a small image-read request, so that this
code can be deleted, is parked with it.

**Today (checked).** On the desktop, saving a file to disk and uploading a picked file go through the
Rust transfer engine. Viewing does not: `files.openForView` is still the browser host's
(`desktop/apps/pistudiodesktop/src/host/transfers.ts`, `packages/workbench/src/host/browser-files.ts`).
The bytes travel daemon → Rust proxy → loopback WebSocket → page, as 32 KiB frames on the control
connection; the page collects them into a `Blob` and views that. Six consumers: the image, video,
PDF and molecule viewers, large text (5 to 30 MiB), and inline images in chat. A file dropped onto
the window also uploads this way, because the window uses HTML drag and drop
(`dragDropEnabled: false` in `tauri.conf.json`).

**What that costs.**

- The whole file is in the page's memory. The PDF viewer then copies it again
  (`getDocument({ data: bytes })`).
- A video cannot start or seek until all of it has arrived.
- No size limit was found for images, video or PDF.
- The bytes share the control connection with chat and terminals.

**Options.**

| Option | How | For | Against |
|---|---|---|---|
| A. Loopback HTTP from Rust | Rust answers `http://127.0.0.1:<port>/<token>/…` with `Range` support, each range fetched from the daemon by the transfer engine. Reuses the gate of the existing loopback proxy (token, `Origin` check). | A real streamed body with back-pressure. Plain HTTP is what every webview's media stack expects. Same choice, for the same reason, as the control connection (`swe/features/desktop-transport-bridge.md`). | One more thing on loopback, so the same "security software blocks 127.0.0.1" failure. The CSP gains `http://127.0.0.1:*` for images, media and fetch. The token is in a URL and must live as long as the view, not for one request. |
| B. A custom URI scheme | A second scheme beside `pi-preview:`, answering range requests. | No listener, no token. | Tauri answers a scheme request with a whole buffer, so large files work only if the webview asks in ranges. Video through a custom scheme on Linux is a known weak spot of WebKitGTK (to verify). This project has only checked its one custom scheme on Linux; on macOS and Windows the preview is `inert` for that reason. |
| C. Download to a temporary file, then view the file | The engine saves to a temp file; the page loads it through Tauri's asset protocol. | Simplest. Reuses the save path as it is. | The whole file must arrive before viewing, so video still does not stream. Uses local disk. Same Linux video caveat as B. |
| D. Read the file from disk when the daemon is local | For the `local` entry only, serve the path straight from this machine. | Instant, no copy. | A second code path that only some entries take, and it bypasses the daemon. An optimisation to add later, not a design. |

**Recommendation when picked up: A, after a spike.** The spike must show, on Linux, macOS and Windows: a video that
starts at once and seeks, a large PDF whose first page appears before the whole file arrived, and a
2 GB file viewed with flat memory.

**What it needs.**

- A ranged download in the Rust engine. The protocol has `offset` and `length`; the engine's save
  path sends no `length` today.
- `ifUnchanged` on every range, so a file that changed mid-view is reloaded, not mixed.
- The PDF viewer loading by URL with ranges instead of by bytes. Optional at first.
- Dropped files: either native drag and drop, which conflicts with the in-page drag from the file
  tree to the composer, or leave dropped files on the old path.

**What it does not give by itself.** The TypeScript transfer client cannot be deleted while Lite views
files through it. It can go only if Lite also changes: text and diffs through `file_read_request` as
today, plus a small "read as base64 up to the cap" request for images. Then the chunked transfer
protocol is spoken by Rust only, and `FileTransferClient` (about 27 KB and 40 KB of tests) and
`browser-files.ts` can be deleted.

**Value.** A better experience with large media, and a control connection that carries no bulk data.
Lower priority than the two-doors work. Effort: medium, most of it the three-platform checking.

### Milestones

Approved by the owner on 2026-11-24, with the small fixes folded in. M1 to M3 are planned as sprints
146 to 150 in `swe/sprints/` (index in `swe/sprints/PLAN.md`); M4 to M9 are planned when each comes
up, and M8 needs a written design first.

| Milestone | Sprints |
|---|---|
| M1 Close the door | 146 — **done 2026-11-24** (on branch `feat/daemon-audit-m1-m3`, not merged) |
| M2 Clear the ground | 147, 148 — **done 2026-11-25** (on branch `feat/daemon-audit-m1-m3`, not merged) |
| M3 Agents that recover | 149, 150 (150/t002 is an owner gate on the timeline file design) |
| M4 to M9 | not planned yet |

| # | Milestone | Contains | What the user gets | Size | Needs |
|---|---|---|---|---|---|
| M1 | Close the door | Improvement 1 in its Lite form: the direct port refuses any request with an `Origin`, with a developer switch for local web development. Refuse a network bind without a password. Web client connects by pairing link only (address and password form removed; no password in the URL or browser storage). Remove `pi-studio ui`. | No website can reach the daemon. | Small | Nothing |
| M2 | Clear the ground | The approved drops: orchestration, service proxy with CORS and the HTTP password check, `mcp-server.ts`, mode support, dead config keys, the four uncalled pieces, `extends: "pi"` profiles, the six shims. Also the packaging that follows from M1: the CLI and the binary stop carrying the web app; `workbench`, `ui-library` and `web-client` stop being published. | Nothing visible. A smaller install, and less code for every later milestone to touch. | Medium, mostly deletions | Nothing; packaging part needs M1 |
| M3 | Agents that recover | Improvement 2 (crash path, turn lock, spawn lock, close during a turn) and improvement 3 (seed the timeline, then save it to disk). | No stuck conversations, no duplicated replies, no lost history. | Medium to large | Nothing |
| M4 | Instant replies | Improvement 4: create and send answer at once; the daemon, SDK, workbench and CLI change together. | New conversations appear at once; long turns show no false error. | Medium | M3 |
| M5 | A daemon that holds up | Improvement 5 (ordered, bounded shutdown), improvement 6 (liveness, limits, slow clients), improvement 8 (set damaged files aside). | Stop and update always finish; steady memory; no silent loss of settings. | Medium, three independent parts | Nothing |
| M6 | One wiring | Improvement 9 (one start-up path), the mock provider and dev daemon out of the published package, improvement 7 (every request checked, with the schema declared where the handler is registered). | Nothing visible. Tested code matches shipped code; clear errors for malformed requests. | Medium to large | M2; best after M4 |
| M7 | The local door | The local daemon listens on a Unix socket or named pipe; the desktop app and the CLI use it; SSH forwards to it; the TCP port becomes opt-in (Docker, headless remote hosts). | No port conflict and no password for the local daemon; an SSH host needs no open port. | Medium, plus checks on three systems | M6 |
| M8 | Devices and roles | A credential per device at pairing, the desktop's key in the OS keychain, revoking one device. Two roles, full and Lite, carried by the credential and enforced per request. The web client trimmed to the Lite feature set. Lite starts agents only in known folders, up to a cap. | A lost phone can be cut off alone. The web client can no longer open a shell, change files or touch settings. | Large; needs a written design first | M6, M7 |
| M9 | Lite contract and version match | Lite speaks a small pinned subset. The desktop app and the daemon require the same version; the feature flags shrink to the Lite subset. The relay's parking of old daemons is replaced by a real "daemon too old" signal. Uploads only on the transfer connection; Lite views files up to a cap; the desktop's `--transfers page` mode goes. | Faster changes to the desktop app without compatibility code; an upload never stalls chat. | Medium to large | M8 |

**Order and what can run side by side.**

- M1 first, alone: it is small and it closes the most serious finding.
- Then M2, M3 and M5. Correction made while planning: M2 and M3 both edit the agent files
  (`pi/agent.ts`, `agent-service.ts`, `session-operations.ts`), so in one working tree sprint 149
  starts after sprint 147; sprint 148 and 149 then run side by side. M5 is still independent.
- M4 follows M3. M6 follows M2 and is easier after M4, because M4 changes two of the handlers M6
  rewires.
- M7, M8 and M9 are the Lite plan, in that order. They come after M6 so that sockets, roles and
  credentials are wired once, not once per bootstrap.

**Why roles wait for credentials (M8).** The desktop app also connects through the relay, and it must
keep full rights. Until each device has its own credential, the daemon cannot tell a paired desktop
from a paired browser, so it cannot give them different roles.

**Consequence to accept in M1.** After M1 the web client relies on pairing links alone, and a pairing
link is still the daemon's public key with no per-device revocation (S3) until M8. This is no worse
than today, where the relay already works that way, but it is the reason M8 should not slip far.

**Things M1 changes for existing set-ups.**

- The Docker daemon image binds `0.0.0.0:6767` with no password by default
  (`docker/daemon.Dockerfile:81`). After M1 it refuses to start that way, so the compose file and
  `docker/README.md` must set a password.
- The Vite dev server's `/daemon-ws` proxy needs the developer switch.

**Not in any milestone.**

- Parked: the desktop viewers' bytes from Rust.
- Kept for later: hardening the git, stash and GitHub requests (F7, S6, F9), to be done before the
  desktop client first calls them.
- Never put to the owner: the unreferenced project, workspace and terminal requests, the unused
  provider-contract members, the upload journal, the top-level `version` config key.
- Small fixes, folded in by the owner on 2026-11-24: requests to Pi with no timeout (A8) is
  sprint-149/task-002; deleting a symlink deletes its target (F1), `file_read_request` on endless files
  (F3), terminal subscriptions leaking on disconnect (F4) and credentials in extension error text
  (section 7) go into M5 when it is planned. The unwired skip store (T6) needs nothing: it was fixed by
  sprint-142/task-002 (`createFileSkipStore` is wired in `bootstrap.ts` on `main`).

---

## 1. Summary

The daemon's core is sound: the relay transport, the download path, the update pipeline, the
extension-UI bridge and provider auth were all read and found well built (section 12). Three things
stand against that.

- **One serious security hole.** Any web page open in a browser on the daemon's machine can connect
  to the daemon and open a terminal. The WebSocket upgrade never checks `Origin`, and there is no
  password by default (finding S1, evidence level **Run**).
- **Reliability bugs in the agent path.** A Pi crash during a turn leaves the agent stuck `running`;
  two prompts can run on one agent at once; Pi processes leak; the conversation timeline lives only
  in memory and can come back empty after a restart (section 4).
- **About 15% of the code serves no working client.** Of 141 registered RPC names, 42 are referenced
  by no client, and another 21 are used only by CLI commands whose payloads do not match the
  handlers. Whole subsystems (chat rooms, loops, schedules, the service proxy, the MCP server) are
  in this group (section 9).

The strongest reason to drop the web client is security, not line count. While a browser is a
first-class client the daemon has to accept browser origins, and a compromise of the hosted app
would reach every user's machine (section 11).

## 2. Measurements

Size of `packages/server/src`, tests excluded: 25,680 lines. Tests: 30,187 lines.

| Subsystem | Lines | Test lines |
|---|---|---|
| `agent/` | 8,519 | 11,223 |
| `daemon/` | 2,660 | 5,196 |
| `resources/` | 1,861 | 2,182 |
| `projects/` | 1,845 | 896 |
| `files/` | 1,579 | 2,154 |
| `update/` | 1,415 | 1,637 |
| `extensions/` | 1,256 | 1,743 |
| `terminal/` | 1,197 | 1,270 |
| `orchestration/` | 954 | 496 |
| `persistence/` | 648 | 337 |
| `ws/` | 612 | 580 |
| `test-support/` | 608 | 0 |
| `config/` | 535 | 456 |
| `observability/` | 485 | 534 |
| `logging/` | 391 | 332 |
| `runtime/` | 305 | 335 |
| `proxy/` | 223 | 142 |
| `viewers/` | 206 | 350 |
| `http/` | 166 | 120 |
| `auth/` | 97 | 113 |
| `util/` | 30 | 61 |

Largest files: `daemon/bootstrap.ts` (1,052), `resources/resource-service.ts` (932),
`agent/providers/pi/agent.ts` (875), `agent/providers/mock/mock-provider.ts` (749),
`files/file-transfer.ts` (708).

Throwaway daemon, production entry point (`dist/daemon/main.js`), empty home (**Run**):

- Ready to accept connections about 350 ms after process start.
- About 167 MB resident memory when idle, 11 threads, 23 open file descriptors.
- `PI_STUDIO_LISTEN=127.0.0.1:0` is rejected with "Invalid listen port", although comments in
  `bootstrap.ts` describe binding port 0.

RPC surface (**Checked**, by searching every registered name in `packages/client/src`,
`packages/workbench/src`, `packages/cli/src` and `desktop/`, tests excluded):

- 141 registered names.
- 42 have no reference in any client (list in section 9.1).
- 21 more (chat, loop, schedule) are referenced only by `packages/cli/src/feature-commands.ts`,
  which marks their wire names `TODO(verify)`.

## 3. Security findings

### S1. Any web page can drive the local daemon (**Run**)

- The WebSocket upgrade checks the `Host` header and the password, and nothing else
  (`ws/ws-server.ts:78-98`). The only use of `Origin` in the daemon is the CORS header in
  `http/http-server.ts`, which browsers do not apply to WebSockets.
- `http/host-allowlist.ts` always accepts `localhost` and literal IP addresses as `Host`.
- No password is set by default, and `createPasswordAuth` then accepts everything
  (`auth/password-auth.ts:78`).
- Observed: an upgrade request with `Origin: https://evil.example` to the default configuration
  answered `101 Switching Protocols`.
- Consequence: a page the user visits can open `ws://127.0.0.1:6767`, send `hello`, and then call
  `create_terminal_request`, the file write RPCs, `create_agent_request` or `loop_run_request`
  (which runs `/bin/sh -c` on a client-supplied string, `bootstrap.ts:817-834`). That is remote code
  execution from a browser tab.
- Newer browser versions may prompt before a public page reaches a local address. That is partial
  and differs by vendor; it was not tested and should not be relied on.
- Fix that works with the web client in place: reject an upgrade whose `Origin` is present and not on
  an allowlist (the hosted app, the local dev server, the desktop webview). Requests with no
  `Origin` (the CLI, the desktop app's Rust side) pass.
- Fix that needs the web client gone: reject every upgrade that carries an `Origin` (section 11).

### S2. No password by default, and a network bind without one only warns (**Checked**)

- A non-loopback bind with no password logs one warning and starts anyway (`bootstrap.ts:1005-1007`).
- There is no role model. Every session can open terminals, read and write any file, read logs,
  apply a daemon update and run loops. `clientType` and `clientId` are whatever the client says.
- Fix: refuse to bind a non-loopback address without a password. For loopback, generate a token in
  `$PI_STUDIO_HOME` that the CLI and the desktop app read.

### S3. Relay sessions skip the password (**Checked**)

- `daemon/relay-sessions.ts`, `relay-transport.ts` and `relay-connection.ts` contain no reference to
  the password or to `auth`; `bootstrap.ts` wires `auth` into the direct path only.
- The only gate on the relay is possession of the daemon's public key, which is in the pairing link
  and QR code.
- Revocation exists but is all-or-nothing: `pi-studio daemon rotate-key` invalidates every link.
- Fix: a per-client credential with individual revocation (section 11, "Real client identity").

### S4. The password check blocks the event loop and is not rate limited (**Checked**)

- `bcrypt.compareSync` at cost 10 runs on every WebSocket upgrade and every HTTP request
  (`auth/password-auth.ts:81`). A plaintext password is also hashed synchronously at start.
- A flood of bad attempts stalls the single thread (agent streams, terminals) and allows unthrottled
  guessing.
- Fix: asynchronous compare, a per-address failure throttle, and a cache of the verified token's
  hash. For a machine-generated token, bcrypt is unnecessary: compare a hash with
  `timingSafeEqual`.

### S5. A corrupt `config.json` silently removes the password (**Read**)

- `loadConfig` turns a parse error into `{}` (`config/daemon-config.ts:310`). A truncated file means
  the daemon starts with no password and the default listen address.
- `persistUpdateAutoCheck` and `persistExtensionPacks` (`daemon-config.ts:344-390`) load the same
  way and then write back, which destroys the user's file.
- Fix: fail to start on an existing file that does not parse, and refuse to write over one.

### S6. Smaller security items (**Read**)

- The password travels in the `Sec-WebSocket-Protocol` header and is echoed back
  (`ws/ws-server.ts:67-73`). Proxies log headers; the daemon's own log tap masks it only in daemon
  logs.
- CORS reflects any listed origin with credentials allowed, and `*` is accepted
  (`http/http-server.ts:25-31`).
- bcrypt truncates input at 72 bytes.
- `capabilityStore` is an unbounded map keyed by a client-chosen `clientId`
  (`ws/capability-store.ts`).
- Any session, relay included, can restart the daemon with `daemon_update_apply_request`.
- Git and `gh` arguments from the client are passed positionally without `--`, so a value starting
  with `-` is read as an option (`projects/git-operations.ts`, `worktree-service.ts` around line
  175, `github-service.ts`). Low severity: the same client can already open a terminal.
- The skills CLI receives client-supplied names after a variadic `-s` with no check that a name does
  not start with `-` (`resources/skills-cli.ts` around line 72). Low severity for the same reason.
- File RPCs have no sandbox. This is deliberate ("trusted operators"), and since a terminal is
  available to the same client, a sandbox would add nothing. The real control is the auth gate,
  which is why S1 to S3 matter.

## 4. Agent subsystem findings

### A1. A Pi crash during a turn leaves the agent stuck (**Checked**)

**Update 2026-11-24 (on `main`, after the audit):** partly fixed in `601a91e6`. A non-zero exit now fails
the transport and a waiting turn ends with an `error` row. Still open, and planned as
sprint-149/task-001: an exit by signal or an unrequested exit 0 still hangs the turn, the turn ends with
a non-terminal `error` rather than `turn_failed`, and the dead session is never replaced.

- The `exit` handler in `agent/providers/pi/rpc-transport.ts:178` fails pending requests only when
  there are some. A prompt is sent with `notify`, so during a turn nothing is pending.
- When `failAll` does run it emits `{type:"error"}`, which `event-mapper.ts:256-257` maps to a
  non-terminal `error` event. `PiAgentSession.run` (`agent.ts:337-349`) therefore never resolves.
- `managed.session` is never cleared, so nothing respawns Pi. Later prompts are written to a dead
  pipe. `handleInterrupt` forces the status to `idle`, but the next send hangs again.
- Fix: on exit, record the failure and emit a terminal `turn_failed`; make `run()` reject on a
  transport failure; have `AgentManager` detach a dead session so the next send resumes it.

### A2. Two prompts can run on one agent at once (**Checked**)

- `AgentService.handleSendPrompt` (`agent/agent-service.ts:346-362`) does not look at the agent's
  status.
- A second send starts a second `runTurn` with a second subscription, so every later event is
  appended and broadcast twice (**Read** for the consequence).
- Fix: a per-agent turn lock, and reject `send_agent_prompt` while the agent is running.

### A3. Pi processes leak (**Read**)

- `spawnOrResumeSession` (`agent-service.ts:155-207`) has no per-agent lock. Send, list commands,
  fork, clone and compact all call it when there is no live session; two concurrent calls spawn two
  Pi processes and one is orphaned.
- `handleResume` (`session-operations.ts:195-208`) spawns over a live session, and `attachSession`
  replaces it without closing the old one.
- In `resumeSession` and `createSession` (`agent.ts` around 707-713), a failure after the spawn
  leaves the new process running.
- Fix: one spawn promise per agent; close the old session before replacing it; close the transport
  when the handshake after a spawn fails.

### A4. Closing a session mid-turn hangs its RPC (**Read**)

- `PiAgentSession.close()` clears the subscriber list (`agent.ts` around line 860), which drops the
  listener `run()` is waiting on. Archiving or deleting a running agent leaves the create or send
  RPC pending forever.

### A5. The timeline is memory-only and never evicted (**Checked** for the map, **Read** for the rest)

- `timelinesByAgentId` is a module-level map with no delete path (`agent-service.ts:39`). Deleting
  or archiving an agent does not touch it.
- The header of `timeline-store.ts` says rows persist with the agent record. They do not:
  `record.timeline` is always `[]`.
- Rows are stored per streamed chunk and merged only when read.
- `page()` (`timeline-store.ts`, roughly lines 170-260) projects the whole window and then slices,
  so each fetch costs O(total rows) on the event loop.
- Fix: an append-only file per agent, chunks merged on write, a bounded tail in memory, and an index
  by sequence number so paging is O(page).

### A6. History can be lost after a restart (**Read**)

- `runTurn` calls `getOrCreateTimeline` and never `ensureTimelineSeeded` (`agent-service.ts:364`).
  Seeding happens only in the timeline fetch and in compact. If the first action after a restart is
  a prompt, an empty store is created and seeding becomes a no-op from then on.
- `hydrateTimelineFromSessionFile` (`session-hydration.ts`, roughly 150-205) restarts sequence
  numbers at 0, so a client's cursor from before the restart is invalid.
- The hydration read is synchronous inside an RPC handler.

### A7. Create and send block until the turn ends (**Checked**)

- Both handlers await `runTurn` (`agent-service.ts:329`, `355-361`). The creating client does not
  learn the agent id until the whole turn is over.
- The workbench works around this with a deferred draft, an optimistic echo and a 30-minute RPC
  timeout (`packages/workbench`, `connection-store.ts:117`). A longer turn fails on the client while
  it keeps running. If the socket drops, the reply is lost.
- The `send_agent_prompt` response says `status: "idle"` even when the turn ended in an error.
- Fix: return `{agentId}` or `{turnId}` at once and report the outcome through events. The CLI's
  `run` and `send` block on purpose today and would have to wait on events instead.

### A8. Requests to Pi have no timeout (**Read**)

- `request()` in `rpc-transport.ts:235-247` waits forever. `get_state`, `compact`, `fork` and model
  listing can all hang.
- `close()` sends SIGTERM only, with no escalation, and does not reject pending requests.
- `chunk.toString("utf8")` per chunk (`rpc-transport.ts:276`) corrupts a multibyte character split
  across two chunks. Use `StringDecoder`.
- Lines that do not parse are dropped silently; `stdin.write` backpressure is ignored.

### A9. Session operations have no busy guard (**Read**)

- Only compact refuses a running agent. New session, switch, fork, clone and set-model run during a
  live turn. A fork resets the timeline under an active subscriber.
- Compact does not set the status to `running`, so a prompt can start during a compaction.
- `handleUpdate` (`session-operations.ts:143-190`) computes the config before its awaits and writes
  it after, which can overwrite a concurrent model or thinking-level change.

### A10. The default provider is the mock (**Checked**)

- `handleCreate` falls back to `"mock"` when the client sends no provider (`agent-service.ts:237`).
  A client that omits the field gets synthetic output with no error.

### A11. Smaller agent items (**Read**)

- `resolve_default_model` caches forever, keyed by provider and an arbitrary cwd, and is never
  invalidated after a settings change (`bootstrap.ts:547-573`). Listing models with no live session
  spawns and closes a Pi process on every call.
- `AgentTodosService.reconcile` re-reads and parses the whole Pi session file synchronously after
  every turn and every compaction (`agent-todos-service.ts` around line 118).
- `PiAgentSession.history` (`agent.ts` around line 189) stores every event forever; its only reader,
  `streamHistory`, has no caller.
- Title generation has no timeout; a hung model call leaves the in-flight flag set for the life of
  the daemon (`structured-generation-runtime.ts` around line 191).
- `handleSteer` appends the user message row before the provider call succeeds
  (`session-operations.ts:115-132`).
- Mode support is cosmetic: `PiAgentSession.setMode` only sets a local field, because Pi has no mode
  command, yet the manifest advertises `plan`, `default` and `full-access`.

## 5. Transport, lifecycle and configuration findings

### T1. Shutdown is fragile (**Checked** for the order, **Read** for the rest)

- `closeDaemon` (`bootstrap.ts:1025-1040`) has no try/finally and no timeout. If
  `manager.closeAll()` rejects or hangs, the PID file is not removed and the process does not exit.
- A second SIGINT is ignored and there is no hard-kill timer.
- The order is backwards: agents are closed while the WebSocket server still accepts RPCs such as
  `create_agent_request`.
- Never closed: the schedule, loop and chat services, the upload journal, provider auth, and child
  processes of running installs.
- There is no `unhandledRejection` or `uncaughtException` handler anywhere in `src`.

### T2. Direct sockets have no liveness check and no backpressure (**Checked**)

- No ping, no keep-alive and no heartbeat in `ws/ws-server.ts`. A half-open connection stays a
  session until the kernel gives up.
- `Session.send` serialises per recipient (`ws/session.ts:80`), so a broadcast to N sessions
  stringifies N times.
- Nothing checks the send queue on a broadcast, so a slow client grows it without bound.
- Fix: stringify once, skip or close a session above a queue cap, and ping on an interval with
  `terminate()` on a missed pong.

### T3. No handshake timeout and no frame size limit (**Checked**)

- A socket that never sends `hello` is held forever.
- The server is created without `maxPayload`, so the library default of 100 MiB per frame applies.
- Each binary frame is copied (`new Uint8Array(data)`).
- Every text frame is dispatched concurrently with no per-session cap or ordering.

### T4. Inbound RPCs are not validated (**Checked**)

- The protocol package has Zod schemas, but the router passes `Record<string, unknown>` and handlers
  cast fields by hand: 31 such reads in `daemon/orchestration-rpc.ts`, 21 in
  `terminal/terminal-rpc.ts`, 19 in `projects/git-operations.ts`. Only the handshake parses a
  schema.
- Fix: validate in the router against the schema for the message type, once.

### T5. Identity and lock files (**Read**)

- A corrupt `daemon-keypair.json` is regenerated silently (`bootstrap.ts:210-243`), which
  invalidates every pairing with no log line.
- The PID file does not lock anything: it is written unconditionally and a second daemon is never
  refused on its account.
- If the server id cannot be written, it changes on every start.
- `server_info.hostname` carries the bind address, usually undefined, not a host name.

### T6. Update subsystem (**Checked** for the first item, **Read** for the rest)

- **Fixed after the audit** (sprint-142/task-002, on `main`): `bootstrap.ts` now passes
  `createFileSkipStore(...)`, so a rolled-back version is not offered again by automatic checks. At the
  audit's commit it was not wired.
- The restart helper (`update/helper.ts`) is about 300 lines of JavaScript in a string, and the
  daemon it starts has `stdio: "ignore"`, so crash output is lost.

### T7. Configuration (**Read**)

- Precedence is scattered: `overlayEnv` handles about 14 variables, but `bootstrap.ts` reads
  `PI_STUDIO_PASSWORD`, `PI_STUDIO_HOME` and `PI_STUDIO_SERVER_ID` itself, and the service proxy
  reads three more.
- Boolean variables are parsed three ways: one accepts `yes`/`on`, one treats anything but
  `false`/`0` as true, one accepts only `true`/`1`.
- The default `hostnames` value contains `*.localhost`, a pattern the checker does not understand
  (it hardcodes `.localhost`), so that entry matches nothing.
- `parseDaemonListen("[::1]:6767")` keeps the brackets in the host, which `listen()` rejects.

### T8. Other (**Read**)

- `LogTap` parses and re-serialises every log line twice even when nobody is subscribed
  (`logging/log-tap.ts`).
- `file_diff_request` always answers `ok: true` and discards the git error (`bootstrap.ts:709-728`).

## 6. Files, terminals, git and persistence findings

All **Read** unless marked.

### F1. Deleting a symlink deletes its target

- `deleteFile` in `files/file-explorer.ts` (roughly 315-326) resolves the real path and then removes
  it recursively. Deleting a symlink in the explorer removes the directory it points to. The root is
  not refused.
- Fix: `lstat` the path and remove the unresolved path, resolving only the parent, as `moveEntry`
  does.

### F2. Stores drop data silently

- `persistence/atomic-store.ts` (roughly 76-90) returns defaults on bad JSON or a schema failure,
  with no log and no quarantine. The next save overwrites the file. One bad record empties the whole
  array in `loops.json`, `rooms.json` or `workspaces.json`.
- `createQueuedJsonWriter` (roughly 115-135) writes in place with no temporary file, so a crash
  mid-write truncates `loops.json`.
- `WorkspaceRegistryService` (`projects/workspace-registry.ts`, roughly 96-160) re-reads, awaits,
  then writes; two concurrent `open_project_request` calls can lose a record.
- `atomicWriteJson` is not serialised per path, so two saves can land out of order.
- Fix: atomic writes everywhere, one promise queue per path, and rename a bad file to
  `*.corrupt-<timestamp>` before falling back to defaults.

### F3. `file_read_request` can exhaust memory or hang

- The handler in `bootstrap.ts:734-757` (copied in `dev-bootstrap.ts`) checks `stat.size` and then
  reads the whole file. `/dev/zero` and `/proc` files report size 0 and read without end; a FIFO
  blocks. `file-transfer.ts` already guards this correctly.

### F4. Terminals

- Stream subscriptions are kept per session in `terminal/terminal-rpc.ts` and never disposed on
  session close; `disposeSession` in `bootstrap.ts:870-875` does not cover terminals. Each flush then
  sends to a dead socket.
- Output has no backpressure: `flush` (`terminal-manager.ts` around line 287) sends to every
  subscriber without checking the send queue, and the PTY is never paused.
- `kill()` sends SIGTERM and removes the entry at once, with no escalation; `killAll` at shutdown
  does not wait.
- PTY data passes through UTF-8 strings (`pty-backend.ts`), which loses binary output.

### F5. File transfer

- The upload stream pool is one map for all sessions over 256 slots. A client that sends 256 upload
  requests without `Begin` starves every other client, and slots are freed only on session close.
  There is no idle timeout and no size cap (`files/file-transfer.ts`, roughly 228-245).
- Upload backpressure pauses reading of the whole session socket (`updateReading`, around line 400),
  so a slow disk stalls that client's RPCs and terminal traffic.
- The upload target is not passed through `expandHome`, so `~/x` lands in a directory literally
  named `~`.
- There is no `fsync` before the final rename.
- Downloads poll the send queue every 10 ms while paused instead of waiting for a drain event.

### F6. File watching and listing

- After a watcher error, an old subscriber's unsubscribe can decrement a newer watch on the same
  directory and tear it down under live subscribers (`files/file-watch-service.ts`, roughly
  125-135). Fix: capture the watch object in the closure and compare identity.
- `file_watch_subscribe` answers `ok: true` when `fs.watch` failed.
- `readDirectory` runs one sequential `stat` per entry with no cap or paging.

### F7. Git

- The git runner uses Node's default 1 MiB output buffer and no timeout (`projects/git-detect.ts`
  around line 16, `bootstrap.ts:716`). A large diff comes back truncated or empty; a hung `git push`
  or `gh` call blocks its RPC forever, and push or pull can prompt for credentials.
- Fix: a timeout, a larger buffer, and `GIT_TERMINAL_PROMPT=0`.
- `checkout_diff_subscribe` keeps its closure and session forever and nothing ever refreshes it
  (`projects/checkout-diff-manager.ts`). It also has no consumer.

### F8. Orchestration: chat rooms, loops and schedules (**Checked** for the first two items)

- `ScheduleService.tick()` has no caller outside tests. A schedule created through the RPC never
  fires; only run-once does anything.
- `LoopService.recover()` has no caller. A loop left `running` by a crash stays `running`.
- `loop_run_request` casts the raw message to its input type, swallows errors from the run with
  `.catch(() => {})`, and still answers `started: true` (`daemon/orchestration-rpc.ts` around
  158-167).
- The loop verifier decides pass or fail with a regular expression in which the word "no" counts as
  a failure, so "All checks pass, no issues" fails (`bootstrap.ts:846-848`).
- Every loop iteration rewrites the whole `loops.json`, including all logs.
- The CLI commands do not match the handlers:
  - `chat post` sends `{message, from}`; the handler reads `body ?? text`.
  - `loop run` sends no `cwd` or `provider`, so the store rejects it.
  - `schedule create` sends `{cron, prompt}`; the handler needs `cadence` and `target`.
  - `terminal capture` reads `.text`; the daemon returns `screen`.
  - `worktree create` sends `{name, workspaceId}`; the handler needs `projectRoot` and `projectId`.
- These mismatches show the feature set has never been run end to end.

### F9. Services built with missing dependencies

- `WorktreeService` is built in `bootstrap.ts:655-660` without `runCommand`, `listAgents`,
  `archiveAgent` or the lifecycle readers. `runCommand` defaults to a no-op success, so setup and
  teardown commands never run, and archiving a worktree does not archive its agents.
- `GitHubService` is given an `archiveWorkspace` callback used only by an auto-archive path that has
  no caller.

## 7. Extensions, skills and viewer settings findings

All **Read**.

- **Credential leak in extension state.** `extensions/sync-executor.ts` (around line 215) stores up
  to 2 KB of raw stderr as the failure message in `extensions-state.json` and sends it to clients as
  `lastError`. The skills path redacts first; this path does not, so credentials in a git URL can be
  stored.
- Install output is accumulated without a cap, and the code listens for `exit` rather than `close`,
  so output can be cut short (`sync-executor.ts:73-107`).
- `extension_packs_set_request` waits for a full sync: several sequential installs at up to 180 s
  each. Skill install and update-all hold the queue for up to 600 s per spawn, and a preview waits
  behind them.
- Running installs are not killed at shutdown (*unverified*).
- The skills watcher suppresses its own writes with a 500 ms time window
  (`resources/resource-service.ts`, roughly 887-905). A slow write or an external edit inside the
  window gives a wrong or missed `skills_changed`.
- The Pi SDK is imported in three places: statically in `session-hydration.ts` and
  `resources/pi-sdk.ts`, lazily elsewhere "for boot resilience". The static imports defeat that
  purpose.
- Viewer settings: a corrupt file loads as all-enabled and the next set overwrites it. `config` is
  an opaque blob nothing reads.

## 8. Structure findings

- **`startDaemon` is one function of about 750 lines** (`bootstrap.ts:298-1052`). It mixes
  composition, inline handlers (`list_agents_request`, `list_workspaces_request`,
  `file_read_request`, `file_diff_request`), the loop and schedule executors, and shutdown.
- **`dev-bootstrap.ts` copies about 60% of it** (542 lines) and has drifted: a different
  `list_workspaces_request`, no subscription disposal on session close, no upload journal, a stubbed
  `schedule_list_request`, a fixed `/tmp/pi-studio-dev` home, and the Host check switched off.
- **The handshake is duplicated line for line** between `ws/ws-server.ts:107-185` and
  `daemon/relay-sessions.ts:81-140`, with two capability stores.
- **`Session` reaches into its socket by duck typing**, and the relay path casts a facade to
  `WebSocket`. A small transport interface would replace both.
- **The provider abstraction has one real implementation.** `AgentSession` has about 35 members,
  most optional and mirroring Pi's RPC one to one. The second implementation is the mock.
- **Agent state lives in three places**: the record on disk, the in-memory `ManagedAgent`, and Pi's
  session file. Model and thinking level are mirrored by hand in four functions.
- **`directory_suggestions_request` and `project_icon_request` are registered twice**, in
  `files/file-explorer.ts` and `projects/open-project.ts`. The registry is last-wins and the two
  versions differ.
- **`packages/server/AGENTS.md` is 2,264 lines.** It is longer than any source file and hard to keep
  truthful.

Suggested shape: a `composeDaemon(deps)` that both entry points call (the dev one passing mocks), one
`registerXxx(registry, deps)` per domain, and an ordered stack of disposers that shutdown unwinds.
That stack also fixes T1.

## 9. What can be dropped today

This section is the audit's proposal. What the owner decided about each item is in
[Decisions](#decisions); where the two differ, Decisions wins.

### 9.1 RPC names with no reference in any client (**Checked**)

Git write operations, stash and branches (12). **Decision: keep**, for the desktop client:

- `checkout_commit_request`, `checkout_switch_branch_request`, `checkout_rename_branch_request`
- `checkout_merge_request`, `checkout_merge_from_base_request`
- `checkout_pull_request`, `checkout_push_request`
- `stash_save_request`, `stash_pop_request`, `stash_list_request`
- `validate_branch_request`, `branch_suggestions_request`

GitHub (6). **Decision: keep**:

- `checkout_pr_create_request`, `checkout_pr_merge_request`, `checkout_pr_status_request`
- `pull_request_timeline_request`, `github_search_request`
- `checkout.github.set_auto_merge.request`

Diff streaming (2): `checkout_diff_subscribe`, `checkout_diff_unsubscribe`. The workbench uses
`file_diff_request`. **Decision: keep.**

Projects and workspaces (7):

- `list_projects_request`, `list_workspaces_request`, `archive_workspace_request`
- `workspace_setup_status_request` (always answers `idle`), `workspace_clear_attention`
- `directory_suggestions_request`, `project_icon_request` (a stub that answers `null`)

Terminals (4): `subscribe_terminals_request`, `unsubscribe_terminals_request`,
`rename_terminal_request`, `start_workspace_script_request`.

Observability (5): `daemon_status_request`, `daemon_status_subscribe_request`,
`daemon_status_unsubscribe_request`, `daemon_logs_subscribe_request`,
`daemon_logs_unsubscribe_request`. These are pinned by the external-client fixtures for the separate
Rust dashboard, so they have a consumer outside this repository. Do not drop them without deciding
what happens to that dashboard.

Schedule names the CLI does not use (5): `create_schedule_request`, `update_schedule_request`,
`delete_schedule_request`, `pause_schedule_request`, `resume_schedule_request`. The CLI uses the
`schedule_*_request` aliases. **Decision: dropped with the rest of orchestration.**

Alias (1): `cancel_agent`. Every client sends `interrupt_agent`.

`agent_clone_request` is referenced by the SDK and the CLI but not by the workbench.

### 9.2 Subsystems and code

| Drop | Size | Why | Decision |
|---|---|---|---|
| `orchestration/` and `daemon/orchestration-rpc.ts` (chat rooms, loops, schedules) | about 1,100 lines | CLI-only and broken (F8). Last changed 2026-06-16. | Approved |
| `proxy/`, `daemon.serviceProxy.*`, three env vars, the `onRequest` hook | about 220 lines | Nothing registers a route, so `handleRequest` always returns false. The HTTP server is `/api/health` plus 404. | Approved |
| CORS and the HTTP bearer path | small | They protect only that 404. | Approved |
| `agent/mcp-server.ts`, its test, and the `supportsMcpServers` plumbing | about 310 lines | Its header says it is not reachable at runtime. No route, no backend, no `--mcp-config`. | Approved |
| Git write, stash, GitHub and diff-subscribe services | `git-operations.ts` 281, `github-service.ts` 236, `checkout-diff-manager.ts` | No consumer today (9.1). | Rejected: keep |
| Mode support for the Pi provider | spread over `agent.ts`, the manifest and the CLI | Cosmetic (A11). | Approved |
| Mock provider and dev daemon in the published package | about 1,200 lines plus `dist/test-support/` | `tsconfig.json` excludes only `*.test.ts`, and `files` ships all of `dist`. Move them to a test-only entry. | Approved |
| `agent/provider-snapshot.ts` | 107 lines | Built only by tests. | Approved |
| `projects/reconciliation.ts`, `projects/workspace-activity.ts` | 90 and 95 lines | No caller. | Approved |
| `PiAgentSession.history` and `streamHistory` | small | No reader; a memory leak. | Approved |
| Unused contract members in `provider-contract.ts` | `setFeature`, `tryHandleOutOfBand`, `RunOptions.outputSchema` and `attachments`, `features`, `getAvailableModes`, `getCurrentMode`, `listModes`, `getDiagnostic`, the legacy `setModel?` | No caller, or Pi does not implement them. | Mode members approved; the rest not asked yet |
| `PROVIDER_CLIENT_FACTORIES` | small | Unreachable for `pi` and `mock`, which are handled first. | Approved, with profiles |
| `extends: "pi"` profiles (`applyModelOverrides`, `additionalModels`, `params.sessionDir`) | spread | Reachable only by editing `config.json` by hand. | Approved |
| `listImportableSessions` | small | No RPC exposes it. | Approved, with profiles |
| Structured-generation stubs for commit message, PR title, PR body and branch name | small | Only `agent_title` is wired; the rest fall back to fixed text. | Keep: they belong to the git RPCs |
| `UploadJournal`'s version gate; possibly the journal itself | small | Temporary files already match a strict name pattern, so a scan at start would do. | Not asked yet |

### 9.3 Compatibility shims

Decision per shim is in [Decisions](#compatibility-shims): six approved drops, three keeps, one
deferral. The list as the audit first gave it:

- `migrateConfig`, `migrateProviderSettings` and the `allowedHosts` rename
  (`config/daemon-config.ts:164-215`).
- `registerAlias` and all six aliases (`ws/router.ts`).
- Field aliases in `orchestration-rpc.ts`: `name ?? title`, `scheduleId ?? id`,
  `cursor ?? sinceCursor`, `body ?? text`. These go with the approved orchestration drop.
- `.passthrough()` on every entity schema. **Decision: keep.**
- `version: z.literal(1)` gates in the upload journal, extension state and viewer settings.
  **Decision: keep.**
- `normalizeWorkspaceKind` accepting the legacy `checkout` kind.
- The unused `normalize` option of `loadStore`.
- `checkoutRefreshEnabled`, `setAutoMergeEnabled` and `restoreModesEnabled`, always `true`.
- `legacyRespondToPermissionSchema` in the protocol package.
- The relay's parking of 0.0.120 daemons (`packages/relay`, `relay-server.ts`). Deferred.

### 9.4 Config keys nothing reads

Decision: approved for `daemon.mcp.*`, `daemon.appendSystemPrompt`, `log.*` (logging reads only
`PI_STUDIO_LOG_LEVEL`), `providers.local.modelsDir` and `worktrees.root` (the service supports it;
`bootstrap.ts` never passes it). The top-level `version` key is also unread but was not in the
approved list.

## 10. Suggested order of work

The owner approved all of this on 2026-11-24: step 4 as the drops, the other nine steps as the nine
improvements (see [Decisions](#decisions)). The approved order is the one in the Decisions table,
which has "return from create and send at once" fourth; this list had it ninth because it changes
the wire contract. Either position works, since it does not depend on steps 5 to 8.

1. **Close the web-page hole (S1, S2).** An `Origin` allowlist on the upgrade, and refuse a
   non-loopback bind without a password. Small, and independent of everything else.
2. **Fix the Pi crash path and add the locks (A1, A2, A3, A4).** Terminal event on exit, detach the
   dead session, one turn lock and one spawn lock per agent.
3. **Fix the timeline (A5, A6).** Seed in `runTurn` first (small), then persist to an append-only
   file.
4. **Delete what was approved (see [Decisions](#decisions)).** This shrinks everything after it,
   including the bootstrap refactor.
5. **Make shutdown ordered and bounded (T1).**
6. **Add liveness and limits to direct sockets (T2, T3).**
7. **Validate inbound RPCs in the router (T4).**
8. **Stop overwriting corrupt files (S5, F2).**
9. **Return from create and send at once (A7).** This changes the wire contract and the CLI.
10. **Merge the two bootstraps (section 8).**

Smaller independent fixes that can go in at any point: F1 (symlink delete), F3 (`file_read_request`),
F4 (terminal leak), T6 (skip store), the credential leak in section 7, A10 (mock default).

## 11. Dropping the web client

**Superseded in part on 2026-11-24:** the owner chose to keep the web client as a second-class "Lite"
(see [Decisions](#web-client-as-lite-desktop-first)). This section stays as the analysis of the
full drop; what was taken from it is listed there.

### 11.1 What falls out immediately

| Item | Where | Effect |
|---|---|---|
| `packages/web-client` | `src/main.tsx`, `vite.config.ts`, `brand/` | About 600 lines with docs. The white-label `PI_STUDIO_BRAND_*` build goes with it. |
| `pi-studio ui` | `packages/cli/src/ui-commands.ts`, `web-server.ts`, the web-client dependency in `packages/cli/package.json`, the `dist/web` copy in `scripts/build-binary.mjs` | About 330 lines, plus the SPA payload in the CLI package and in the single binary. |
| Web Docker image | `docker/web-client.Dockerfile`, the nginx template, the compose service | Includes the `/daemon-ws` proxy that exists so an https page can reach a `ws://` daemon. |
| Release and deploy steps | `scripts/docker-publish.sh`, `dokploy-deploy.sh`, `release.sh`, `.github/workflows/release.yml` | One of three Docker builds, the Vite build that needs a 6 GB heap, one of two deploy polls, the Dokploy `app` stack and `app.molagent.ai`. Time saved was not measured. |
| npm publishing | `PUBLISH_ORDER` in `scripts/publish.sh` | `web-client`, `workbench` and `ui-library` are published only to feed `web-client` into the CLI. The desktop app builds them from source. Eight published packages become five. |
| Pairing-link origin | `packages/cli/src/pairing.ts`, `config.app.baseUrl`, `PI_STUDIO_APP_BASE_URL` | The https wrapper exists so a browser can open the link. A `pistudio://pair?…` link or a bare string is enough; the Rust side already parses the fragment form. |
| CORS, the Host allowlist's browser role, the subprotocol echo | `http/http-server.ts`, `ws/ws-server.ts:67-73` | Browser-only. |
| Browser launch grammar | `packages/workbench/src/host/browser-launch.ts`, `lib/agent-deep-link.ts` | `?host=&password=&cwd=` puts the daemon password in the URL and in history. |
| Browser fallbacks | Blob downloads, the clipboard fallback, the password in `localStorage`, the Blob decode path in `daemon-client.ts` | About 15 KB plus the tests that cover them. |
| Desktop `--transfers page` mode | `desktop/` shell crate and the TypeScript save path | It exists only so the browser file path still works inside the app. The Rust engine is already the default. |

Total: about 4,000 lines, roughly half of them tests. The pipeline savings matter more than the line
count.

Conditional: the TypeScript client side of the relay channel (`createClientChannel` in
`packages/relay`, `packages/client/src/relay-transport.ts`) can go if the Rust client and the shared
fixtures become the only reference client. It is still used by a CLI end-to-end test and by
`scripts/daemon-update-check`.

### 11.2 Design changes that become possible

Ranked by value.

**1. Local daemon on a Unix socket or named pipe.** Effort: small to medium.

- Today the desktop app reaches its local daemon over loopback TCP with a password, and its Rust side
  sends a browser-style `Host` header (`desktop/crates/net/src/dial.rs`).
- A browser cannot dial a Unix socket, so this closes S1 by construction. For the local case it also
  removes port conflicts, the password and the stored secret.
- Node listens on a path directly, including Windows named pipes; the Rust dialer is already generic
  over a byte stream; the CLI's `ws` library accepts a socket path.
- Auth becomes file mode 0600 or peer credentials.
- Risks: Windows pipe permissions. Docker and remote daemons still need TCP.

**2. Reject every upgrade that carries an `Origin`.** Effort: small.

- A ten-line fix for S1 on the TCP listener. It is impossible while the hosted app has to connect.

**3. Real client identity.** Effort: medium to large.

- Replaces both the bcrypt password (S4) and the public key used as a credential (S3).
- The app generates a keypair and keeps it in the OS keychain (`desktop/crates/secrets`). Pairing adds
  it to an authorised-clients list on the daemon. Both transports verify it in the handshake; the
  relay channel already has the machinery.
- Gives per-client revocation.
- Where a bearer token remains (CLI, Docker), make it a random 256-bit value sent in an
  `Authorization` header.
- Risks: a protocol and relay version bump; the CLI and Docker flows need a pairing step.

**4. Bulk data on its own connection only.** Effort: medium.

- Today files ride the control socket as slot-multiplexed binary frames, and an upload's backpressure
  pauses the whole session (F5).
- The Rust transfer crate already opens a dedicated connection and marks it with
  `hello.agentStreams: "none"`.
- Making that the only path deletes the TypeScript `FileTransferClient` (about 27 KB plus about 40 KB
  of tests), the in-band slots and the 10 ms polling.
- Over direct and SSH connections, plain HTTP range requests would give native backpressure and
  resume. The relay carries only WebSocket frames, so there the bulk path stays framed.
- Risk: relay client limits would count transfer connections.

**5. Standard WebSocket ping, with liveness on the daemon side.** Effort: small to medium.

- JSON `ping`/`pong` exists because browsers do not expose protocol pings. It needs a worker timer to
  dodge hidden-tab throttling, and the Rust transfer connection reimplements it.
- The daemon would ping on an interval and terminate on a missed pong (fixes T2). The JSON pair, the
  SDK's `ping` and the worker timers go.

**6. SSH without a daemon TCP port.** Effort: small to medium.

- Today the SSH transport opens a channel to `127.0.0.1:<port>` on the host and runs the WebSocket
  upgrade over it, so the remote daemon must listen on TCP.
- With item 1, forward to the socket instead, or run a stdio shim. SSH is then the whole auth story.
- Risk: socket forwarding may be disabled on the host; keep the stdio shim as the fallback.

**7. One protocol version instead of feature flags.** Effort: medium. Not strictly browser-driven.

- `SERVER_FEATURES` has about 20 flags plus client capabilities, mostly to cover version skew between
  a hosted SPA and old daemons.
- The app owns daemon install and update, so skew can be refused: one `hello.protocol` integer,
  matched exactly.
- Risk: remote daemons the user has not updated; the refusal needs a clear message and an update
  path.

**8. Rust-owned persisted state.** Effort: medium. Small value.

- `WorkbenchHost.storage` is synchronous because `localStorage` is. The desktop app fakes that with a
  snapshot at start and write-behind.

### 11.3 What does not go away

- The workbench is still TypeScript in a webview. The host seam stays; `createBrowserHost` is spread
  into the desktop host and would be renamed and trimmed, not deleted.
- The CLI still connects over WebSocket, so the daemon keeps a WebSocket server and some secret for
  it.
- Docker and headless remote daemons still need TCP, a Host policy and auth.
- The relay is still needed for NAT traversal, with its flow control, ping and encryption.
- The desktop loopback proxy stays. The benchmark in `swe/features/desktop-transport-bridge.md` showed
  no Tauri channel variant passing the throughput rows on all three systems. Item 4 above takes the
  heaviest traffic off that path anyway.
- Phone and browser access would be gone for good.

### 11.4 The security argument

With a browser as a first-class client, the daemon has to accept connections that carry a browser
origin. An allowlist limits that to the hosted app, but then a compromise of the hosted app (or a
script injection in it) can reach the daemon of every user who has it open. With the desktop app
only, the daemon never accepts a browser origin at all, and the local case needs no network listener.

## 12. Parts that were checked and found sound

So that a later reader knows what was covered and need not be re-read first.

- Host-header allowlist logic, against DNS rebinding, on both the HTTP and WebSocket paths.
- `SessionSubscriptions`: a clean disposer registry.
- The router's `afterReply` ordering, error correlation and unknown-type handling.
- `relay-transport.ts`: backoff, jitter, timers, the connection cap, `close()`.
- `relay-connection.ts`: timers all cleared, real backpressure on inbound frames.
- `DaemonStatusService` and `DaemonLogsService`: timers only while subscribed, bounded queues, a
  token bucket. `LogTap` has a bounded ring and redaction.
- `update-service.ts`: single-flight, unreferenced timer, a reasoned pipeline.
- Config and keypair files are written with mode 0600.
- Download streaming in `file-transfer.ts`: water marks, per-session ids, range and `ifUnchanged`
  handling, handles closed on every path, bounded memory.
- Upload ordering and cleanup: temporary file, final rename, removal on every error path.
- `FileExplorerService.writeFile` and `createEntry`.
- Terminal grid validation, the snapshot ring, idempotent exit.
- `atomicWriteJson` for a single writer.
- File watching: non-recursive, per-session cap, cleanup on close.
- Git and `gh` are run with argument arrays, never through a shell.
- JSONL framing splits on `\n` only; a missing Pi binary becomes a clean failure.
- `AgentManager.closeAll` bounds each close; `recover()` normalises stale statuses.
- `AgentUiService`: daemon-minted ids, first answer wins.
- `ProviderAuthService`: one terminal event, a time limit, per-session ownership.
- Viewer-settings writes are serialised; `ExtensionsService.sync` is serialised.
- `redactSource` runs before truncation.

## 13. Open questions

- **Is the skip store unwired on purpose (T6)?** It may be unfinished work on this branch.
- **Does anything still use the Rust dashboard** that consumes the `daemon_status_*` and
  `daemon_logs_*` fixtures? If not, that family and its fixtures are droppable too.
- **Are chat rooms, loops and schedules wanted?** Answered 2026-11-24: no, drop them.
- **Are the git write and GitHub RPCs planned?** Answered 2026-11-24: yes, for the desktop client.
  They need timeouts and `--` before positional arguments first (F7, S6).
- **Is mode support (`plan` / `default` / `full-access`) meant to do something?** Answered
  2026-11-24: no, drop it.
- **Still open from the decisions round:** only the relay parking of old daemons, which is deferred
  on recommendation and not yet confirmed by the owner.
- **Does a Pi process exit when its stdin closes?** If not, a daemon killed with SIGKILL orphans
  every agent. Not tested.
- **Do newer browsers block a public page from reaching `ws://127.0.0.1`?** Not tested; relevant only
  to how urgent S1 is, not to whether to fix it.

## 14. How to reproduce

The throwaway daemon and the `Origin` probe. Run from the repository root with a built
`packages/server/dist`. Nothing is written outside the temporary directory.

```bash
T=$(mktemp -d /tmp/pis-audit.XXXX); mkdir -p $T/home $T/pi; PORT=47613
PI_STUDIO_HOME=$T/home PI_STUDIO_PI_HOME=$T/pi \
PI_STUDIO_EXTENSIONS_AUTOSYNC=false PI_STUDIO_UPDATE_AUTOCHECK=false \
PI_STUDIO_LISTEN=127.0.0.1:$PORT \
node packages/server/dist/daemon/main.js > $T/out.log 2>&1 &
PID=$!; sleep 2

# S1: expect "HTTP/1.1 101 Switching Protocols" today; a fixed daemon answers 403.
curl -s -m 3 -i -N \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: https://evil.example' \
  http://127.0.0.1:$PORT/ | head -5

grep -E 'VmRSS|Threads' /proc/$PID/status
kill $PID; rm -rf $T
```

The RPC consumer check: collect every name passed to `.register(` or `.registerAlias(` under
`packages/server/src` (tests excluded), then search each name in `packages/client/src`,
`packages/workbench/src`, `packages/cli/src` and `desktop/` (tests, `target/` and `node_modules/`
excluded). A name with no match is in section 9.1.
