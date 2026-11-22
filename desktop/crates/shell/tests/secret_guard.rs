//! No control-protocol answer and no log line contains a registry secret. The secrets are
//! distinctive strings, so a plain search is reliable. One test: the logger is process-wide.
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use pistudiodesktop_engine::{LocalRequest, Notice, Session};
use pistudiodesktop_model::EntryId;
use pistudiodesktop_secrets::{MemoryStore, Secret, SecretError, SecretKey, SecretKind, SecretStore, StoreKind};
use pistudiodesktop_shell::daemons::LocalOp;
use pistudiodesktop_shell::supervisor::{Limits, Supervisor};
use pistudiodesktop_shell::transports::{ConnectionError, Snapshot, TransportState, TransportView};
use pistudiodesktop_shell::{AppShell, Request, Services, control, process};
use serde_json::{Value, json};

const PASSWORD: &str = "S3CRET-PASSWORD-7f3a91";
const LINK: &str = "pi://S3CRET-PAIRING-LINK-b04c52";
const NEW_PASSWORD: &str = "S3CRET-NEW-PASSWORD-1d8e66";
const NEW_LINK: &str = "pi://S3CRET-NEW-LINK-92aa07";
/// The secrets of the version 1 file the session opens on.
const OLD_PASSWORD: &str = "S3CRET-OLD-PASSWORD-44b1c8";
const OLD_LINK: &str = "pi://S3CRET-OLD-LINK-0e6d13";
const ARCHIVE: &str = "3f2b8a40-1111-4222-8333-444455557777";
/// What the fake CLI prints as its `pairingUrl`.
const CLI_PAIRING: &str = "S3CRET-CLI-PAIRING-5c1e90";
/// The token in a proxied connection's local address, which the app's hook can reach.
const TOKEN: &str = "S3CRET-TOKEN-8a21d7";
const SECRETS: [&str; 8] = [PASSWORD, LINK, NEW_PASSWORD, NEW_LINK, OLD_PASSWORD, OLD_LINK, CLI_PAIRING, TOKEN];

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

/// A memory store whose deletes can be made to fail.
#[derive(Default)]
struct Flaky {
    inner: MemoryStore,
    fail_delete: AtomicBool,
}

impl SecretStore for Flaky {
    fn kind(&self) -> StoreKind {
        self.inner.kind()
    }
    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError> {
        self.inner.get(key)
    }
    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError> {
        self.inner.set(key, secret)
    }
    fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
        if self.fail_delete.load(std::sync::atomic::Ordering::SeqCst) { Err(SecretError::Unavailable("down".into())) } else { self.inner.delete(key) }
    }
}

/// A memory store that reports another kind, to see each kind named in the views.
struct Kinded(StoreKind, MemoryStore);

impl SecretStore for Kinded {
    fn kind(&self) -> StoreKind {
        self.0
    }
    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError> {
        self.1.get(key)
    }
    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError> {
        self.1.set(key, secret)
    }
    fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
        self.1.delete(key)
    }
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
    // A version 1 file with two secrets: the open moves them to the store.
    std::fs::write(
        dir.path().join("daemons.json"),
        json!({"version": 1, "entries": [
            {"id": "local", "kind": "local", "name": "This machine", "password": OLD_PASSWORD},
            {"id": ARCHIVE, "kind": "relay", "name": "Archive", "pairingLink": OLD_LINK},
        ]})
        .to_string(),
    )
    .expect("write the version 1 file");
    let store = Arc::new(Flaky::default());
    let (session, notices) = Session::with_config_dir(dir.path(), store.clone());
    assert!(notices.is_empty(), "{notices:?}");
    // The app's hook holds the local address (token) and the password of a connection; what it
    // answers is a snapshot of counters, and `ui.inspect` must carry nothing of what it holds.
    let held = (format!("ws://127.0.0.1:1/{TOKEN}"), PASSWORD);
    let services = Services {
        transports: Some(Arc::new(move || {
            let _held = &held;
            Snapshot {
                transports: vec![TransportView {
                    entry_id: ARCHIVE.into(),
                    state: TransportState::Open,
                    frames_in: 4,
                    frames_out: 3,
                    bytes_in: 400,
                    bytes_out: 300,
                    peak_held_in: 20,
                    peak_held_out: 10,
                }],
                last_error: Some(ConnectionError { code: "page_refused", at_ms: 1 }),
            }
        })),
        ..Services::default()
    };
    let mut app = AppShell::new(session, services);
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
    assert_eq!(inspect["result"]["daemons"]["entries"].as_array().map(Vec::len), Some(4), "{inspect}");
    assert_eq!(inspect["result"]["connection"]["transports"][0]["state"], "open", "{inspect}");
    assert_eq!(inspect["result"]["connection"]["lastError"]["code"], "page_refused", "{inspect}");
    assert_eq!(inspect["result"]["daemons"]["currentId"], "local");
    control_call(&mut app, &mut seen, "ui.set", json!({}));
    control_call(&mut app, &mut seen, "ui.set", json!({"password": PASSWORD}));
    control_call(&mut app, &mut seen, "ui.nope", json!({"pairingLink": LINK}));

    // Every daemon.* and settings.* command, valid and refused, some echoing a secret as input.
    execute(&mut app, &mut seen, "daemon.list", json!({}));
    execute(&mut app, &mut seen, "daemon.switch", json!({"id": direct_id}));
    // What to dial names the secret and never holds it: the store has it, the answer does not.
    let plan = app.answer(&Request::Local(LocalOp::Resolve));
    check_answer("resolve", &plan);
    assert_eq!((plan["result"]["dial"].as_str(), plan["result"]["entry"].as_str()), (Some("password"), Some(direct_id.as_str())), "{plan}");
    execute(&mut app, &mut seen, "daemon.switch", json!({"id": relay_id}));
    let plan = app.answer(&Request::Local(LocalOp::Resolve));
    check_answer("resolve", &plan);
    assert_eq!((plan["result"]["dial"].as_str(), plan["result"]["entry"].as_str()), (Some("pairing_link"), Some(relay_id.as_str())), "{plan}");
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
    // A store that cannot delete: the entry is removed all the same, one notice names it, and the
    // log line has the entry id and no secret.
    store.fail_delete.store(true, std::sync::atomic::Ordering::SeqCst);
    let removed = execute(&mut app, &mut seen, "daemon.remove", json!({"id": direct_id}));
    assert_eq!(removed["result"], json!({"removed": true, "notices": [{"kind": "secret_not_removed", "entry": direct_id}]}), "{removed}");
    assert!(logged().iter().any(|l| l.contains(&direct_id) && l.contains("could not remove")), "{:?}", logged());
    store.fail_delete.store(false, std::sync::atomic::Ordering::SeqCst);
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

    // The secrets are where they belong: the migrated ones in the store, and none in the file.
    let file = std::fs::read_to_string(dir.path().join("daemons.json")).expect("read the registry");
    assert!(leaks(&file).is_none(), "daemons.json holds a secret: {file}");
    assert!(file.contains("\"version\": 2") && !file.contains("\"password\"") && !file.contains("\"pairingLink\""), "{file}");
    let held = |entry: &str, kind| store.get(&SecretKey::new(EntryId::parse(entry).expect("id"), kind)).expect("store read").map(|s| s.expose().to_owned());
    assert_eq!(held("local", SecretKind::Password).as_deref(), Some(OLD_PASSWORD));
    assert_eq!(held(ARCHIVE, SecretKind::PairingLink).as_deref(), Some(OLD_LINK));

    for kind in [StoreKind::Keychain, StoreKind::File, StoreKind::Memory] {
        views_name_the_kind(kind);
    }

    let lines = logged();
    assert!(lines.iter().all(|l| leaks(l).is_none()), "a log line leaked a secret: {lines:?}");
}

/// The kind of store is told in every view, whichever backend the launch chose, with the launch's
/// notices, and no view holds a secret.
fn views_name_the_kind(kind: StoreKind) {
    let scratch = tempfile::tempdir().expect("tempdir");
    let (session, _) = Session::with_config_dir(scratch.path(), Arc::new(Kinded(kind, MemoryStore::default())));
    let mut app = AppShell::new(session, Services::default());
    app.notices = vec![
        Notice::SecretStoreFallback { reason: "denied".into() },
        Notice::FileReset { file: "secrets.json".into(), kept_as: None },
        Notice::SecretNotRemoved { entry: ARCHIVE.into() },
    ];
    let mut seen = Vec::new();
    let inspect = control_call(&mut app, &mut seen, "ui.inspect", Value::Null);
    assert_eq!(
        inspect["result"]["connection"],
        json!({"secretStore": kind.as_str(), "transports": [], "lastError": null, "resumeSignals": {"wake": 0, "network": 0}}),
        "{inspect}"
    );
    assert_eq!(inspect["result"]["daemons"]["secretStore"], kind.as_str(), "{inspect}");
    let added = execute(&mut app, &mut seen, "daemon.add", json!({"kind": "direct", "name": "Work", "address": "10.0.0.9:8080", "password": PASSWORD}));
    assert_eq!(added["ok"], true, "{added}");
    // What `daemons_changed` carries.
    let changed = pistudiodesktop_shell::daemons::take_change(&mut app).expect("the registry changed");
    check_answer("daemons_changed", &changed);
    assert_eq!(changed["secretStore"], kind.as_str(), "{changed}");
    let boot = app.answer(&Request::Boot);
    check_answer("boot", &boot);
    assert_eq!(boot["result"]["daemons"]["secretStore"], kind.as_str(), "{boot}");
    assert_eq!(
        boot["result"]["notices"],
        json!([
            {"kind": "secret_store_fallback", "reason": "denied"},
            {"kind": "file_reset", "file": "secrets.json", "keptAs": null},
            {"kind": "secret_not_removed", "entry": ARCHIVE},
        ]),
        "{boot}"
    );
}
