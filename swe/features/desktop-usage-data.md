# Feature — Desktop usage data

> **Status: built 2026-11-25 (sprints 157–158), not yet released; the live check and the first-release check are in sprint 158.** From the grill
> [../grills/desktop-usage-telemetry.md](../grills/desktop-usage-telemetry.md) (4 rounds, confirmed by the
> owner on 2026-11-25): D1–D17 are the owner's, P1–P11 were proposed by the agent and confirmed at the
> readout. U1–U12 are proposed in this document; where one refines a D or P decision the table says so.
> **Compatibility is not a concern** (owner, 2026-11-22).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [desktop-daemon-registry.md](desktop-daemon-registry.md) (the command registry, `boot`,
> `settings.set`), [desktop-transport-bridge.md](desktop-transport-bridge.md) (`ui.inspect`, the wake
> signal), [desktop-self-update.md](desktop-self-update.md) (the hourly tick, "Restart to update", the
> install kind, `desktop-release.yml`), [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (the host contract; amended here)
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

The owner cannot tell how many people use the desktop app, on which systems, on which versions, or for
how long; the only numbers today are GitHub's download counts. This feature makes each published
desktop app send a few anonymous usage events to PostHog Cloud (EU), so a PostHog dashboard answers:
active users per day, week and month; the split by system and CPU, app version, installer kind, system
language and country; how many daemon entries of each kind people keep; retention; and how long the app
stays open (D6, D7).

Sending is on by default, with no message at first launch (D10). A switch in Settings → Privacy turns
it off (D4, D11), and a public "Usage data" page says what is sent (D17).

Out of scope: the daemon, the CLI, the relay and the web client send nothing (D1). Also out of scope:
feature usage events, the system version, theme and zoom (D6, D7); a first-launch message; retrying an
unsent event (D15); a pass-through on the owner's domain (D16); self-hosting the backend (D2).

## Decisions

### From the grill

| # | Decision |
|---|----------|
| D1 | The desktop app only |
| D2 | PostHog Cloud, EU region, free plan (1M events a month, 1 year of data); project token `phc_uDTdc5M6sSbEWs4zHypSZM7X6ir8XbJcr53p68v8AERi` |
| D3 | No IP address is stored; location is the country only |
| D4 | On by default; a switch turns it off |
| D5 | A user is an anonymous random ID, plus the platform |
| D6 | Numbers: active users; system and CPU; app version; installer kind; country; daemon entries by kind (counts only); retention; how long the app stays open. Not feature usage |
| D7 | Also the system language; nothing else |
| D8 | One event per 24 hours while the app runs |
| D9 | Turning the switch off keeps the ID; turning it on again continues as the same user |
| D10 | No message and no dialog at first launch |
| D11 | The switch lives in Settings, a new "Privacy" category, desktop only, with the list of what is sent |
| D12 | Only the installers the release workflow publishes send. Source builds, pull-request test builds, manual-run builds and forks send nothing |
| D13 | Sending is also off under `DO_NOT_TRACK`, under `CI`, and in a scripted run (`--control` or `--config-dir`, or their environment forms) |
| D14 | An event at quit carries the run's duration; quitting waits at most 2 s for it |
| D15 | An event that cannot be sent is dropped: one attempt, no queue in memory or on disk |
| D16 | The undercount from DNS blocklists is accepted; events go straight to PostHog |
| D17 | A public "Usage data" section (the docs site and the desktop README) says what is sent, where to, and how to turn it off; the internal "no telemetry" statements are corrected |
| P1 | Rust alone sends. The page never holds the token, gets no new permission and sends nothing |
| P2 | Events are stored without a person profile; users are counted by the ID |
| P3 | Capture v1 (`/i/v1/analytics/events`), not the legacy endpoint |
| P4 | Switch off while running: nothing more in this run, not even "closed". Switch on: no "started"; the next hourly check sends the daily event |
| P5 | The Privacy category is always shown in the desktop app and says why when this run sends nothing |
| P6 | A missing or unreadable ID is replaced by a new one (a new user); a language the system does not report is left out |
| P7 | The daily event is also sent after a wake when the last one is 24 hours old |
| P8 | "Restart to update" counts as a quit |
| P9 | A second launch that only focuses the running window sends nothing |
| P10 | Failures show nothing; one short code in the log at debug level, never the ID or the token; 10 s per event, 2 s at quit; sending never delays the window |
| P11 | `ui.inspect` gains a `usage` part (on or off, and why), without the ID |

### Proposed here

| # | Point | Decision | Why |
|---|-------|----------|-----|
| U1 | How a build knows it is published (D12) | The token is not in the source. It is compiled in from the build environment variable `PISTUDIODESKTOP_POSTHOG_TOKEN` (`option_env!`), which only the `bundle-release` job of `desktop-release.yml` sets, from the variable `POSTHOG_PROJECT_TOKEN` of the GitHub environment `desktop-release` (set by the owner, 2026-11-25). No other job or workflow references that variable, and a test guards it. A build compiled without it has no sender at all | One rule covers source builds, pull-request and manual runs, and forks (which do not inherit the variable). It is a variable, not a secret: the token is public and write-only, the environment is available only to jobs that name it (`bundle-release`, `main` only), and a test guards that only one step references it |
| U2 | The endpoint | `https://eu.i.posthog.com/i/v1/analytics/events`, a constant. A **test build** may replace it at compile time with `PISTUDIODESKTOP_USAGE_ENDPOINT` (any `http`/`https` URL); a test fails if `bundle-release` sets that variable | Lets a local fake server receive events end to end, as `--update-manifest` and the test overlay do for the updater |
| U3 | Scripted runs in a test build | In a build whose endpoint is replaced (U2), D13's `CI` and scripted-run rules do not apply; `DO_NOT_TRACK` and the switch still do | End-to-end checks need `--config-dir` and `--control` and must still see events |
| U4 | Where the ID and the switch are stored | `settings.json`: `shareUsageData` (boolean, absent reads as `true`) and `usageId` (string). `settings.set` accepts `shareUsageData` and refuses `usageId` | One file; a reset `settings.json` already means a new ID (P6). No new file to set aside when damaged |
| U5 | The ID's form | A random UUID version 4 (122 random bits from `getrandom`), lower-case hyphenated. Any stored value that is not that form is replaced (P6) | Not derived from hardware, the account or the time |
| U6 | When the ID is made | The first time an event is about to be sent; written to `settings.json` before the request. A failed write sends nothing for that event (the next one tries again) | A run that sends nothing makes no ID; an ID never sent unstored would count a user twice |
| U7 | Event names | `app_started`, `app_daily`, `app_closed` | Plain names to filter on in PostHog |
| U8 | A run's session | Each process run has its own random UUID, sent as the event's `session_id` | PostHog groups a run's events; nothing about the user in it |
| U9 | When the daily event is due | At the hourly tick and at a wake: when sending is on now and this run has attempted no event yet, or its last attempt is at least 24 h old. "Attempted" counts failures (D15) | Implements D8, P4, P7 with one rule; an offline launch is not retried every hour |
| U10 | When "closed" is sent | Once per run, at whichever comes first: the app's exit (`RunEvent::Exit`), or right before "Restart to update" hands over (on Windows the installer ends the process without an exit event). Only when sending is on at that moment | P8, P4; the restart path does not rely on the exit event |
| U11 | The language | The system's first preferred language as a BCP 47 tag (`en-US`), from the `sys-locale` crate (MIT OR Apache-2.0); left out when unknown or longer than 35 characters | D7, P6 |
| U12 | Where the switch is shown | Settings → Privacy, gated by the host's `usageData` member; the browser host has none, so the browser client never shows it | D11; categories are gated by daemon capabilities today, so the registry's capabilities gain a host flag |

## Public contract

### 1. Build and configuration

| Item | Where | Value |
|------|-------|-------|
| Project token | build environment variable `PISTUDIODESKTOP_POSTHOG_TOKEN`, read with `option_env!` by the app binary | Set by `bundle-release`'s Bundle step only, from `vars.POSTHOG_PROJECT_TOKEN` (U1) |
| Endpoint | constant in the app binary | `https://eu.i.posthog.com/i/v1/analytics/events`; replaced in a test build by `PISTUDIODESKTOP_USAGE_ENDPOINT` (U2) |
| GitHub | environment `desktop-release`, variable | `POSTHOG_PROJECT_TOKEN` = D2's token (**set by the owner, 2026-11-25**) |
| PostHog project (the owner, by hand) | Settings → Project | IP data capture: discard (the EU default). A property-filter transformation removes every location property finer than the country: `$geoip_city_name`, `$geoip_subdivision_*`, `$geoip_postal_code`, `$geoip_latitude`, `$geoip_longitude`, `$geoip_time_zone`, and the same on `$set` |
| Dependency | `desktop/Cargo.toml` | `sys-locale` (U11). `reqwest`/`rustls` as the `install` crate uses them (`rustls` with `ring`, the system's verifier, no system proxy change) |

> TODO(verify): the exact list of GeoIP properties PostHog adds today, and that the property filter
> removes them before storage — read off the first stored event (acceptance, live).

### 2. The request

One `POST` per event (never batched, D15), body ≤ 2 KiB:

```
POST <endpoint>
Authorization: Bearer <token>
Content-Type: application/json
User-Agent: pistudiodesktop/<version>
PostHog-Sdk-Info: pistudiodesktop/<version>
PostHog-Request-Id: <new UUID>
PostHog-Attempt: 1
PostHog-Request-Timestamp: <now, RFC 3339 UTC, ms>

{ "created_at": "<now>",
  "batch": [ { "event": "app_started" | "app_daily" | "app_closed",
               "uuid": "<new UUID>",
               "distinct_id": "<usageId>",
               "timestamp": "<now>",
               "session_id": "<the run's UUID>",
               "options": { "process_person_profile": false },
               "properties": { …the table below… } } ] }
```

Properties, the same on every event except `duration_s`:

| Property | Value |
|----------|-------|
| `os` | `macos`, `windows` or `linux` |
| `arch` | `x86_64` or `aarch64` (Rust's `std::env::consts::ARCH`) |
| `app_version` | the app's version (`CARGO_PKG_VERSION`) |
| `install_kind` | `InstallKind::as_str()`: `appimage`, `deb`, `rpm`, `app`, `nsis`, `msi`, `unknown` |
| `locale` | U11; absent when unknown |
| `daemons_local`, `daemons_direct`, `daemons_relay`, `daemons_ssh` | the number of registry entries of each kind, at the moment of the event |
| `duration_s` | `app_closed` only: whole seconds since the process started |

Nothing else is sent: no names, addresses or host names of daemons, no paths, no project, workspace,
agent, model or provider names, nothing a user typed. The country is added by PostHog from the
connection (D3).

A `200` whose result for the event is `ok` or `warning` is success. Anything else (another status, a
`drop` or `retry` result, no answer, a TLS or DNS failure) is a failure: logged (P10), dropped (D15).

### 3. Settings

| Key | Type | Absent | Set by |
|-----|------|--------|--------|
| `shareUsageData` | boolean | `true` | `settings.set` (`{"key": "shareUsageData", "value": bool}`), the Privacy switch |
| `usageId` | string | no ID yet | the app only (U6); `settings.set` refuses it as an unknown key |

`settings.get` answers `shareUsageData` with the other two booleans; it does not answer `usageId`.

### 4. The usage view

One shape, computed by the shell, used by `boot`, `ui.inspect` and the host member:

```
UsageView = {
  enabled: boolean,                 // shareUsageData
  sending: boolean,                 // enabled and no reason below applies
  blocked?: "build" | "do_not_track" | "ci" | "scripted",   // why this run never sends; absent when it can
  id?: string                       // usageId, when one was made; boot only, never in ui.inspect (P11)
}
```

`blocked` is fixed for the life of the process; it is checked in this order: `build` (no token, U1),
`do_not_track` (`DO_NOT_TRACK` set to anything but empty or `0`), `ci` (`CI` set to anything but empty
or `false`/`0`), `scripted` (`--control`, `--config-dir`, `PISTUDIODESKTOP_CONTROL_PORT` or
`PISTUDIODESKTOP_CONFIG_DIR` given). U3 drops the last two in a test build.

### 5. Page and automation surfaces

| Surface | Change |
|---------|--------|
| `boot` (`crates/shell/src/page.rs`) | a `usage: UsageView` part, with `id` |
| `ui.inspect` (`crates/shell/src/control.rs`) | a `usage` part: `UsageView` without `id` |
| `settings.set` | `shareUsageData` (§ 3); the answer is the settings, as today |
| Page commands, capabilities | unchanged: the page sets the switch through `engine_command` → `settings.set` |

### 6. The host contract (workbench)

One optional member of `WorkbenchHost` (amends `workbench-host-adapter.md`):

```
usageData?: {
  current(): { enabled: boolean; sending: boolean; blocked?: "build" | "do_not_track" | "ci" | "scripted"; id?: string };
  setEnabled(enabled: boolean): Promise<void>;   // rejects with the command's error; current() reflects it after
}
```

The desktop host implements it over `boot`'s `usage` part and `settings.set`. The browser host has no
`usageData`. `SettingsCategoryCapabilities` gains `usageData: boolean` (the host has the member), and
the "Privacy" category is `available: (caps) => caps.usageData` (U12).

### 7. The Privacy panel

- A switch "Share anonymous usage data", bound to `enabled`; a failed change shows the error and
  leaves the switch as it was.
- The list of what is sent (§ 2's properties in plain words, the three events, "country, derived by
  PostHog from the connection; the IP address is not stored"), where to (PostHog, EU), and a link to
  the public "Usage data" page.
- When `blocked` is present, one line saying this run sends nothing and why ("this build is not a
  published release", "`DO_NOT_TRACK` is set", "`CI` is set", "the app was started by a script"). The
  switch still works.
- When `id` is present: "Your anonymous ID: `<id>`", selectable, for a deletion request.

### 8. Where the code lives

| Piece | Place |
|-------|-------|
| `shareUsageData`, `usageId`, `set` | `crates/model` (`Settings`) |
| `settings.set`/`get` rows, the roll-back on a failed write | `crates/engine` (`settings_cmds.rs`, `storage.rs`) |
| The usage state: `blocked`, the run's session ID and start, the last attempt, the "closed sent" flag, the due rule (U9), the event and its properties from given inputs, `UsageView`, the `boot` and `ui.inspect` parts; the sender behind a `Services` hook so the crate stays free of Tauri and of sockets (rule 4) | `crates/shell` (`usage.rs`) |
| The HTTP sender, the token and endpoint constants, the locale, the hook's wiring to launch, the hourly tick, the wake signal, `RunEvent::Exit` and the update restart | `apps/pistudiodesktop/src-tauri` (`usage.rs`) |
| The host member | `apps/pistudiodesktop/src/host` (`usage-data.ts`) |
| The category, the panel | `packages/workbench` (`features/settings/`, `host/types.ts`) |
| The token in the build | `.github/workflows/desktop-release.yml` (`bundle-release`'s Bundle step) |

## Behavior & algorithms

```
at launch, after setup (a second launch never gets here: single-instance ends it first, P9):
  usage.blocked  = first reason of § 4 that applies, else none
  usage.session  = new UUID; usage.started_at = now; usage.last_attempt = none; usage.closed_sent = false
  if sending(): send("app_started")                      // off the main thread; the window never waits

sending() = settings.shareUsageData and usage.blocked is none

every hour, and at a wake (the update schedule's tick and the resume signal):
  if sending() and (usage.last_attempt is none or now - usage.last_attempt >= 24 h):
    send("app_daily")                                     // U9: also covers "switched on mid-run" (P4)

on "Restart to update", before the hand-over; and on RunEvent::Exit:
  if not usage.closed_sent:
    usage.closed_sent = true
    if sending(): send_blocking("app_closed", duration_s = now - usage.started_at, limit = 2 s)

send(event):
  id = settings.usageId if it is a valid UUID v4, else new UUID v4 written to settings.json   // U5, U6
  if writing failed: log debug "usage: id not stored"; return
  usage.last_attempt = now
  POST § 2 with a 10 s limit (2 s for app_closed)
  on failure: log debug "usage: not sent (<code>)"        // code: offline | timeout | status_<n> | dropped; never the URL, ID or token
```

Turning the switch off takes effect for the next decision: nothing else is sent in this run, including
`app_closed` (P4). A request already in flight is not cancelled. Turning it on sends no `app_started`;
the next tick sends `app_daily` because the run has no attempt yet, or its last is 24 h old (P4).

## Data & persistence touchpoints

- `settings.json`: `shareUsageData` (absent = `true`), `usageId`. No migration. A rolled-back release
  leaves them as unknown keys, kept and written back.
- In memory, per run: the session ID, the start time, the last attempt, the "closed sent" flag.
- Nothing queued, in memory or on disk (D15).
- PostHog: events for a year (free plan). Deleting one user's events is done by the owner in PostHog
  by `distinct_id`.
- GitHub: the variable `POSTHOG_PROJECT_TOKEN` of environment `desktop-release`.

## Error handling & edge cases

| Condition | Behavior |
|-----------|----------|
| Offline, DNS blocklist, PostHog down or slow, the free limit used up | Dropped after its limit; a debug log code; nothing shown (D15, D16, P10) |
| PostHog answers `401`/`400` (a wrong token or a malformed request) | Same; the code names the status |
| Quit with the endpoint unreachable | Quitting takes at most 2 s longer (D14) |
| `settings.json` cannot be written when the ID is first needed | That event is not sent (U6) |
| `usageId` missing, empty, not a UUID v4 | Replaced at the next send (P6, U5) |
| `settings.json` reset (damaged) | A new ID: a new user (P6) |
| The system reports no language, or a long one | `locale` left out (U11) |
| A second launch focusing the running window | Nothing sent (P9) |
| The switch turned off or on while running | P4 |
| A machine that slept for days | `app_daily` at the wake (P7, U9) |
| "Restart to update" on Windows | `app_closed` before the installer runs; no second one (U10) |
| A crash or a kill | No `app_closed`; accepted (D14) |
| The page | Never sees the token; cannot send (P1) |
| A release's checks on GitHub's machines | `CI` and `--config-dir`/`--control`: blocked, no ID made (D13) |
| A fork running the release workflow | No `POSTHOG_PROJECT_TOKEN`: the build has no token (U1) |
| Logs | Never the URL, the ID, the token or a property value |

## Dependencies on other specs

- [desktop-self-update.md](desktop-self-update.md) — the hourly tick and wake schedule, "Restart to
  update" (U8 there: Windows hand-over), `InstallKind`, `bundle-release`.
- [desktop-daemon-registry.md](desktop-daemon-registry.md) — `settings.set`, `boot`, the registry's
  kinds.
- [desktop-transport-bridge.md](desktop-transport-bridge.md) — `ui.inspect`, the wake signal.
- [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md) — the optional
  `usageData` member; amended.
- [../MAIN-SCOPE.md](../MAIN-SCOPE.md) — its "It has no telemetry" sentence is corrected when this is
  built (D17).

## Acceptance criteria

Unit and integration (in `cargo xtask ci` and `npm test`):

- [ ] `blocked` for every combination of: token present or not, `DO_NOT_TRACK`, `CI`, `--control`,
  `--config-dir` and their environment forms, a test build (U3); the order of § 4.
- [ ] The due rule (U9) with a fake clock: launch, 23 h, 24 h, a failed attempt, a wake after days,
  switched on mid-run, switched off mid-run.
- [ ] "closed" is produced once across `Exit` and the update restart, only when sending is on, with
  the right `duration_s`.
- [ ] The event body: exactly § 2's fields and properties; registry entries named and addressed with
  marker strings never appear in it.
- [ ] `usageId`: made on the first send only, kept across runs, kept when the switch is turned off and
  on, replaced when invalid; a failed write sends nothing; `settings.set` refuses `usageId`.
- [ ] `shareUsageData` absent reads `true`; `settings.set` with a non-boolean is refused and leaves it.
- [ ] `ui.inspect.usage` has no `id`; `boot.usage` has it once made.
- [ ] The workbench shows "Privacy" only with a host that has `usageData`; the browser host has none.
- [ ] A test fails if `bundle-release` sets `PISTUDIODESKTOP_USAGE_ENDPOINT`, or if any job other than
  `bundle-release` sets `PISTUDIODESKTOP_POSTHOG_TOKEN`.

Live (a test build pointed at a local server, U2, in the Linux container):

- [ ] First start with a fresh `--config-dir`: one `app_started` with the ID; a second start from the
  same folder: the same ID.
- [ ] Quit: one `app_closed`; with the server not answering, the quit takes at most 2 s longer.
- [ ] Switch off in Settings → Privacy: no request at quit or at the next tick; on again: the same ID.
- [ ] `DO_NOT_TRACK=1`: no request, no `usageId` in `settings.json`, `ui.inspect.usage.blocked` is
  `do_not_track`; the Privacy panel says so.
- [ ] A second launch while running: no request.
- [ ] The server refusing: nothing shown in the window; the log holds a code and none of the URL, ID or
  token.

Once, after the first release with the feature (owner and agent):

- [ ] An event stored in the PostHog project shows the country and no IP address, city, region, postal
  code, coordinates or time zone (D3).
- [ ] The release's own `update-check` runs added no user to the project (D13).

Documentation (D17):

- [ ] `fern/pages/usage-data.mdx` (in the navigation) and the desktop README say what is sent, to
  PostHog EU, and how to turn it off; `swe/MAIN-SCOPE.md` no longer says the project has no telemetry.

## TODO(verify)

- The GeoIP properties PostHog adds and the filter that removes all but the country (§ 1). — the first
  stored event.
- Whether `RunEvent::Exit` fires for "Restart to update" on Linux and macOS; U10 sends before the
  hand-over either way, so this only matters for not sending twice. — the build.
- How many users the blocklists hide (D16). — not measurable from the app; accepted.
