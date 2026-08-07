# Provider Usage (Balances & Rate-Limit Windows) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-providers.md](agent-providers.md), [composer-ui.md](composer-ui.md),
> [app-navigation-screens.md](app-navigation-screens.md), [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

## Purpose

Surfaces each configured provider's account usage — spend/quota balances and rolling rate-limit
windows — so a user can see at a glance how close they are to a cap without leaving Pi-Studio. Read
in Settings (a per-host summary) and, compactly, in the composer footer while an agent is active.

## Public Contract

### Wire contract (daemon → client)
```ts
{ type: "provider_usage_list_request", requestId }
→ { type: "provider_usage_list_response", requestId,
    payload: { providers: ProviderUsage[] } }
```
Gated by a server feature flag `providerUsageList` (`server_info.features.providerUsageList`); a
daemon that doesn't advertise it is treated as unsupported (client shows an "update host" message,
no degraded fallback — same rule as every other capability gate).

```ts
type ProviderUsageTone = "default" | "ok" | "warning" | "danger";
type ProviderUsageStatus = "available" | "unavailable" | "error";

interface ProviderUsageWindow {
  label: string;
  usedPct?: number;       // 0–100
  remainingPct?: number;  // 0–100 (either used or remaining may be given)
  resetsAt?: string;      // ISO timestamp
  runsOutAt?: string;     // ISO timestamp — projected exhaustion if usage continues at pace
  shortfallPct?: number;  // set alongside runsOutAt when at risk of running out before reset
  tone?: ProviderUsageTone;
}

interface ProviderUsageBalance {
  label: string;
  unit: string;           // e.g. "USD", "credits", "tokens"
  used?: number;
  remaining?: number;
  limit?: number;
  resetsAt?: string;
  tone?: ProviderUsageTone;
}

interface ProviderUsageDetail {
  label: string;
  value: string;
  tone?: ProviderUsageTone;
}

interface ProviderUsage {
  provider: string;        // provider id (icon resolved via the provider-id→icon map)
  status: ProviderUsageStatus;
  sourceLabel?: string;    // e.g. "Anthropic Console", "OpenAI billing" — where the data came from
  fetchedAt: string;       // ISO timestamp — for "Updated Nx ago"
  windows: ProviderUsageWindow[];   // rolling rate-limit windows (e.g. 5h, weekly)
  balances?: ProviderUsageBalance[]; // spend/credit balances
  details?: ProviderUsageDetail[];   // free-form extra rows
}
```

## Behavior & Algorithms

### Fetching
- `useProviderUsage(serverId)`: enabled only when connected AND the host advertises
  `providerUsageList`; a 5-minute stale time; refetch on mount, not on window focus/reconnect
  (manual refresh only, plus the natural remount-on-reconnect).
- View states: `loading | error | ready`. `error` covers host-unavailable, feature-not-supported
  ("update host"), and request failure, each with a distinct message.

### Balance bar (spend / credit)
```
resolve(balance):
    if limit > 0:
        used = balance.used ?? (limit - balance.remaining)
        usedPct = used / limit * 100
        text = "{formatAmount(used)} / {formatAmount(limit)}"
    elif remaining given: text = "{formatAmount(remaining)} left"
    elif used given: text = formatAmount(used)
    else: text = "—"
render: label ⟷ text (+ " · resets <label>" if resetsAt), a track + tone-colored fill (0 width if no pct)
```

### Rate-limit window bar
```
usedPct = window.usedPct ?? (window.remainingPct != null ? 100 - window.remainingPct : null)
tone = window.tone ?? deriveTone(usedPct)   # ok < warning-threshold < danger, see tone.ts
trailing = if (runsOutAt && shortfallPct): "runs out <label>"
           else: formatResetLabel(resetsAt)
render: label ⟷ trailing, a track + tone-colored fill
```
- `runsOutAt`/`shortfallPct` together flag a window projected to exhaust **before** its reset —
  rendered with the "runs out" wording instead of the plain reset countdown, prompting the user to
  throttle usage.

### Surfaces
| Surface | Contents |
|---------|----------|
| **Settings → Provider Usage** section (per host) | A refreshable card per provider: icon + status badge (Error/Unavailable when not `available`) + all balance bars + all window bars + a footer (`sourceLabel · Updated Nx ago`) |
| **Composer footer (compact)** | An inline, denser rendering of the single most relevant window (e.g. the tightest/soonest-resetting one) — reuses the window-bar component at a smaller scale |

## Data & Persistence
- No client-local persistence; always live-fetched (React Query cache only, 5-minute stale window).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Host lacks `providerUsageList` | "Update host" message, section hidden/disabled, not a broken fetch |
| Provider `status: "error"` | Card shows an Error badge; balances/windows still rendered if present |
| Provider `status: "unavailable"` | Card shows an Unavailable badge |
| No `limit` and no `remaining`/`used` on a balance | Renders `"—"` (no bar) |
| `runsOutAt` in the past | TODO(verify) — likely still shows the "runs out" wording |

## Dependencies
- Internal: host runtime client, session store (`server_info.features`), provider icon map, design
  system tone tokens (`ok/warning/danger` map to `statusSuccess/statusWarning/statusDanger`).
- **Daemon work required**: `provider_usage_list_request/response` RPC + `providerUsageList` feature
  flag + per-provider usage retrieval (billing/rate-limit API per provider) do not exist in any
  completed sprint (001–011). Track as an explicit task (see
  `sprints/sprint-013-app-navigation-screens/backlog/task-005-provider-usage.md`).

## Acceptance Criteria
- [ ] The Settings provider-usage section is hidden/disabled (not broken) on a daemon without
      `providerUsageList`.
- [ ] Each provider card shows its status badge, balance bars, rate-limit window bars, and a
      source/updated-ago footer.
- [ ] A window at risk of exhausting before its reset shows "runs out …" instead of the plain reset
      countdown.
- [ ] The composer footer shows a compact single-window summary when connected and supported.
- [ ] Refresh invalidates and refetches without a full-page reload.

## TODO(verify)
- [ ] Exact per-provider usage retrieval mechanism (API keys/OAuth scopes needed per provider).
- [ ] Composer footer's "most relevant window" selection rule when a provider has several windows.

### Tone thresholds
`deriveTone(usedPct)`: `> 90% → danger`, `70–90% → warning`, `< 70% → default` (no `ok` tone is
derived automatically — `ok` is only ever set explicitly by the daemon payload).
