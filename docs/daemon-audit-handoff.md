# Daemon audit handoff

A read-only audit of the daemon (`packages/server`), with two questions answered:

1. What is bad about the daemon today, and what can be fixed or dropped now?
2. What becomes possible if the browser web client is dropped and the desktop app is the only
   graphical client?

Written 2026-11-24 against commit `3e25cec5` on `feat/single-binary-daemon`, daemon version
`0.0.130`. Line numbers are from that commit and will drift. Nothing in the repository was changed
by the audit; this file is its only output.

This is a snapshot, not a maintained document. Before acting on a finding, re-check it against the
code: other agents were changing the tree while the audit ran.

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

- `bootstrap.ts` passes no `skipStore` to `UpdateService`, so `createFileSkipStore`
  (`update/update-service.ts:581`) is used only by tests. A version that was rolled back is forgotten
  on the restart the update caused, and is offered again. This contradicts the decision that a
  rolled-back version is not offered again. It may be unfinished work on this branch.
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

### 9.1 RPC names with no reference in any client (**Checked**)

Git write operations, stash and branches (12):

- `checkout_commit_request`, `checkout_switch_branch_request`, `checkout_rename_branch_request`
- `checkout_merge_request`, `checkout_merge_from_base_request`
- `checkout_pull_request`, `checkout_push_request`
- `stash_save_request`, `stash_pop_request`, `stash_list_request`
- `validate_branch_request`, `branch_suggestions_request`

GitHub (6):

- `checkout_pr_create_request`, `checkout_pr_merge_request`, `checkout_pr_status_request`
- `pull_request_timeline_request`, `github_search_request`
- `checkout.github.set_auto_merge.request`

Diff streaming (2): `checkout_diff_subscribe`, `checkout_diff_unsubscribe`. The workbench uses
`file_diff_request`.

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
`schedule_*_request` aliases.

Alias (1): `cancel_agent`. Every client sends `interrupt_agent`.

`agent_clone_request` is referenced by the SDK and the CLI but not by the workbench.

### 9.2 Subsystems and code

| Drop | Size | Why |
|---|---|---|
| `orchestration/` and `daemon/orchestration-rpc.ts` (chat rooms, loops, schedules) | about 1,100 lines | CLI-only and broken (F8). Last changed 2026-06-16. If kept, wire `tick()` and `recover()` and fix the CLI payloads. |
| `proxy/`, `daemon.serviceProxy.*`, three env vars, the `onRequest` hook | about 220 lines | Nothing registers a route, so `handleRequest` always returns false. The HTTP server is `/api/health` plus 404. |
| CORS and the HTTP bearer path | small | They protect only that 404. |
| `agent/mcp-server.ts`, its test, and the `supportsMcpServers` plumbing | about 310 lines | Its header says it is not reachable at runtime. No route, no backend, no `--mcp-config`. |
| Git write, stash, GitHub and diff-subscribe services | `git-operations.ts` 281, `github-service.ts` 236, `checkout-diff-manager.ts` | No consumer (9.1). |
| Mode support for the Pi provider | spread over `agent.ts`, the manifest and the CLI | Cosmetic (A11). Implement it or remove it. |
| Mock provider and dev daemon in the published package | about 1,200 lines plus `dist/test-support/` | `tsconfig.json` excludes only `*.test.ts`, and `files` ships all of `dist`. Move them to a test-only entry. |
| `agent/provider-snapshot.ts` | one file | Built only by tests. |
| `projects/reconciliation.ts`, `projects/workspace-activity.ts` | two files | No caller. |
| `PiAgentSession.history` and `streamHistory` | small | No reader; a memory leak. |
| Unused contract members in `provider-contract.ts` | `setFeature`, `tryHandleOutOfBand`, `RunOptions.outputSchema` and `attachments`, `features`, `getAvailableModes`, `getCurrentMode`, `listModes`, `getDiagnostic`, the legacy `setModel?` | No caller, or Pi does not implement them. |
| `PROVIDER_CLIENT_FACTORIES` | small | Unreachable for `pi` and `mock`, which are handled first. |
| `extends: "pi"` profiles (`applyModelOverrides`, `additionalModels`, `params.sessionDir`) | spread | Reachable only by editing `config.json` by hand. |
| `listImportableSessions` | small | No RPC exposes it. |
| Structured-generation stubs for commit message, PR title, PR body and branch name | small | Only `agent_title` is wired; the rest fall back to fixed text. |
| `UploadJournal`'s version gate; possibly the journal itself | small | Temporary files already match a strict name pattern, so a scan at start would do. |

### 9.3 Compatibility shims

- `migrateConfig`, `migrateProviderSettings` and the `allowedHosts` rename
  (`config/daemon-config.ts:140-198`).
- `registerAlias` and all seven aliases (`ws/router.ts`).
- Field aliases in `orchestration-rpc.ts`: `name ?? title`, `scheduleId ?? id`,
  `cursor ?? sinceCursor`, `body ?? text`.
- `.passthrough()` on every entity schema, kept for "older daemons".
- `version: z.literal(1)` gates in the upload journal, extension state and viewer settings.
- `normalizeWorkspaceKind` accepting the legacy `checkout` kind.
- The unused `normalize` option of `loadStore`.
- `checkoutRefreshEnabled` and `setAutoMergeEnabled`, always `true`.
- `legacyRespondToPermissionSchema` in the protocol package.
- The relay's parking of 0.0.120 daemons (`packages/relay`, `relay-server.ts`).

### 9.4 Config keys nothing reads

`daemon.mcp.*`, `daemon.appendSystemPrompt`, `log.*` (logging reads only `PI_STUDIO_LOG_LEVEL`),
`providers.local.modelsDir`, `worktrees.root` (the service supports it; `bootstrap.ts` never passes
it), `version`.

## 10. Suggested order of work

1. **Close the web-page hole (S1, S2).** An `Origin` allowlist on the upgrade, and refuse a
   non-loopback bind without a password. Small, and independent of everything else.
2. **Fix the Pi crash path and add the locks (A1, A2, A3, A4).** Terminal event on exit, detach the
   dead session, one turn lock and one spawn lock per agent.
3. **Fix the timeline (A5, A6).** Seed in `runTurn` first (small), then persist to an append-only
   file.
4. **Delete the dead subsystems (section 9).** This shrinks everything after it, including the
   bootstrap refactor.
5. **Make shutdown ordered and bounded (T1).**
6. **Add liveness and limits to direct sockets (T2, T3).**
7. **Validate inbound RPCs in the router (T4).**
8. **Stop overwriting corrupt files (S5, F2).**
9. **Return from create and send at once (A7).** This changes the wire contract and the CLI.
10. **Merge the two bootstraps (section 8).**

Smaller independent fixes that can go in at any point: F1 (symlink delete), F3 (`file_read_request`),
F4 (terminal leak), T6 (skip store), the credential leak in section 7, A10 (mock default).

## 11. Dropping the web client

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
- **Are chat rooms, loops and schedules wanted?** They are either a feature to finish (wire the
  timer, recovery and CLI payloads, add a UI) or about 1,100 lines to delete.
- **Are the git write and GitHub RPCs planned for the workbench?** If yes, they need timeouts and
  `--` before positional arguments first (F7, S6).
- **Is mode support (`plan` / `default` / `full-access`) meant to do something?** Today it does not.
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
