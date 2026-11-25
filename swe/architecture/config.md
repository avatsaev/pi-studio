# Configuration (config.json, pi-studio.json, env) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [features/agent-providers.md](../features/agent-providers.md),
> [persistence.md](persistence.md),
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
    hostnames: true | string[],
    devAllowedOrigins: string[],           # browser Origins allowed on WS upgrades (dev switch; default none)
    relay: { enabled, endpoint, publicEndpoint, useTls, publicUseTls },
    piHome?: string,                       # redirects the bundled Pi CLI's own .pi config dir
    auth: { password: string }             # bcrypt hash, optional
  },
  app: { baseUrl },
  agents: {
    providers: { pi?: ProviderOverride },   # only `pi`; other keys are a config error
    metadataGeneration: { providers: [{ provider, model?, thinkingOptionId? }] }
  }
}
```
- All fields optional with sensible defaults.
- `agents.metadataGeneration.providers` sets the preferred fallback order for daemon-side structured
  generation (commit messages, PR text, branch names, titles); tried in order, then dynamic defaults,
  then current selection.

### Provider override (`agents.providers.pi`)
Only the `pi` key is accepted; any other key fails load (`agents.providers.foo: only "pi" is
supported`). Fields: `command?` (string[]), `env?`. See
[features/agent-providers.md](../features/agent-providers.md).

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
- A revision/stale-write model exists (`Pi-StudioConfigRevisionSchema`): writes can fail with
  `project_not_found`, `invalid_project_config`, `stale_project_config` (config changed on disk),
  or `write_failed`.

### Environment-variable precedence (selected)
Env overrides config.json for: `PI_STUDIO_HOME`, `PI_STUDIO_LISTEN`, `PI_STUDIO_SERVER_ID`, `PI_STUDIO_PASSWORD`,
`PI_STUDIO_HOSTNAMES`, `PI_STUDIO_PI_HOME` (`daemon.piHome`), `PI_STUDIO_RELAY_ENDPOINT`, `PI_STUDIO_RELAY_PUBLIC_ENDPOINT`,
`PI_STUDIO_RELAY_USE_TLS`, `PI_STUDIO_RELAY_PUBLIC_USE_TLS`, `PI_STUDIO_APP_BASE_URL` (pairing link origin, `app.baseUrl`),
`PI_STUDIO_DEV_ALLOWED_ORIGINS` (`daemon.devAllowedOrigins`).

## Behavior & Algorithms
```
function loadConfig(path):
    raw = readJson(path) or {}
    migrate legacy: provider command:{mode,...}→current shape
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
| Legacy provider `command.mode` | Migrate inline on load |
| `pi-studio.json` changed on disk during edit | Reject with `stale_project_config` |
| Invalid provider id | Reject the entry |
| WS upgrade with an `Origin` not in `daemon.devAllowedOrigins` | Refused (`403 Origin not allowed`) |

## Dependencies
- Internal: bootstrap, provider registry, worktree service.
- External: Zod, bcrypt (password hash).

## Acceptance Criteria
- [ ] Env vars override the matching config.json keys.
- [ ] A legacy provider `command.mode` shape loads without error.
- [ ] An `agents.providers` key other than `pi` is rejected, naming the key.
- [ ] `pi-studio.json` `setup: "cmd"` normalizes to `["cmd"]`.
- [ ] Editing `pi-studio.json` against a stale revision returns `stale_project_config`.

## TODO(verify)
- [ ] Complete `pi-studio.json` script entry schema (fields beyond `type`/`command`).
- [ ] Exact default `log` levels/rotation values.
