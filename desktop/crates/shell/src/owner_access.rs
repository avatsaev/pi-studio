//! The supervisor's way to a session that lives on another thread: [`LocalAccess`] over the owner
//! thread's channel. Each call is one short request ([`LocalOp`]) answered in order with the
//! storage writes and the control socket's requests, so a 90 s daemon start, which happens in
//! the supervisor between calls, holds none of them up.

use std::sync::Arc;
use std::sync::mpsc::Sender;
use std::time::Duration;

use pistudiodesktop_secrets::SecretStore;

use pistudiodesktop_engine::{BridgePlan, Dial, RemoteRequest, SshPlan, SshSecrets};
use pistudiodesktop_model::{EntryId, LocalState, RemoteState, Secret};
use serde_json::{Value, json};

use crate::daemons::{self, Batch, LocalOp, SshOp};
use crate::supervisor::LocalAccess;
use crate::{Envelope, Request};

/// The owner thread answers each of these at once; a minute is only a bound on a stuck thread.
const REPLY_DEADLINE: Duration = Duration::from_secs(60);

/// [`LocalAccess`] through the channel of the thread that owns the session. It also holds the
/// session's secret store: a dial's secret is read here, on the caller's thread, never on the
/// owner thread (a store read may block until the user answers a system prompt).
#[derive(Clone)]
pub struct OwnerAccess {
    requests: Sender<Envelope>,
    store: Arc<dyn SecretStore>,
}

impl OwnerAccess {
    /// `store` is the one the session was given ([`pistudiodesktop_engine::Session::secret_store`]).
    pub fn new(requests: Sender<Envelope>, store: Arc<dyn SecretStore>) -> Self {
        Self { requests, store }
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

    /// What the transport bridge dials for the current entry (one short question to the owner
    /// thread; the store is not touched). `Err` is a code of `transport_open`.
    pub fn bridge_plan(&self) -> Result<BridgePlan, &'static str> {
        match self.ask(LocalOp::Bridge) {
            Ok(value) => daemons::bridge_from_json(&value),
            Err(code) => Err(daemons::static_code(&code)),
        }
    }

    /// The password of the planned entry, read from the store on the caller's thread, which may
    /// block as long as a keychain prompt lasts: never the owner thread's.
    pub fn bridge_password(&self, plan: &BridgePlan) -> Result<Option<Secret>, &'static str> {
        plan.read_password(&*self.store)
    }

    /// What opening the current SSH entry needs: its fields and which secrets exist (one short
    /// question to the owner thread; the store is not touched). `Err` is a code of `transport_open`.
    pub fn ssh_plan(&self) -> Result<SshPlan, &'static str> {
        match self.ask(LocalOp::Ssh(SshOp::Plan)) {
            Ok(value) => daemons::ssh_plan_from_json(&value),
            Err(code) => Err(daemons::static_code(&code)),
        }
    }

    /// The SSH password and key passphrase of the planned entry, read from the store on the
    /// caller's thread, which may block as long as a keychain prompt lasts: never the owner thread's.
    pub fn ssh_secrets(&self, plan: &SshPlan) -> Result<SshSecrets, &'static str> {
        plan.read_secrets(&*self.store)
    }

    /// The remote daemon requests the session queued since the last call; none when the owner
    /// thread has stopped.
    pub fn remote_requests(&self) -> Vec<RemoteRequest> {
        self.ask(LocalOp::Ssh(SshOp::Take)).map(|value| daemons::remote_requests_from_json(&value)).unwrap_or_default()
    }

    /// Store the state a remote request reached for `entry`; `false` when `entry` is no longer current.
    pub fn apply_remote(&self, entry: &EntryId, state: RemoteState) -> bool {
        matches!(self.ask(LocalOp::Ssh(SshOp::Apply { entry: entry.clone(), state })), Ok(Value::Bool(true)))
    }

    /// Store a state of the remote daemon learned without a request (it was reached, say); `false`
    /// when `entry` is no longer current.
    pub fn set_remote(&self, entry: &EntryId, state: RemoteState) -> bool {
        matches!(self.ask(LocalOp::Ssh(SshOp::Set { entry: entry.clone(), state })), Ok(Value::Bool(true)))
    }

    fn ask(&self, op: LocalOp) -> Result<Value, String> {
        self.call(Request::Local(op))
    }
}

impl LocalAccess for OwnerAccess {
    fn take(&self) -> Batch {
        self.ask(LocalOp::Take).map(|value| daemons::batch_from_json(&value)).unwrap_or_default()
    }

    fn progress(&self, state: LocalState) {
        if let Err(e) = self.ask(LocalOp::Progress(state)) {
            log::warn!("local daemon: the progress could not be stored: {e}");
        }
    }

    fn apply(&self, state: LocalState) {
        if let Err(e) = self.ask(LocalOp::Apply(state)) {
            log::warn!("local daemon: the outcome could not be stored: {e}");
        }
    }

    fn resolve(&self) -> Result<Dial, &'static str> {
        let plan = match self.ask(LocalOp::Resolve) {
            Ok(value) => daemons::plan_from_json(&value)?,
            Err(code) => return Err(daemons::static_code(&code)),
        };
        // The owner thread has answered: the store read below may block as long as it likes.
        plan.finish(&*self.store)
    }

    fn request(&self, id: &str) -> Result<(), String> {
        self.ask(LocalOp::Request(id.to_owned())).map(|_| ())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use std::sync::Arc;

    use pistudiodesktop_engine::Session;
    use pistudiodesktop_model::LocalState;
    use pistudiodesktop_secrets::{MemoryStore, SecretError, SecretKey, SecretStore};
    use serde_json::json;

    use super::*;
    use crate::owner;
    use crate::supervisor::{Limits, Supervisor};
    use crate::{AppShell, Services, process};

    /// A pairing link `model::pairing` reads.
    const LINK: &str = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=l";

    fn running_owner(mut app: AppShell) -> (OwnerAccess, std::thread::JoinHandle<()>) {
        let (tx, rx) = channel();
        let store = app.session.secret_store();
        let worker = std::thread::spawn(move || owner::serve(&mut app, &rx, Duration::from_secs(3600)));
        (OwnerAccess::new(tx, store), worker)
    }

    #[test]
    fn the_supervisor_drives_a_session_on_another_thread() {
        let mut session = Session::new();
        session.set_local_state(LocalState::Stopped);
        let (access, _worker) = running_owner(AppShell::new(session, Services::default()));
        // No process hooks: the probe fails at once, and the outcome lands in the session.
        let env = vec![("PI_STUDIO_HOME".to_owned(), "/nonexistent/pi-studio-home".to_owned())];
        let supervisor = Supervisor::with_env(Services::default(), Limits::default(), env);
        Supervisor::probe_now(&access).unwrap();
        assert_eq!(supervisor.pump(&access), 1);
        assert_eq!(supervisor.pump(&access), 0);
        // The binary that could not be run is the state reached, so the next batch re-reads the environment.
        assert_eq!(access.ask(LocalOp::Request("daemon.list".into())), Ok(Value::Null));
        assert_eq!(access.take(), Batch { requests: vec![], refresh_env: true });
    }

    #[test]
    fn resolving_a_direct_entry_returns_its_address_and_no_password_through_the_channel() {
        let mut session = Session::new();
        let added = session.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080", "password": "pw"})).unwrap();
        session.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
        let (access, _worker) = running_owner(AppShell::new(session, process::native_services()));
        let supervisor = Supervisor::new(process::native_services(), Limits::default());
        let dial = supervisor.resolve_current(&access).unwrap();
        assert_eq!(daemons::dial_for_page(dial).unwrap(), json!({"url": "10.0.0.2:8080", "connect": true}));
    }

    #[test]
    fn the_bridge_plan_crosses_the_channel_and_its_password_is_read_off_the_owner_thread() {
        use pistudiodesktop_engine::BridgePassword;

        let mut session = Session::new();
        let added = session.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080", "password": "pw"})).unwrap();
        session.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
        let (access, _worker) = running_owner(AppShell::new(session, process::native_services()));
        let plan = access.bridge_plan().unwrap();
        assert_eq!((plan.entry.as_str(), plan.url.as_str(), &plan.password), (added["id"].as_str().unwrap(), "10.0.0.2:8080", &BridgePassword::Stored));
        assert_eq!(access.bridge_password(&plan).unwrap().map(|p| p.expose().to_owned()), Some("pw".to_owned()));
        let relay = access.execute("daemon.add", json!({"kind": "relay", "name": "R", "pairingLink": LINK})).unwrap();
        access.execute("daemon.switch", json!({"id": relay["id"]})).unwrap();
        let plan = access.bridge_plan().unwrap();
        assert_eq!((plan.kind, plan.url.as_str(), &plan.password), (pistudiodesktop_model::Kind::Relay, "", &BridgePassword::Stored));
    }

    #[test]
    fn the_ssh_plan_and_the_remote_queue_cross_the_channel_and_the_secrets_are_read_off_the_owner_thread() {
        use pistudiodesktop_engine::{RemoteAction, RemoteRequest};
        use pistudiodesktop_model::RemoteState;

        let mut session = Session::new();
        let added = session
            .execute("daemon.add", json!({"kind": "ssh", "name": "S", "host": "box", "user": "me", "port": 2222, "jump": "j", "sshPassword": "PW-ssh"}))
            .unwrap();
        let (access, _worker) = running_owner(AppShell::new(session, Services::default()));
        assert_eq!(access.ssh_plan().unwrap_err(), "wrong_kind", "the local entry is current");
        access.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
        let plan = access.ssh_plan().unwrap();
        assert_eq!((plan.entry.as_str(), plan.url.as_str()), (added["id"].as_str().unwrap(), "ws://127.0.0.1:6767"));
        assert_eq!((plan.fields.host.as_str(), plan.fields.user.as_deref(), plan.fields.port), ("box", Some("me"), Some(2222)));
        assert_eq!((plan.fields.identity_file.as_deref(), plan.fields.jump.as_deref(), plan.fields.daemon_port), (None, Some("j"), 6767));
        assert_eq!((plan.has_ssh_password, plan.has_passphrase), (true, false));
        let secrets = access.ssh_secrets(&plan).unwrap();
        assert_eq!((secrets.ssh_password.map(|p| p.expose().to_owned()), secrets.passphrase), (Some("PW-ssh".to_owned()), None));

        assert!(access.remote_requests().is_empty());
        access.execute("daemon.remote.refresh", json!({})).unwrap();
        assert_eq!(access.remote_requests(), vec![RemoteRequest { entry: plan.entry.clone(), action: RemoteAction::Probe }]);
        assert!(access.remote_requests().is_empty());
        assert!(access.apply_remote(&plan.entry, RemoteState::Running));
        assert!(access.set_remote(&plan.entry, RemoteState::Stopped));
        let other = pistudiodesktop_model::EntryId::parse("3f2b8a40-1111-4222-8333-444455556666").unwrap();
        assert!(
            !access.apply_remote(&other, RemoteState::Running) && !access.set_remote(&other, RemoteState::Running),
            "an entry that is not current is refused"
        );
        let listed = access.execute("daemon.list", Value::Null).unwrap();
        assert_eq!(listed["remote"], json!({"state": "stopped"}));
        assert!(!listed.to_string().contains("PW-"));
    }

    #[test]
    fn a_stopped_channel_is_an_empty_batch_and_a_refused_request() {
        let (tx, rx) = channel();
        drop(rx);
        let access = OwnerAccess::new(tx, std::sync::Arc::new(MemoryStore::new()));
        assert_eq!(access.take(), Batch::default());
        assert_eq!(access.request("daemon.local.refresh"), Err("shutting_down".to_owned()));
        assert_eq!(access.resolve(), Err("internal"));
    }

    #[test]
    fn a_slow_start_on_the_runner_holds_up_neither_storage_writes_nor_other_requests() {
        use std::os::unix::fs::PermissionsExt as _;
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let version = dir.path().join("bin").join("versions").join("fake");
        std::fs::create_dir_all(&version).unwrap();
        let cli = version.join("pi-studio");
        std::fs::write(&cli, include_str!("../tests/fixtures/fake-pi-studio.sh")).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink("versions/fake", dir.path().join("bin").join("current")).unwrap();
        let mut session = Session::new();
        session.set_local_supported(true);
        session.execute("daemon.local.start", json!({})).unwrap();
        let (tx, rx) = channel();
        let store = session.secret_store();
        let mut app = AppShell::new(session, Services::default());
        let worker = std::thread::spawn(move || owner::serve(&mut app, &rx, Duration::from_secs(3600)));
        let env = vec![
            ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
            ("PI_STUDIO_HOME".to_owned(), dir.path().display().to_string()),
            ("FAKE_PI_DIR".to_owned(), dir.path().display().to_string()),
            ("FAKE_PI_MODE".to_owned(), "slow".to_owned()),
        ];
        let supervisor = std::sync::Arc::new(Supervisor::with_env(process::native_services(), Limits::default(), env));
        let access = OwnerAccess::new(tx.clone(), store);
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

    /// A store whose reads wait, as a keychain does while it shows a prompt.
    #[derive(Default)]
    struct SlowStore {
        inner: pistudiodesktop_secrets::MemoryStore,
        wait_ms: std::sync::atomic::AtomicU64,
    }

    impl SecretStore for SlowStore {
        fn kind(&self) -> pistudiodesktop_secrets::StoreKind {
            self.inner.kind()
        }

        fn get(&self, key: &SecretKey) -> Result<Option<pistudiodesktop_secrets::Secret>, SecretError> {
            std::thread::sleep(Duration::from_millis(self.wait_ms.load(std::sync::atomic::Ordering::SeqCst)));
            self.inner.get(key)
        }

        fn set(&self, key: &SecretKey, secret: &pistudiodesktop_secrets::Secret) -> Result<(), SecretError> {
            std::thread::sleep(Duration::from_millis(self.wait_ms.load(std::sync::atomic::Ordering::SeqCst)));
            self.inner.set(key, secret)
        }

        fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
            std::thread::sleep(Duration::from_millis(self.wait_ms.load(std::sync::atomic::Ordering::SeqCst)));
            self.inner.delete(key)
        }
    }

    #[test]
    fn a_store_that_blocks_for_3_s_holds_up_neither_storage_writes_nor_control_requests() {
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SlowStore::default());
        let (mut session, _) = Session::with_config_dir(dir.path(), store.clone());
        // A relay entry: its pairing link is the one item a dial still reads from the store.
        let added = session.execute("daemon.add", json!({"kind": "relay", "name": "R", "pairingLink": LINK})).unwrap();
        session.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
        // From here on every store call takes 3 s.
        store.wait_ms.store(3000, std::sync::atomic::Ordering::SeqCst);
        let (access, _worker) = running_owner(AppShell::new(session, Services::default()));
        let resolver = std::thread::spawn({
            let access = access.clone();
            move || {
                let started = Instant::now();
                (access.resolve(), started.elapsed())
            }
        });
        // The plan is answered at once; the resolver is now inside the store's read.
        std::thread::sleep(Duration::from_millis(300));
        let begun = Instant::now();
        access.call(Request::StorageSet { key: "pi-studio-appearance".into(), value: "dark".into() }).unwrap();
        let listed = access.execute("daemon.list", Value::Null).unwrap();
        assert!(begun.elapsed() < Duration::from_millis(100), "answered in {:?}", begun.elapsed());
        assert_eq!(listed["entries"].as_array().map(Vec::len), Some(2));
        let (dial, took) = resolver.join().unwrap();
        assert!(took >= Duration::from_millis(2900), "the read really blocked: {took:?}");
        assert_eq!(daemons::dial_for_page(dial.unwrap()).unwrap(), json!({"url": "ws://l", "connect": true}));
    }

    #[test]
    fn a_direct_entrys_dial_waits_for_no_store_read() {
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SlowStore::default());
        let (mut session, _) = Session::with_config_dir(dir.path(), store.clone());
        let added = session.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080", "password": "pw"})).unwrap();
        session.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
        store.wait_ms.store(3000, std::sync::atomic::Ordering::SeqCst);
        let (access, _worker) = running_owner(AppShell::new(session, Services::default()));
        let begun = Instant::now();
        assert_eq!(access.resolve(), Ok(Dial::Connect { url: "10.0.0.2:8080".into() }));
        assert!(begun.elapsed() < Duration::from_millis(500), "the page's dial read the store: {:?}", begun.elapsed());
    }

    #[test]
    fn add_update_and_remove_wait_for_a_slow_store_off_the_owner_thread() {
        use std::sync::atomic::Ordering::SeqCst;
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SlowStore::default());
        let (session, _) = Session::with_config_dir(dir.path(), store.clone());
        let (access, _worker) = running_owner(AppShell::new(session, Services::default()));
        let entries = |access: &OwnerAccess| access.execute("daemon.list", Value::Null).unwrap()["entries"].as_array().map(Vec::len).unwrap();
        store.wait_ms.store(600, SeqCst);

        // Add: the owner answers while the store call runs, the answer waits for it, the entry appears after.
        let adder = std::thread::spawn({
            let access = access.clone();
            move || {
                let started = Instant::now();
                (access.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080", "password": "MARK-pw"})), started.elapsed())
            }
        });
        std::thread::sleep(Duration::from_millis(200));
        let begun = Instant::now();
        access.call(Request::StorageSet { key: "pi-studio-appearance".into(), value: "dark".into() }).unwrap();
        assert_eq!(entries(&access), 1, "no entry before its secret is stored");
        assert!(begun.elapsed() < Duration::from_millis(100), "answered in {:?}", begun.elapsed());
        let (added, took) = adder.join().unwrap();
        let added = added.unwrap();
        assert!(took >= Duration::from_millis(550), "the store call really blocked: {took:?}");
        assert_eq!((added["hasPassword"].as_bool(), entries(&access)), (Some(true), 2));

        // Update through the page's request, clearing the password.
        let id = added["id"].clone();
        let (envelope, reply) = Envelope::new(Request::Engine { id: "daemon.update".into(), params: json!({"id": id, "password": null}) });
        access.requests.send(envelope).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let listed = access.execute("daemon.list", Value::Null).unwrap();
        assert_eq!(listed["entries"][1]["hasPassword"], true, "still claimed while the item is being deleted");
        let updated = reply.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!((updated["ok"].as_bool(), updated["result"]["hasPassword"].as_bool()), (Some(true), Some(false)), "{updated}");

        // Remove: the entry is gone at once (the file is written first), the answer follows the deletes.
        access.execute("daemon.update", json!({"id": id, "password": "MARK-again"})).unwrap();
        let remover = std::thread::spawn({
            let access = access.clone();
            let id = id.clone();
            move || access.execute("daemon.remove", json!({"id": id}))
        });
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(entries(&access), 1);
        assert_eq!(remover.join().unwrap().unwrap(), json!({"removed": true}));
        assert!(!std::fs::read_to_string(dir.path().join("daemons.json")).unwrap().contains("MARK"));
    }
}
