//! The supervisor's way to a session that lives on another thread: [`LocalAccess`] over the owner
//! thread's channel. Each call is one short request ([`LocalOp`]) answered in order with the
//! storage writes and the control socket's requests, so a 90 s daemon start, which happens in
//! the supervisor between calls, holds none of them up.

use std::sync::mpsc::Sender;
use std::time::Duration;

use pistudiodesktop_engine::Dial;
use pistudiodesktop_model::LocalState;
use serde_json::{Value, json};

use crate::daemons::{self, Batch, LocalOp};
use crate::supervisor::LocalAccess;
use crate::{Envelope, Request};

/// The owner thread answers each of these at once; a minute is only a bound on a stuck thread.
const REPLY_DEADLINE: Duration = Duration::from_secs(60);

/// [`LocalAccess`] through the channel of the thread that owns the session.
#[derive(Clone)]
pub struct OwnerAccess {
    requests: Sender<Envelope>,
}

impl OwnerAccess {
    pub fn new(requests: Sender<Envelope>) -> Self {
        Self { requests }
    }

    /// Run the engine command `command` and read its result, or its error text.
    pub fn execute(&self, command: &str, params: Value) -> Result<Value, String> {
        self.call(Request::Control { method: "engine.execute".into(), params: json!({"command": command, "params": params}) })
    }

    /// Send `request` and read the reply's `result`, or its error text.
    pub fn call(&self, request: Request) -> Result<Value, String> {
        let (envelope, reply) = Envelope::new(request);
        self.requests.send(envelope).map_err(|_| "shutting_down".to_owned())?;
        let mut reply = reply.recv_timeout(REPLY_DEADLINE).map_err(|_| "timeout".to_owned())?;
        if reply["ok"] == true {
            Ok(reply.get_mut("result").map(Value::take).unwrap_or(Value::Null))
        } else {
            Err(reply["error"].as_str().unwrap_or("internal").to_owned())
        }
    }

    fn ask(&self, op: LocalOp) -> Result<Value, String> {
        self.call(Request::Local(op))
    }
}

impl LocalAccess for OwnerAccess {
    fn take(&self) -> Batch {
        self.ask(LocalOp::Take).map(|value| daemons::batch_from_json(&value)).unwrap_or_default()
    }

    fn apply(&self, state: LocalState) {
        if let Err(e) = self.ask(LocalOp::Apply(state)) {
            log::warn!("local daemon: the outcome could not be stored: {e}");
        }
    }

    fn resolve(&self) -> Result<Dial, &'static str> {
        match self.ask(LocalOp::Resolve) {
            Ok(value) => daemons::dial_from_json(&value),
            Err(code) => Err(daemons::static_code(&code)),
        }
    }

    fn request(&self, id: &str) -> Result<(), String> {
        self.ask(LocalOp::Request(id.to_owned())).map(|_| ())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use pistudiodesktop_engine::Session;
    use pistudiodesktop_model::LocalState;
    use serde_json::json;

    use super::*;
    use crate::owner;
    use crate::supervisor::{Limits, Supervisor};
    use crate::{AppShell, Services, process};

    fn running_owner(mut app: AppShell) -> (OwnerAccess, std::thread::JoinHandle<()>) {
        let (tx, rx) = channel();
        let worker = std::thread::spawn(move || owner::serve(&mut app, &rx, Duration::from_secs(3600)));
        (OwnerAccess::new(tx), worker)
    }

    #[test]
    fn the_supervisor_drives_a_session_on_another_thread() {
        let mut session = Session::new();
        session.set_local_state(LocalState::Stopped);
        let (access, _worker) = running_owner(AppShell::new(session, Services::default()));
        // No process hooks: the probe fails at once, and the outcome lands in the session.
        let supervisor = Supervisor::with_env(Services::default(), Limits::default(), vec![]);
        Supervisor::probe_now(&access).unwrap();
        assert_eq!(supervisor.pump(&access), 1);
        assert_eq!(supervisor.pump(&access), 0);
        // The missing CLI is the state reached, so the next batch re-reads the environment.
        assert_eq!(access.ask(LocalOp::Request("daemon.list".into())), Ok(Value::Null));
        assert_eq!(access.take(), Batch { requests: vec![], cli_path: None, refresh_env: true });
    }

    #[test]
    fn resolving_a_direct_entry_returns_its_address_and_password_through_the_channel() {
        let mut session = Session::new();
        let added = session.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080", "password": "pw"})).unwrap();
        session.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
        let (access, _worker) = running_owner(AppShell::new(session, process::native_services()));
        let supervisor = Supervisor::new(process::native_services(), Limits::default());
        let dial = supervisor.resolve_current(&access).unwrap();
        assert_eq!(daemons::dial_for_page(dial).unwrap(), json!({"url": "10.0.0.2:8080", "password": "pw", "connect": true}));
    }

    #[test]
    fn a_stopped_channel_is_an_empty_batch_and_a_refused_request() {
        let (tx, rx) = channel();
        drop(rx);
        let access = OwnerAccess::new(tx);
        assert_eq!(access.take(), Batch::default());
        assert_eq!(access.request("daemon.local.refresh"), Err("shutting_down".to_owned()));
        assert_eq!(access.resolve(), Err("internal"));
    }

    #[test]
    fn a_slow_start_on_the_runner_holds_up_neither_storage_writes_nor_other_requests() {
        use std::os::unix::fs::PermissionsExt as _;
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let cli = dir.path().join("pi-studio");
        std::fs::write(&cli, include_str!("../tests/fixtures/fake-pi-studio.sh")).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut session = Session::new();
        session.set_local_supported(true);
        session.execute("settings.set", json!({"key": "cliPath", "value": cli.display().to_string()})).unwrap();
        session.execute("daemon.local.start", json!({})).unwrap();
        let (tx, rx) = channel();
        let mut app = AppShell::new(session, Services::default());
        let worker = std::thread::spawn(move || owner::serve(&mut app, &rx, Duration::from_secs(3600)));
        let env = vec![
            ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
            ("FAKE_PI_DIR".to_owned(), dir.path().display().to_string()),
            ("FAKE_PI_MODE".to_owned(), "slow".to_owned()),
        ];
        let supervisor = std::sync::Arc::new(Supervisor::with_env(process::native_services(), Limits::default(), env));
        let access = OwnerAccess::new(tx.clone());
        let runner = std::thread::spawn({
            let supervisor = std::sync::Arc::clone(&supervisor);
            move || supervisor.pump(&access)
        });
        // The start takes 0.4 s in the fake CLI; the session answers meanwhile.
        std::thread::sleep(Duration::from_millis(100));
        let begun = Instant::now();
        let (envelope, reply) = Envelope::new(Request::StorageSet { key: "pi-studio-appearance".into(), value: "dark".into() });
        tx.send(envelope).unwrap();
        let (settings, settings_reply) = Envelope::new(Request::Engine { id: "settings.get".into(), params: Value::Null });
        tx.send(settings).unwrap();
        assert_eq!(reply.recv_timeout(Duration::from_secs(5)).unwrap()["ok"], true);
        assert_eq!(settings_reply.recv_timeout(Duration::from_secs(5)).unwrap()["ok"], true);
        assert!(begun.elapsed() < Duration::from_millis(250), "answered in {:?}", begun.elapsed());
        assert_eq!(runner.join().unwrap(), 1);
        drop(tx);
        worker.join().unwrap();
    }
}
