//! Anonymous usage data, the app's half (`swe/features/desktop-usage-data.md` § 1, § 2, § 8): the token
//! and the endpoint compiled into the build, the HTTP `POST` behind the shell's `Services::usage` hook,
//! and the moments that call the shell's entry points (`pistudiodesktop_shell::usage`) and send what
//! they answer.
//!
//! * A build without `PISTUDIODESKTOP_POSTHOG_TOKEN` has no sender at all: [`sender`] is `None`, the
//!   hook is not filled, and the shell reports `blocked: "build"` ([`Usage::new`] then does nothing).
//! * [`Usage::launch`] (after setup) and [`Usage::tick`] (the update ticker's hourly step and the wake
//!   hook) run on a thread of their own: the window and the callers never wait. [`Usage::close`] blocks
//!   for at most two seconds, at `RunEvent::Exit` ([`on_run_event`]) and right before "Restart to
//!   update" hands over ([`close`]); the shell sends `app_closed` once per run, whichever comes first.
//! * Every decision, the ID and the event's JSON are the shell's; the app only reads the clock, the
//!   system's facts and the environment, asks the owner thread over its channel, and sends.
//! * One attempt per event, nothing queued (D15). A failure is one short code at debug level (P10):
//!   `offline`, `timeout`, `status_<n>` or `dropped`; never the URL, the ID, the token or a value.

use std::sync::Arc;
use std::sync::mpsc::{Sender as Channel, channel};
use std::time::{Duration, Instant};

use pistudiodesktop_shell::update::InstallKind;
use pistudiodesktop_shell::usage::{CLOSE_LIMIT, Facts, Launch, UsageHook, UsageOp, UsageRequest};
use pistudiodesktop_shell::{Envelope, Request};
use reqwest::Client;
use rustls::ClientConfig;
use serde_json::Value;
use tauri::{AppHandle, Manager as _, RunEvent, Runtime};

/// The project token of a published build: set by `bundle-release` alone (U1). Empty counts as none.
const TOKEN: Option<&str> = option_env!("PISTUDIODESKTOP_POSTHOG_TOKEN");
/// The endpoint a test build sends to (U2); never set by a release.
const ENDPOINT_OVERRIDE: Option<&str> = option_env!("PISTUDIODESKTOP_USAGE_ENDPOINT");
/// Capture v1 on PostHog Cloud, EU (D2, P3).
const ENDPOINT: &str = "https://eu.i.posthog.com/i/v1/analytics/events";

/// How long the thread that asks the owner for a request waits for the answer.
const OWNER_DEADLINE: Duration = Duration::from_secs(30);
/// What the caller of [`Sender::send`] waits beyond the limit for the thread that sends: the system's
/// roots are read there, and the HTTP client's own limit is the request's.
const GRACE: Duration = Duration::from_millis(500);

/// The build's replaced endpoint, `None` in a published build and in a source build.
fn endpoint_override() -> Option<&'static str> {
    ENDPOINT_OVERRIDE.filter(|url| !url.is_empty())
}

/// This build's sender: `Some` only when a token was compiled in (U1).
pub fn sender() -> Option<Sender> {
    let token = TOKEN.filter(|token| !token.is_empty())?;
    Some(Sender::new(endpoint_override().unwrap_or(ENDPOINT).to_owned(), token.to_owned()))
}

/// The one `POST` of an event: where to, and the bearer token.
#[derive(Clone)]
pub struct Sender {
    endpoint: String,
    token: String,
}

// The token is never in a log, not even through a `{:?}`.
impl std::fmt::Debug for Sender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Sender").finish_non_exhaustive()
    }
}

impl Sender {
    pub fn new(endpoint: String, token: String) -> Self {
        Self { endpoint, token }
    }

    /// The shell's hook over this sender ([`pistudiodesktop_shell::Services::usage`]).
    pub fn hook(self) -> UsageHook {
        Arc::new(move |request: &UsageRequest, limit: Duration| self.send(request, limit))
    }

    /// Send one event, waiting at most `limit`: `Ok` for a `200` whose result for the event is `ok` or
    /// `warning`, else the code of why not. Blocks; the work runs on a thread of its own with its own
    /// runtime, so that this works whatever thread calls it.
    pub fn send(&self, request: &UsageRequest, limit: Duration) -> Result<(), String> {
        let (done, answer) = channel();
        let job = (self.clone(), request.clone());
        std::thread::Builder::new()
            .name("usage-send".into())
            .spawn(move || {
                // The caller may have given up: nobody is left to read.
                let _ = done.send(job.0.post(&job.1, limit));
            })
            .map_err(|_| "dropped".to_owned())?;
        answer.recv_timeout(limit + GRACE).unwrap_or_else(|_| Err("timeout".to_owned()))
    }

    fn post(&self, request: &UsageRequest, limit: Duration) -> Result<(), String> {
        let uuid = event_uuid(&request.body).ok_or_else(|| "dropped".to_owned())?;
        let client = build_client(limit).map_err(|_| "dropped".to_owned())?;
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| "dropped".to_owned())?;
        runtime.block_on(async {
            let mut post = client.post(&self.endpoint).bearer_auth(&self.token).body(request.body.clone());
            for (name, value) in &request.headers {
                post = post.header(name, value);
            }
            let response = post.send().await.map_err(|e| transport_code(&e))?;
            let status = response.status().as_u16();
            if status != 200 {
                return classify(status, &[], &uuid);
            }
            let body = response.bytes().await.map_err(|e| transport_code(&e))?;
            classify(status, &body, &uuid)
        })
    }
}

/// `rustls` with `ring` and the operating system's verifier, HTTP/1.1, `limit` for the whole exchange:
/// the client of `pistudiodesktop-install`, which keeps its own. No process-wide provider is installed.
fn build_client(limit: Duration) -> Result<Client, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|e| e.to_string())?;
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        // `dangerous()` is rustls's name for a verifier of one's own: this is the platform's, which checks the chain,
        // the validity period and the name.
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Client::builder().tls_backend_preconfigured(config).timeout(limit).build().map_err(|e| e.without_url().to_string())
}

/// The `uuid` of the one event in a request's body.
fn event_uuid(body: &str) -> Option<String> {
    let body: Value = serde_json::from_str(body).ok()?;
    Some(body.get("batch")?.get(0)?.get("uuid")?.as_str()?.to_owned())
}

/// The code of a request that got no answer: the time limit, else not reachable (DNS, refused, TLS).
fn transport_code(e: &reqwest::Error) -> String {
    if e.is_timeout() { "timeout" } else { "offline" }.to_owned()
}

/// § 2: a `200` whose result for the event is `ok` or `warning` is success. Another status is
/// `status_<n>`; a `200` with a `drop` or `retry` result, no result or no JSON is `dropped`.
fn classify(status: u16, body: &[u8], uuid: &str) -> Result<(), String> {
    if status != 200 {
        return Err(format!("status_{status}"));
    }
    let results: Value = serde_json::from_slice(body).map_err(|_| "dropped".to_owned())?;
    match results.get("results").and_then(|r| r.get(uuid)).and_then(|r| r.get("result")).and_then(Value::as_str) {
        Some("ok" | "warning") => Ok(()),
        _ => Err("dropped".to_owned()),
    }
}

/// What the app tells the shell about itself and the system, fixed for the run (§ 2's properties).
pub fn facts(kind: InstallKind) -> Facts {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    Facts {
        os: os.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        install_kind: kind.as_str().to_owned(),
        // The first preferred language as a BCP 47 tag, `None` when the system reports none (U11).
        locale: sys_locale::get_locale(),
    }
}

/// An environment variable as a string; set but not Unicode still counts as set.
fn env_value(name: &str) -> Option<String> {
    std::env::var_os(name).map(|value| value.to_string_lossy().into_owned())
}

/// The moments of the run: managed by Tauri as `Arc<Usage>`.
pub struct Usage {
    /// The owner thread's channel: the shell decides there, the app sends here.
    requests: Channel<Envelope>,
    /// `None` in a build without a token: nothing here does anything, and the shell stays `build`-blocked.
    hook: Option<UsageHook>,
    /// What the launch tells the shell, but for the time.
    launch: Launch,
}

impl Usage {
    /// The moments over the owner channel, with the environment and the arguments of this launch:
    /// `scripted` is whether `--control` or `--config-dir` (or their environment forms) were given.
    pub fn new(requests: Channel<Envelope>, hook: Option<UsageHook>, scripted: bool, facts: Facts) -> Self {
        let launch =
            Launch { now_ms: 0, test_build: endpoint_override().is_some(), do_not_track: env_value("DO_NOT_TRACK"), ci: env_value("CI"), scripted, facts };
        Self::with_launch(requests, hook, launch)
    }

    /// The moments with a launch of one's own (the tests').
    pub fn with_launch(requests: Channel<Envelope>, hook: Option<UsageHook>, launch: Launch) -> Self {
        Self { requests, hook, launch }
    }

    /// After setup: tell the shell the run began and send `app_started` when it says so. Off this thread.
    pub fn launch(self: &Arc<Self>) {
        let this = Arc::clone(self);
        self.background("usage-launch", move || {
            let op = UsageOp::Launch(Launch { now_ms: crate::update::now_ms(), ..this.launch.clone() });
            this.run(op, OWNER_DEADLINE, None);
        });
    }

    /// The hourly step and the wake (U9): `app_daily` when due. Off this thread.
    pub fn tick(self: &Arc<Self>) {
        let this = Arc::clone(self);
        self.background("usage-tick", move || this.run(UsageOp::Tick { now_ms: crate::update::now_ms() }, OWNER_DEADLINE, None));
    }

    /// `app_closed`, once per run and only when sending is on, within [`CLOSE_LIMIT`] from the call
    /// (the asking and the send share it). Blocks.
    pub fn close(&self) {
        let began = Instant::now();
        self.run(UsageOp::Close { now_ms: crate::update::now_ms() }, CLOSE_LIMIT, Some(began));
    }

    /// Run `work` on a thread of its own, unless this build has no sender.
    fn background(&self, name: &str, work: impl FnOnce() + Send + 'static) {
        if self.hook.is_none() {
            return;
        }
        if let Err(e) = std::thread::Builder::new().name(name.into()).spawn(work) {
            log::debug!("usage: not sent (dropped: {e})");
        }
    }

    /// Ask the owner thread what to send for `op`, within `deadline`, and send it; with `began`, the
    /// send gets what is left of the request's limit after the asking.
    fn run(&self, op: UsageOp, deadline: Duration, began: Option<Instant>) {
        let Some(hook) = &self.hook else { return };
        let (envelope, reply) = Envelope::new(Request::Usage(op));
        if self.requests.send(envelope).is_err() {
            return;
        }
        let Some(request) = reply.recv_timeout(deadline).ok().and_then(|reply| UsageRequest::from_reply(&reply)) else { return };
        let limit = match began {
            Some(began) => request.limit().saturating_sub(began.elapsed()),
            None => request.limit(),
        };
        if limit.is_zero() {
            log::debug!("usage: not sent (timeout)");
        } else if let Err(code) = hook(&request, limit) {
            log::debug!("usage: not sent ({code})");
        }
    }
}

/// `app_closed` before "Restart to update" hands over (U10): on Windows the installer ends the process
/// without an exit event, elsewhere the exit's own call finds it sent already. Blocks for at most 2 s.
pub fn close<R: Runtime>(handle: &AppHandle<R>) {
    if let Some(usage) = handle.try_state::<Arc<Usage>>() {
        usage.close();
    }
}

/// `app_closed` when the app exits (U10).
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit) {
        close(handle);
    }
}

#[cfg(test)]
mod tests;
