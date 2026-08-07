# Implementation Plan

> Derived from the clean-room scope in `swe/`. Sprints and tasks are listed in
> implementation order. Execute with the `clean-room-implement` agent, one sprint at a time.
> Task numbering restarts at 001 within each sprint; numeric order = execution order.

## Strategy

Build bottom-up so a later task never depends on something unbuilt:
1. **Foundation** (sprint 001–003): monorepo + tooling, the shared `protocol` wire contract, then
   persistence + configuration.
2. **Daemon core** (sprint 004–006): bootstrap/security/WS server, provider + lifecycle, then agent
   sessions/timeline/permissions — the runnable heart of the system.
3. **Client SDK** (sprint 007): the `@av-pi-studio/client` driver + facade so CLI and app share one
   client.
4. **Workspace & orchestration features** (sprint 008–010): projects/worktrees/git, then
   terminals/proxy/files, then MCP/chat/schedules/loops.
5. **Client logic** (sprint 011–016): CLI, then the visual UI *logic layer* — design system, screens,
   workspace shell, timeline/composer, and feature panels built as **framework-agnostic view models**
   (pure TypeScript, Vitest-tested).
6. **UI render layer** (sprint 017–022): a **React 19 + Vite DOM** app (web + Electron only, no mobile)
   that renders the sprint 012–016 view models — runtime foundation, primitives + nav chrome, navigation
   screens, the workspace shell, timeline/composer, and feature panels. The UI/UX mirrors the reference
   app (Paseo); the DOM stack replaces its Expo/React-Native-Web stack (see
   `architecture/design-system.md` § UI technology stack).
7. **Remote access & desktop** (sprint 023–025): relay E2EE, the Electron desktop shell (which wraps the
   Vite web build), then Electron-only SSH gateway connections after the desktop shell exists.

Each sprint ends in a buildable, testable state. Tests run per-file with Vitest
(`npx vitest run <file>`); the daemon is exercised in tests via the in-process `mock` provider.

## Sprint overview
| # | Sprint | Goal | Tasks |
|---|--------|------|-------|
| 001 | `sprint-001-foundation` | Monorepo, tooling, build layering, validation conventions | 3 |
| 002 | `sprint-002-protocol` | Shared wire contract: envelopes, caps, session schemas, binary codecs | 5 |
| 003 | `sprint-003-persistence-config` | File-based JSON stores + daemon/project config | 4 |
| 004 | `sprint-004-daemon-bootstrap-security` | PID lock/identity, HTTP+WS servers, auth, routing, bootstrap | 5 |
| 005 | `sprint-005-provider-lifecycle` | Provider contracts + Pi adapter + registry/snapshot + AgentManager + archive | 5 |
| 006 | `sprint-006-agent-sessions-timeline` | Timeline store, create/run/stream, fetch, ops, permissions, structured-gen | 6 |
| 007 | `sprint-007-client-sdk` | DaemonClient driver, Pi-StudioClient facade, terminal router/reconnect | 3 |
| 008 | `sprint-008-projects-worktrees-git` | Projects/workspaces, worktrees, git status/ops, GitHub PRs | 6 |
| 009 | `sprint-009-terminals-proxy-files` | PTY terminals, service proxy, file explorer/transfer, highlight | 6 |
| 010 | `sprint-010-orchestration` | MCP server, chat rooms, schedules/heartbeats, loops | 4 |
| 011 | `sprint-011-cli` | Commander CLI: core, agent, daemon, feature command groups | 4 |
| 012 | `sprint-012-ui-foundation` | Design-system tokens/themes, styling-engine conventions, shared primitives, localization + keyboard-shortcut infra, white-label branding | 6 |
| 013 | `sprint-013-app-navigation-screens` | Host runtime/app shell, routing, onboarding/pairing, open-project/new-workspace, settings/projects/sidebar, cross-host sessions/schedules + command center | 5 |
| 014 | `sprint-014-workspace-shell` | Tab model/registry, pane/split + DnD, screen composition/headers, seeding/pinned-targets/gating/mobile switcher | 4 |
| 015 | `sprint-015-timeline-and-composer-ui` | Timeline reducers/render model + rows + tool-cards + diffs/permissions + markdown, composer surface/stores, rewind | 7 |
| 016 | `sprint-016-feature-panels-ui` | Panel contract, file explorer/preview, git panel (+ PR activity/context-attach), terminal pane, browser pane + subagents track | 5 |
| 017 | `sprint-017-app-runtime-foundation` | Vite+React DOM app scaffold + build targets, theme→CSS bridge, providers/stores, router shell + boot gating | 4 |
| 018 | `sprint-018-ui-primitives-nav-chrome` | Core DOM primitives, overlay/portal/feedback infra, left sidebar + command center | 3 |
| 019 | `sprint-019-navigation-screens` | Onboarding/pairing, home/sessions, open-project/new-workspace, settings/projects/hosts, schedules + command-center wiring | 5 |
| 020 | `sprint-020-workspace-shell-screens` | Workspace scaffold + route gating, tab strip + pins, pane/split tree + web DnD, header/switcher/bulk-close | 4 |
| 021 | `sprint-021-timeline-composer-screens` | Virtualized timeline + rows/markdown + tool/diff/permission cards, composer surface, rewind UI | 5 |
| 022 | `sprint-022-feature-panel-screens` | Explorer + file preview, git panel (+PR activity/attach), terminal pane (xterm), browser pane + subagents track | 4 |
| 023 | `sprint-023-data-hooks-integration` | Session store (Zustand), React Query hooks for all entities, terminal stream controller, connection provider wiring | 5 |
| 024 | `sprint-024-workspace-wiring` | Workspace route state, tab layout store, pane content router with keepalive, timeline subscription, header/sidebar live wiring | 4 |
| 025 | `sprint-025-composer-full` | Draft persistence (IndexedDB), full submission pipeline, attachments (image/GitHub/browser), autocomplete with real data, voice dictation, provider usage | 4 |
| 026 | `sprint-026-timeline-full` | Streaming message render, syntax highlighting, tool call detail sheets + permission RPC, thinking/activity/compaction, rewind/fork integration | 4 |
| 027 | `sprint-027-git-full` | Production diff viewer (unified/split + word-level), commit box, branch switcher, PR panel with real data, checkout status, worktree UI | 4 |
| 028 | `sprint-028-polish-a11y` | Loading skeletons, empty states, error boundaries, animations (framer-motion), responsive breakpoints, keyboard a11y, theme variants, custom scrollbar | 5 |
| 029 | `sprint-029-final-app-shell` | Assemble the real root shell (theme boundary, left sidebar, command center, shortcuts) replacing the ad hoc placeholder; wire real screens (Home/Sessions/Schedules/Settings) to live data via adapters; assemble the real Workspace screen (tab strip/pane tree/header); wire boot gating + route grammar + onboarding | 4 |
| 030 | `sprint-030-integration-gap-closure` | Close integration gaps in the shipped web app: agent-detail route, new-agent provider picker, tab context actions + pinned quick-launch, schedule detail view, live header fields + bundle code-splitting | 5 |
| 031 | `sprint-031-provider-usage-setup-backend` | New daemon/protocol scope: provider-usage RPC + UI wiring, workspace setup-panel/scripts surface (feeds s030 header fields) | 3 |
| 032 | `sprint-032-relay-e2ee` | Relay crypto/channels, daemon+client transports, Cloudflare server | 4 |
| 033 | `sprint-033-desktop` | Electron shell+daemon supervisor, multi-window, native integrations (permissions/updates), browser panes | 4 |
| 034 | `sprint-034-ssh-gateway-connections` | Electron-only SSH tunnel profiles, bridge/runtime integration, UI, hardening | 5 |
| 035 | `sprint-035-production-daemon` | Real production daemon: bootstrap + real Pi provider + disk persistence, register ALL handlers, terminals/binary frames, security + E2E (no mocks) | 4 |
| 036 | `sprint-036-paseo-ux-parity` | Full Paseo UX/UI parity for the whole app: design tokens, sidebar redesign, navigation screens, workspace shell, timeline/composer, feature panels + wiring gaps | 6 |
| 037 | `sprint-037-agent-slash-commands` | Server+SDK+CLI support for Pi built-in slash commands that have RPC equivalents (`/session`, `/compact`, `/new`, `/resume`, `/fork`, `/clone`, `/name`, `/export`, `/model`, `/copy`): protocol schemas, provider-contract + Pi adapter, daemon handlers, mock, SDK facade, CLI (web-client deferred) | 6 |
| 038 | `sprint-038-tab-strip-new-tab-menu` | web-client: TabStrip "+" button opening a New chat / New terminal menu, scoped to the active workspace (GitHub issue #8); dedupes the New-chat-tab creation path into one shared helper alongside the existing `openNewTerminal` | 3 |
| 039 | `sprint-039-agent-turn-steering` | Steer a live agent turn end-to-end: inject a message mid-turn (Pi `steer`/`follow_up`) + `queue_update` event — protocol schemas, provider-contract + Pi adapter, daemon handlers, mock, SDK facade, CLI, and web-client (Send→Steer swap + queued badge) | 8 |
| 040 | `sprint-040-agent-command-discovery` | Server-only: surface Pi's `get_commands` (extension commands, prompt templates, skills) as a per-session `agent_list_commands_request` discovery RPC — protocol schemas, enriched command-definition contract + Pi adapter `listCommands`, daemon handler, mock + docs (SDK/CLI/UI deferred) | 4 |
| 041 | `sprint-041-agent-turn-settlement` | Fix premature turn termination: the Pi adapter declares a turn terminal on the first `agent_end`, but Pi emits one `agent_end` per low-level run (with `willRetry`) and a single `agent_settled` at the true end — retried/compaction/continued turns appear finished mid-flight, lose post-retry stream rows, flip status to idle early, and can auto-archive a live agent. Make the event-mapper settlement-driven (honour `willRetry`, derive terminal kind from the settled run's `stopReason`), wire it per-session, add a fake-transport `agent_settled` + retry-subscription regression, and sync scope/AGENTS docs | 3 |
| 042 | `sprint-042-workspace-status-bar` | web-client: a full-width ~75px bottom powerline status bar for the active session — icon-prefixed segments (model · cwd · git branch+ahead/behind/dirty/conflict · context % · token total · cost), fully swapping on session switch with live branch and per-session-cached stats. UI-primary: adds optional `model`/`provider` to `list_agents_response` and a poll-reconciled `model` to `agent_session_stats` (append-only); retains git branch meta in git-store, adds `SessionEntry.model` + a per-session stats-store, a `use-session-stats` poll, pure formatters, the `StatusBar` component, and docs | 7 |
| 043 | `sprint-043-model-selector` | web-client: a per-conversation model selector in the chat composer (left of the input) showing the current model, opening an anchored popup with a fuzzy search filter, checkmark on the selected model (sorted first), and rows of `label (id)` with the id in muted text. Unblocks the picker by registering the previously-unserved `list_provider_models` daemon RPC (both bootstraps, via `AgentClient.listModels`), types the client SDK response, and reuses the fully-wired `agent_set_model_request` for selection. | 5 |
| 044 | `sprint-044-molecule-viewer-live-files` | web-client + daemon: a **molecule viewer** tab type built on `@molviewer/core` — molecular files (`.pdb`/`.cif`/`.xyz`/`.mol`/`.mol2`/`.gro`/`.lammpstrj`/`.xsf`/POSCAR) open in a 3D viewer instead of the text viewer, plus an empty "New molecule view" from the TabStrip "+" menu. Adds the daemon's **first real filesystem watcher** (`FileWatchService`, `fs.watch` per directory, ref-counted, 150 ms coalescing) behind a `file_watch_*` subscription family, which powers both an edit-gated live reload of open molecule tabs (`sourceMode="update"` preserves camera/selection; skipped while the user has unsaved in-viewer edits) and a **live file tree** (expanded directories refresh on create/delete/rename from any writer, not just agent tools). Also raises the file-read ceiling — 512 KiB → 5 MiB inline (async, so a big read no longer blocks the event loop), streamed uncapped above that, 30 MiB display cap. Fixes a pre-existing per-session subscription leak on disconnect on the way past. | 10 |
| 045 | `sprint-045-inline-image-rendering` | web-client + daemon + protocol: **inline images in the chat timeline**. `![alt](path)` in a finalized assistant message renders the real image, with bytes streamed over the existing chunked binary file-transfer path — workspace-relative, absolute, and `~` paths all resolve; remote URLs pass through untouched; non-image extensions and missing files degrade to readable text, never a broken-image glyph. Reuses the seam that already exists (`react-markdown`'s per-tag override map, currently holding only `code`) plus a new ref-counted LRU object-URL cache, because the file-viewer download hook's revoke-on-unmount ownership is wrong under timeline virtualization. Second half: a new client→daemon `inline_image_markdown` capability advertised in `hello` (web-client currently advertises none) that makes the daemon append a short image-rendering instruction to the session's system prompt at create time, so only surfaces that can render images are told to emit them. Also closes two pre-existing defects the feature trips over: `file_download_token_request` never expanded `~` (unlike `file_read_request`), and session **resume** dropped the per-session `systemPrompt`. | 7 |
| 046 | `sprint-046-file-explorer-move` | web-client + daemon: **drag-and-drop move/rename in the file explorer**. Adds the file surface's first mutation of this kind — a `fs.rename`-shaped `file_move_request` on `FileExplorerService` with all eight rejections decided server-side (`empty_path`, `invalid_name`, `not_found`, `not_a_directory`, `same_path`, `into_descendant`, `exists`, `cross_device`), and **parent-only** symlink resolution so a symlink row moves as the link, not its target. A same-parent destination is a rename, so no second RPC is ever needed for that. Collision is a hard error — never overwrite, never merge. On the client it extends the **native HTML5** drop zone already serving OS-file uploads with an `application/x-pi-studio-path` MIME type (dnd-kit is deliberately not used: it fits `TabStrip`'s flat reordering, not re-parenting into a virtualized tree), puts every legality rule in one pure `resolveMoveTarget`, carries expanded paths + selection to the new prefix via `repathAfterMove`, invalidates exactly the two affected listings, and reopens an open tab at its new path. | 6 |
| 047 | `sprint-047-file-explorer-rename` | web-client + daemon: **explicit rename in the file explorer**, completing item 9 of the improvements triage. Rename is a same-parent `file_move_request`, so no new RPC is needed — the work is a row-substituting inline editor (`file-tree.ts` replaces the edited row rather than inserting one, keeping `TreeNode` hook-free), sibling `renaming` state in `explorer-store` that is mutually exclusive with the create draft, and a context-menu-only trigger (**no F2** — recorded decision). Extracts `moveDropped`'s post-move sequence into a shared `applyMove` and corrects two defects in it: the daemon-echoed destination was discarded, and diff tabs on the moved path closed **silently** — they now stay closed (a per-path `git diff` after a rename renders the whole file as additions) but the status line reports the count. One daemon fix: `moveEntry` validated the trimmed destination basename but joined the untrimmed one. | 6 |
| 050 | `sprint-050-connection-resilience` | web-client + client SDK: fix two connection-layer failure modes that browsers impose and this app's core usage pattern (watch long-running agents while doing something else) makes constant. **(a)** Hidden-tab timer throttling stretches the reconnect ladder from sub-second to minute-granularity — fixed by backing `ReconnectionManager`'s backoff with a Web Worker through the `setTimer`/`clearTimer` seam it already exposes for tests, so no SDK change is needed for it. **(b)** A half-open socket after laptop sleep / NAT expiry leaves the UI reading `open` forever, because the web client has **no client→server liveness loop** and socket events are its only inputs — fixed by a `ping` probe fired on tab-visible/network-online that closes the socket (code 4000) when it times out. That probe is the one caller permitted to conclude socket death from a timeout; the reconciliation against invariant 6 (`rpcTimeoutMs` ≠ socket death) is written into the scope and must be commented at the call site. Adds one additive SDK method, `ReconnectionManager.reconnectNow()`, so a resume signal can bypass the remaining backoff rung instead of waiting it out. No protocol, daemon, or persistence change. | 4 |
| 051 | `sprint-051-file-link-rendering` | web-client + daemon + protocol: **actionable file links in the chat timeline** (`[label](path)` opens the file as a tab), the sibling feature to sprint-045's inline images sharing its capability→instruction→markdown-override shape. Fixes a shared pane-targeting defect along the way — click-to-open (both this feature's and the pre-existing inline-image one) currently lands in whichever pane is globally focused rather than the pane the message is rendered in, because no component between the pane host and a markdown node-override carries a pane id — and fixes a shared classifier gap (`classifyImageSrc`'s `local` results were unnormalized and not percent-decoded, which would have silently broken this feature's tab-reuse acceptance criteria). Drag-to-split reuses the existing Files-tree `path` payload with zero drop-side changes. Generalizes the daemon's single-capability system-prompt ternary into an ordered, N-capability composition so both instructions compose deterministically. | 6 |
| 052 | `sprint-052-terminal-sizing` | web-client + daemon: fix the terminal's **PTY size handshake**, the single root cause behind unused horizontal space, mangled long-command editing, ghost characters on backspace, and scrambled redraws. The PTY runs at the 80×24 default for its whole life while xterm renders ~140×35, because `TerminalPanel` calls `fitAddon.fit()` *before* attaching `onResize` and `FitAddon` only resizes on a dimension **change** — so the one size-changing fit of the panel's life fires with no listener, and every later refit is a silent no-op. Implements all three size-claim triggers the scope has always specified and the code has never had (create-time `cols`/`rows`, genuine viewport change, focus/tap), with dedupe, coalescing, and the explicit non-triggers enforced. Second, independent garbling cause fixed too: the daemon's 64 KiB snapshot ring is cut on a raw byte boundary (frequently mid-escape-sequence) and the client `clear()`s instead of `reset()`ing before replay. Zero protocol change; the daemon already forwards `cols`/`rows`. | 6 |
| 053 | `sprint-053-terminal-fidelity` | web-client + daemon + protocol: the terminal's remaining conformance gaps, all against **already-written** scope. **(a)** The emulator ignores the appearance system entirely — a hardcoded 19-colour dark literal and the *unscaled* `baseFontSize.sm` — while `colors.terminal` already builds a full per-variant xterm ANSI map and `theme.ts` already scales every rung from the user's 10–24 px setting; unreachable from a component because `ThemeBoundary` keeps the controller private and only emits CSS vars, so a theme context lands first. A font change alters cell metrics, hence refit + size claim. **(b)** An exited PTY leaves a zombie tab: there is no close opcode, `onExit` only clears subscribers, and the `terminals_update` broadcast has zero web-client consumers (and isn't even sent on self-exit). **(c)** Implements restore **tier 2** — `Restore` (`0x05`), `terminal-restore-modes`, and `terminal_reflowable_snapshot` have all existed since sprint-002 and are wholly dead: no server path emits the frame, no client advertises the capability. A serialized headless-grid redraw makes reattach width-correct instead of approximate. | 6 |

Total: **51 sprints, 251 tasks** (summed from the table above, still excluding 048/049 per the gap
noted below). Recompute from the table rather than trusting a hand-maintained figure.

> **Index gap (found while planning sprint 050, not introduced by it):**
> `sprint-048-workspace-split-panes-model` and `sprint-049-workspace-split-panes-ui` exist on disk
> with completed tasks but appear in neither the table above nor the task index below, so the
> totals here exclude them. Reconstructing those two sections from their `done/` folders is a
> separate housekeeping pass — deliberately not folded into this sprint's planning.

> **UI audit note:** sprints 012–016 (the UI client) were re-audited against the live Paseo reference
> after this plan's initial draft (Paseo had moved on in the interim — rewind, provider usage,
> cross-host Sessions/Schedules + command center, localization, the keyboard-shortcut system, pinned
> quick-launch targets, and the PR activity timeline/context-attach were all added or corrected as a
> result). See the new/updated scope files: `features/rewind.md`, `features/provider-usage.md`,
> `features/keyboard-shortcuts.md`, `features/localization.md`, and the updated
> `features/app-navigation-screens.md`, `features/workspace-ui.md`, `features/composer-ui.md`,
> `features/feature-panels-ui.md`, `features/desktop-app.md`.

## Task index

### sprint-001-foundation
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Monorepo workspaces + tooling skeleton | none | MAIN-SCOPE §2,§4,§7 |
| task-002 | Layered build + cross-package declarations | task-001 | MAIN-SCOPE §3,§7 |
| task-003 | Shared validation conventions + base types | task-001 | MAIN-SCOPE §9; architecture/persistence, websocket-protocol |

### sprint-002-protocol
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Top-level envelopes + handshake schemas | s001/task-003 | architecture/websocket-protocol |
| task-002 | Capability flags + compatibility gating | task-001 | architecture/websocket-protocol; MAIN-SCOPE §9 |
| task-003 | Session message family schemas | task-001 | architecture/websocket-protocol; features/agent-sessions, timeline-streaming, tool-permissions |
| task-004 | Terminal stream binary frame codec | task-001 | architecture/websocket-protocol; features/terminals |
| task-005 | File-transfer frames, endpoint parsing, manifest types | task-004 | architecture/websocket-protocol; features/file-explorer-transfer, agent-providers |

### sprint-003-persistence-config
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Atomic JSON store primitive | s001/task-003 | architecture/persistence |
| task-002 | Daemon config (config.json) + env precedence | task-001 | architecture/config; MAIN-SCOPE §6 |
| task-003 | Per-project pi-studio.json + revision model | task-001 | architecture/config; features/worktrees, service-proxy |
| task-004 | Entity store schemas + accessors | task-001 | architecture/persistence; MAIN-SCOPE §5 |

### sprint-004-daemon-bootstrap-security
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | PID lock, server id, keypair, directory layout | s003/task-001,002 | architecture/daemon-bootstrap, relay-e2ee, persistence |
| task-002 | HTTP server, health, host allowlist, CORS | task-001 | architecture/auth-security, daemon-bootstrap |
| task-003 | Optional password auth (bcrypt + bearer) | task-002 | architecture/auth-security, config |
| task-004 | WS server: handshake, sessions, capability rehydrate | task-003; s002/task-001,002 | architecture/websocket-protocol |
| task-005 | Frame routing, ping/pong, rpc_error, bootstrap wiring | task-004 | architecture/websocket-protocol, daemon-bootstrap |

### sprint-005-provider-lifecycle
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | AgentClient/AgentSession contracts + mock provider | s004/task-005; s002/task-004 | features/agent-providers, agent-sessions |
| task-002 | Pi provider adapter (pi --mode rpc) | task-001 | features/agent-providers, agent-sessions |
| task-003 | Provider manifest/registry + snapshot refresh | task-002; s003/task-002 | features/agent-providers; architecture/config |
| task-004 | AgentManager lifecycle state machine + recovery | task-003; s003/task-004 | architecture/agent-lifecycle, daemon-bootstrap |
| task-005 | Archive (soft delete) + cascade | task-004 | architecture/agent-lifecycle; features/subagents |

### sprint-006-agent-sessions-timeline
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Append-only timeline store | s005/task-004; s003/task-004 | features/timeline-streaming; architecture/persistence |
| task-002 | Create agent + run turn + stream broadcast | task-001; s005/task-002 | features/agent-sessions; architecture/websocket-protocol |
| task-003 | Authoritative paged timeline fetch RPC | task-002 | features/timeline-streaming |
| task-004 | Session operations: prompt/interrupt/update/resume/import | task-002 | features/agent-sessions, agent-providers |
| task-005 | Tool-call permission flow + question bridge | task-002 | features/tool-permissions, agent-providers |
| task-006 | Structured generation (daemon-side metadata) | task-002; s005/task-003 | architecture/structured-generation, config |

### sprint-007-client-sdk
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | DaemonClient low-level WS driver | s002/task-005 | architecture/client-app-runtime, websocket-protocol |
| task-002 | Pi-StudioClient facade + handles | task-001 | architecture/client-app-runtime; features/agent-sessions |
| task-003 | Terminal-stream router + reconnection/rehydrate | task-001 | architecture/client-app-runtime; features/terminals |

### sprint-008-projects-worktrees-git
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Project/workspace registries + key + reconciliation | s003/task-004; s005/task-005 | features/projects-workspaces; architecture/persistence |
| task-002 | Open-project flow + workspace updates | task-001 | features/projects-workspaces; architecture/agent-lifecycle |
| task-003 | Pi-Studio worktree service + auto-archive coupling | task-002; s003/task-003; s006/task-006 | features/worktrees; architecture/agent-lifecycle |
| task-004 | Git status/diff projections + streaming | task-002 | features/git-checkout; architecture/websocket-protocol |
| task-005 | Git operations (commit/push/pull/merge/branch/stash) | task-004; s006/task-006 | features/git-checkout; architecture/structured-generation |
| task-006 | GitHub PR operations + auto-archive-on-merge | task-005 | features/git-checkout; architecture/websocket-protocol |

### sprint-009-terminals-proxy-files
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | PTY terminal manager (worker) + binary stream | s004/task-005; s002/task-004 | features/terminals; architecture/websocket-protocol |
| task-002 | Terminal control RPCs + restore/capture | task-001 | features/terminals |
| task-003 | Service proxy (generated hostnames + routing) | task-002; s003/task-003 | features/service-proxy; architecture/config, auth-security |
| task-004 | File explorer (list/preview) + path safety | s004/task-005 | features/file-explorer-transfer; architecture/auth-security |
| task-005 | File download/upload binary transfer | task-004; s002/task-005 | features/file-explorer-transfer; architecture/websocket-protocol |
| task-006 | Highlight package (server-side syntax highlighting) | s001/task-002 | MAIN-SCOPE §3,§4; features/file-explorer-transfer, git-checkout |

### sprint-010-orchestration
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | MCP server + agent orchestration tools | s005/task-005; s006/task-005; s008/task-003 | features/mcp-server, agent-providers; architecture/agent-lifecycle |
| task-002 | Chat rooms | s003/task-004; s005/task-004 | features/chat-rooms |
| task-003 | Schedules & heartbeats (cron/interval) | s003/task-004; s006/task-002 | features/schedules-heartbeats |
| task-004 | Loops (iterative agent runs with verifiers) | s003/task-004; s006/task-002; s005/task-005 | features/loops; architecture/persistence |

### sprint-011-cli
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | CLI scaffolding + connection + output rendering | s007/task-002 | features/cli |
| task-002 | Agent commands (+ top-level) | task-001 | features/cli, agent-sessions |
| task-003 | Daemon command group + local spawn + QR pairing | task-001; s004/task-005 | features/cli; architecture/daemon-bootstrap, relay-e2ee |
| task-004 | Feature command groups (chat/terminal/loop/schedule/permit/provider/worktree) | task-001; s006,s008,s009,s010 | features/cli, chat-rooms, terminals, loops, schedules-heartbeats, tool-permissions, agent-providers, worktrees |

### sprint-012-ui-foundation
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Theme system: tokens, variants, appearance application | s007/task-002 | architecture/design-system |
| task-002 | Styling-engine conventions, platform gating, overlay/portal infra | task-001 | architecture/design-system; features/ui-components |
| task-003 | Core primitives: pressables, inputs, icons, surfaces | task-002 | features/ui-components |
| task-004 | Overlays, navigation chrome, feedback primitives | task-003 | features/ui-components |
| task-005 | Localization + keyboard-shortcut system infra | task-001 | features/localization, features/keyboard-shortcuts |
| task-006 | White-label branding (build-time brand config) | task-001,003,005 | features/white-label-branding; architecture/design-system; features/ui-components, localization |

### sprint-013-app-navigation-screens
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Host runtime, session context, route grammar, app shell, provider stack, boot resolver | s007/task-002,003; s012 | architecture/client-app-runtime; features/app-navigation-screens |
| task-002 | Onboarding & device-pairing screens | task-001 | features/app-navigation-screens; architecture/relay-e2ee |
| task-003 | Open-project screen (global + per-host) & new-workspace screen | task-001; s015/task-006 | features/app-navigation-screens, projects-workspaces, worktrees, composer-ui |
| task-004 | Settings IA (+ language/shortcuts/permissions/diagnostics/provider-usage/daemon-mode sections), projects screens, left-sidebar shell | task-001; s012/task-005 | features/app-navigation-screens; architecture/config, structured-generation; features/localization, keyboard-shortcuts, provider-usage, desktop-app (daemon-mode toggle UI) |
| task-005 | Cross-host Sessions & Schedules screens + Command center | task-001; task-004; s012/task-005 | features/app-navigation-screens, schedules-heartbeats, keyboard-shortcuts |

### sprint-014-workspace-shell
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Tab model, panel registry, subagents policy & reconciliation | s013/task-001 | features/workspace-ui, subagents |
| task-002 | Pane/split model, layout store & web DnD splits | task-001 | features/workspace-ui |
| task-003 | Workspace screen composition, headers & actions | task-002 | features/workspace-ui |
| task-004 | Empty-draft seeding, pinned quick-launch targets, route gating, mobile tab switcher | task-003 | features/workspace-ui |

### sprint-015-timeline-and-composer-ui
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Timeline reducers, sync planner, render model, virtualized list, row dispatch, autoscroll | s013/task-001; s012 | architecture/client-app-runtime; features/timeline-streaming; features/timeline-rendering |
| task-002 | Message rows, row treatments, turn grouping & footers | task-001 | features/timeline-rendering |
| task-003 | Tool-call cards | task-002 | features/timeline-rendering, tool-permissions |
| task-004 | Diff rows, permission prompts | task-003 | features/timeline-rendering, tool-permissions |
| task-005 | Markdown rendering & syntax highlighting | task-002 | features/timeline-rendering, feature-panels-ui |
| task-006 | Composer surface, composer logic, platform stores, submit/queue, autocomplete, controls, attachments, voice, create-agent preferences | task-001 | features/composer-ui; architecture/client-app-runtime; features/provider-usage |
| task-007 | Rewind (conversation & file time-travel) | task-002; task-006 | features/rewind; features/agent-providers (capability flags, additive) |

### sprint-016-feature-panels-ui
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Panel plug-in contract; file explorer panel | s014/task-001; s012 | features/feature-panels-ui, file-explorer-transfer |
| task-002 | File preview panel | task-001; s015/task-005 | features/feature-panels-ui, file-explorer-transfer |
| task-003 | Git panel: changes, diff viewer, inline review, PR (+ activity timeline, context-attach) | task-001; s015/task-004 | features/feature-panels-ui, git-checkout |
| task-004 | Terminal pane | task-001; s007/task-003 | features/feature-panels-ui, terminals |
| task-005 | Browser pane & subagents track | task-001; s014/task-001 | features/feature-panels-ui, subagents, service-proxy |

### sprint-017-app-runtime-foundation
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Vite + React app scaffold & build targets | s012; s016 | architecture/design-system, client-app-runtime; features/desktop-app |
| task-002 | Theme → CSS variables bridge & appearance | task-001; s012/task-001 | architecture/design-system; features/white-label-branding |
| task-003 | App providers, client wiring & global stores | task-001; s007; s013/task-001 | architecture/client-app-runtime; features/app-navigation-screens |
| task-004 | Router shell, boot resolver & route gating | task-002,003; s013/task-001 | features/app-navigation-screens; architecture/client-app-runtime |

### sprint-018-ui-primitives-nav-chrome
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Core DOM primitives | s017/task-002; s012/task-003 | features/ui-components; architecture/design-system |
| task-002 | Overlay, portal & feedback infrastructure | task-001; s012/task-002,004 | features/ui-components; architecture/design-system |
| task-003 | Left sidebar, nav chrome & command center | task-002; s013/task-004,005; s012/task-005 | features/app-navigation-screens, keyboard-shortcuts |

### sprint-019-navigation-screens
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Onboarding & device-pairing screens | s018; s013/task-002 | features/app-navigation-screens; architecture/relay-e2ee |
| task-002 | Home & Sessions screens | s018; s013/task-003,005 | features/app-navigation-screens |
| task-003 | Open-project & new-workspace screens | s018; s013/task-003; s015/task-006 | features/app-navigation-screens, projects-workspaces, worktrees, composer-ui |
| task-004 | Settings, projects & hosts screens | s018; s013/task-004 | features/app-navigation-screens, localization, keyboard-shortcuts, provider-usage, desktop-app |
| task-005 | Schedules screen & command-center wiring | task-002; s013/task-005 | features/app-navigation-screens, schedules-heartbeats |

### sprint-020-workspace-shell-screens
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Workspace scaffold & route gating | s019; s014/task-003,004 | features/workspace-ui |
| task-002 | Tab strip & pinned quick-launch | task-001; s014/task-001,004 | features/workspace-ui |
| task-003 | Pane/split tree renderer & web DnD | task-002; s014/task-002 | features/workspace-ui |
| task-004 | Header, compact switcher & bulk-close | task-003; s014/task-003,004 | features/workspace-ui |

### sprint-021-timeline-composer-screens
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Virtualized timeline, dispatch & autoscroll | s020; s015/task-001 | features/timeline-rendering; architecture/client-app-runtime |
| task-002 | Message rows, grouping/footers & markdown | task-001; s015/task-002,005 | features/timeline-rendering |
| task-003 | Tool-call cards, diff rows & permission prompts | task-002; s015/task-003,004 | features/timeline-rendering, tool-permissions |
| task-004 | Composer surface | task-001; s015/task-006; s013/task-004 | features/composer-ui, provider-usage |
| task-005 | Rewind UI | task-002,004; s015/task-007 | features/rewind, agent-providers |

### sprint-022-feature-panel-screens
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Explorer sidebar & file preview pane | s020,s021; s016/task-001,002 | features/feature-panels-ui, file-explorer-transfer |
| task-002 | Git panel (changes, diff, inline review, PR) | task-001; s016/task-003 | features/feature-panels-ui, git-checkout |
| task-003 | Terminal pane (xterm) | s020; s016/task-004; s007/task-003 | features/feature-panels-ui, terminals |
| task-004 | Browser pane & subagents track | s020; s016/task-005 | features/feature-panels-ui, subagents, service-proxy |

### sprint-032-relay-e2ee
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Relay crypto + symmetric channels | s004/task-001 | architecture/relay-e2ee; MAIN-SCOPE §2 |
| task-002 | Daemon relay transport + bootstrap wiring | task-001; s004/task-005 | architecture/relay-e2ee, daemon-bootstrap, config |
| task-003 | Client relay transport + pairing (QR fragment) | task-001; s007/task-001 | architecture/relay-e2ee, client-app-runtime |
| task-004 | Cloudflare relay server adapter | task-002, task-003 | architecture/relay-e2ee; MAIN-SCOPE §6 |

### sprint-033-desktop
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Electron shell + managed daemon supervisor | web-client (React+Vite DOM app, `build:web`/`build:electron` already wired); s004/task-005 | features/desktop-app; architecture/daemon-bootstrap, client-app-runtime |
| task-002 | Multi-window model + land-on-project | task-001; s008/task-002 | features/desktop-app |
| task-003 | Native integrations (dialogs/menus/titlebar/notifications/auto-update) | task-001 | features/desktop-app |
| task-004 | In-app browser panes (webview) | task-003 | features/desktop-app |

### sprint-034-ssh-gateway-connections
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | SSH gateway profile and security model | s013/task-001; s033/task-001 | architecture/ssh-gateway-connections; architecture/client-app-runtime; features/desktop-app |
| task-002 | Electron SSH tunnel manager | task-001; s033/task-001 | architecture/ssh-gateway-connections; architecture/auth-security; features/desktop-app |
| task-003 | Preload bridge and app runtime integration | task-002; s013/task-001; s033/task-001 | architecture/ssh-gateway-connections; architecture/client-app-runtime; features/desktop-app |
| task-004 | SSH connection UI and diagnostics | task-003; s013/task-002; s013/task-004 | architecture/ssh-gateway-connections; features/app-navigation-screens; features/desktop-app |
| task-005 | Secret storage hardening, cleanup, and docs | task-004 | architecture/ssh-gateway-connections; architecture/auth-security; features/desktop-app |

### sprint-030-integration-gap-closure
> Added after a post-implementation audit of the shipped web app (sprints 017–029 done). Closes
> concrete integration gaps so the built app truly "uses all the features". Do before shipping.

| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Agent detail route & screen assembly | s024, s026, s029 | features/app-navigation-screens, agent-sessions, timeline-rendering, composer-ui |
| task-002 | New-agent provider/profile picker (replace hardcoded mock) | task-001; s005, s013/s019 | features/agent-providers, app-navigation-screens, composer-ui |
| task-003 | Workspace tab context actions & pinned quick-launch | s014/s020, s024 | features/workspace-ui, agent-sessions |
| task-004 | Schedule detail view | s019, s010 | features/schedules-heartbeats, app-navigation-screens |
| task-005 | Workspace header live fields & bundle code-splitting | task-001..004; s031/task-003, s009 | features/workspace-ui, service-proxy; architecture/client-app-runtime |

### sprint-031-provider-usage-setup-backend
> New protocol/server scope flagged in the Open-questions list: provider-usage RPC and the setup/
> scripts surface. Needed before the provider-usage UI and workspace-header fields can show live data.

| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Provider-usage daemon RPC + protocol schema | s005, s006, s002 | features/provider-usage; architecture/websocket-protocol, structured-generation |
| task-002 | Wire provider-usage UI to live data | task-001; s025, s019 | features/provider-usage, composer-ui, app-navigation-screens |
| task-003 | Setup panel & workspace scripts surface | s009, s003, s016 | features/service-proxy, feature-panels-ui; architecture/config |

### sprint-037-agent-slash-commands
> Server + SDK + CLI support for the subset of Pi built-in slash commands that have Pi RPC
> equivalents. Pi's TUI-only built-ins (`/settings`, `/hotkeys`, `/changelog`, `/login`, `/logout`,
> `/reload`, `/scoped-models`, `/trust`, `/share`, `/quit`) have no RPC and are excluded. web-client
> affordances are deferred to a later sprint. Grounded in the live Pi RPC contract
> (`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`), not a new scope doc.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Protocol schemas for slash-command RPCs | none | packages/protocol; architecture/websocket-protocol |
| task-002 | Provider-contract methods + Pi adapter RPC wiring | task-001 | provider-contract; providers/pi; features/agent-providers |
| task-003 | Daemon RPC handlers | task-001, task-002 | session-operations; daemon/bootstrap; features/agent-sessions |
| task-004 | Mock provider support + test fixtures | task-002, task-003 | providers/mock |
| task-005 | SDK / client facade methods | task-001, task-003 | packages/client (PiStudioClient AgentHandle) |
| task-006 | CLI slash-command subcommands | task-005 | packages/cli (agent group); features/cli |

### sprint-038-tab-strip-new-tab-menu
> web-client only. Real GitHub issue (#8), not derived from a `swe/features/*.md`
> spec — `features/workspace-ui.md`'s tab model describes a different, aspirational
> draft/agent/pane architecture not reflected in the current implementation; tasks below reference
> the live source files (`tab-store.ts`, `TabStrip.tsx`, `SessionList.tsx`, …) directly instead.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Shared `openNewChat` helper alongside `openNewTerminal` | none | packages/web-client (tab-store, session-store, SessionList, open-workspace, use-session-restore) |
| task-002 | TabStrip "+" button with New chat / New terminal menu | task-001 | packages/web-client (TabStrip, TabStrip.module.css, SessionContextMenu dropdown pattern) |
| task-003 | Docs sync + full verification pass | task-001, task-002 | packages/web-client/AGENTS.md |

### sprint-039-agent-turn-steering
> Full-stack "steer a running turn" feature: while an agent is mid-turn, inject additional
> instructions without waiting for it to finish. Grounded in the live Pi RPC contract
> (`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` § Prompting: `steer`/`follow_up`,
> `queue_update`). Dedicated fire-and-forget RPCs (like `interrupt_agent`), NOT a
> `send_agent_prompt` overload. web-client surfaces **steer only** (Send→Steer swap + queued
> badge); follow-up stays SDK/CLI-level for now.
>
> **Status:** COMPLETE — all 8 tasks done. Full workspace `build`/`typecheck`/`lint`/`vitest run`
> green (86 files, 699 tests). See `done/*-summary.md` for what each task actually shipped.

| Task | Title | Status | Depends on | Covers |
|------|-------|--------|------------|--------|
| task-001 | Protocol steering schemas + `queue_update` event + `supportsSteering` flag | done | none | packages/protocol; architecture/websocket-protocol |
| task-002 | Provider-contract `steer`/`followUp` + Pi adapter + `queue_update` mapping | done | task-001 | provider-contract; providers/pi; features/agent-providers |
| task-003 | Daemon `steer_agent_request`/`follow_up_agent_request` handlers | done | task-001, task-002 | session-operations; daemon/bootstrap; features/agent-sessions |
| task-004 | Mock provider steering support | done | task-002 | providers/mock |
| task-005 | SDK / client facade `steer`/`followUp` | done | task-001 | packages/client (PiStudioClient agent handle) |
| task-006 | CLI `steer` / `follow-up` commands + `queue_update` render | done | task-005 | packages/cli (agent group); features/cli |
| task-007 | web-client Composer Send→Steer swap + queued badge | done | task-005 | packages/web-client (Composer, timeline reducer/row-model, UserRow); features/composer-ui, timeline-rendering |
| task-008 | Docs sync + full verification pass | done | task-001,002,003,005,006,007 | AGENTS.md (web-client); features/agent-sessions, composer-ui, timeline-rendering, timeline-streaming |

### sprint-040-agent-command-discovery
> Server-only. Surfaces Pi's `get_commands` (extension commands, prompt templates, skills — the
> disjoint set from sprint-037's built-in slash commands) as a per-session discovery RPC. Grounded
> in the live Pi RPC contract (`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
> § Commands: `get_commands`), not a new scope doc. `AgentSession.listCommands?` is already declared
> in the contract but unimplemented; this sprint wires it end-to-end server-side. SDK/CLI/MCP/web-
> client discovery surfaces are a deliberate follow-up.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Protocol schemas for `agent_list_commands_request`/`_response` | none | packages/protocol; architecture/websocket-protocol |
| task-002 | Enrich `AgentCommandDefinition` + implement Pi `listCommands` | task-001 | provider-contract; providers/pi; features/agent-providers |
| task-003 | Daemon `agent_list_commands_request` handler | task-001, task-002 | slash-command-operations; daemon/bootstrap; features/agent-sessions |
| task-004 | Mock support + docs sync + verification | task-002, task-003 | providers/mock; AGENTS.md (protocol, server) |

### sprint-041-agent-turn-settlement
> Bug fix, server-only. The Pi adapter's event-mapper treats every `agent_end` as the turn's terminal
> event (deriving the kind from that run's last assistant `stopReason`), but
> Pi emits one `agent_end` per low-level run — decorated with `willRetry` — and a single
> `agent_settled` at the true end of a session-level run (auto-retry, overflow-compaction, and
> queued steering/follow-up all loop before settle). Firing terminal on the first `agent_end` tears
> down the daemon's stream subscription mid-turn, drops post-retry rows, flips status to idle early,
> and can auto-archive a live agent. Grounded in the live Pi RPC contract
> (`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` § Events; `dist/core/agent-session.js`
> `_runAgentPrompt`/`_willRetryAfterAgentEnd`/`_emitAgentSettled`), not a new scope doc. Reuses the
> existing `turn_completed`/`turn_failed`/`turn_canceled` protocol kinds — no schema change. Closes
> the `agent_settled`/`willRetry` audit gap deferred in sprint-040/task-001.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Settlement-driven event-mapper (`willRetry` non-terminal; `agent_settled` → terminal by `stopReason`) + per-session wiring | none | providers/pi (event-mapper, agent); features/agent-sessions |
| task-002 | Fake-transport `agent_settled` wiring + retry-subscription regression test | task-001 | providers/pi (pi-adapter.test); agent-service (runTurn) |
| task-003 | Scope-doc + AGENTS.md sync and full verification | task-001, task-002 | features/agent-sessions; architecture/agent-lifecycle; AGENTS.md (server); packages/server/docs (gateway-architecture, rpc-communication) |

### sprint-042-workspace-status-bar
> web-client feature. A full-width, ~75px, bottom powerline status bar showing the **active
> session's** metadata as icon-prefixed segments (lucide): model · cwd · git branch (+ ahead/behind,
> dirty count, conflict flag) · context usage % · token total · session cost. Fully swaps on session
> switch; branch live-updates from the active-cwd checkout subscription; context/token/cost are
> pull-only (polled via the existing `agent_session_stats_request`) and cached per session. UI-primary
> — the only server change is two append-only optional fields (`list_agents_response` model/provider
> and a poll-reconciled `agent_session_stats` model). References the live source files
> (`git-store.ts`, `session-store.ts`, `use-checkout-status.ts`, `WorkspacePage.tsx`) directly.
> `features/workspace-ui.md` describes a different, aspirational Paseo-parity pane/tab/header
> architecture not reflected in the current implementation (same discrepancy sprint-038 already
> flagged) — its "Primary header" section doesn't cover a bottom status bar at all, so this sprint
> does NOT edit it; the shipped bar is documented at the AGENTS.md/live-source level instead
> (`packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/web-client/AGENTS.md`).

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | `list_agents_response` optional `model`/`provider` (protocol + both bootstraps) | none | packages/protocol; packages/server (bootstrap, dev-bootstrap); features/agent-sessions; architecture/websocket-protocol |
| task-002 | Poll-reconciled `model` in `agent_session_stats` payload (runtime-info fallback) | none | packages/protocol; packages/server (slash-command-operations); features/agent-sessions, agent-providers |
| task-003 | Client stores: git branch/ahead/behind/dirty retention, `SessionEntry.model`, per-session `stats-store` | none | packages/web-client (git-store, session-store, stats-store); features/git-checkout, workspace-ui |
| task-004 | `use-session-stats` poll + model wiring on create/restore/`agent_update` | task-003 | packages/web-client (use-session-stats, use-session-restore); features/agent-sessions, workspace-ui |
| task-005 | Pure status-bar value formatters (tokens/percent/cost/cwd/branch-meta) | none | packages/web-client (status-bar-format); features/workspace-ui |
| task-006 | `StatusBar` powerline component + WorkspacePage bottom mount | task-003, task-004, task-005 | packages/web-client (StatusBar, WorkspacePage); features/workspace-ui; architecture/design-system |
| task-007 | Docs sync (protocol/server/web-client AGENTS.md — NOT `workspace-ui.md`, see this sprint's header note) + E2E verification | task-001..006 | AGENTS.md (protocol, server, web-client) |

### sprint-043-model-selector
> web-client feature. A per-conversation **model selector** in the chat composer, placed left of the
> text input: a ghost button showing the current model (`session.model`, or a `"Model"` placeholder
> for a fresh session), opening a Radix-`DropdownMenu` popup with a top **fuzzy search filter**
> (reusing `filterOptions`), the current model **sorted first with a checkmark** (lucide `Check`
> idiom), and rows rendering `label` + `(id)` with the id in `--pi-color-foregroundMuted`. Reuses
> the visible-trigger menu pattern from `TabStrip`'s `NewTabMenu` (NOT the invisible-coordinate
> `SessionContextMenu` pattern). **Unblocks the picker** by registering the previously-unserved
> `list_provider_models` daemon RPC in both bootstraps (backed by the already-built
> `AgentClient.listModels`, no spawned agent needed) and typing the client SDK response; selection
> reuses the fully-wired `agent_set_model_request` → `setProviderModel` → `agent_update({model})`
> path, so `session.model` and the StatusBar reconcile for free. New sessions with no bound agent
> store the pick locally only (agent creation is not changed — out of scope).

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Register `list_provider_models` daemon RPC (both bootstraps, via `AgentClient.listModels`) | none | packages/server (bootstrap, dev-bootstrap); features/provider-usage, agent-providers |
| task-002 | Type client SDK `providers.listModels` response (`ProviderModel`/`ListProviderModelsResponse`) | task-001 | packages/client (pistudio-client, index); features/provider-usage |
| task-003 | `ModelMenu` component: trigger button + anchored searchable picker with checkmark + muted `(id)` rows | task-002 | packages/web-client (features/chat/ModelMenu); features/composer-ui, provider-usage; architecture/design-system |
| task-004 | Mount `ModelMenu` in Composer + wire optimistic `setModel` | task-003 | packages/web-client (features/chat/Composer); features/composer-ui, provider-usage |
| task-005 | E2E verification + docs sync (server/client/web-client AGENTS.md) | task-001..004 | AGENTS.md (server, client, web-client); features/composer-ui, provider-usage |

### sprint-044-molecule-viewer-live-files
> Two coupled halves, planned so the first ships and smoke-tests without touching the daemon.
> **Molecule viewer (tasks 001-004, web-client only):** molecular files open a dedicated 3D viewer
> tab built on `@molviewer/core` (10 formats from its own reader registry, plus VASP
> POSCAR/CONTCAR by basename), and the TabStrip "+" menu gains "New molecule view" for an empty
> viewer. Molecule tabs get their **own `TabKind` + panel** rather than riding `FilePanel`: the
> empty tab has no path at all, and `FilePanel` is built entirely around one. Nothing is lost —
> `.pdb` diffs still come from the git Changes panel's independent `kind: "diff"` tabs. Format
> dispatch therefore happens at **tab-open** time (`isMoleculeFile` in the viewer registry, called
> from the single site that opens file tabs) rather than inside `FilePanel`. Content is fetched via
> the **chunked binary download** path, not `file_read_request`, whose 512 KiB cap would break the
> MD trajectories this viewer exists for; molviewer takes the resulting object URL directly as a
> `{ url, name }` source, so there is no decode step. The 4.3 MB bundle is split into a lazy
> `vendor-molviewer` chunk.
> **Live file updates (tasks 005-008, daemon + client):** the daemon has **no filesystem watcher
> today** — every "live" update in the product is client-initiated polling in disguise
> (`workspace-git-service.ts`'s "a filesystem watcher calls refresh()" comment is stale, and the
> file tree only refreshes on a debounced guess after an *agent tool* completes). This sprint adds
> the real thing: `FileWatchService` (always watches the *directory* so atomic-rename saves keep
> firing, one ref-counted `fs.watch` per directory, 150 ms coalescing) behind a `file_watch_*`
> per-session subscription family that follows `checkout_status_subscribe`'s 4-hop precedent
> exactly — including validating through `messages.ts`'s passthrough fallback, so **no protocol
> package change**. It powers two consumers: an **edit-gated reload** of open molecule tabs
> (`sourceMode="update"` preserves camera/selection; skipped entirely while `onModifiedChange`
> reports unsaved in-viewer edits, with a stale indicator instead of a silent clobber) and a **live
> file tree** (each expanded directory subscribes and invalidates only its own listing query — a
> 1:1 fit with the existing one-query-per-expanded-directory model). Task 005 first fixes a
> confirmed pre-existing leak: per-session subscriptions are never disposed on disconnect because
> `ws-server` exposes no close hook, so a dropped connection leaks a listener forever — worse for
> file watching, which would also pin an OS handle.
> **Large-file ceiling (task-009, independent of both halves):** `file_read_request` rejects anything
> over 512 KiB, so a 2 MB log is unopenable. Raised to a shared 5 MiB `MAX_INLINE_FILE_READ_BYTES`
> constant — *and* made **async**, because `readFileSync` on the inline path blocks the daemon's
> whole event loop (agent streams, terminals, heartbeats) for the duration of the read, which is the
> real reason the old cap was low. Above 5 MiB `TextViewer` transparently falls back to the existing
> **uncapped** chunked download path, so files of any size open; 30 MiB is a *display* ceiling
> (CodeMirror + `lineWrapping`) above which the viewer offers a download instead of rendering. Net
> effect: no multi-MB string ever crosses a JSON text frame, and file size stops being a wall.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Move `@molviewer/core` into web-client + lazy `vendor-molviewer` chunk | none | packages/web-client (package.json, vite.config); docs/molviewer-integration-scope §2.9 |
| task-002 | `isMoleculeFile`/`MOLECULE_EXTENSIONS` format detection in the viewer registry | none | packages/web-client (features/files/viewer-registry); features/file-explorer-transfer |
| task-003 | `MoleculeViewer` component: download → `<MolViewer>` mount, replace-then-update source modes, empty state | task-001 | packages/web-client (features/files/MoleculeViewer); features/file-explorer-transfer; architecture/design-system |
| task-004 | `molecule` tab kind + `MoleculeViewerPanel` + explorer routing + "+"-menu item | task-002, task-003 | packages/web-client (stores/tab-store, features/workspace/{panel-registry,TabStrip}, features/files); features/workspace-ui |
| task-005 | `SessionSubscriptions` + `onSessionClose` hook; migrate git-checkout subs (fixes disconnect leak) | none | packages/server (ws/session-subscriptions, ws/ws-server, projects/git-checkout-rpc, daemon/bootstrap); architecture/websocket-protocol; features/git-checkout |
| task-006 | `FileWatchService` (file + directory, ref-counted, 150 ms coalescing) + `file_watch_*` RPCs | task-005 | packages/server (files/file-watch-service, files/file-watch-rpc, daemon/bootstrap); architecture/websocket-protocol; features/file-explorer-transfer |
| task-007 | `use-file-watch` hook + edit-gated live reload of molecule tabs | task-003, task-006 | packages/web-client (hooks/use-file-watch, features/files/MoleculeViewer); architecture/websocket-protocol |
| task-008 | Live file tree: `use-explorer-watch` subscribes expanded dirs, invalidates per-directory | task-006 | packages/web-client (hooks/use-explorer-watch, features/files/FileExplorer); features/file-explorer-transfer, workspace-ui |
| task-009 | Raise file-read ceiling: 5 MiB inline (async read, shared constant), streamed above that, 30 MiB display cap | none | packages/server (files/limits, daemon/{bootstrap,dev-bootstrap}); packages/web-client (hooks/{use-file-read,use-file-text}, features/files/TextViewer); features/file-explorer-transfer; architecture/websocket-protocol |
| task-010 | E2E browser verification + docs sync (server/web-client/root AGENTS.md, scope docs) | task-001..009 | AGENTS.md (root, server, web-client); features/file-explorer-transfer, workspace-ui; architecture/websocket-protocol |

### sprint-045-inline-image-rendering
> Two independent halves, ordered so the render half ships and smoke-tests on its own.
> **Render half (tasks 001-004):** `![alt](path)` in a **finalized** assistant markdown block renders
> the real image inline. The seam already exists — `timeline/markdown.tsx` passes react-markdown a
> per-tag override map currently holding only `code` — so this is one added `img` entry plus a decision
> layer and a fetch layer. The decision layer (`classifyImageSrc`) is pure and exhaustively tested
> before any component touches it: remote/`data:`/`blob:` URLs pass straight through, `file:` and
> unknown schemes fall back, `/`+`~`+relative paths resolve, and the **existing** viewer-registry
> extension detection is the "is this an image" gate, so `![](notes.pdf)` never issues a download and
> registering a new image extension extends inline rendering with no second list. Bytes come from the
> already-shipping chunked binary download path (token → `Begin/Chunk/End` → blob → object URL) that
> `ImageViewer` uses — but **not** through `useFileDownload`, whose `gcTime: 0` + revoke-on-unmount
> ownership is single-exclusive-consumer by design and would re-download on every virtualized
> scroll-back; inline images get a sibling hook over a ref-counted LRU object-URL cache instead.
> Timeline virtualization supplies laziness for free (only near-viewport rows mount), and the
> already-existing "render raw text while streaming" behavior keeps a half-typed `![](scr` from
> firing requests. A missing or hallucinated path degrades to **readable text**, never a broken-image
> glyph — the non-negotiable UX rule, since agents do emit paths that don't exist.
> **Instruction half (tasks 005-006):** the agent has to be told to use the syntax, but only when the
> connected surface can render it. Every piece of plumbing exists except one link: `CLIENT_CAPS` is the
> client→daemon flag registry, `Session.supports(flag)` is the gate, `RpcHandlerContext` carries the
> session on every dispatch — and `AgentService.registerHandlers` throws it away, passing only
> `ctx.message`. So: a new `inline_image_markdown` capability, advertised by the web-client (which
> currently advertises **none**), threaded into `handleCreate`, which appends a short instruction to
> `config.systemPrompt` — already on the wire, already persisted, already reaching
> `--append-system-prompt`. Gated on the capability rather than `clientType` because "renders inline
> images" is a property of the rendering surface, not a client identity (and a future mobile client
> then flips one flag). The instruction is bound at **spawn time**; a CLI-created session later opened
> in the browser won't have it. That limitation is accepted — the degradation is benign both ways, and
> per-turn injection doesn't exist today because a turn's `prompt` string is dual-purpose (provider
> message text *and* the timeline's visible `user_message.text`).
> **Two pre-existing defects the feature trips over, both fixed here:** `file_download_token_request`
> calls `realpath()` with **no** `~` expansion while `file_read_request` expands it — so `~/shot.png`
> works in one and 404s in the other; the expansion itself is copy-pasted inline in six places, with
> `file-watch-service.ts` carrying a comment that explicitly declines to factor it out and a correct
> helper already sitting in the wrong package (`providers/pi/rpc-transport.ts`). And `resumeSession`
> builds its spawn args from the daemon-wide default only, silently dropping the record's per-session
> `systemPrompt` — so *any* per-session prompt vanishes on daemon restart or on a deferred draft's
> first spawn, which would have made the instruction half quietly non-persistent.
> No new RPC, no new binary opcode, no HTTP route, no protocol message schema — one capability string.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Shared daemon `~` expansion (`files/resolve-path.ts`, replaces 6 inline copies + fixes download-token) + `mimeType` in transfer `Begin` | none | packages/server (files/{resolve-path,file-transfer,file-explorer,file-watch-service,file-watch-rpc}, daemon/{bootstrap,dev-bootstrap}); features/inline-image-rendering, file-explorer-transfer |
| task-002 | `lib/paths.ts` `resolveWorkspacePath` (lifted from `watchTargetPath`) + pure `classifyImageSrc` | none | packages/web-client (lib/paths, timeline/image-src, hooks/use-file-live-refresh); features/inline-image-rendering |
| task-003 | Ref-counted LRU inline-image object-URL cache + `useInlineImage` hook | none | packages/web-client (lib/inline-image-cache, hooks/use-inline-image, lib/connection/connection-store); features/inline-image-rendering, file-explorer-transfer |
| task-004 | `InlineImage` component, `img` markdown override, `assetBase` threading, click-to-open | task-002, task-003 | packages/web-client (timeline/{InlineImage,markdown,markdown.module.css}, features/chat/{Timeline,rows/AssistantRow}); features/inline-image-rendering, timeline-rendering |
| task-005 | `resumeSession` honors the persisted per-session `systemPrompt` (pre-existing defect) | none | packages/server (agent/providers/pi/agent); features/agent-providers; architecture/agent-lifecycle |
| task-006 | `CLIENT_CAPS.inline_image_markdown` + web-client advertisement + daemon-composed instruction at create time | task-005 | packages/protocol (client-capabilities); packages/web-client (lib/connection/connection-store); packages/server (agent/{agent-service,inline-image-instructions}); features/inline-image-rendering, agent-sessions; architecture/websocket-protocol |
| task-007 | E2E browser verification (12 steps) + docs sync (protocol/server/web-client/root AGENTS.md + scope doc) | task-001..006 | AGENTS.md (root, protocol, server, web-client); features/inline-image-rendering |

### sprint-046-file-explorer-move
> Drag-and-drop **move/rename** for the file explorer — the one mutation the file surface never had.
> The daemon has no move, rename, or copy operation at all today (`FileExplorerService` exposes only
> `listOrPreview`, `deleteFile`, `createEntry`, `writeFile`, `directorySuggestions`), so task-001 adds
> a single `fs.rename`-shaped primitive that also serves a future Rename affordance for free: a
> same-parent destination *is* a rename. Its one deliberate divergence from its four siblings is
> **parent-only symlink resolution** — they `realpath()` the full path, which for a move would relocate
> a symlink's target instead of the link, so the parent is resolved and the basename re-joined
> (`mv` semantics), keeping ancestors normalized server-side. Collision is a hard `exists` error: no
> overwrite, no merge, no auto-dedup, matching `createEntry`'s fail-loudly posture, and cross-filesystem
> moves are rejected rather than emulated with copy+delete (drags are confined to one workspace subtree,
> so `EXDEV` is effectively unreachable from the UI).
> On the client this reuses the **native HTML5** drop zone `FileExplorer.tsx` already runs for OS-file
> uploads, discriminated by a new `application/x-pi-studio-path` MIME type — *not* dnd-kit, which is
> right for `TabStrip`'s flat-list reordering but wrong for re-parenting into a virtualized tree, and
> which would not interoperate with the OS-file drag living on the same handlers. Because
> `dataTransfer.getData()` returns `""` during `dragover` (protected mode), the dragged path is held in
> a ref for hover validation. Every legality rule lives in one pure `resolveMoveTarget` (task-003) since
> the web-client has no jsdom environment — dropping onto a *file* row means "into its parent folder",
> which also fixes the pre-existing upload behavior where a file row fell through to the tree root.
> Post-move state: exactly the two affected listings are invalidated (not the broad `["explorer"]` key
> delete uses), `repathAfterMove` carries expanded paths and the selection to the new prefix, and an open
> tab is **reopened** at the new path rather than repathed, because tab ids embed the path. No optimistic
> tree update — `useExplorerWatch` already refetches both sides from the daemon's `file_changed` pushes,
> and TanStack Query dedupes the overlap.
> No protocol schema: the four existing file RPCs have none either.
> Scope doc `features/file-explorer-move.md` was written ahead of this sprint and needs no task.

| Task | Title | Depends on | Covers |
|------|-------|------------|--------|
| task-001 | Daemon `FileExplorerService.moveEntry` (parent-only symlink resolution, 8 ordered rejections) + `file_move_request` handler + tests + bootstrap RPC probe | none | packages/server (files/file-explorer, files/file-explorer.test, daemon/bootstrap.test); features/file-explorer-move, file-explorer-transfer |
| task-002 | Client `move-entry.ts` wire helper + user-facing error-string map | task-001 | packages/web-client (features/files/move-entry); features/file-explorer-move |
| task-003 | Pure `resolveMoveTarget` drop-legality decision + unit tests | none | packages/web-client (features/files/{move-target,move-target.test}); features/file-explorer-move |
| task-004 | `explorer-store.repathAfterMove` (expanded/selected follow the moved subtree) + tests | none | packages/web-client (stores/{explorer-store,explorer-store.test}); features/file-explorer-move, file-explorer-transfer |
| task-005 | Draggable rows: `MOVE_MIME` drag source, `dragSourceRef`, `.item.dropTarget` style | none | packages/web-client (features/files/{TreeNode,FileExplorer,FileExplorer.module.css}); features/file-explorer-move |
| task-006 | Accept the drop: hover targeting, 700 ms auto-expand, move + two-directory invalidation + tab reopen + status line, E2E browser verification | task-002, task-003, task-004, task-005 | packages/web-client (features/files/FileExplorer, stores/tab-store consumers); features/file-explorer-move, file-explorer-transfer |

### sprint-047-file-explorer-rename
> Explicit **rename** for the file explorer — item 9 of `features/file-explorer-improvements.md`, and
> the affordance `features/file-explorer-move.md` § Purpose already anticipated ("by drag-and-drop
> today and by an explicit rename affordance later"). No new daemon RPC: a same-parent destination on
> the existing `file_move_request` *is* a rename, so sprint 046's server work already covers it.
>
> Two product decisions were settled before planning and are recorded in that report's § 9.
> **(a)** A diff tab on the moved/renamed path closes and does **not** reopen: verified git behaviour
> is that renaming a *modified* tracked file leaves ` D old` + `?? new`, so the diff handler's
> per-path `git diff` on the new name returns empty and its `--no-index` fallback renders the entire
> file as added lines — reopening would replace the user's real "what did I change" view with an
> all-green whole-file diff. The defect was the *silence*, so the closed count now appears in the
> status line. **(b)** The trigger is the row context menu only — **no F2** — which removes all
> row-level keyboard and focus work from the sprint.
>
> Two latent implementation choices were also picked here rather than left to the implementer: the
> inline editor is **row substitution in `file-tree.ts`** (not a `TreeNode` edit mode, which would
> push `useState` into a component whose docblock pins it as hook-free and presentational), and
> destination trimming happens on **both** sides — the client trims as create already does, and
> task-001 fixes the daemon's own validate-trimmed/join-untrimmed split at the source.
>
> Tasks 003-005 are deliberately inert until task-006 adds the single `startRename` call site, so
> every task before it leaves the explorer fully working and none of them ships a stub.

| Task | Title | Type | Depends on | Covers |
|------|-------|------|------------|--------|
| task-001 | Daemon `moveEntry`: join the **trimmed** destination basename so the validated name is the created name (the `file-explorer.ts:190` join vs `:195` guard split) | bugfix | none | packages/server (files/file-explorer, files/file-explorer.test); features/file-explorer-move |
| task-002 | Extract `moveDropped`'s post-move sequence into a shared `applyMove`; honour the daemon-echoed destination; count + report closed diff tabs (new pure `move-status.ts`) | refactor + bugfix | task-001 | packages/web-client (features/files/{FileExplorer,move-status,move-status.test}); features/file-explorer-improvements, file-explorer-move |
| task-003 | `explorer-store.renaming` + `startRename`/`cancelRename`, mutually exclusive with `draft`, cleared by `setRoot` and `repathAfterMove` | feature | none | packages/web-client (stores/{explorer-store,explorer-store.test}); features/file-explorer-improvements |
| task-004 | `file-tree.ts` `RenameRow`: **substitute** the edited row in place, never insert; children of a renamed expanded directory stay put | feature | none | packages/web-client (features/files/{file-tree,file-tree.test}); features/file-explorer-improvements |
| task-005 | `TreeRenameRow` (pre-filled, extension excluded from initial selection, Enter/Escape/blur) + `TreeNode` branch + `flattenTree` wiring + `submitRename` through `applyMove` | feature | task-002, task-003, task-004 | packages/web-client (features/files/{TreeRenameRow,TreeNode,FileExplorer}); features/file-explorer-move, file-explorer-improvements |
| task-006 | Context-menu `Rename` (row variant only, directly above Delete) + eight-check E2E browser verification + docs sync | feature | task-005 | packages/web-client (features/files/FileContextMenu, AGENTS.md); features/file-explorer-improvements, file-explorer-move |

### sprint-050-connection-resilience
> web-client + client SDK, derived from `features/connection-resilience.md`. Two failure modes that
> share one trigger surface, so they ship together.
>
> **Grounding facts that shaped the task split.** `ReconnectionManager` already accepts injected
> `setTimer`/`clearTimer` (added for tests), so the throttling half is a *construction-site* change
> in `connection-store.ts` with no SDK modification — task-002 depends on nothing. The stale-socket
> half does need an SDK addition (`reconnectNow()`, task-001), because the manager can only move
> from `closed` toward `open` through its private backoff timer today. Those two are independent
> and may run concurrently; task-003 consumes both.
>
> **The repo's test reality is designed into the plan, not worked around.** Vitest runs in the Node
> environment with no DOM and no jsdom (a deliberate repo-wide convention — see the
> `text-viewer-state.ts` / `molecule-reload.ts` pure-core extractions). So the Worker path and the
> `visibilitychange`/`online` wiring are **not** unit-testable here: tasks 002 and 003 cover their
> pure cores and fallback branches, and task-004 supplies the live proof. No task may claim
> coverage it cannot have.
>
> Two contract decisions were settled during planning rather than left to the implementer: the
> resume *signal* is **not** a parameter of `resolveResumeAction` (no decision-table row branches on
> it — it stays at the wiring layer), and `attachResumeTriggers()` installs at **module scope in
> `main.tsx`, outside React**, because that file renders under `<StrictMode>` whose dev-mode
> double-invoked effects would attach two listener sets. Both are reflected back into the scope doc.

| Task | Title | Type | Depends on | Covers |
|------|-------|------|------------|--------|
| task-001 | `ReconnectionManager.reconnectNow()`: cancel the pending rung, reset the ladder, attempt immediately; guarded on active/in-flight/`closed`, with `attempt: 0` as the forced-reconnect signal | feature | none | packages/client (reconnect, terminal-router.test — the manager's tests live there, there is no `reconnect.test.ts`); features/connection-resilience |
| task-002 | Worker-backed timers (inline Blob worker, latched `setTimeout` fallback, lazy singleton) injected into `ReconnectionManager` at the `connection-store` construction site | feature | none | packages/web-client (lib/connection/{worker-timers,worker-timers.test,connection-store}); features/connection-resilience |
| task-003 | Resume triggers: pure `resolveResumeAction` decision core + `visibilitychange`/`online` wiring; immediate reconnect when down, 5 s `ping` probe → close 4000 → reconnect when the socket only looks up | feature | task-001 | packages/web-client (lib/connection/{resume-action,resume-action.test,resume-triggers}, main.tsx); features/connection-resilience |
| task-004 | Live E2E proof of both failure modes (6 min hidden-tab reconnect, real laptop sleep, disconnect-flap, regression sweep) + docs sync + close the scope's acceptance/TODO items | test + docs | task-001, task-002, task-003 | packages/web-client (AGENTS.md), packages/client (AGENTS.md); features/connection-resilience |

### sprint-051-file-link-rendering
> Sibling to sprint-045: `[label](path)` in a **finalized** assistant markdown block becomes an
> actionable open-file element, using the identical capability→instruction→markdown-override shape
> — instead of fetching bytes, a resolved link dispatches the existing "open a path as a tab"
> primitive. `workspace-split-panes.md` § Drag sources already carries a fourth row for this (a file
> link or resolved inline image dropped onto a pane), so drag-to-split needs zero drop-side changes
> — only a source that writes the existing `EXTERNAL_DRAG_MIME.path` payload the Files tree already
> defines.
>
> **Two shared defects this feature's review surfaced, both fixed here, both benefiting the
> pre-existing inline-image feature too.** (1) Nothing between `TabPanelHost` and a markdown
> node-override carries a pane id — `TabPanelHost.tsx` computes the tab's owning pane
> (`layout.placement[tab.id]`) for its focus handler but never passes it downstream, so every
> open-file dispatch (including today's inline-image click) falls back to whichever pane merely
> happens to be globally focused. task-002 threads `owningPaneId` through the whole render chain;
> task-003 is where both this feature's link click and `InlineImage`'s click (converged onto the
> same `openFileTab` dispatch it should have been calling all along) start reading it. (2)
> `classifyImageSrc`'s `local` results were never normalized or percent-decoded
> (`./shot.png` against `/repo` returns `/repo/./shot.png`, unchanged since sprint-045) — harmless
> for images, but fatal for this feature's tab-reuse acceptance criteria, since tab identity is
> `file:<absolute path>` matched by exact string. task-001 fixes it in the one shared resolver both
> classifiers now call.
>
> **Capability composition generalizes from one flag to N.** `agent-service.ts` hardcodes a single
> `?:` for `inline_image_markdown` today; task-005 replaces it with an ordered
> `CAPABILITY_INSTRUCTIONS` list (`composeSystemPrompt`) so which instruction blocks land, and in
> what order, is deterministic regardless of which capability subset a connection advertised — the
> existing image instruction moves onto the new mechanism rather than being left beside a second
> ad hoc branch.
>
> No new RPC, no new binary opcode, no HTTP route, no protocol message schema — one capability
> string, reusing every existing dispatch/payload primitive.

| Task | Title | Type | Depends on | Covers |
|------|-------|------|------|--------|
| task-001 | Shared candidate-resolution step (extracted from `classifyImageSrc`, joins via existing `lib/paths.ts` `resolveWorkspacePath`) + normalization/percent-decoding fix + pure `classifyFileLinkSrc` | feature + bugfix | none | packages/web-client (lib/paths, timeline/{href-resolution,file-link-src,file-link-src.test,image-src,image-src.test,markdown.test}); features/file-link-rendering, inline-image-rendering |
| task-002 | `owningPaneId` + `workspaceCwd` propagation: `TabPanelHost` → `ChatPanel` → `Timeline` → `AssistantRow`/`ReasoningRow` → `Markdown` (pre-existing pane-targeting defect fix) | bugfix | none | packages/web-client (features/workspace/{TabPanelHost,panel-registry,pane-layout-view}, features/chat/{ChatPanel,Timeline,rows/AssistantRow,rows/ReasoningRow}, timeline/markdown); features/file-link-rendering, inline-image-rendering, workspace-split-panes |
| task-003 | `FileLink` component + `a` markdown override + converged click-to-open dispatch (`InlineImage` moves onto shared `openFileTab`, both now pane-targeted) | feature | task-001, task-002 | packages/web-client (timeline/{FileLink,markdown,InlineImage}); features/file-link-rendering, inline-image-rendering |
| task-004 | Drag-to-split source wiring: `FileLink`/`InlineImage` write the existing `EXTERNAL_DRAG_MIME.path` payload on `dragstart`, zero drop-side changes | feature | task-003 | packages/web-client (timeline/{FileLink,InlineImage}); features/file-link-rendering, workspace-split-panes |
| task-005 | `CLIENT_CAPS.file_link_markdown` + web-client advertisement + `composeSystemPrompt` (ordered N-capability composition, replacing the single-flag ternary) + `file-link-instructions.ts` | feature | none | packages/protocol (client-capabilities); packages/web-client (lib/connection/connection-store); packages/server (agent/{agent-service,compose-system-prompt,file-link-instructions,create-run.test}, daemon/bootstrap.test); features/file-link-rendering, inline-image-rendering, agent-sessions; architecture/websocket-protocol |
| task-006 | E2E browser verification against the spec's full acceptance-criteria list + docs sync (protocol/server/web-client AGENTS.md) | test + docs | task-001, task-002, task-003, task-004, task-005 | AGENTS.md (protocol, server, web-client); features/file-link-rendering |

### sprint-052-terminal-sizing
> **Root cause, verified.** `TerminalPanel.tsx:207` calls `fitAddon.fit()` — which *does* resize the
> frontend grid 80×24 → the real size — but `terminal.onResize` is not attached until `:229`, and
> `node_modules/@xterm/addon-fit/src/FitAddon.ts:43-46` only calls `terminal.resize()` when the
> proposed dimensions **differ**. So that one resize fires into nothing and every later `fit()` (the
> `ResizeObserver`'s initial callback, the `isVisible` refit) recomputes the same numbers and is a
> silent no-op. `create_terminal_request` doesn't pass `cols`/`rows` either. Net: the PTY stays 80×24
> forever while xterm renders ~140×35, so every wrap decision and cursor-positioning sequence the
> shell's line editor emits is calibrated to a width the display does not have — which is exactly the
> reported ghosting, scrambling, and misalignment. The defect survived smoke testing because a panel
> that mounts **hidden** works correctly: `proposeDimensions()` returns `undefined` under
> `display:none`, so the first fit no-ops and the later visibility fit *does* fire with the handler
> attached. Only the ordinary path — open a terminal and look at it — is broken.
>
> **The fix is scope conformance, not new design.** `terminals.md` § PTY size ownership already named
> the triggers ("genuinely changes size **or** the user focuses/taps") and
> `feature-panels-ui.md` § Terminal pane already required the dedupe ("only the claiming, focused,
> visible pane sends resize (deduping identical sizes)") and the post-subscribe size resend. Neither
> half was ever implemented. Planning sharpened § PTY size ownership into an explicit trigger table
> (adding the create-time claim, which is *not* a Resize frame — the terminal does not exist yet, so
> nothing is taken from another client) plus an explicit non-trigger list, and added a Pi-Studio
> implementation contract to § Terminal pane recording the three ways split panes legitimately diverge
> from the reference app's single-terminal model (N simultaneous subscriptions, no empty filler / no
> unsubscribe-on-switch, size claim scoped to the focused visible pane).
>
> **No protocol or daemon-RPC change.** `terminal-rpc.ts:53-54` already forwards `cols`/`rows` and
> `terminal-manager.ts:114-115,171` already applies them to both the PTY spawn and the `ScreenBuffer`
> grid. The only daemon change in the sprint is the escape-safe ring trim (task-005).
>
> **No component test is possible** — the root vitest runner discovers `.test.ts` under a plain Node
> environment with no jsdom — so the decidable logic is extracted into a pure `terminal-size.ts` and
> the panel behaviour is proven by a live browser sequence in task-006, with `stty size`,
> `pi-studio terminal ls`, and devtools binary-frame counts as the oracles.

| Task | Title | Type | Depends on | Covers |
|------|-------|------|------|--------|
| task-001 | Decouple the xterm mount from the slot; attach `onData`/`onResize` before the first `fit()`; split subscription from emulator so a reconnect stops destroying scrollback | bugfix | none | packages/web-client (features/terminal/{TerminalPanel,TerminalPanel.module.css}); features/terminals, feature-panels-ui |
| task-002 | Create-time size claim: measured `cols`/`rows` on `create_terminal_request`, reconciled against the daemon's echo; pure `terminal-size.ts` (`isMeasurable`/`sameGrid`/`shouldClaimOnChange`/`shouldClaimOnFocus`) + tests | bugfix | task-001 | packages/web-client (features/terminal/{TerminalPanel,terminal-size,terminal-size.test}); packages/server (terminal/terminal-rpc — verify only); features/terminals |
| task-003 | Focus/tap claim + ownership-gated genuine-change claim through one `claimSize` seam, deduped against the last claimed size; non-triggers (attach, mount/visibility fits of a never-claimed panel, reconnect, background pane) provably silent | bugfix | task-002 | packages/web-client (features/terminal/{TerminalPanel,terminal-size}, stores/layout-store — read only); features/terminals, feature-panels-ui |
| task-004 | Coalesce refits/claims to one frame at rest (rAF + trailing settle), guard the `ResizeObserver` feedback loop, skip hidden panels | bugfix | task-003 | packages/web-client (features/terminal/TerminalPanel); features/terminals |
| task-005 | Snapshot replay hygiene: client `reset()` before replay (not `clear()`); daemon `safeReplayStart` so the 64 KiB ring never begins mid-escape-sequence | bugfix | none | packages/server (terminal/{terminal-manager,terminal-manager.test}); packages/web-client (features/terminal/TerminalPanel); features/terminals |
| task-006 | Live E2E proof of the whole size contract (fresh open, long-command editing, drag, splits, reattach, reconnect, two clients, large-output replay) + docs sync incl. three wrong statements in `packages/server/AGENTS.md` and a stale renderer comment | test + docs | task-001, task-002, task-003, task-004, task-005 | AGENTS.md (server, web-client); packages/web-client (features/terminal/TerminalPanel); features/terminals, feature-panels-ui |

### sprint-053-terminal-fidelity
> Three independent terminal gaps, each a divergence from scope that is already written, sequenced
> after sprint-052 because two of them sit directly on the size path it fixes.
>
> **Appearance.** `feature-panels-ui.md` § Terminal pane requires "theme from the terminal color
> tokens, user mono font, code font size" and `design-system.md` § Colors already defines
> `colors.terminal` as the full xterm ANSI map, built per variant (with a light-mode override).
> `TerminalPanel.tsx:51-73` ships a hardcoded 19-colour dark literal plus `baseFontSize.sm` — the
> **unscaled** token — and a literal mono stack, so the light theme leaves the terminal dark and the
> 10–24 px font-size setting does nothing there. The blocker is structural, not cosmetic: no component
> can read the resolved theme, because `ThemeBoundary.tsx:24-30` keeps the controller in a private ref
> and its only output is CSS variables (`css-bridge.ts:113-118` emits just two of the nineteen colours,
> commented "consumed by xterm config directly" — by nothing, because nothing can). Hence task-001's
> context seam. Reading the palette back out of CSS with `getComputedStyle` was rejected: it
> string-round-trips data already held, and cannot deliver the numeric font size. A font change alters
> cell metrics, so it is a genuine viewport change → refit then claim.
>
> **Exit.** `feature-panels-ui.md` § Terminal pane says "exit sets 'Terminal exited'". Today `exit`
> leaves a tab with a blinking cursor that swallows keystrokes. There is no close opcode
> (`terminal-manager.ts:291-293` says so explicitly), the sole signal is a `terminals_update` broadcast
> with **zero** web-client consumers, and that broadcast isn't sent at all on self-exit — only from RPC
> handlers. So the sprint adds an exit notification seam on `TerminalManager` (not a new opcode: the
> protocol is append-only and the JSON inventory broadcast already exists) and a client-side
> reconciliation.
>
> **Reflowable restore (tier 2).** `Restore = 0x05`, `SERVER_FEATURES["terminal-restore-modes"]`
> (advertised, `restoreModesEnabled: true`), and `CLIENT_CAPS.terminal_reflowable_snapshot` have all
> existed since sprint-002 and are **wholly dead**: no server path ever emits the frame, the negotiated
> `restoreMode` is echoed then ignored, and no client advertises the capability. The basic tier replays
> the raw byte ring, which reproduces the wrapping of whatever width the PTY had when those bytes were
> written — approximate by construction at any other width, which is why a reattach after a resize
> renders wrong even with sprint-052's escape-safe trim. Tier 2 serves a serialized redraw of the
> daemon's `@xterm/headless` grid instead, correct at any client width, and resolves both scopes'
> `TODO(verify)` on the snapshot serialization format.

| Task | Title | Type | Depends on | Covers |
|------|-------|------|------|--------|
| task-001 | Appearance context: publish the resolved `Theme` (incl. `colors.terminal`, scaled `fontSize`, `fontFamily.mono`) from `ThemeBoundary` with change notification, preserving the synchronous pre-first-paint apply | refactor | none | packages/web-client (theme/{ThemeBoundary,appearance-store,index}); architecture/design-system, features/feature-panels-ui |
| task-002 | Terminal follows the theme, mono font, and font-size setting; hardcoded palette + unscaled token deleted; font change refits then claims, colour-only change claims nothing | bugfix | task-001 | packages/web-client (features/terminal/TerminalPanel, theme/colors — read only); architecture/design-system, features/feature-panels-ui, terminals |
| task-003 | Exited-terminal state: `TerminalManager` exit notification seam (covers self-exit, not just RPC kill) → `terminals_update`; client reconciliation, "Terminal exited", input disabled, final screen preserved | bugfix | none | packages/server (terminal/{terminal-manager,terminal-rpc,terminal-manager.test,terminal-rpcs.test}); packages/web-client (features/terminal/TerminalPanel, features/workspace/TabStrip, stores/tab-store); features/feature-panels-ui, terminals |
| task-004 | Daemon tier 2: bounded grid serialization on `ScreenBuffer`, emitted as `Restore` (`0x05`) instead of `Snapshot` when the negotiated mode is reflowable; negotiation result finally honoured | feature | none | packages/server (terminal/{screen-buffer,screen-buffer.test,terminal-manager,terminal-rpc,+tests}, package.json); features/terminals, feature-panels-ui; architecture/websocket-protocol |
| task-005 | Client tier 2: advertise `terminal_reflowable_snapshot`, request + honour the echoed `restoreMode`, apply `Restore` through the shared reset-then-replay helper | feature | task-004 | packages/web-client (lib/connection/connection-store, features/terminal/TerminalPanel); packages/client (terminal-router.test); features/terminals; architecture/websocket-protocol |
| task-006 | Live E2E proof of the three strands **and their combinations** (font change → new width → restore laid out for it; exited terminal not restored on reconnect; disabled-daemon fallback) + sprint-052 regression sweep + docs sync | test + docs | task-001, task-002, task-003, task-004, task-005 | AGENTS.md (protocol, client, server, web-client); features/terminals, feature-panels-ui; architecture/design-system |
| task-007 | Broadcast PTY size on resize (ends multi-client belief drift, the limitation sprint-052 documented rather than fixed) + degrade the snapshot ring to the naive cut instead of dropping everything on an unterminated escape sequence | bugfix | none (coordinate with task-003 — both want one `terminals_update` listener) | packages/server (terminal/{terminal-manager,terminal-rpc,+tests}); packages/web-client (features/terminal/TerminalPanel); features/terminals |

## Coverage check

Every feature and architecture scope is covered by at least one task.

| Scope file | Covered by |
|------------|-----------|
| features/agent-sessions.md | s002/t003, s005/t001-002, s006/t002,t004, s011/t002, s045/t006 (capability-gated create-time system-prompt composition), s051/t005 (generalized N-capability composition) |
| features/agent-providers.md | s002/t005, s005/t001-003, s006/t005, s010/t001, s015/t007 (capability-flag extension for rewind), s045/t005 (resume honors per-session systemPrompt) |
| features/timeline-streaming.md | s002/t003, s006/t001,t003, s015/t001 |
| features/tool-permissions.md | s002/t003, s006/t005, s010/t001 (MCP mirror), s011/t004 (permit), s015/t003-004 |
| features/projects-workspaces.md | s008/t001-002, s013/t003 |
| features/worktrees.md | s003/t003, s008/t003, s011/t004, s013/t003 |
| features/git-checkout.md | s008/t004-006, s009/t006 (diff highlight), s016/t003 |
| features/terminals.md | s002/t004, s007/t003, s009/t001-002, s016/t004; s052/t001-006 (PTY size-ownership conformance: create-time/change/focus claims, dedupe+coalescing, escape-safe snapshot ring, reset-before-replay), s053/t002-006 (appearance-driven emulator, exited state, reflowable restore tier 2) |
| features/chat-rooms.md | s010/t002, s011/t004 |
| features/schedules-heartbeats.md | s010/t003, s011/t004, s013/t005 (UI) |
| features/loops.md | s010/t004, s011/t004 |
| features/mcp-server.md | s010/t001 |
| features/service-proxy.md | s003/t003, s009/t003, s016/t005 |
| features/file-explorer-transfer.md | s002/t005, s009/t004-005, s016/t001-002, s045/t001,t003 (shared `~` resolution, `Begin` mimeType, inline-image reuse of the download path), s046/t001,t004,t006 (move RPC on the same service, watch-driven refresh of both affected directories) |
| features/file-explorer-move.md | s046/t001-006; s047/t001 (trimmed-basename fix at the source), t005 (same-parent rename destination), t006 (docs: the anticipated affordance landed) |
| features/file-explorer-improvements.md | s047/t002-006 (item 9 rename; item 8 was delivered by s046) |
| features/subagents.md | s005/t005, s014/t001, s016/t005 |
| features/cli.md | s011/t001-004 |
| features/connection-resilience.md | s050/t001-004 |
| features/desktop-app.md | s024/t001-004, s025/t001-005, s013/t002,t004 (local-vs-remote daemon mode UI); s012/t006 (branding config) |
| features/app-navigation-screens.md | s013/t001-005 (logic); s017/t004, s019/t001-005 (render) |
| features/workspace-ui.md | s014/t001-004 (logic); s020/t001-004 (render) |
| features/timeline-rendering.md | s015/t001-005 (logic); s021/t001-003 (render); s045/t004 (`img` markdown override), s051/t003 (`a` markdown override) |
| features/inline-image-rendering.md | s045/t001-007; s051/t001-003 (amended: normalized/decoded classifier, pane-targeted click-to-open) |
| features/file-link-rendering.md | s051/t001-006 |
| features/composer-ui.md | s015/t006 (logic); s021/t004 (render) |
| features/feature-panels-ui.md | s016/t001-005, s015/t005 (logic); s022/t001-004 (render); s052/t001,t003,t006 (terminal-pane size-claim + status-surface conformance, Pi-Studio split-pane contract), s053/t001-006 (appearance sourcing, "Terminal exited" state, reconnect/restore) |
| features/ui-components.md | s012/t002-004,t006 (logic); s018/t001-002 (render) |
| features/rewind.md | s015/t007 (logic); s021/t005 (render) |
| features/provider-usage.md | s013/t004-005, s015/t006; s019/t004, s021/t004 (render) |
| features/keyboard-shortcuts.md | s012/t005, s013/t004-005, s015/t006; s018/t003 (render) |
| features/localization.md | s012/t005,t006, s013/t004; s017/t002, s019/t004 (render) |
| features/white-label-branding.md | s012/t006; s017/t002 (theme injection); s024/t001,t003 (desktop app name/icon/About) |
| architecture/daemon-bootstrap.md | s004/t001,t005, s023/t002, s024/t001 |
| architecture/websocket-protocol.md | s002/t001-005, s004/t004-005, s045/t006 (`CLIENT_CAPS.inline_image_markdown`), s051/t005 (`CLIENT_CAPS.file_link_markdown`), s053/t004-005 (first live use of the `Restore` binary opcode + `terminal_reflowable_snapshot` × `terminal-restore-modes` negotiation) |
| architecture/relay-e2ee.md | s004/t001, s023/t001-004, s013/t002, s019/t001 |
| architecture/persistence.md | s001/t003, s003/t001,t004 |
| architecture/auth-security.md | s004/t002-003, s009/t003-004, s025/t002,t005 |
| architecture/agent-lifecycle.md | s005/t004-005, s008/t002, s014/t001, s045/t005 (resume system-prompt fidelity) |
| architecture/config.md | s003/t002-003, s005/t003, s013/t004 |
| architecture/client-app-runtime.md | s007/t001-003, s013/t001, s015/t001,t006, s017/t001,t003,t004 (render foundation), s024/t001, s025/t001,t003, s050/t001-003 (reconnect ladder + resume-trigger liveness), s052/t001-004 (terminal-stream router usage: subscription split from emulator, single `claimSize` seam), s053/t005 (`onRestore` becomes a live path) |
| architecture/structured-generation.md | s006/t006, s008/t005-006, s013/t004, s016/t003 |
| architecture/design-system.md | s012/t001-004,t006 (logic); s017/t002 (theme→CSS), s018/t001-002 (primitives/overlays); s053/t001-002 (resolved-`Theme` context for JS-configured surfaces; `colors.terminal` + scaled font scale finally consumed) |
| architecture/ssh-gateway-connections.md | s025/t001-005 |

## Open questions — TODO(verify)
Carried from the scope; resolve against the live source while implementing the owning task.
- [ ] Full enumeration of WebSocket session message types + payload shapes (`packages/protocol/src/messages.ts`) — s002/t003.
- [ ] Current `CLIENT_CAPS` / `features.*` lists + floor versions + `COMPAT(...)` removal dates — s002/t002.
- [ ] Pi session JSONL directory layout/file naming + full Pi RPC surface + honored `params` keys — s005/t002.
- [ ] Exact `fetch_agent_timeline` field names + cursor encoding + page-limit merge counting — s006/t001,t003.
- [ ] Permission response option vocabulary + payload field names per provider — s006/t005.
- [ ] Per-request field shapes for checkout/git ops + diff projection format + `gh`/API surface — s008/t004-006.
- [x] Terminal Restore opcode value — `0x05`, confirmed against the live codec; the reflowable payload
      format is unconstrained by any external peer and is fixed by s053/t004. Worker protocol remains
      open (see below) — s002/t004, s009/t001, s053/t004-005.
- [ ] File-transfer frame layout (opcodes/chunk/completion) + download-token TTL/single-use — s002/t005, s009/t005.
- [ ] Service-proxy branch/project slugging + public TLS handling — s009/t003.
- [ ] Schedule missed-run/catch-up across downtime; `create_heartbeat` vs `create_schedule` params — s010/t003.
- [ ] Loop worker-vs-verify ordering and whether `sleepMs` applies after success — s010/t004.
- [ ] Relay `offer` fragment encoding, in-session replay protection status, relay session-id routing — s023/t001,t003,t004.
- [ ] Whether any server-side staged/percentage rollout exists behind the desktop `stable`/`beta` update
      channels (client-side is channel-select only) + full preload bridge surface + multi-window state
      lifting — s024/t002-004.
- [ ] Rewind's exact daemon-side file-revert mechanism (non-git workspaces) and `agent.rewind.request/
      response` field names — s015/t007. **This entire feature is new protocol/server scope**, not just a
      client task; coordinate with the daemon owner before implementing.
- [ ] Provider-usage daemon RPC (`provider_usage_list_request/response`) and per-provider retrieval
      mechanism — **new protocol/server scope**, needed before s013/t004's Provider Usage settings section
      and s015/t006's composer footer widget can show live data (build the UI against a mock/stubbed
      response in the meantime).
- [ ] RTL layout handling for Arabic locale — s012/t005.
- [ ] Exact empty-state copy per Schedules filter combination (host × active/ended) — s013/t005.
- [ ] `DesktopDaemonMode` (embedded/remote-only) is a Pi-Studio product decision layered on top of the
      reference app's always-on local daemon — there is no upstream behavior to verify against; exact
      Settings → Daemon copy/placement is open — s013/t002,t004; s024/t001.
- [ ] SSH gateway host-profile storage keys, OS secret-storage adapter, shared-vs-per-window tunnel policy, and possible future CLI `--ssh` support — s025/t001-005.
- [ ] Vite web/Electron build integration (loadFile vs dev-server URL), the `getIsElectron()` marker on
      each target, and the guarded dynamic-import helper for `*.electron.*` modules — s017/t001, s024/t001.
- [ ] Concrete DOM library confirmations where the design-system table lists alternatives (radix vs
      hand-rolled overlays; `react-markdown` remark plugin set; QR-decode lib) — s018/t002, s019/t001, s021/t002.
- [ ] Highlight package: highlighter library/grammar set (no dedicated scope file) — s009/t006.
- [ ] `Pi-StudioClient` exact method/signature surface per handle; reconnection backoff parameters — s007/t002, s013/t001.
- [ ] UI gaps carried from the new UI scope docs (own task in parens): theme appearance storage key (s012/t001); `?open=` workspace intent vocabulary (s014/t004); turn-footer metadata fields + full tool-type catalog (s015/t002-003); list-virtualization pin threshold + highlighter grammar set (s015/t001,t005); proxy-URL resolution for the browser pane (s016/t005). UI library choices are pinned in design-system § UI technology stack (mirror of the original's stack).
- [ ] Which extensions the web-client's viewer registry actually classifies as `image` (notably `.svg`,
      `.webp`, `.avif`) — this is the gate that decides what inline chat images will fetch, and the
      daemon's `mimeHintForFile` table covers a narrower set than the registry does — s045/t001-002.
- [ ] Whether the markdown *file* viewer should pass the viewed file's directory as its asset base
      (would make repository README images render inline for free). Behavior is desirable; whether it
      lands with this sprint is open — s045/t004.
- [ ] Safari/Firefox: whether dedicated-worker timers are exempt from visibility throttling under
      battery-saver modes (Chromium confirmed; others expected but unverified). Only affects how much
      of the throttling fix those browsers get — the `setTimeout` fallback keeps them at today's
      behavior either way — s050/t002,t004.
- [ ] Whether the production PTY should run in a dedicated worker process (`terminal-worker-protocol.ts`)
      or stay in-process behind `PtyBackend` as it does today. Carried unresolved from
      `features/terminals.md` § TODO(verify); untouched by s052/s053, neither of which depends on the
      answer.
- [ ] Renderer addon: `design-system.md` § UI technology stack lists `@xterm/xterm` ^6 beta with
      `addon-webgl`/`addon-search`/`addon-web-links`/`addon-clipboard`/`addon-image`/`addon-ligatures`/
      `addon-unicode11`; the app ships ^5.5.0 with `addon-fit` only, so it runs xterm 5's **DOM**
      renderer (a stale comment at `TerminalPanel.tsx:197-199` claims canvas — corrected by s052/t006).
      Whether to adopt the WebGL renderer for heavy-output throughput, and whether to move to the ^6
      line, is a deliberate open decision — not a prerequisite for either terminal sprint.
- [ ] Scrollback is hardcoded at 5000 lines; `feature-panels-ui.md` § Terminal pane says "configured
      scrollback" but no setting exists. Whether it becomes an appearance/terminal setting is open —
      s053/t002 deliberately does not invent one.
- [ ] `pi-studio terminal capture` renders `payload.text` while the daemon returns `screen`, so it
      prints an empty string; `terminal ls` renders a `title` column while entries carry `name`. Both in
      `packages/cli/src/feature-commands.ts`, both found while scoping s052, both deliberately out of
      scope there (CLI surface, unrelated to sizing) — needs its own small task.
