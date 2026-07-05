# Implementation Plan

> Derived from the clean-room scope in `clean-room-scope/`. Sprints and tasks are listed in
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
5. **Clients** (sprint 011–016, 018): CLI, the visual UI (design system + screens + workspace shell
   + timeline/composer + panels), and the Electron desktop shell.
6. **Remote access** (sprint 017, 019): relay E2EE, then Electron-only SSH gateway connections after
   the desktop shell exists.

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
| 017 | `sprint-017-relay-e2ee` | Relay crypto/channels, daemon+client transports, Cloudflare server | 4 |
| 018 | `sprint-018-desktop` | Electron shell+daemon supervisor, multi-window, native integrations (permissions/updates), browser panes | 4 |
| 019 | `sprint-019-ssh-gateway-connections` | Electron-only SSH tunnel profiles, bridge/runtime integration, UI, hardening | 5 |

Total: **19 sprints, 91 tasks.**

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

### sprint-017-relay-e2ee
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Relay crypto + symmetric channels | s004/task-001 | architecture/relay-e2ee; MAIN-SCOPE §2 |
| task-002 | Daemon relay transport + bootstrap wiring | task-001; s004/task-005 | architecture/relay-e2ee, daemon-bootstrap, config |
| task-003 | Client relay transport + pairing (QR fragment) | task-001; s007/task-001 | architecture/relay-e2ee, client-app-runtime |
| task-004 | Cloudflare relay server adapter | task-002, task-003 | architecture/relay-e2ee; MAIN-SCOPE §6 |

### sprint-018-desktop
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | Electron shell + managed daemon supervisor | s013/task-001; s004/task-005 | features/desktop-app; architecture/daemon-bootstrap, client-app-runtime |
| task-002 | Multi-window model + land-on-project | task-001; s008/task-002; s014 | features/desktop-app |
| task-003 | Native integrations (dialogs/menus/titlebar/notifications/auto-update) | task-001 | features/desktop-app |
| task-004 | In-app browser panes (webview) | task-003; s016/task-005 | features/desktop-app |

### sprint-019-ssh-gateway-connections
| Task | Title | Depends on | Covers (scope files) |
|------|-------|------------|----------------------|
| task-001 | SSH gateway profile and security model | s013/task-001; s018/task-001 | architecture/ssh-gateway-connections; architecture/client-app-runtime; features/desktop-app |
| task-002 | Electron SSH tunnel manager | task-001; s018/task-001 | architecture/ssh-gateway-connections; architecture/auth-security; features/desktop-app |
| task-003 | Preload bridge and app runtime integration | task-002; s013/task-001; s018/task-001 | architecture/ssh-gateway-connections; architecture/client-app-runtime; features/desktop-app |
| task-004 | SSH connection UI and diagnostics | task-003; s013/task-002; s013/task-004 | architecture/ssh-gateway-connections; features/app-navigation-screens; features/desktop-app |
| task-005 | Secret storage hardening, cleanup, and docs | task-004 | architecture/ssh-gateway-connections; architecture/auth-security; features/desktop-app |

## Coverage check

Every feature and architecture scope is covered by at least one task.

| Scope file | Covered by |
|------------|-----------|
| features/agent-sessions.md | s002/t003, s005/t001-002, s006/t002,t004, s011/t002 |
| features/agent-providers.md | s002/t005, s005/t001-003, s006/t005, s010/t001, s015/t007 (capability-flag extension for rewind) |
| features/timeline-streaming.md | s002/t003, s006/t001,t003, s015/t001 |
| features/tool-permissions.md | s002/t003, s006/t005, s010/t001 (MCP mirror), s011/t004 (permit), s015/t003-004 |
| features/projects-workspaces.md | s008/t001-002, s013/t003 |
| features/worktrees.md | s003/t003, s008/t003, s011/t004, s013/t003 |
| features/git-checkout.md | s008/t004-006, s009/t006 (diff highlight), s016/t003 |
| features/terminals.md | s002/t004, s007/t003, s009/t001-002, s016/t004 |
| features/chat-rooms.md | s010/t002, s011/t004 |
| features/schedules-heartbeats.md | s010/t003, s011/t004, s013/t005 (UI) |
| features/loops.md | s010/t004, s011/t004 |
| features/mcp-server.md | s010/t001 |
| features/service-proxy.md | s003/t003, s009/t003, s016/t005 |
| features/file-explorer-transfer.md | s002/t005, s009/t004-005, s016/t001-002 |
| features/subagents.md | s005/t005, s014/t001, s016/t005 |
| features/cli.md | s011/t001-004 |
| features/desktop-app.md | s018/t001-004, s019/t001-005, s013/t002,t004 (local-vs-remote daemon mode UI); s012/t006 (branding config) |
| features/app-navigation-screens.md | s013/t001-005 |
| features/workspace-ui.md | s014/t001-004 |
| features/timeline-rendering.md | s015/t001-005 |
| features/composer-ui.md | s015/t006 |
| features/feature-panels-ui.md | s016/t001-005, s015/t005 |
| features/ui-components.md | s012/t002-004,t006 |
| features/rewind.md | s015/t007 |
| features/provider-usage.md | s013/t004-005, s015/t006 |
| features/keyboard-shortcuts.md | s012/t005, s013/t004-005, s015/t006 |
| features/localization.md | s012/t005,t006, s013/t004 |
| features/white-label-branding.md | s012/t006; s018/t001,t003 (desktop app name/icon/About) |
| architecture/daemon-bootstrap.md | s004/t001,t005, s017/t002, s018/t001 |
| architecture/websocket-protocol.md | s002/t001-005, s004/t004-005 |
| architecture/relay-e2ee.md | s004/t001, s017/t001-004, s013/t002 |
| architecture/persistence.md | s001/t003, s003/t001,t004 |
| architecture/auth-security.md | s004/t002-003, s009/t003-004, s019/t002,t005 |
| architecture/agent-lifecycle.md | s005/t004-005, s008/t002, s014/t001 |
| architecture/config.md | s003/t002-003, s005/t003, s013/t004 |
| architecture/client-app-runtime.md | s007/t001-003, s013/t001, s015/t001,t006, s018/t001, s019/t001,t003 |
| architecture/structured-generation.md | s006/t006, s008/t005-006, s013/t004, s016/t003 |
| architecture/design-system.md | s012/t001-004,t006 |
| architecture/ssh-gateway-connections.md | s019/t001-005 |

## Open questions — TODO(verify)
Carried from the scope; resolve against the live source while implementing the owning task.
- [ ] Full enumeration of WebSocket session message types + payload shapes (`packages/protocol/src/messages.ts`) — s002/t003.
- [ ] Current `CLIENT_CAPS` / `features.*` lists + floor versions + `COMPAT(...)` removal dates — s002/t002.
- [ ] Pi session JSONL directory layout/file naming + full Pi RPC surface + honored `params` keys — s005/t002.
- [ ] Exact `fetch_agent_timeline` field names + cursor encoding + page-limit merge counting — s006/t001,t003.
- [ ] Permission response option vocabulary + payload field names per provider — s006/t005.
- [ ] Per-request field shapes for checkout/git ops + diff projection format + `gh`/API surface — s008/t004-006.
- [ ] Terminal Restore opcode value + reflowable-snapshot payload + worker protocol — s002/t004, s009/t001.
- [ ] File-transfer frame layout (opcodes/chunk/completion) + download-token TTL/single-use — s002/t005, s009/t005.
- [ ] Service-proxy branch/project slugging + public TLS handling — s009/t003.
- [ ] Schedule missed-run/catch-up across downtime; `create_heartbeat` vs `create_schedule` params — s010/t003.
- [ ] Loop worker-vs-verify ordering and whether `sleepMs` applies after success — s010/t004.
- [ ] Relay `offer` fragment encoding, in-session replay protection status, relay session-id routing — s017/t001,t003,t004.
- [ ] Whether any server-side staged/percentage rollout exists behind the desktop `stable`/`beta` update
      channels (client-side is channel-select only) + full preload bridge surface + multi-window state
      lifting — s018/t002-004.
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
      Settings → Daemon copy/placement is open — s013/t002,t004; s018/t001.
- [ ] SSH gateway host-profile storage keys, OS secret-storage adapter, shared-vs-per-window tunnel policy, and possible future CLI `--ssh` support — s019/t001-005.
- [ ] Highlight package: highlighter library/grammar set (no dedicated scope file) — s009/t006.
- [ ] `Pi-StudioClient` exact method/signature surface per handle; reconnection backoff parameters — s007/t002, s013/t001.
- [ ] UI gaps carried from the new UI scope docs (own task in parens): theme appearance storage key (s012/t001); `?open=` workspace intent vocabulary (s014/t004); turn-footer metadata fields + full tool-type catalog (s015/t002-003); list-virtualization pin threshold + highlighter grammar set (s015/t001,t005); proxy-URL resolution for the browser pane (s016/t005). UI library choices are pinned in design-system § UI technology stack (mirror of the original's stack).
