# Service Proxy — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [terminals.md](terminals.md), [../architecture/config.md](../architecture/config.md),
> [projects-workspaces.md](projects-workspaces.md), [../architecture/auth-security.md](../architecture/auth-security.md)

## Purpose

Pi-Studio proxies HTTP traffic to dev services running inside workspaces, giving each a stable URL.
Localhost service URLs are always enabled; an optional public alias and a separate service-only
listener can be layered on via config. This lets a user open a workspace's running dev server (e.g.
from a phone) without manual port juggling.

## Public Contract

### Triggering
- A `pi-studio.json` script with `"type": "service"` is assigned a local port when started and
  registered as a route in the service proxy (see [terminals.md](terminals.md) for script start).

### Generated hostname
```
<script>--<branch>--<project>.localhost          # general form
<script>--<project>.localhost                     # branch omitted when main/master
```
- One combined leftmost label (`script--branch--project`) keeps it compatible with single-level
  wildcard DNS/TLS. If the label exceeds the DNS 63-char limit, it is truncated with a deterministic
  hash suffix to avoid collisions.
- Example: script `dev`, project `miniweb`, branch `feature/auth` →
  `dev--feature-auth--miniweb.localhost`.

### Config (`daemon.serviceProxy`)
| Field | Required | Purpose |
|-------|----------|---------|
| `listen` | No | Start a separate service-only listener (e.g. `0.0.0.0:8080`) |
| `publicBaseUrl` | No | Add public host aliases + public links (e.g. `https://pi-studioapps.my.domain.com`) |
| `enabled` | No (compat) | `false` suppresses optional listen/publicBaseUrl only; localhost proxy stays on |

Env overrides: `PI_STUDIO_SERVICE_PROXY_LISTEN`, `PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL`,
`PI_STUDIO_SERVICE_PROXY_ENABLED` (compat shim). Env takes precedence over config.

## Behavior & Algorithms

```
on incoming HTTP request (daemon listener or service-only listener):
    host = request.Host header
    route = lookupServiceRouteByHostname(host)     # script--branch--project[.localhost | public base]
    if route: reverse-proxy to 127.0.0.1:{assignedPort}, forward Host unchanged
    else: normal daemon handling

on service script start:
    assign a free local port
    register route { hostname(script,branch,project) → port }
on service script stop:
    deregister route, release port
```

- Public URLs are built from `publicBaseUrl` (combined leftmost label as the subdomain).
- The reverse proxy in front (nginx/Caddy/Traefik) must forward the `Host` header **unchanged** —
  routing depends on it.

## Data & Persistence
- Route table + port assignments are in-memory runtime state tied to running service scripts
  (`workspace-service-port-registry`, `script-route-branch-handler`). Not persisted across restarts.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Hostname label > 63 chars | Truncate + deterministic hash suffix |
| Branch is main/master | Omit the branch segment |
| Unknown hostname | Fall through to normal daemon handling |
| `enabled:false` | Disable only optional public/listen layers |
| Reverse proxy rewrites Host | Routing breaks (documented requirement) |
| Service not yet listening | Proxy errors until the service binds its port |

## Dependencies
- Internal: service-proxy, script-proxy, script-route-branch-handler, port registry, script health
  monitor, workspace git metadata (branch/project).
- External: workspace dev services; optional external reverse proxy + wildcard DNS.

## Acceptance Criteria
- [ ] Starting a `type:"service"` script assigns a port and registers a localhost route.
- [ ] A request to `<script>--<project>.localhost` is proxied to the service port.
- [ ] Branch `main`/`master` omits the branch segment in the hostname.
- [ ] Over-long labels truncate with a stable hash suffix.
- [ ] `publicBaseUrl` produces public aliases; `enabled:false` suppresses only optional layers.
- [ ] Daemon password auth does **not** gate proxied service traffic (services expose themselves).

## TODO(verify)
- [ ] Exact slugging of branch/project into hostname labels.
- [ ] TLS handling for public service URLs vs. the relay.
