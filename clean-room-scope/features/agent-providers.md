# Pi Provider — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [tool-permissions.md](tool-permissions.md),
> [../architecture/config.md](../architecture/config.md), [mcp-server.md](mcp-server.md)

## Purpose

**Pi** is the single agent backend Pi-Studio drives. The provider adapter implements a common
`AgentClient`/`AgentSession` contract so the rest of the daemon stays provider-neutral. Pi is a
process-backed provider: the user must have the `pi` binary installed and authenticated, and the
daemon talks to it via `pi --mode rpc`. The daemon never manages Pi's credentials. A dev-only,
in-process `mock` provider exists purely for tests and load testing.

## Public Contract

### Provider entry
| Provider | Wraps | Integration | Session format |
|----------|-------|-------------|----------------|
| `pi` | Pi (`pi --mode rpc`) | Direct / process-backed | JSONL session dir (read for import; resume via session file handle) |
| `mock` | in-process fake | Direct (dev/test only) | in-memory |

### `AgentClient` (abridged contract)
- `provider`, `capabilities`
- `createSession(config, launchContext?, options?) → AgentSession`
- `resumeSession(handle, overrides?, launchContext?) → AgentSession`
- `listModels(opts) → AgentModelDefinition[]`
- `isAvailable() → boolean`  (checks the `pi` binary is on `$PATH`)
- optional: `listModes`, `listImportableSessions`, `importSession`, `getDiagnostic`

### `AgentSession` (abridged contract)
- `provider`, `id`, `capabilities`, `features?`
- `run(prompt, opts?)`, `startTurn(prompt, opts?) → { turnId }`
- `subscribe(cb) → unsubscribe`, `streamHistory() → AsyncGenerator<AgentStreamEvent>`
- `getRuntimeInfo()`, `getAvailableModes()`, `getCurrentMode()`, `setMode(id)`
- `getPendingPermissions()`, `respondToPermission(requestId, response)`
- `describePersistence() → PersistenceHandle | null`, `interrupt()`, `close()`
- optional: `listCommands`, `setModel`, `setThinkingOption`, `setFeature`, `tryHandleOutOfBand`

### Capability flags (`AgentCapabilityFlags`)
`supportsStreaming`, `supportsSessionPersistence`, `supportsDynamicModes`, `supportsMcpServers`,
`supportsReasoningStream`, `supportsToolInvocations`.

### Registration surface
1. Provider class in `agent/providers/pi/agent.ts` implementing `AgentClient`/`AgentSession`.
2. Manifest entry in `provider-manifest.ts` (modes with `icon`/`colorTier`, provider definition).
3. Factory in `provider-registry.ts` (`PROVIDER_CLIENT_FACTORIES`), invoked with
   `(logger, runtimeSettings, options)`.
4. App icon registered in `provider-icons.ts` (fallback `Bot`).
5. E2E config in `daemon-e2e/agent-configs.ts`.

### Custom Pi-compatible profiles (config `agents.providers.{id}`)
- A custom provider must declare `extends: "pi"` and a `label`. It may set `command` (custom binary),
  `env`, `params` (e.g. `sessionDir` for a fork's JSONL session directory), `models`/
  `additionalModels`, `disallowedTools`, `enabled`, `order`, `description`.
- Pi-compatible forks keep Pi's `--mode rpc` API but may write sessions elsewhere; set
  `params.sessionDir` so import can find them. Launch/resume still use the configured `command`.
- Provider ids must match `/^[a-z][a-z0-9-]*$/`. See
  [../architecture/config.md](../architecture/config.md).

## Behavior & Algorithms

### Pi lifecycle
```
createSession(config):
    spawn `pi --mode rpc` (or configured command) in cwd, with env
    pass Pi-Studio system prompts via --append-system-prompt (Pi keeps its default coding prompt)
    if injecting MCP servers: write a per-agent MCP config and pass --mcp-config
        (do NOT modify user/project MCP files)
    discover models/modes/commands/features via Pi RPC top-level calls
run/startTurn: send prompt over RPC; stream events (assistant, reasoning, tool calls, turn markers)
isAvailable(): `pi` binary resolvable on $PATH
```

### MCP injection specifics
- Pi MCP support depends on the open-source `pi-mcp-adapter` extension being loaded for the agent
  cwd. Probe with Pi RPC `get_commands`; the adapter registers an extension command named `mcp`
  (often with `sourceInfo.source` containing `pi-mcp-adapter`).
- For local HTTP MCP servers (such as the daemon's own `/mcp/agents` endpoint), explicitly disable
  adapter OAuth in the generated config (`auth: false`, `oauth: false`).

### Import & resume
- Pi RPC does not expose a recent-session listing command, so import discovery **reads Pi's persisted
  JSONL session files** directly.
- Resume and full history hydration go through `pi --mode rpc` using the session file as
  `nativeHandle`.
- Import contract: the picker calls `listImportableSessions` (rows only: provider handle, cwd, title,
  prompt previews, last activity); `importSession({ providerHandleId, cwd })` returns the resumed
  session + storage config + persistence handle + hydrated timeline for that one native session.
  `AgentManager.importProviderSession` seeds the daemon timeline and publishes the agent only once
  ready.

### Extension UI dialogs → question permissions
- Pi RPC extension UI requests (`select`, `input`, `editor`, `confirm`) are bridged into Pi-Studio
  question permissions and answered with `extension_ui_response`. See
  [tool-permissions.md](tool-permissions.md) for the combined/chained-dialog semantics.

### Models, modes, features
- Discovered dynamically at runtime via Pi RPC; manifest entries are UI scaffolding (icons, color
  tiers) only. Draft metadata lookups prefer `listModels`/`listModes`/`listCommands`/`listFeatures`
  over creating a scratch session (scratch sessions can appear as empty native sessions in Pi's
  import/history UIs).

### Provider snapshot refresh contract
- The daemon keeps a provider snapshot **per resolved cwd** (blank cwd → user home). Workspace
  selectors pass the launching cwd so project-specific models/modes probe in context; settings use
  the home snapshot.
- A snapshot probes only while **cold**; once warm (`ready`/`error`/`unavailable`) it stays cached
  until an **explicit refresh** (no TTL/focus/selector-open/config-reload revalidation).
- **Settings refresh** clears all cwd-scope caches + in-flight loads, then immediately refreshes only
  the home snapshot with `force:true`; workspace snapshots re-probe lazily.
- Registry/config replacement updates visible metadata (label/description/default mode/enabled) but
  must **not** spawn the Pi process.

## Data & Persistence
- Provider config in `config.json` (`agents.providers`). Per-agent runtime/persistence in the agent
  record (`PersistenceHandle.nativeHandle` = Pi session file). Pi session JSONL files are owned by
  the Pi CLI (read-only for import).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| `pi` binary not on `$PATH` | `isAvailable()` false → provider unavailable |
| `pi-mcp-adapter` not loaded for cwd | MCP injection unavailable; agent still runs without injected MCP |
| Scratch session created for metadata | Avoid; prefer top-level list APIs |
| Custom fork with different session dir | Use `params.sessionDir` for import; launch/resume via `command` |
| Fire-and-forget extension UI (notifications) | Ignored unless first-class UI exists |

## Dependencies
- Internal: provider registry/manifest, snapshot manager, runtime MCP config injection, structured
  generation, permission flow.
- External: the `pi` CLI (`pi --mode rpc`), `pi-mcp-adapter` extension (for MCP), GitHub `gh` (for
  PR-related agent flows).

## Acceptance Criteria
- [ ] The Pi provider exposes models/modes/features discovered at runtime via Pi RPC.
- [ ] Pi-Studio system prompts are passed with `--append-system-prompt`, preserving Pi's default prompt.
- [ ] Injected MCP servers are written to a per-agent `--mcp-config`, never to user/project files.
- [ ] A cold provider snapshot probes once and stays cached until an explicit refresh.
- [ ] Settings refresh clears all scopes and re-probes only the home snapshot.
- [ ] Import discovery reads Pi JSONL session files; resume uses the session file as `nativeHandle`.
- [ ] A custom `extends:"pi"` profile launches via its `command` and finds imports via `params.sessionDir`.

## TODO(verify)
- [ ] Current Pi session JSONL directory layout and file naming.
- [ ] Full Pi RPC method surface used by the adapter.
- [ ] Exact `params` keys honored for Pi profiles.
