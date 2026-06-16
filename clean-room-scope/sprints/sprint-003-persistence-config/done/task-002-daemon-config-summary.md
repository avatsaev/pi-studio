# Task 002 — Daemon config (config.json) + env precedence — Summary

- **Sprint:** sprint-003-persistence-config
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/config/daemon-config.ts`:
- **`persistedConfigSchema`** — the full `PersistedConfigSchema` (`version`, `daemon.{listen,
  hostnames,mcp,appendSystemPrompt,cors,relay,auth,serviceProxy}`, `app.baseUrl`, `worktrees.root`,
  `providers.local.modelsDir`, `agents.{providers,metadataGeneration.providers}`, `log.*`). Every
  field optional with a default so `{}` parses to a fully populated config.
- **`providerOverrideSchema` + `providersRecordSchema`** — provider ids `/^[a-z][a-z0-9-]*$/`
  (record key schema); a custom profile (id ≠ `pi`) must declare `extends:"pi"` + `label` (enforced
  via `superRefine`); overriding the built-in `pi` does not.
- **`migrateConfig`** — inline legacy normalization: `allowedHosts` (daemon- or top-level) →
  `hostnames`; provider `command:{mode,command?,args?}` object → `string[]` via
  `migrateProviderSettings` (mode dropped). Tagged `COMPAT(legacy-allowed-hosts)` /
  `COMPAT(legacy-provider-command)`.
- **`overlayEnv`** — overlays the config.md env keys (env wins): `PI_STUDIO_LISTEN`, `PI_STUDIO_PASSWORD`,
  `PI_STUDIO_HOSTNAMES` (`"true"`→disable allowlist, else CSV), relay endpoint/public/useTls/
  publicUseTls, service-proxy listen/publicBaseUrl/enabled.
- **`loadConfig(path, env?)`** — read JSON (or `{}` when missing/corrupt) → migrate → parse → overlay
  env. Throws on structurally invalid config (bad provider id / custom missing extends+label).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/config/daemon-config.ts` | created |
| `packages/server/src/config/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports config |
| `packages/server/src/config/daemon-config.test.ts` | added — 11 tests |

## How it satisfies the scope
- **config.md § Daemon config / § Env precedence / § Behavior:** schema shape, the `loadConfig`
  pseudocode (read→migrate→parse→overlay), and the enumerated env keys are reproduced.
- **MAIN-SCOPE §6:** default listen `127.0.0.1:6767`, hostnames allowlist, password, relay/service-proxy.
- **persistence.md:** corrupt/missing JSON falls back to `{}`→defaults; no migration framework
  (optional fields + defaults + inline normalization).

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/config/daemon-config.test.ts
 ✓ daemon-config.test.ts (11 tests)
 Test Files  1 passed (1)      Tests  11 passed (11)
$ npx oxlint packages/server   → clean
$ npx oxfmt --check ...        → clean
```

## Acceptance criteria
- [x] Missing `config.json` → all defaults.
- [x] Legacy `allowedHosts` and provider `command.mode` load without error (migrated inline).
- [x] Env vars override matching config keys (env wins).
- [x] A custom provider missing `extends`+`label` is rejected; bad provider id rejected.

## Follow-ups / TODO(verify)
- Exact default `hostnames` list (chose `["localhost","*.localhost"]`; MAIN-SCOPE also mentions literal
  IPs) and the `log` level/rotation defaults are TODO(verify).
- `PI_STUDIO_HOME`/`PI_STUDIO_SERVER_ID` env vars are *not* config.json fields (they select the home dir /
  the `server-id` file), so they are handled in bootstrap (sprint-004), not in `overlayEnv`.
