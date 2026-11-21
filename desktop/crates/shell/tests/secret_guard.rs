//! No control-protocol answer and no log line contains a registry secret. The secrets are
//! distinctive strings, so a plain search is reliable. One test: the logger is process-wide.
use std::sync::Mutex;

use pistudiodesktop_engine::{LocalRequest, Session};
use pistudiodesktop_shell::supervisor::{Limits, Supervisor};
use pistudiodesktop_shell::{AppShell, Request, Services, control, process};
use serde_json::{Value, json};

const PASSWORD: &str = "S3CRET-PASSWORD-7f3a91";
const LINK: &str = "pi://S3CRET-PAIRING-LINK-b04c52";
const NEW_PASSWORD: &str = "S3CRET-NEW-PASSWORD-1d8e66";
const NEW_LINK: &str = "pi://S3CRET-NEW-LINK-92aa07";
/// What the fake CLI prints as its `pairingUrl`.
const CLI_PAIRING: &str = "S3CRET-CLI-PAIRING-5c1e90";
const SECRETS: [&str; 5] = [PASSWORD, LINK, NEW_PASSWORD, NEW_LINK, CLI_PAIRING];

static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct Capture;

impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        if let Ok(mut lines) = LOG.lock() {
            lines.push(format!("{}", record.args()));
        }
    }
    fn flush(&self) {}
}

fn logged() -> Vec<String> {
    LOG.lock().map(|l| l.clone()).unwrap_or_default()
}

/// Every key at any depth.
fn keys(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                out.push(k.clone());
                keys(v, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| keys(v, out)),
        _ => {}
    }
}

/// What leaks in one text: a secret, or (for JSON answers) a `password` / `pairingLink` key.
fn leaks(text: &str) -> Option<String> {
    SECRETS.iter().find(|s| text.contains(*s)).map(|s| format!("secret `{s}`"))
}

fn check_answer(what: &str, answer: &Value) {
    if let Some(leak) = leaks(&answer.to_string()) {
        panic!("{what} leaked {leak}: {answer}");
    }
    let mut all = Vec::new();
    keys(answer, &mut all);
    assert!(!all.iter().any(|k| k == "password" || k == "pairingLink"), "{what} has a secret key: {answer}");
}

fn control_call(app: &mut AppShell, seen: &mut Vec<Value>, method: &str, params: Value) -> Value {
    let answer = control::handle(app, method, &params);
    check_answer(&format!("{method} {params}"), &answer);
    seen.push(answer.clone());
    answer
}

fn execute(app: &mut AppShell, seen: &mut Vec<Value>, command: &str, params: Value) -> Value {
    control_call(app, seen, "engine.execute", json!({"command": command, "params": params}))
}

#[test]
fn no_answer_and_no_log_line_contains_a_secret() {
    log::set_logger(&Capture).expect("one logger per process");
    log::set_max_level(log::LevelFilter::Trace);

    // The checks catch a leak: a canary in a log line and in an answer.
    log::warn!("canary {PASSWORD}");
    assert!(logged().iter().any(|l| leaks(l).is_some()), "the log capture sees lines");
    LOG.lock().expect("lock").clear();
    assert!(std::panic::catch_unwind(|| check_answer("canary", &json!({"result": {"nested": [{"password": "x"}]}}))).is_err());
    assert!(std::panic::catch_unwind(|| check_answer("canary", &json!({"error": format!("bad {LINK}")}))).is_err());

    let dir = tempfile::tempdir().expect("tempdir");
    let (session, _) = Session::with_config_dir(dir.path());
    let mut app = AppShell::new(session, Services::default());
    let mut seen = Vec::new();

    let direct = execute(&mut app, &mut seen, "daemon.add", json!({"kind": "direct", "name": "Work", "address": "10.0.0.9:8080", "password": PASSWORD}));
    assert_eq!(direct["ok"], true, "{direct}");
    let relay = execute(&mut app, &mut seen, "daemon.add", json!({"kind": "relay", "name": "Home", "pairingLink": LINK}));
    assert_eq!(relay["ok"], true, "{relay}");
    let direct_id = direct["result"]["id"].as_str().expect("id").to_owned();
    let relay_id = relay["result"]["id"].as_str().expect("id").to_owned();

    // Every method.
    control_call(&mut app, &mut seen, "engine.commands", Value::Null);
    let inspect = control_call(&mut app, &mut seen, "ui.inspect", Value::Null);
    assert_eq!(inspect["result"]["daemons"]["entries"].as_array().map(Vec::len), Some(3), "{inspect}");
    assert_eq!(inspect["result"]["daemons"]["currentId"], "local");
    control_call(&mut app, &mut seen, "ui.set", json!({}));
    control_call(&mut app, &mut seen, "ui.set", json!({"password": PASSWORD}));
    control_call(&mut app, &mut seen, "ui.nope", json!({"pairingLink": LINK}));

    // Every daemon.* and settings.* command, valid and refused, some echoing a secret as input.
    execute(&mut app, &mut seen, "daemon.list", json!({}));
    execute(&mut app, &mut seen, "daemon.switch", json!({"id": direct_id}));
    execute(&mut app, &mut seen, "daemon.switch", json!({"id": relay_id}));
    execute(&mut app, &mut seen, "daemon.update", json!({"id": direct_id, "password": NEW_PASSWORD}));
    execute(&mut app, &mut seen, "daemon.update", json!({"id": relay_id, "pairingLink": NEW_LINK}));
    execute(&mut app, &mut seen, "daemon.update", json!({"id": direct_id, "name": "Work 2", "address": "10.0.0.10:8080"}));
    execute(&mut app, &mut seen, "daemon.update", json!({"id": relay_id, "password": PASSWORD}));
    execute(&mut app, &mut seen, "daemon.update", json!({"id": direct_id, "pairingLink": LINK}));
    execute(&mut app, &mut seen, "daemon.add", json!({"kind": "direct", "name": "Work 2", "address": "a:1", "password": PASSWORD}));
    execute(&mut app, &mut seen, "daemon.add", json!({"kind": "direct", "name": "x", "address": "", "password": PASSWORD}));
    execute(&mut app, &mut seen, "daemon.add", json!({"kind": "relay", "name": "Home", "pairingLink": NEW_LINK}));
    execute(&mut app, &mut seen, "daemon.add", json!({"kind": PASSWORD}));
    execute(&mut app, &mut seen, "daemon.remove", json!({"id": PASSWORD}));
    execute(&mut app, &mut seen, "daemon.remove", json!({"id": "local"}));
    execute(&mut app, &mut seen, "daemon.nope", json!({"password": PASSWORD}));
    execute(&mut app, &mut seen, "command.list", json!({}));
    execute(&mut app, &mut seen, "settings.get", Value::Null);
    execute(&mut app, &mut seen, "settings.set", json!({"key": "cliPath", "value": "/usr/bin/pi"}));
    execute(&mut app, &mut seen, "settings.set", json!({"key": "autoStartLocalDaemon", "value": false}));
    control_call(&mut app, &mut seen, "ui.inspect", Value::Null);
    execute(&mut app, &mut seen, "daemon.remove", json!({"id": relay_id}));
    execute(&mut app, &mut seen, "daemon.remove", json!({"id": direct_id}));
    control_call(&mut app, &mut seen, "ui.inspect", Value::Null);

    // The page's requests too.
    for request in [Request::Boot, Request::Flush] {
        let answer = app.answer(&request);
        check_answer(&format!("{request:?}"), &answer);
    }

    // The same through the wire answers and what the app and status bar hold.
    let status = app.ui.status.clone();
    assert!(leaks(&status).is_none(), "status bar: {status}");
    assert!(leaks(&format!("{:?}", app.session.registry())).is_none(), "Debug of the registry");
    assert!(seen.len() >= 30, "the sequence ran: {}", seen.len());

    // The supervisor runs a CLI whose answers carry a pairing URL: it reaches no state and no log line.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let cli = dir.path().join("pi-studio");
        std::fs::write(&cli, include_str!("fixtures/fake-pi-studio.sh")).expect("write cli");
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        let env = vec![("PATH".to_owned(), "/usr/bin:/bin".to_owned()), ("FAKE_PI_DIR".to_owned(), dir.path().display().to_string())];
        let supervisor = Supervisor::with_env(process::native_services(), Limits::default(), env);
        for request in [LocalRequest::Probe, LocalRequest::Start, LocalRequest::Restart, LocalRequest::Stop] {
            let state = supervisor.carry_out(request, cli.to_str(), false);
            assert!(leaks(&format!("{state:?}")).is_none(), "{state:?}");
        }
    }

    let lines = logged();
    assert!(lines.iter().all(|l| leaks(l).is_none()), "a log line leaked a secret: {lines:?}");
}
