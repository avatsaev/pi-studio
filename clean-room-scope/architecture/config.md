# Configuration (config.json, pi-studio.json, env) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [features/agent-providers.md](../features/agent-providers.md),
> [features/service-proxy.md](../features/service-proxy.md), [persistence.md](persistence.md),
> [auth-security.md](auth-security.md)

## Purpose

Two configuration surfaces: the **daemon config** (`$PI_STUDIO_HOME/config.json`, global, mutable) and
the **per-project config** (`pi-studio.json` at a project root, for worktree lifecycle + named scripts).
Environment variables override config where noted. All config is Zod-validated with legacy
normalization on load.

## Public Contract

### Daemon config — `config.json` (`PersistedConfigSchema`)
```
{
  version: 1,
  daemon: {
    listen: "127.0.0.1:6767",
    hostnames: true | string[],           # legacy alias `allowedHosts` migrated on load
    mcp: { enabled, injectIntoAgents },
    appendSystemPrompt: string,            # appended to supported providers' system/developer prompts
    cors: { allowedOrigins: string[] },
    relay: { enabled, endpoint, publicEndpoint, useTls, publicUseTls },
    auth: { password: string },            # bcrypt hash, optional
    serviceProxy: { listen?, publicBaseUrl?, enabled? }   # see service-proxy
  },
  app: { baseUrl },
  worktrees?: { root? },                   # default $PI_STUDIO_HOME/worktrees
  providers: { local: { modelsDir } },
  agents: {
    providers: Record<providerId, ProviderOverride>,   # custom Pi-compatible profiles
    metadataGeneration: { providers: [{ provider, model?, thinkingOptionId? }] }
  },
  log: { level, format, console: {...}, file: { level, path, rotate: { maxSize, maxFiles } } }
}
```
- All fields optional with sensible defaults.
- `agents.metadataGeneration.providers` sets the preferred fallback order for daemon-side structured
  generation (commit messages, PR text, branch names, titles); tried in order, then dynamic defaults,
  then current selection.

### Provider override (`agents.providers.{id}`)
Provider ids: `/^[a-z][a-z0-9-]*$/`. Fields: `extends` (`"pi"`; required for custom),
`label` (required for custom), `description?`, `command?` (string[]; custom Pi binary/fork), `env?`,
`params?`, `models?`, `additionalModels?`, `disallowedTools?`, `enabled?`, `order?`. Full semantics
in [features/agent-providers.md](../features/agent-providers.md).

### Per-project config — `pi-studio.json`
```
{
  worktree?: { setup?: string|string[], teardown?: string|string[] },
  scripts?: Record<scriptName, { type?: "service" | ..., command: string, ... }>,
  instructions?: string
}
```
- `setup`/`teardown` are normalized: a string becomes a single-element array; blanks dropped; default
  `{ setup: [], teardown: [] }`.
- `scripts` entries with `type: "service"` are proxied (see
  [features/service-proxy.md](../features/service-proxy.md)).
- A revision/stale-write model exists (`Pi-StudioConfigRevisionSchema`): writes can fail with
  `project_not_found`, `invalid_project_config`, `stale_project_config` (config changed on disk),
  or `write_failed`.

### Environment-variable precedence (selected)
Env overrides config.json for: `PI_STUDIO_HOME`, `PI_STUDIO_LISTEN`, `PI_STUDIO_SERVER_ID`, `PI_STUDIO_PASSWORD`,
`PI_STUDIO_HOSTNAMES`, `PI_STUDIO_RELAY_ENDPOINT`, `PI_STUDIO_RELAY_PUBLIC_ENDPOINT`, `PI_STUDIO_RELAY_USE_TLS`,
`PI_STUDIO_RELAY_PUBLIC_USE_TLS`, `PI_STUDIO_SERVICE_PROXY_LISTEN`, `PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL`,
`PI_STUDIO_SERVICE_PROXY_ENABLED` (compat shim).

## Behavior & Algorithms
```
function loadConfig(path):
    raw = readJson(path) or {}
    migrate legacy: allowedHosts→hostnames, provider command:{mode,...}→current shape
    parsed = PersistedConfigSchema.parse(migrated)
    overlay env vars (env wins) for the keys listed above
    return parsed
```
- Pi models/modes are discovered dynamically at runtime via Pi RPC. A custom profile's `models`
  replaces discovered models; `additionalModels` merges/relabels. See
  [features/agent-providers.md](../features/agent-providers.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Missing config.json | Use all defaults |
| Legacy `allowedHosts` / provider `command.mode` | Migrate inline on load |
| `pi-studio.json` changed on disk during edit | Reject with `stale_project_config` |
| Invalid provider id | Reject the entry |
| `serviceProxy.enabled:false` | Suppress optional listen/publicBaseUrl only; localhost proxy stays on |

## Dependencies
- Internal: bootstrap, provider registry, service proxy, worktree service.
- External: Zod, bcrypt (password hash).

## Acceptance Criteria
- [ ] Env vars override the matching config.json keys.
- [ ] Legacy `allowedHosts` and provider `command.mode` shapes load without error.
- [ ] A custom Pi profile missing `extends`+`label` is rejected.
- [ ] `pi-studio.json` `setup: "cmd"` normalizes to `["cmd"]`.
- [ ] Editing `pi-studio.json` against a stale revision returns `stale_project_config`.

## TODO(verify)
- [ ] Complete `pi-studio.json` script entry schema (fields beyond `type`/`command`).
- [ ] Exact default `log` levels/rotation values.
