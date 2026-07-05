# Client / App Runtime — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [websocket-protocol.md](websocket-protocol.md),
> [features/timeline-streaming.md](../features/timeline-streaming.md),
> [features/agent-sessions.md](../features/agent-sessions.md), [relay-e2ee.md](relay-e2ee.md),
> [ssh-gateway-connections.md](ssh-gateway-connections.md)

## Purpose

Defines the client-side architecture shared by the Expo app and (indirectly) the CLI: the low-level
daemon WebSocket driver, the `Pi-StudioClient` SDK facade, host-connection management, per-session
runtime state, reconnection, and the cross-platform gating rules that keep one codebase running on
iOS, Android, browser web, and Electron desktop.

## Public Contract

### Layered client library (`@av-pi-studio/client`)
| Layer | Export | Responsibility |
|-------|--------|----------------|
| Driver | `DaemonClient` (`internal/daemon-client`) | Low-level WS connect, framing, RPC correlation, transports |
| Transports | websocket transport, relay E2EE transport, Electron SSH tunnel URL handoff | Direct vs. relay data paths; SSH obtains a local `ws://127.0.0.1:<port>` URL before using the direct WebSocket path |
| Facade | `Pi-StudioClient` (`@av-pi-studio/client`) | High-level workspace/agent/provider actions, handles |
| Router | terminal-stream-router | Demux binary terminal frames to subscribers |

`Pi-StudioClient` exposes handles: `Pi-StudioWorkspaceHandle`/`Pi-StudioWorkspaceActions`,
`Pi-StudioAgentHandle`/`Pi-StudioAgentActions` (with `Pi-StudioAgentTimelineHandle`), `Pi-StudioProviderActions`,
plus update handler types (`Pi-StudioWorkspaceUpdateHandler`, `Pi-StudioAgentUpdateHandler`). `ConnectionState`
models the connection lifecycle.

### App runtime concepts
| Concept | Code anchor | Responsibility |
|---------|-------------|----------------|
| Host | `HostProfile` | Saved client-side connection profile pointing at a daemon (direct / relay / SSH gateway / desktop-managed local embedded daemon — see [../features/desktop-app.md](../features/desktop-app.md) § Local vs. remote daemon mode) |
| Host runtime | `HostRuntimeController` | Manages saved hosts, reconnection, per-host runtime state |
| Session context | `SessionContext` | Wraps the daemon client for the active session |
| Routing | Expo Router | `/h/[serverId]/workspace/[workspaceId]`, `/h/[serverId]/agent/[agentId]`, etc. |
| Composer | `Composer` (`composer/`) | Prompt surface: input, toolbar, tracks, attachments, drafts |
| Timeline reducers | `session-stream-reducers.ts` | Compaction, gap detection, sequence-based dedup |

### Platform gating (app)
| Gate | Type | Use for |
|------|------|---------|
| `isWeb` | constant | DOM APIs (document/window/`<div>`/listeners) |
| `isNative` | constant | Native-only APIs (haptics, camera, secure storage) |
| `getIsElectron()` | cached fn | Desktop bridge (file dialogs, titlebar, updates) |
| `useIsCompactFormFactor()` | hook | Layout decisions (phone vs. tablet/desktop) |

## Behavior & Algorithms

### Connection
```
HostRuntimeController:
    for each saved HostProfile:
        choose transport (direct ws OR relay E2EE OR Electron SSH tunnel based on profile)
        DaemonClient.connect():
            open socket
            (relay) complete e2ee handshake
            (ssh/electron) open local tunnel, then connect direct WS to returned localhost URL
            send hello { clientId, clientType, protocolVersion, capabilities }
            await status/server_info → record serverId, features
        expose ConnectionState; on drop → backoff reconnect; rehydrate capabilities
```

### Timeline view consistency (client side)
- Live `agent_stream` for immediacy; `fetch_agent_timeline_request` is authoritative.
- Resume with a known cursor → page `direction:"after"` to completion (`hasNewer:false`); never
  replace with a latest-tail page (would skip the middle of a long run).
- Resume without a cursor → fetch latest tail page; older history is scroll-driven.
- See [features/timeline-streaming.md](../features/timeline-streaming.md).

### Platform rules (Pi-Studio: web + Electron, DOM/React/Vite)
> Pi-Studio ships web + Electron only. The original's Metro `.web`/`.native`/`.electron` extension
> policy is replaced by the Vite module-selection policy below (see also
> [design-system.md](design-system.md) § Module-selection policy).
- **Web is the baseline.** All shared components render to the DOM; there is no React Native runtime.
- **`getIsElectron()`** (cached) is the single source of truth for desktop-only behavior. Two build
  targets exist, distinguished by `import.meta.env.VITE_TARGET` (`"web"` | `"electron"`).
- **Selecting Electron-only code** (in precedence order):
  1. Runtime branch inside a shared module: `if (getIsElectron()) { … }` for small differences
     (clipboard, open-external, titlebar affordance).
  2. Build-time flag `import.meta.env.VITE_TARGET` for whole branches Vite can dead-code-eliminate.
  3. Dynamic `await import("./thing.electron.ts")` guarded by `getIsElectron()` for heavy Electron-only
     modules (SSH bridge, `<webview>` browser pane, native menu glue) so they never enter the web chunk.
  Name Electron-only files `*.electron.ts(x)` by convention and import them only through the guarded
  dynamic-import helper; name web fallbacks `*.web.ts(x)` when a shared file would be confusing.
- **Hover** only exists on web/desktop (pointer devices). Use CSS `:hover` for pure-visual hover and a
  `useHover()` hook (pointerenter/leave) when hover must drive React state; treat compact layout as
  "always reveal" so touch/compact users are not stranded.
- **Never use OS/user-agent as a layout proxy** — use the breakpoint system
  ([design-system.md](design-system.md) § breakpoints); `isCompact` is the only phone-class signal.

## Data & Persistence
- Client stores go through a `KeyValueStore` interface: `localStorage` on web, an Electron settings
  bridge on desktop. Draft store key `pi-studio-drafts` (v2); attachment bytes in web IndexedDB
  (`indexedDB`) / Electron temp files. See [persistence.md](persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Socket drop | Backoff reconnect; rehydrate capabilities; resume timeline from cursor |
| RPC timeout | Operation error only; do not treat socket as dead (use ping/pong) |
| Daemon lacks a feature flag | Show "update the host"; no degraded fallback |
| Stale mobile focus heartbeat | May affect notification routing only; never hides timeline rows |
| Multiple clients on one agent | Each maintains its own layout/tabs; archive is the global gesture |

## Dependencies
- Internal: protocol schemas, daemon client transports.
- External: React/React Native, Expo Router, AsyncStorage, IndexedDB (web), browser/RN WebSocket.

## Acceptance Criteria
- [ ] `DaemonClient.connect()` completes the hello handshake and records `serverId`+`features`.
- [ ] Relay connections complete the E2EE handshake before any app RPC.
- [ ] On reconnect, the timeline catches up from the stored cursor to `hasNewer:false`.
- [ ] Hover-to-show controls are always visible on native and hover-gated on web.
- [ ] A missing feature flag surfaces an "update host" affordance, not a broken/degraded feature.

## Related UI scope
The visual/interaction layer that sits on top of this runtime is specified separately:
- [../features/app-navigation-screens.md](../features/app-navigation-screens.md) — route map, navigation
  shell, onboarding/pairing, settings & projects IA.
- [../features/workspace-ui.md](../features/workspace-ui.md) — workspace screen, tabs, panes/splits.
- [../features/timeline-rendering.md](../features/timeline-rendering.md) — per-row rendering + autoscroll.
- [../features/composer-ui.md](../features/composer-ui.md) — composer regions, submit/queue, controls.
- [../features/feature-panels-ui.md](../features/feature-panels-ui.md) — explorer/git/terminal/browser/
  subagents panel UIs.
- [../features/ui-components.md](../features/ui-components.md) — shared primitive library.
- [design-system.md](design-system.md) — theme tokens, variants, breakpoints, styling-engine rules.

## TODO(verify)
- [ ] Exact `Pi-StudioClient` action surface (method names/signatures) per handle.
- [ ] Reconnection backoff parameters.
