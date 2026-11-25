# Grill — Desktop usage telemetry

> Status: grilled
> Confirmed: the engineer answered the readout on 2026-11-25: D17 "keep", P1–P11 "confirm".
> Spec: [../features/desktop-usage-data.md](../features/desktop-usage-data.md).
> Started: 2026-11-25   Last updated: 2026-11-25   Rounds: 4
> Engineer: avatsaev   Agent: Claude (omp)

## Raw idea

> I would like to have minimal anonymous telemetry on the desktop client just to track the usage of pi-studio
>
> - anonymous unique user ID
> - IP adress
> - platform (macos/win/linux)
> - and some other information
>
> What would be the most pragamtic way to set this up using open source technlogies/lib, i can deploy a
> container on dokploy to have a backend for this telemetry

Then, the same day: "if i can use a free manqaged service or ssaas for this it's okay too", and after
the agent's comparison: "ok let's go with posthog cloud EU, country only, opt-out toggle, desktop only".

## Codebase context

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Settings | `desktop/crates/model/src/lib.rs` (`Settings`), `desktop/crates/engine/src/settings_cmds.rs`, `desktop/crates/engine/src/storage.rs` | `settings.json` holds `autoStartLocalDaemon`, `checkForUpdates` and the workbench's keys; unknown keys are kept. `settings.set` changes one boolean by name, writes the file before it answers and rolls the value back when the write fails |
| Settings in the window | `packages/workbench/src/features/settings/settings-categories.ts`, `packages/workbench/src/features/daemons/DaemonsScreen.tsx` | Settings categories are gated by daemon capabilities only (`available(caps)`); none is gated by the host. `autoStartLocalDaemon` is a switch on the Daemons screen. `checkForUpdates` has no switch anywhere: it is reachable through `settings.set` only |
| Host contract | `packages/workbench/src/host/types.ts` | Desktop-only features reach the workbench as optional host members (`updates?`, `zoom?`); the browser host has none of them, so the browser client shows nothing |
| Boot notices | `desktop/crates/shell/src/page.rs`, `desktop/apps/pistudiodesktop/src/host/boot.ts`, `desktop/apps/pistudiodesktop/src/main.tsx` | The boot snapshot carries `notices`; the page shows each one as a toast (`file_reset`, `secrets_not_moved`, `secret_store_fallback` today) |
| Webview boundary | `desktop/apps/pistudiodesktop/src-tauri/build.rs`, `desktop/AGENTS.md` rule 6 | The page may call only the app's own listed commands. Anything that talks to a third party runs in Rust, as the updater does |
| Install kind | `desktop/crates/shell/src/update.rs` (`InstallKind`), `desktop/apps/pistudiodesktop/src-tauri/src/update.rs` | The app already knows how it was installed: `appimage`, `deb`, `rpm`, `app`, `nsis`, `msi`, `unknown` (a development build) |
| Daemon registry | `desktop/crates/model/src/registry.rs` (`Kind`) | Entries are `Local`, `Direct`, `Relay` or `Ssh`; names and addresses are user data |
| HTTP client | `desktop/Cargo.toml`, `desktop/crates/install/src/download.rs`, `desktop/xtask/src/layers.rs` | `reqwest` 0.13 is in the workspace (`rustls` with `ring`, the system's certificate verifier, built as a preconfigured client in `install`). `cargo xtask layers` fails on `aws-lc-rs`. A crate that opens sockets is layer 8 and only an app binary may use it |
| Schedules | `swe/features/desktop-self-update.md` (P16), `desktop/apps/pistudiodesktop/src-tauri/src/resume.rs` | The update check already runs at launch, on an hourly tick when the last check is 24 h old, and after a wake |
| Logging | `desktop/apps/pistudiodesktop/src-tauri/src/logging.rs` | The app logs a failure as a short code; a library's own lines that carry an address are silenced |
| Scripted runs | `desktop/apps/pistudiodesktop/src-tauri/src/main.rs` (`--config-dir`, `--control`), `.github/workflows/desktop-release.yml` (`update-check`) | Every release launches the published build on GitHub's Linux, macOS and Windows machines, each time with a fresh configuration folder. Unless told otherwise, each of those launches would count as a new user |
| Build-time values | `desktop/apps/pistudiodesktop/src-tauri`, `desktop-release.yml` | No value is injected at build time today (`option_env!` is unused); the release job passes `--config` overlays and the updater key only |
| `ui.inspect` | `desktop/crates/shell/src/control.rs` | Automation reads `settings` and `update` from it; a new part is how a check without a person would see the telemetry state |
| Random values, time | `desktop/Cargo.toml` | `getrandom` 0.3 is in the workspace (`engine`, `shell`, the app binary). There is no `uuid` crate and no date-formatting crate |
| What the project says today | `swe/MAIN-SCOPE.md:20`, `swe/grills/desktop-native-shell.md:176`, `swe/architecture/pi-resource-management.md:72` | "It has no telemetry and no forced login"; "Nothing leaves the machine; no telemetry"; the daemon sets `DO_NOT_TRACK=1` for the `skills` CLI it spawns |
| PostHog, read in its docs on 2026-11-25 | `posthog.com/docs/api/capture`, `/docs/api/capture-v1`, `/docs/privacy/data-collection`, `/pricing` | Free plan: 1M events a month, 1 project, 1 year of data, no card, usage stops at the limit. EU ingestion host `https://eu.i.posthog.com`. Two capture APIs: the legacy `POST /i/v0/e/` (token in the body; "still work and stay supported", to be retired at a date announced in advance) and capture v1 `POST /i/v1/analytics/events` (token as a bearer header, six required headers, a UUID and an RFC 3339 timestamp per event, per-event results). The project token is public by design (POST-only endpoints). EU organizations default to discarding client IPs; location properties are still added from the IP before it is discarded. An event with `process_person_profile: false` is stored without a person profile |

## Problem & outcome
- **Who:** the owner, who cannot tell how many people use the desktop app, on which systems, or on which versions.
- **Today:** the only numbers are GitHub's download counts per release file.
- **Done means:** the owner opens a PostHog dashboard and reads the numbers of D6.
- **Measured by:** the dashboard showing, for the desktop app: active users per day, week and month; the split by
  system and CPU, by app version, by installer and by country; how many daemon entries of each kind people have;
  retention; and how long the app stays open (D6).

## Goals
- Count the desktop app's users anonymously, with their platform and country (D1, D3, D5).
- Answer the nine questions of D6 and no others: active users, system and CPU, app version, installer, country,
  daemon kinds, retention, session length, and the system language (D7).

## Non-goals
- No telemetry in the daemon, the CLI, the relay or the web client (D1).
- No stored IP address and no location finer than the country (D3).
- No feature usage (agents started, terminals, file transfers) (D6).
- No system version and no theme or zoom (D7).

## Happy path
1. A person installs one of the published installers and starts the app. Nothing about usage data is asked or
   shown (D10).
2. The app finds no ID in its configuration folder, makes a random one and stores it.
3. The app sends one "started" event to PostHog with the ID and the properties of *Data & state*. PostHog adds the
   country and keeps no IP address (D3).
4. While the app keeps running, it sends one event per 24 hours (D8).
5. When the person quits, the app sends one "closed" event carrying how long it ran, and waits at most 2 seconds
   for it (D14).
6. At any time the person opens Settings → Privacy, reads what is sent and turns the switch off. From then on
   nothing is sent; the ID stays on the machine (D9, D11).
7. The owner opens the PostHog dashboard and reads the numbers of D6.

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Which programs send usage data? | The desktop app only | Engineer: "desktop only" | 1 |
| D2 | integration | Where does the data go? | PostHog Cloud, EU region, free plan, project token `phc_uDTdc5M6sSbEWs4zHypSZM7X6ir8XbJcr53p68v8AERi` | Engineer, after the comparison with self-hosted Umami and Aptabase: no backend to run, a stable anonymous ID is native, 1M events a month | 1 |
| D3 | privacy | Is the IP address kept? | No. Country only; this replaces "IP address" in the raw idea | Engineer: "country only". A stored IP next to a stable ID is personal data | 1 |
| D4 | control | Consent model | On by default, with a switch to turn it off | Engineer: "opt-out toggle" | 1 |
| D5 | data | Who is a "user"? | An anonymous unique ID, plus the platform (macOS, Windows, Linux) | Raw idea | 1 |
| D6 | outcome | Which numbers does the owner want? | Active users per day, week and month; system and CPU; app version; installer kind; country; daemon entries by kind, as counts only; retention; how long the app stays open. Not feature usage | Engineer's selection. Feature usage needs events from inside the app and more to disclose | 2 |
| D7 | data | "Some other information" | The system language, and nothing else. Not the system version, not the theme or zoom | Engineer's selection, against the agent's recommendation of none | 2 |
| D8 | timing | A window left open for several days | Counts as active on each day: one event per 24 hours while the app runs | Engineer; otherwise a laptop that is never restarted looks inactive | 2 |
| D9 | data | The ID when the switch is turned off | Kept. Turning the switch on again continues as the same user | Engineer, against the agent's recommendation to delete it: a user who toggles is not counted twice | 2 |
| D10 | control | Is the user told at first launch? | No. Sending is on by default from the first launch, with no message and no dialog; the switch in Settings turns it off | Engineer, in his own words: "enabled by default, can optout in settings, no discolusre". The agent had recommended a one-time message and a 5-minute wait before the first event | 3 |
| D11 | control | Where the switch lives | Settings, a new "Privacy" category, shown in the desktop app only, with the list of what is sent | Engineer; there is no place for app-level switches today | 3 |
| D12 | rollout | Which builds send | Only the installers the release workflow publishes. A build from source, a pull-request test build and a fork send nothing | Engineer; the owner's own development work must not count as users | 3 |
| D13 | control | What else turns sending off, without touching the switch | Each of: the environment variable `DO_NOT_TRACK`; the environment variable `CI`; a scripted run (started with `--control` or `--config-dir`, or their environment forms) | Engineer; each release starts the published build on GitHub's machines with a fresh folder, and each start would be a new "user" | 3 |
| D14 | data | How session length is measured | An event at quit carrying the run's duration; quitting waits at most 2 seconds for it. A crash, a kill, a shutdown or no network loses that session | Engineer, as recommended: the simplest; the numbers lean towards clean exits and that is accepted | 4 |
| D15 | failure | An event that cannot be sent | Dropped: one attempt, no retry, nothing kept in memory or on disk | Engineer, against the agent's recommendation to retry from memory. Consequence accepted: a launch before the network is up is not counted; that user appears with the next daily event or launch | 4 |
| D16 | dependency | DNS blocklists that block PostHog's domains | The undercount is accepted. The app sends straight to PostHog | Engineer, as recommended; a pass-through on the owner's domain can be added later | 4 |
| D17 | docs | What the documentation says | A short "Usage data" section in the desktop documentation (the docs site and the desktop README): what is sent, where to, how to turn it off. The internal "no telemetry" statements are corrected | Engineer, as recommended; with D10 the Privacy panel would otherwise be the only place | 4 |

### Proposed by the agent (to confirm at the readout)

| # | Point | Proposal | Why |
|---|-------|----------|-----|
| P1 | Who sends | Rust only. The page never holds the token, gets no new permission and sends nothing | The webview boundary (`desktop/AGENTS.md` rule 6); the updater works the same way |
| P2 | How PostHog stores a user | Events are stored without a person profile (PostHog's anonymous events); users are counted by the ID | Nothing about a person is kept beyond the events themselves |
| P3 | Which PostHog API | Capture v1 (`/i/v1/analytics/events`), not the legacy endpoint | PostHog has said the legacy endpoints will be retired; a build already installed cannot be changed |
| P4 | The switch changed while the app runs | Off: nothing more is sent in this run, not even the "closed" event. On: no "started" event; the next hourly check sends the daily event | Off must mean off at once |
| P5 | The Privacy category when this run sends nothing for another reason (D12, D13) | Always shown in the desktop app. The panel says which reason applies; the switch still changes the stored choice | A switch that looks on while nothing is sent, or a missing category, would both mislead |
| P6 | The ID is missing or unreadable (a reset or hand-edited file) | A new ID is made: a new user. Reinstalling keeps the configuration folder, so the same ID. Two machines are two users | Nothing else identifies an installation |
| P7 | A machine that slept | The daily event is also sent after a wake when the last event is 24 hours old or more | The update check's schedule, which already exists |
| P8 | "Restart to update" | Counts as a quit: a "closed" event with the same 2 seconds; the new process sends "started" | Otherwise every update loses a session |
| P9 | A second launch that only focuses the running window | Sends nothing | It is not a launch |
| P10 | Failures and time limits | Nothing is ever shown in the window. The app's log gets one short code at debug level, never the ID or the token. An event has 10 seconds (2 at quit) and never delays the window | The app's logging rule; D14 |
| P11 | Checks without a person | `ui.inspect` gains a `usage` part: on or off, and why. It does not hold the ID | How D12, D13 and the switch are asserted in automated runs |

## Data & state
- **The ID:** one random ID per installation (per configuration folder), stored on the machine, not derived from
  hardware or from the account. Turning the switch off keeps it (D9).
- **Sent with every event:** the ID, the app version, the system (macOS, Windows, Linux), the CPU, the installer
  kind, the system language, and the number of daemon entries of each kind (local, direct, relay, SSH).
- **Events:** one at launch, one per 24 hours while the app runs (D8), and whatever session length needs (D6;
  how is open, see Open questions).
- **Never sent:** daemon names, addresses and host names, paths, project and workspace names, anything an agent or a
  user wrote, model and provider names.
- **Added by PostHog from the connection:** the country (D3).
- **When the ID is made:** at the first moment an event is about to be sent (D10: the first launch of a published
  build with nothing turning sending off). A run that sends nothing makes no ID.
- **The switch:** a setting of the app, on when absent (D4).
- **Nothing else is stored:** no queue of unsent events, in memory or on disk (D15).

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| PostHog Cloud EU (`https://eu.i.posthog.com`) | Receives the events | writes | A third party; its domains are on common DNS blocklists, so developers are undercounted |
| PostHog project settings (the owner's, by hand) | Client IPs discarded (the EU default); location from the IP kept at country level only, anything finer removed by a filter in the project | configures | Outside the repository; D3 holds only if this is set. To verify on a stored event |
| `settings.json` and `settings.set` (`desktop/crates/model`, `desktop/crates/engine`) | One new boolean setting (the switch) and the stored ID | reads / writes | The ID is not a setting a command may change |
| Settings dialog (`packages/workbench/src/features/settings/settings-categories.ts`) | A new "Privacy" category, shown only when the host offers it | consumes | Categories are gated by daemon capabilities today, not by the host: the registry's gate changes |
| Host contract (`packages/workbench/src/host/types.ts`) | One new optional member; the browser host does not have it | consumes | Amends `swe/architecture/workbench-host-adapter.md` |
| Launch, the hourly tick, the wake signal, quit and "Restart to update" (`desktop/apps/pistudiodesktop/src-tauri`) | The moments an event is sent | reads | Quit waits at most 2 s (D14) |
| Daemon registry, install kind (`desktop/crates/model/src/registry.rs`, `desktop/crates/shell/src/update.rs`) | Counts of entries by kind; the installer kind | reads | Names and addresses must never leave |
| `desktop-release.yml` | The publishing job gives the build the project token; nothing else does (D12) | writes | Pull-request test builds are made by the same workflow and must not get it |
| `ui.inspect` (`desktop/crates/shell/src/control.rs`) | A `usage` part (P11) | emits | |
| Documentation (`fern/`, `desktop/README.md`, `swe/MAIN-SCOPE.md:20`) | A "Usage data" section; "no telemetry" corrected (D17) | writes | `swe/grills/desktop-native-shell.md:176` is a record of its time and stays |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | The system reports no language | The property is left out | P6 |
| inputs | The stored ID is missing, empty or not an ID | A new one is made | P6 |
| identity & access | The project token is in every installer, so anyone can send junk events | Accepted: the token can only write | D2 |
| identity & access | The page | Never holds the token and never sends | P1 |
| state | A second launch focuses the running window | Nothing is sent | P9 |
| state | The switch is turned off while the app runs | Nothing more in this run, not even "closed" | P4 |
| state | The switch is turned on while the app runs | No "started"; the next hourly check sends the daily event | P4 |
| state | This run sends nothing because of the build or the environment | The Privacy panel says why; the switch still changes the stored choice | P5, D12, D13 |
| timing | Quit | "closed" with the duration, at most 2 s | D14 |
| timing | "Restart to update" | Treated as a quit | P8 |
| timing | The machine slept for days | The daily event after the wake | D8, P7 |
| timing | Retries, idempotency | n/a — one attempt per event (D15) | D15 |
| timing | The machine's clock is wrong | n/a — PostHog corrects the time from the request | |
| scale | Volume | About two events per launch and one per day of running: some 200 a month for a user who starts the app three times a day, so the free million covers about 5,000 active users | D2 |
| dependencies | Offline, a blocklist, PostHog down or slow | The event is dropped after its time limit; nothing is shown | D15, D16, P10 |
| dependencies | The free limit is used up | PostHog refuses events until the next month; the app does nothing | D2, P10 |
| dependencies | PostHog retires the legacy API | Not affected | P3 |
| data lifecycle | Builds from before the feature | Nothing to migrate: the first launch of a build with the feature makes the ID | |
| data lifecycle | `settings.json` is reset | A new ID: a new user | P6 |
| data lifecycle | Retention and deletion | PostHog keeps a year of data on the free plan. The ID is readable in the configuration folder, so a person can quote it to have their events deleted | D2 |
| observability & ops | A failure to send | One short code in the app's log at debug level | P10 |
| observability & ops | Is this run sending? | `ui.inspect` → `usage` | P11 |
| observability & ops | Rollback | A later release without the feature sends nothing; the stored ID and setting are left as unknown keys | |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | Sending never delays the window; quitting waits at most 2 s (D14). Volume: see *Edge cases*, scale |
| Security & authorization | Rust only (P1). The token is public and write-only. HTTPS with the system's certificate check, as the daemon download does. Nothing a user typed, named or opened is in an event |
| Privacy | Country only, no stored IP (D3). A random ID, not derived from the machine (D5). No message at first launch (D10); the Privacy panel and the public documentation say what is sent (D11, D17). The engineer was told that, for users in the EU, sending a stored ID with no notice is the legally weakest variant, and chose it |
| Backward compatibility | None needed: a new setting that reads as on when absent |
| Rollout / feature flag | Published installers only (D12); off under `DO_NOT_TRACK`, `CI` and scripted runs (D13) |
| Observability | A debug log code per failure (P10); `ui.inspect` → `usage` (P11) |
| Rollback | A release without the feature; nothing to undo on users' machines |

## Deferred
- Self-hosting the backend (Umami on Dokploy): set aside for PostHog Cloud (D2).
- A pass-through for the events on the owner's own domain, against DNS blocklists (D16).
- A message or a dialog at first launch (D10).
- Retrying an event that could not be sent (D15).
- Feature usage (agents started, terminals, file transfers): not selected in round 2 (D6).
- The system version (macOS 15.1, the Windows build, the Linux distribution): not selected (D7).
- The chosen theme and zoom: not selected (D7).

## Open questions — TODO(verify)
- [x] The agent's proposals P1–P11 — confirmed by the engineer at the readout.
- [x] Why the public section (D17) is needed when the data is anonymous — answered: a stored random ID is
  pseudonymous data under the GDPR, the repository is public anyway, and the section is short; the engineer
  answered "keep".
- [ ] That the PostHog project discards client IPs and stores no location finer than the country — owner: engineer (project settings), agent (reads a stored event).

## Acceptance criteria (draft)
- [ ] Given a published build started for the first time with nothing turning sending off, when it starts, then
  exactly one "started" event reaches the endpoint, holding the ID and exactly the properties of *Data & state*.
- [ ] Given registry entries whose names and addresses are known marker strings, when any event is sent, then its
  body holds none of them.
- [ ] Given a second start from the same configuration folder, then the ID is the same.
- [ ] Given the app has run for 24 hours (a fake clock), or wakes with its last event 24 hours old, then one daily
  event is sent (D8, P7).
- [ ] Given the app quits or restarts to update, then one "closed" event with the duration is sent; with the endpoint
  unreachable, quitting takes at most 2 seconds longer (D14, P8).
- [ ] Given the switch is off, then no request is made at launch, daily or at quit, and the ID is unchanged; turned
  on again, the same ID is used (D9, P4).
- [ ] Given `DO_NOT_TRACK`, `CI`, `--control`, `--config-dir`, or a build without the token, then no request is
  made, no ID is created, and `ui.inspect` names the reason (D12, D13, P11).
- [ ] Given the endpoint refuses or does not answer, then one request was made, nothing is shown, and the log holds
  a code without the ID or the token (D15, P10).
- [ ] Given a second launch while the app runs, then no request is made (P9).
- [ ] Settings → Privacy exists in the desktop app with the switch and the list of what is sent, and does not exist
  in the browser client (D11).
- [ ] A release's own checks on GitHub's machines add no user to the PostHog project (D13).
- [ ] Live, once: an event stored in the PostHog project shows the country and no IP address, city or coordinates (D3).
- [ ] The desktop documentation has a "Usage data" section, and no document says the project has no telemetry (D17).

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem & scope boundary | In conversation, before the brief existed: the agent compared self-hosted Umami, Aptabase and PostHog Cloud; the engineer chose PostHog Cloud EU, country only, an opt-out switch, the desktop app only (D1–D5) |
| 2 | data: what is sent | Eight of nine offered numbers selected, feature usage left out (D6); the system language added, system version and theme not (D7); a daily event while the app runs (D8); the ID is kept when the switch is turned off (D9) |
| 3 | telling the user, off switches | No message at first launch, on by default (D10, against the agent's recommendation); a new Settings → Privacy category in the desktop app (D11); published installers only (D12); off under `DO_NOT_TRACK`, `CI` and scripted runs (D13) |
| 4 | failures, documentation | An event at quit with the duration, 2 s wait (D14); an unsent event is dropped (D15, against the agent's recommendation); the blocklist undercount is accepted (D16); a public "Usage data" section (D17) |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `swe/features/desktop-usage-data.md` | Goals, Non-goals, Happy path, Decisions (D1–D17, P1–P11), Data & state, Integration points, Edge cases, Non-functional constraints, Acceptance criteria, Open questions |

The project keeps specs in `swe/features/` and `swe/architecture/` (`swe/av-swe.config.json`); the host contract's
amendment is recorded in the feature spec and folded into `swe/architecture/workbench-host-adapter.md` when built.
