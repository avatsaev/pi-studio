//! The daemon registry as the page and the background runner reach it: the view both the boot
//! snapshot and `ui.inspect` hold, the commands the page may run, who is told about a change, and
//! the local-daemon operations that cross to the thread that owns the session.
//!
//! The view never holds a password or a pairing link. The one answer that does, "what to dial",
//! is [`Request::Local`] with [`LocalOp::Resolve`] and nothing else, and that answer carries the
//! name of the secret to read, not the secret: the caller reads the store off the owner thread
//! (see `docs/architecture.md` § Decisions).

use pistudiodesktop_engine::{Dial, DialPlan, LocalRequest, Session};
use pistudiodesktop_model::{EntryId, FailReason, LocalState, Secret};
use serde_json::{Value, json};

use crate::AppShell;
use crate::cli_answers;

/// The engine commands the page may run (`engine_command`). `daemon.switch` is not here: a switch
/// needs a confirm, a flush and a reload, which the app does itself.
pub const PAGE_COMMANDS: &[&str] = &[
    "daemon.list",
    "daemon.add",
    "daemon.update",
    "daemon.remove",
    "daemon.local.start",
    "daemon.local.stop",
    "daemon.local.restart",
    "daemon.local.refresh",
    "settings.get",
    "settings.set",
];

/// The event the page is told of a change with.
pub const CHANGED_EVENT: &str = "daemons_changed";

/// Whether the page may run the engine command `id`.
pub fn page_may_run(id: &str) -> bool {
    PAGE_COMMANDS.contains(&id)
}

/// The oldest `pi-studio` CLI (and so daemon) the app works with, as the page is told it.
pub fn min_daemon_version() -> String {
    cli_answers::MIN_CLI_VERSION.to_string()
}

/// `{ currentId, entries, local, settings }`: the registry view, with no secret in it.
pub fn view(app: &mut AppShell) -> Value {
    let mut list = app.session.execute("daemon.list", Value::Null).unwrap_or(Value::Null);
    if let Some(fields) = list.as_object_mut() {
        fields.insert("settings".into(), app.session.execute("settings.get", Value::Null).unwrap_or(Value::Null));
    }
    list
}

/// The view to send the page when the registry, the local state or a setting changed since the
/// last call; `None` when nothing did. The one place that decides who is told.
pub fn take_change(app: &mut AppShell) -> Option<Value> {
    app.session.take_registry_changed().then(|| view(app))
}

/// Run an engine command for the page, if it is on [`PAGE_COMMANDS`].
pub fn page_command(app: &mut AppShell, id: &str, params: Value) -> Result<Value, String> {
    if !page_may_run(id) {
        return Err(format!("the page may not run `{}`", id.chars().take(64).collect::<String>()));
    }
    app.run(id, params)
}

/// What the supervisor needs from the session, taken together.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Batch {
    pub requests: Vec<LocalRequest>,
    /// The `cliPath` setting.
    pub cli_path: Option<String>,
    /// The CLI was missing or outdated: the user may have installed it since, so the shell
    /// environment is read again (the Retry of the Daemons screen).
    pub refresh_env: bool,
}

/// A short operation of the supervisor on the session, run on the thread that owns it.
#[derive(Clone, Debug, PartialEq)]
pub enum LocalOp {
    /// Take the queued requests and the settings they need.
    Take,
    /// Store the state a request reached.
    Apply(LocalState),
    /// What to dial for the current entry: a [`DialPlan`], which names the secret to read and
    /// never reads it (a store read may block, and the owner thread never waits on one).
    Resolve,
    /// Run the engine command `id` (`daemon.local.refresh` and the like).
    Request(String),
}

/// Answer a [`LocalOp`]: `{"ok": true, "result": …}` or `{"ok": false, "error": "…"}` like every reply.
pub fn local_op(app: &mut AppShell, op: &LocalOp) -> Value {
    crate::control::reply(match op {
        LocalOp::Take => Ok(batch_to_json(&take_batch(&mut app.session))),
        LocalOp::Apply(state) => {
            app.session.apply_local_outcome(state.clone());
            Ok(Value::Null)
        }
        LocalOp::Resolve => app.session.plan_dial(cli_answers::dial_address).map(plan_to_json).map_err(str::to_owned),
        LocalOp::Request(id) => app.session.execute(id, Value::Null).map(|_| Value::Null).map_err(|e| e.to_string()),
    })
}

/// Take the queued local requests and what they need from the session.
pub fn take_batch(s: &mut Session) -> Batch {
    let requests = s.take_local_requests();
    let refresh_env = matches!(s.local_state(), LocalState::CliMissing { .. } | LocalState::CliOutdated { .. });
    Batch { requests, cli_path: s.settings().cli_path.clone(), refresh_env }
}

fn request_name(request: LocalRequest) -> &'static str {
    match request {
        LocalRequest::Start => "start",
        LocalRequest::Stop => "stop",
        LocalRequest::Restart => "restart",
        LocalRequest::Probe => "probe",
    }
}

fn request_of(name: &str) -> Option<LocalRequest> {
    Some(match name {
        "start" => LocalRequest::Start,
        "stop" => LocalRequest::Stop,
        "restart" => LocalRequest::Restart,
        "probe" => LocalRequest::Probe,
        _ => return None,
    })
}

fn batch_to_json(batch: &Batch) -> Value {
    json!({
        "requests": batch.requests.iter().map(|r| request_name(*r)).collect::<Vec<_>>(),
        "cliPath": batch.cli_path,
        "refreshEnv": batch.refresh_env,
    })
}

/// The inverse of [`LocalOp::Take`]'s answer; what cannot be read is an empty batch.
pub fn batch_from_json(value: &Value) -> Batch {
    Batch {
        requests: value["requests"].as_array().map(|names| names.iter().filter_map(|n| request_of(n.as_str()?)).collect()).unwrap_or_default(),
        cli_path: value["cliPath"].as_str().map(str::to_owned),
        refresh_env: value["refreshEnv"].as_bool().unwrap_or(false),
    }
}

/// What the owner thread answers [`LocalOp::Resolve`] with. It holds a held-in-memory password
/// only when a version 1 file's secrets could not be moved to the store (see the engine's
/// `Storage::open`); otherwise it names the item to read, and the caller reads it.
fn plan_to_json(plan: DialPlan) -> Value {
    match plan {
        DialPlan::Ready(Dial::Connect { url, password }) => json!({"dial": "connect", "url": url, "password": password.as_ref().map(Secret::expose)}),
        DialPlan::Ready(Dial::StartNeeded) => json!({"dial": "start_needed"}),
        DialPlan::Ready(Dial::Wait) => json!({"dial": "wait"}),
        DialPlan::Password { url, entry } => json!({"dial": "password", "url": url, "entry": entry.as_str()}),
        DialPlan::PairingLink { entry } => json!({"dial": "pairing_link", "entry": entry.as_str()}),
    }
}

/// The inverse of [`LocalOp::Resolve`]'s answer.
pub fn plan_from_json(value: &Value) -> Result<DialPlan, &'static str> {
    let entry = || value["entry"].as_str().and_then(|id| EntryId::parse(id).ok()).ok_or("internal");
    match value["dial"].as_str() {
        Some("connect") => Ok(DialPlan::Ready(Dial::Connect {
            url: value["url"].as_str().ok_or("internal")?.to_owned(),
            password: value["password"].as_str().map(Secret::new),
        })),
        Some("start_needed") => Ok(DialPlan::Ready(Dial::StartNeeded)),
        Some("wait") => Ok(DialPlan::Ready(Dial::Wait)),
        Some("password") => Ok(DialPlan::Password { url: value["url"].as_str().ok_or("internal")?.to_owned(), entry: entry()? }),
        Some("pairing_link") => Ok(DialPlan::PairingLink { entry: entry()? }),
        _ => Err("internal"),
    }
}

/// The page's answer for a dial: `{ url, password?, connect: true }`. The only place a secret is
/// written into JSON for the page. Anything but a connection is not an answer here (the
/// supervisor settles those first).
pub fn dial_for_page(dial: Dial) -> Result<Value, String> {
    match dial {
        Dial::Connect { url, password } => {
            let mut answer = json!({"url": url, "connect": true});
            if let (Some(password), Some(fields)) = (password, answer.as_object_mut()) {
                fields.insert("password".into(), Value::String(password.expose().to_owned()));
            }
            Ok(answer)
        }
        Dial::StartNeeded | Dial::Wait => Err("internal".to_owned()),
    }
}

/// The code a rejected resolve carries, as a `&'static str` (the supervisor's trait wants one).
pub fn static_code(code: &str) -> &'static str {
    const KNOWN: &[&str] =
        &["no_current", "not_found", "unsupported", "cli_missing", "cli_outdated", "local_stopped", "busy", "secret_missing", "secret_unavailable"];
    const FAILS: [FailReason; 4] = [FailReason::NotHealthy, FailReason::Timeout, FailReason::BadOutput, FailReason::SpawnFailed];
    KNOWN.iter().copied().find(|known| *known == code).or_else(|| FAILS.iter().map(|f| f.code()).find(|known| *known == code)).unwrap_or("internal")
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_engine::Session;

    use super::*;
    use crate::Services;

    fn app() -> AppShell {
        AppShell::new(Session::new(), Services::default())
    }

    #[test]
    fn only_the_listed_commands_run_for_the_page() {
        let mut app = app();
        for id in ["daemon.switch", "command.list", "test.panic", "", "settings.get ", "daemon.local"] {
            assert!(!page_may_run(id), "{id}");
            assert!(page_command(&mut app, id, Value::Null).unwrap_err().contains("may not run"));
        }
        for id in PAGE_COMMANDS {
            assert!(page_may_run(id));
        }
        assert!(page_command(&mut app, "settings.get", Value::Null).is_ok());
    }

    #[test]
    fn the_view_holds_entries_local_state_and_settings_and_no_secret() {
        let mut app = app();
        page_command(&mut app, "daemon.add", json!({"kind": "direct", "name": "B", "address": "h:1", "password": "hunter2"})).unwrap();
        page_command(&mut app, "daemon.add", json!({"kind": "relay", "name": "R", "pairingLink": "pi://secret-link"})).unwrap();
        let view = view(&mut app);
        let text = view.to_string();
        assert!(!text.contains("hunter2") && !text.contains("secret-link"), "{text}");
        assert_eq!(view["entries"].as_array().map(Vec::len), Some(3));
        assert_eq!(view["settings"]["autoStartLocalDaemon"], true);
        assert!(view.get("currentId").is_some() && view.get("local").is_some());
    }

    #[test]
    fn a_change_is_told_once_and_a_quiet_session_tells_nothing() {
        let mut app = app();
        assert!(take_change(&mut app).is_none() || take_change(&mut app).is_none());
        page_command(&mut app, "daemon.add", json!({"kind": "direct", "name": "B", "address": "h:1"})).unwrap();
        assert!(take_change(&mut app).is_some());
        assert!(take_change(&mut app).is_none());
        page_command(&mut app, "settings.set", json!({"key": "autoStartLocalDaemon", "value": false})).unwrap();
        assert_eq!(take_change(&mut app).map(|v| v["settings"]["autoStartLocalDaemon"].clone()), Some(json!(false)));
        page_command(&mut app, "daemon.list", Value::Null).unwrap();
        assert!(take_change(&mut app).is_none(), "reading changes nothing");
    }

    #[test]
    fn batches_and_dial_plans_survive_the_trip_to_the_owner_thread() {
        let batch = Batch { requests: vec![LocalRequest::Probe, LocalRequest::Start], cli_path: Some("/x/pi".into()), refresh_env: true };
        assert_eq!(batch_from_json(&batch_to_json(&batch)), batch);
        assert_eq!(batch_from_json(&Value::Null), Batch::default());
        let entry = EntryId::parse("3f2b8a40-1111-4222-8333-444455556666").unwrap();
        let plans = [
            DialPlan::Ready(Dial::Connect { url: "ws://h:1".into(), password: Some(Secret::new("pw")) }),
            DialPlan::Ready(Dial::Connect { url: "ws://h:1".into(), password: None }),
            DialPlan::Ready(Dial::Wait),
            DialPlan::Ready(Dial::StartNeeded),
            DialPlan::Password { url: "ws://h:1".into(), entry: entry.clone() },
            DialPlan::PairingLink { entry },
        ];
        for plan in plans {
            assert_eq!(plan_from_json(&plan_to_json(plan.clone())), Ok(plan));
        }
        assert_eq!(plan_from_json(&Value::Null), Err("internal"));
        assert_eq!(plan_from_json(&json!({"dial": "password", "url": "u", "entry": "../x"})), Err("internal"));
        for code in ["no_current", "timeout", "spawn_failed", "local_stopped", "secret_missing", "secret_unavailable"] {
            assert_eq!(static_code(code), code);
        }
        assert_eq!(static_code("surprise"), "internal");
    }

    #[test]
    fn the_page_answer_for_a_dial_carries_the_password_only_when_there_is_one() {
        let with = dial_for_page(Dial::Connect { url: "ws://h:1".into(), password: Some(Secret::new("pw")) }).unwrap();
        assert_eq!(with, json!({"url": "ws://h:1", "password": "pw", "connect": true}));
        let without = dial_for_page(Dial::Connect { url: "ws://h:1".into(), password: None }).unwrap();
        assert_eq!(without, json!({"url": "ws://h:1", "connect": true}));
        assert!(dial_for_page(Dial::Wait).is_err());
    }

    #[test]
    fn the_minimum_daemon_version_is_the_clis() {
        assert_eq!(min_daemon_version(), "0.0.119");
    }
}
