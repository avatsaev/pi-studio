//! Anonymous usage data: every decision of it, with no Tauri and no socket (rule 4 of
//! `desktop/AGENTS.md`). Why a run is blocked, when an event is due, the event's JSON body, the
//! usage ID's creation and the [`UsageView`] in `boot` and `ui.inspect` are plain data and pure
//! functions here; the one thing that touches the network, the HTTP `POST`, is the app binary's
//! and sits behind [`crate::Services::usage`] ([`UsageHook`]).
//!
//! The clock is the caller's: every entry point takes `now_ms` (milliseconds since the Unix
//! epoch), as the update schedule does, so nothing here reads one.
//!
//! The entry points run on the thread that owns the shell (they read the settings and the
//! registry and write the ID) and never send: each answers the [`UsageRequest`] to send, ready but
//! for the endpoint and the `Authorization` header, which the app adds. The app sends it off this
//! thread: [`on_launch`] and [`on_tick`] without waiting, [`on_close`] blocking for at most its
//! [`UsageRequest::limit`]. Over the owner's channel they are [`crate::Request::Usage`]
//! ([`UsageOp`]); the answer is read back with [`UsageRequest::from_reply`].
//!
//! Nothing is queued, and nothing here logs a value: the app logs the failure code of a send
//! (`usage: not sent (<code>)`) and this module logs only `usage: id not stored`.

use std::sync::Arc;
use std::time::Duration;

use pistudiodesktop_model::{Kind, Settings, is_usage_id};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::AppShell;

/// The daily event is due when the last attempt is this old (U9): 24 hours.
pub const DAILY_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;
/// The time limit of one event (P10).
pub const SEND_LIMIT: Duration = Duration::from_secs(10);
/// The time limit of the event at quit (D14).
pub const CLOSE_LIMIT: Duration = Duration::from_secs(2);
/// The longest language tag sent (U11).
pub const MAX_LOCALE_LEN: usize = 35;

/// Send a ready request, waiting at most the limit given (the request's own [`UsageRequest::limit`]).
/// Success, or a short failure code: `offline`, `timeout`, `status_<n>` or `dropped`; never the
/// URL, the ID or the token. Blocks: whoever calls it must not be the thread that owns the shell.
/// The app fills it only in a build that has a token; without it every run is [`Blocked::Build`].
pub type UsageHook = Arc<dyn Fn(&UsageRequest, Duration) -> Result<(), String> + Send + Sync>;

/// Why this run never sends. Fixed for the life of the process.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Blocked {
    /// Not a published build: no token, so no sender (U1).
    Build,
    /// `DO_NOT_TRACK` is set to something but empty or `0`.
    DoNotTrack,
    /// `CI` is set to something but empty, `false` or `0`.
    Ci,
    /// `--control`, `--config-dir` or their environment forms were given.
    Scripted,
}

impl Blocked {
    /// The name in JSON.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Build => "build",
            Self::DoNotTrack => "do_not_track",
            Self::Ci => "ci",
            Self::Scripted => "scripted",
        }
    }
}

/// What decides [`blocked`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BlockInputs {
    /// This build has a sender (a token was compiled in).
    pub has_token: bool,
    /// The build's endpoint was replaced (U2): `CI` and a scripted run do not block it (U3).
    pub test_build: bool,
    /// The value of `DO_NOT_TRACK`, `None` when unset.
    pub do_not_track: Option<String>,
    /// The value of `CI`, `None` when unset.
    pub ci: Option<String>,
    /// A scripted run: `--control`, `--config-dir`, `PISTUDIODESKTOP_CONTROL_PORT` or `PISTUDIODESKTOP_CONFIG_DIR`.
    pub scripted: bool,
}

/// The first reason of the order `build`, `do_not_track`, `ci`, `scripted` that applies; `None` when
/// the run can send. U3 drops the last two in a test build.
pub fn blocked(inputs: &BlockInputs) -> Option<Blocked> {
    let set = |value: &Option<String>, off: &[&str]| value.as_deref().is_some_and(|v| !v.is_empty() && !off.contains(&v));
    if !inputs.has_token {
        Some(Blocked::Build)
    } else if set(&inputs.do_not_track, &["0"]) {
        Some(Blocked::DoNotTrack)
    } else if inputs.test_build {
        None
    } else if set(&inputs.ci, &["false", "0"]) {
        Some(Blocked::Ci)
    } else if inputs.scripted {
        Some(Blocked::Scripted)
    } else {
        None
    }
}

/// An event's name (U7).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventName {
    Started,
    Daily,
    Closed,
}

impl EventName {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Started => "app_started",
            Self::Daily => "app_daily",
            Self::Closed => "app_closed",
        }
    }
}

/// What the app knows about itself and the system, fixed for the run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    /// `macos`, `windows` or `linux`.
    pub os: String,
    /// `x86_64` or `aarch64`.
    pub arch: String,
    /// The app's version.
    pub version: String,
    /// [`crate::update::InstallKind::as_str`].
    pub install_kind: String,
    /// The system's first preferred language as a BCP 47 tag; `None` when unknown. Left out of the
    /// event when empty or longer than [`MAX_LOCALE_LEN`].
    pub locale: Option<String>,
}

/// The registry's entries by kind, at the moment of the event: counts only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub local: usize,
    pub direct: usize,
    pub relay: usize,
    pub ssh: usize,
}

impl Counts {
    fn of(kinds: impl Iterator<Item = Kind>) -> Self {
        let mut counts = Self::default();
        for kind in kinds {
            match kind {
                Kind::Local => counts.local += 1,
                Kind::Direct => counts.direct += 1,
                Kind::Relay => counts.relay += 1,
                Kind::Ssh => counts.ssh += 1,
            }
        }
        counts
    }
}

/// One request, ready to send but for the endpoint and the `Authorization` header (the token is the
/// app's): the `POST` body, the other headers and the time limit.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRequest {
    /// The event's name (`app_started`, `app_daily`, `app_closed`).
    pub event: String,
    /// The JSON body.
    pub body: String,
    /// `Content-Type`, `User-Agent`, `PostHog-Sdk-Info`, `PostHog-Request-Id`, `PostHog-Attempt` and
    /// `PostHog-Request-Timestamp`, in this order.
    pub headers: Vec<(String, String)>,
    /// How long the send may take, in milliseconds.
    pub limit_ms: u64,
}

impl UsageRequest {
    /// How long the send may take: [`SEND_LIMIT`], [`CLOSE_LIMIT`] for `app_closed`.
    pub fn limit(&self) -> Duration {
        Duration::from_millis(self.limit_ms)
    }

    /// Read back what [`answer`] put in a control reply: `None` for "nothing to send" and for a
    /// reply that holds no request.
    pub fn from_reply(reply: &Value) -> Option<Self> {
        serde_json::from_value(reply.get("result")?.clone()).ok()
    }
}

// A request holds the ID and the properties: never in a log.
impl std::fmt::Debug for UsageRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UsageRequest").field("event", &self.event).finish_non_exhaustive()
    }
}

/// What one event is made of. The two UUIDs and the time are given so that the builder is pure.
#[derive(Clone, Copy, Debug)]
pub struct EventInputs<'a> {
    pub name: EventName,
    /// The usage ID (`distinct_id`).
    pub id: &'a str,
    /// The run's UUID (`session_id`).
    pub session: &'a str,
    pub facts: &'a Facts,
    pub counts: Counts,
    /// Whole seconds since the process started; `app_closed` only.
    pub duration_s: Option<u64>,
    pub now_ms: u64,
    /// The event's own UUID.
    pub event_uuid: &'a str,
    /// The request's UUID (`PostHog-Request-Id`).
    pub request_id: &'a str,
}

/// § 2's body and headers for one event. Exactly the fields and properties of the spec: no name, address, path
/// or anything a user typed is an input, so none can be in the output.
pub fn build_request(e: &EventInputs<'_>) -> UsageRequest {
    let now = rfc3339_ms(e.now_ms);
    let mut properties = serde_json::Map::new();
    properties.insert("os".into(), json!(e.facts.os));
    properties.insert("arch".into(), json!(e.facts.arch));
    properties.insert("app_version".into(), json!(e.facts.version));
    properties.insert("install_kind".into(), json!(e.facts.install_kind));
    if let Some(locale) = e.facts.locale.as_deref().filter(|l| !l.is_empty() && l.len() <= MAX_LOCALE_LEN) {
        properties.insert("locale".into(), json!(locale));
    }
    properties.insert("daemons_local".into(), json!(e.counts.local));
    properties.insert("daemons_direct".into(), json!(e.counts.direct));
    properties.insert("daemons_relay".into(), json!(e.counts.relay));
    properties.insert("daemons_ssh".into(), json!(e.counts.ssh));
    if let Some(duration) = e.duration_s {
        properties.insert("duration_s".into(), json!(duration));
    }
    let body = json!({
        "created_at": now,
        "batch": [{
            "event": e.name.as_str(),
            "uuid": e.event_uuid,
            "distinct_id": e.id,
            "timestamp": now,
            "session_id": e.session,
            "options": { "process_person_profile": false },
            "properties": properties,
        }],
    });
    let agent = format!("pistudiodesktop/{}", e.facts.version);
    let limit = if e.name == EventName::Closed { CLOSE_LIMIT } else { SEND_LIMIT };
    UsageRequest {
        event: e.name.as_str().to_owned(),
        body: body.to_string(),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            ("User-Agent".into(), agent.clone()),
            ("PostHog-Sdk-Info".into(), agent),
            ("PostHog-Request-Id".into(), e.request_id.to_owned()),
            ("PostHog-Attempt".into(), "1".into()),
            ("PostHog-Request-Timestamp".into(), now),
        ],
        limit_ms: u64::try_from(limit.as_millis()).unwrap_or(u64::MAX),
    }
}

/// A UTC time as RFC 3339 with milliseconds: `2026-11-25T10:20:30.123Z`.
pub fn rfc3339_ms(ms: u64) -> String {
    let secs = ms / 1000;
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    // Civil date from days since 1970-01-01 (proleptic Gregorian; Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600, rem % 3_600 / 60, rem % 60, ms % 1000)
}

/// A random UUID version 4, lower-case and hyphenated (U5); `None` when the system has no random source.
#[cfg(not(target_arch = "wasm32"))]
fn new_uuid() -> Option<String> {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).ok()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
    Some(format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32]))
}

/// The browser build has no sender and no random source.
#[cfg(target_arch = "wasm32")]
fn new_uuid() -> Option<String> {
    None
}

/// The state of one run of the process; nothing of it is stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsageRun {
    blocked: Option<Blocked>,
    facts: Facts,
    session: Option<String>,
    started_at_ms: u64,
    last_attempt_ms: Option<u64>,
    closed_sent: bool,
}

impl Default for UsageRun {
    /// Before [`on_launch`]: a run that sends nothing.
    fn default() -> Self {
        Self { blocked: Some(Blocked::Build), facts: Facts::default(), session: None, started_at_ms: 0, last_attempt_ms: None, closed_sent: false }
    }
}

impl UsageRun {
    /// A run that starts at `now_ms`, with what [`blocked`] decided.
    pub fn new(blocked: Option<Blocked>, facts: Facts, now_ms: u64) -> Self {
        Self { blocked, facts, session: None, started_at_ms: now_ms, last_attempt_ms: None, closed_sent: false }
    }

    /// Why this run never sends, if it does not.
    pub fn blocked(&self) -> Option<Blocked> {
        self.blocked
    }

    /// Whether an event may be sent now: the switch is on and nothing blocks this run.
    pub fn sending(&self, settings: &Settings) -> bool {
        settings.share_usage_data && self.blocked.is_none()
    }

    /// U9: sending is on now and this run has attempted no event yet, or the last attempt is at least
    /// 24 hours old (a clock set back counts as old). Failed attempts count.
    pub fn due_daily(&self, settings: &Settings, now_ms: u64) -> bool {
        self.sending(settings) && self.last_attempt_ms.is_none_or(|last| now_ms < last || now_ms - last >= DAILY_INTERVAL_MS)
    }

    /// U10: the whole seconds the run lasted when `app_closed` is to be sent, once. A second call, a
    /// call with the switch off and a call in a blocked run answer `None`; the first call ends the
    /// chance either way.
    pub fn take_closed(&mut self, settings: &Settings, now_ms: u64) -> Option<u64> {
        if std::mem::replace(&mut self.closed_sent, true) || !self.sending(settings) {
            return None;
        }
        Some(now_ms.saturating_sub(self.started_at_ms) / 1000)
    }
}

/// The usage part of `boot` and `ui.inspect`:
/// `{ enabled, sending, blocked?, id? }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct UsageView {
    /// `shareUsageData`.
    pub enabled: bool,
    /// Enabled and nothing blocks this run.
    pub sending: bool,
    /// Why this run never sends; absent when it can.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<Blocked>,
    /// The stored usage ID, when one was made. In `boot` only, never in `ui.inspect` (P11).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

impl UsageView {
    /// The view of `run` under `settings`; `with_id` is `boot`'s.
    pub fn new(run: &UsageRun, settings: &Settings, with_id: bool) -> Self {
        Self {
            enabled: settings.share_usage_data,
            sending: run.sending(settings),
            blocked: run.blocked,
            id: settings.usage_id.clone().filter(|id| with_id && is_usage_id(id)),
        }
    }

    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

/// `boot`'s `usage`: with the ID once one was made.
pub fn boot_view(app: &AppShell) -> Value {
    UsageView::new(&app.usage, app.session.settings(), true).to_json()
}

/// `ui.inspect`'s `usage`: no ID.
pub fn inspect_view(app: &AppShell) -> Value {
    UsageView::new(&app.usage, app.session.settings(), false).to_json()
}

/// What the app tells the shell at launch.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Launch {
    pub now_ms: u64,
    /// The build's endpoint was replaced (U2, U3).
    pub test_build: bool,
    /// `DO_NOT_TRACK` as the environment has it.
    pub do_not_track: Option<String>,
    /// `CI` as the environment has it.
    pub ci: Option<String>,
    /// `--control`, `--config-dir` or their environment forms were given.
    pub scripted: bool,
    pub facts: Facts,
}

/// What a request on the owner's channel asks ([`crate::Request::Usage`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UsageOp {
    Launch(Launch),
    Tick { now_ms: u64 },
    Close { now_ms: u64 },
}

/// Run one operation and answer `{"ok": true, "result": <UsageRequest or null>}`.
pub fn answer(app: &mut AppShell, op: &UsageOp) -> Value {
    let request = match op {
        UsageOp::Launch(launch) => on_launch(app, launch),
        UsageOp::Tick { now_ms } => on_tick(app, *now_ms),
        UsageOp::Close { now_ms } => on_close(app, *now_ms),
    };
    crate::control::reply(Ok(request.and_then(|r| serde_json::to_value(r).ok()).unwrap_or(Value::Null)))
}

/// At launch, after setup: decide [`blocked`] once (an app with no [`crate::Services::usage`] hook
/// has no token: [`Blocked::Build`]), start the run, and answer `app_started` when sending.
pub fn on_launch(app: &mut AppShell, launch: &Launch) -> Option<UsageRequest> {
    let inputs = BlockInputs {
        has_token: app.services.usage.is_some(),
        test_build: launch.test_build,
        do_not_track: launch.do_not_track.clone(),
        ci: launch.ci.clone(),
        scripted: launch.scripted,
    };
    app.usage = UsageRun::new(blocked(&inputs), launch.facts.clone(), launch.now_ms);
    if !app.usage.sending(app.session.settings()) {
        return None;
    }
    prepare(app, EventName::Started, launch.now_ms, None)
}

/// At the hourly tick and at a wake: `app_daily` when [`UsageRun::due_daily`].
pub fn on_tick(app: &mut AppShell, now_ms: u64) -> Option<UsageRequest> {
    if !app.usage.due_daily(app.session.settings(), now_ms) {
        return None;
    }
    prepare(app, EventName::Daily, now_ms, None)
}

/// At the app's exit and right before "Restart to update" hands over: `app_closed` once per run,
/// when sending is on at that moment. The app sends it blocking, for at most [`UsageRequest::limit`].
pub fn on_close(app: &mut AppShell, now_ms: u64) -> Option<UsageRequest> {
    let duration = app.usage.take_closed(app.session.settings(), now_ms)?;
    prepare(app, EventName::Closed, now_ms, Some(duration))
}

/// The request of one event that is to be sent now: the ID (the stored one, or a new one written to
/// `settings.json` first, U6), the attempt noted, the event built. `None` when the ID could not be
/// stored or the system has no random source: nothing is sent and no attempt is counted.
fn prepare(app: &mut AppShell, name: EventName, now_ms: u64, duration_s: Option<u64>) -> Option<UsageRequest> {
    let id = match app.session.settings().usage_id.clone().filter(|id| is_usage_id(id)) {
        Some(id) => id,
        None => {
            let id = new_uuid()?;
            if app.session.store_usage_id(&id).is_err() {
                log::debug!("usage: id not stored");
                return None;
            }
            id
        }
    };
    let (event_uuid, request_id) = (new_uuid()?, new_uuid()?);
    if app.usage.session.is_none() {
        app.usage.session = Some(new_uuid()?);
    }
    let session = app.usage.session.as_deref()?;
    app.usage.last_attempt_ms = Some(now_ms);
    let counts = Counts::of(app.session.registry().entries.iter().map(|entry| entry.kind));
    Some(build_request(&EventInputs {
        name,
        id: &id,
        session,
        facts: &app.usage.facts,
        counts,
        duration_s,
        now_ms,
        event_uuid: &event_uuid,
        request_id: &request_id,
    }))
}

#[cfg(test)]
mod tests;
