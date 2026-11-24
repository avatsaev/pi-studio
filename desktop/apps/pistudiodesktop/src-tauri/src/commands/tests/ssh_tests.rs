//! An SSH entry through Tauri's own IPC path with the app's real permissions: `transport_open`, the
//! transfer engine's connector and the remote commands share one SSH session, against the SSH server
//! of `pistudiodesktop-ssh`'s `testing` feature (in this process) and a daemon stand-in behind it.
//! The secrets, the host and the user appear in no answer and no log line.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use futures_util::{SinkExt as _, StreamExt as _};
use pistudiodesktop_model::EntryId;
use pistudiodesktop_secrets::{MemoryStore, SecretStore};
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::remote_supervisor::{RemoteLimits, RemoteSupervisor};
use pistudiodesktop_shell::resume::{Reason, ResumeSignals};
use pistudiodesktop_shell::services::{Archive, ArchiveSource, FetchFailure};
use pistudiodesktop_shell::supervisor::{Limits, Supervisor};
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use pistudiodesktop_shell::{Request, Services};
use pistudiodesktop_ssh::testing::{Behavior, Exec, Server, Wire, ed25519, shell, write_key};
use pistudiodesktop_ssh::{Limits as SshLimits, known_hosts};
use serde_json::{Value, json};
use tauri::test::MockRuntime;
use tauri::{App, Manager as _, WebviewWindow, WebviewWindowBuilder};
use tokio_tungstenite::tungstenite::Message;

use super::transport_tests::{Daemon, Page, capture_logs, connect_page, logged, wait_until};
use super::{built_app_ssh, invoke};
use crate::bridge::{Bridge, Launch, idle_update};
use crate::daemons::{Events, RemoteOwner, start_runner};
use crate::ssh_session::{SshEnv, SshSessions};
use crate::transport::origin_of;

/// A user and a password nobody would pick: if either appears anywhere but the SSH login, it leaked.
const USER: &str = "marker-user-7c1e";
const SSH_PASSWORD: &str = "MARKER-ssh-pw-41d9";
const DAEMON_PASSWORD: &str = "MARKER-daemon-pw-9a3b";
/// What the host's installed `pi-studio --version` prints, and the folder it is installed in.
const CLI_VERSION: &str = "0.0.130";
const HOST_FOLDER: &str = "/home/host/.pi-studio";
/// The seeds of the keys: the host's, the one the server accepts, and one it does not.
const HOST_SEED: u8 = 100;
const GOOD_SEED: u8 = 1;
const BAD_SEED: u8 = 2;

/// What differs between the tests' apps.
#[derive(Clone)]
struct Options {
    /// The port the entry names for its daemon: the stand-in's, unless a test wants one that is closed.
    daemon_port: Option<u16>,
    /// Whether the key file of the entry is one the server accepts.
    authorized: bool,
    /// Whether the app's known hosts already hold the server's key.
    trusted: bool,
    /// The entry's SSH password, when it has one.
    ssh_password: Option<&'static str>,
    /// The password the server accepts, when it accepts one.
    server_password: Option<&'static str>,
    /// How long a session lives without a channel.
    idle: Duration,
    /// The keepalive of the connect; `None` is the default 15 s and three.
    keepalive: Option<Duration>,
    /// Put a silenceable wire between the app and the server.
    wired: bool,
    /// What the confirmation dialog answers, when there is one: `Some(true)` is Trust.
    answer: Option<bool>,
    /// Whether nothing is installed on the host: its facts report no binary.
    bare: bool,
    /// The version the daemon reports on `/api/health` (what the app reads over the session), when it can be read.
    daemon_version: Option<&'static str>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            daemon_port: None,
            authorized: true,
            trusted: true,
            ssh_password: None,
            server_password: None,
            idle: Duration::from_secs(3600),
            keepalive: None,
            wired: false,
            answer: None,
            bare: false,
            daemon_version: None,
        }
    }
}

/// What the pinned archive holds in these tests: bytes the stand-in host takes without looking.
const ARCHIVE: &[u8] = &[7_u8; 600 * 1024];

/// The pinned archive of every target: one file on the app's disk.
struct ServedArchive {
    path: PathBuf,
    size: u64,
}

impl ArchiveSource for ServedArchive {
    fn version(&self) -> &str {
        "0.0.200"
    }

    fn fetch(&self, _target: &str, _progress: &mut dyn FnMut(u64, u64)) -> Result<Archive, FetchFailure> {
        Ok(Archive { path: self.path.clone(), size: self.size, sha256: "ab".repeat(32) })
    }
}

/// A port nothing listens on.
fn closed_port() -> u16 {
    let listener = tauri::async_runtime::block_on(tokio::net::TcpListener::bind("127.0.0.1:0")).unwrap();
    listener.local_addr().unwrap().port()
}

struct Fixture {
    config: tempfile::TempDir,
    work: tempfile::TempDir,
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    server: Server,
    wire: Option<Wire>,
    daemon: Daemon,
    ssh: SshSessions,
    entry: String,
    origin: String,
    /// What the page derives from the entry: the daemon's loopback address on the host.
    url: String,
    /// How many Starts left the daemon running (what makes the page connect again).
    started: Arc<AtomicUsize>,
    picks: Arc<Mutex<Vec<PathBuf>>>,
    /// What the confirmation dialog was shown with.
    questions: Arc<Mutex<Vec<String>>>,
    /// How often the page was told to connect again after a host key was trusted.
    resumed: Arc<AtomicUsize>,
}

impl Fixture {
    fn new(options: &Options) -> Fixture {
        capture_logs();
        let (config, work) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let home = config.path().join("home");
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        let daemon = Daemon::start_with_version(None, options.daemon_version);
        let daemon_port = options.daemon_port.unwrap_or(daemon.port);

        // The server: logs in the one key, runs `pi-studio`, forwards to the daemon stand-in.
        let host_key = ed25519(HOST_SEED);
        let mut behavior = Behavior::new(host_key.clone(), USER);
        behavior.keys = vec![ed25519(GOOD_SEED).public_key().clone()];
        behavior.password = options.server_password.map(str::to_owned);
        let bare = options.bare;
        let marked = shell(move |command| match command {
            // The facts script: Linux on x86_64 with glibc, the app's binary installed at `CLI_VERSION` (or not at all).
            facts if facts.contains("pi-studio-fact:os") => {
                let version = if bare { "" } else { CLI_VERSION };
                let text = format!(
                    "pi-studio-fact:os=Linux\npi-studio-fact:cpu=x86_64\npi-studio-fact:musl=0\npi-studio-fact:dir={HOST_FOLDER}\npi-studio-fact:ver={version}\n"
                );
                (text.into_bytes(), 0)
            }
            start if start == format!("'{HOST_FOLDER}/bin/current/pi-studio' --json -H 127.0.0.1:{daemon_port} daemon start") => {
                (format!("{{\"up\":true,\"host\":\"127.0.0.1\",\"port\":{daemon_port}}}\n").into_bytes(), 0)
            }
            // The install's own steps (the folder, the check, the unpack, the prune) succeed on this host.
            step if step.contains("-mmin") || step.contains("wc -c") || step.contains("tar -xzf") || step.contains("readlink") => (Vec::new(), 0),
            _ => (Vec::new(), 127),
        });
        // The send's `cat` takes the archive on its standard input, as `/bin/sh -c 'cat > path'` does.
        behavior.exec = Some(Arc::new(move |line| if line.starts_with("/bin/sh -c ") { Exec::Receive { status: 0 } } else { marked(line) }));
        let server = tauri::async_runtime::block_on(Server::start(behavior)).unwrap();
        let wire = options.wired.then(|| tauri::async_runtime::block_on(Wire::start(server.addr())).unwrap());
        let port = wire.as_ref().map_or_else(|| server.port(), |wire| wire.addr().port());

        let key_file = home.join("id_test");
        write_key(&key_file, &ed25519(if options.authorized { GOOD_SEED } else { BAD_SEED })).unwrap();
        let app_known_hosts = config.path().join("known_hosts");
        if options.trusted {
            known_hosts::trust("127.0.0.1", port, host_key.public_key(), &app_known_hosts).unwrap();
        }
        let limits =
            options.keepalive.map_or_else(SshLimits::default, |interval| SshLimits { keepalive_interval: interval, keepalive_max: 2, ..SshLimits::default() });
        let questions = Arc::new(Mutex::new(Vec::new()));
        let resumed = Arc::new(AtomicUsize::new(0));
        let mut asking = Services::default();
        if let Some(answer) = options.answer {
            let asked = Arc::clone(&questions);
            asking.confirm = Some(Arc::new(move |message: &str| {
                asked.lock().unwrap().push(message.to_owned());
                answer
            }));
        }
        let counted = Arc::clone(&resumed);
        let env = SshEnv::fixed(home, app_known_hosts, Vec::new()).asking(asking).on_trusted(Arc::new(move || {
            counted.fetch_add(1, Ordering::SeqCst);
        }));
        let ssh = SshSessions::with(env, options.idle, limits);

        let store = Arc::new(MemoryStore::new());
        let as_store: Arc<dyn SecretStore> = Arc::clone(&store) as Arc<dyn SecretStore>;
        let started = Arc::new(AtomicUsize::new(0));
        let picks = Arc::new(Mutex::new(Vec::new()));
        let for_picks = Arc::clone(&picks);
        let archive = work.path().join("pi-studio-linux-x64.tar.gz");
        std::fs::write(&archive, ARCHIVE).unwrap();
        let archives = ServedArchive { path: archive, size: ARCHIVE.len() as u64 };
        let services = Services {
            pick_files: Some(Arc::new(move |_| std::mem::take(&mut *for_picks.lock().unwrap()))),
            archives: Some(Arc::new(archives)),
            ..Services::default()
        };
        let (for_launch, for_started, for_store) = (ssh.clone(), Arc::clone(&started), Arc::clone(&as_store));
        let app = built_app_ssh(
            config.path(),
            services,
            move |requests, services| {
                // As `main` starts them: the runner for the remote daemon's requests, the events that end an edited entry's session.
                let supervisor = Arc::new(Supervisor::new(services.clone(), Limits::default()));
                let remote = RemoteSupervisor::new(services.clone(), RemoteLimits::default());
                let counted = Arc::clone(&for_started);
                let owner = RemoteOwner::new(OwnerAccess::new(requests.clone(), Arc::clone(&for_store)), for_launch.clone(), move || {
                    counted.fetch_add(1, Ordering::SeqCst);
                });
                let wake = start_runner(requests.clone(), Arc::clone(&for_store), supervisor, remote, owner);
                Launch {
                    notify: Box::new(Events::new(|_| {}, wake).closing(for_launch)),
                    local_supported: false,
                    notices: Vec::new(),
                    resume: Arc::new(ResumeSignals::new()),
                    transfers: TransfersMode::Engine,
                    update: idle_update(),
                }
            },
            as_store,
            ssh.clone(),
        );
        let window = WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default()).build().unwrap();
        let mut params = json!({
            "kind": "ssh", "name": "S", "host": "127.0.0.1", "user": USER, "port": port,
            "identityFile": key_file.display().to_string(), "daemonPort": daemon_port,
        });
        if let Some(password) = options.ssh_password {
            params["sshPassword"] = json!(password);
        }
        params["password"] = json!(DAEMON_PASSWORD);
        let added = invoke(&window, "engine_command", json!({"id": "daemon.add", "params": params})).unwrap();
        let entry = added["id"].as_str().unwrap().to_owned();
        let origin = origin_of(&window.url().unwrap()).unwrap();
        let url = format!("ws://127.0.0.1:{daemon_port}");
        let fixture = Fixture { config, work, app, window, server, wire, daemon, ssh, entry: entry.clone(), origin, url, started, picks, questions, resumed };
        fixture.make_current(&entry);
        fixture
    }

    /// What the control socket does: switch without the page's confirm and reload.
    fn make_current(&self, id: &str) {
        let switch = Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": id}}) };
        assert_eq!(tauri::async_runtime::block_on(self.app.state::<Bridge>().ask(switch)).unwrap()["ok"], true);
    }

    fn open(&self) -> Result<String, Value> {
        invoke(&self.window, "transport_open", json!({"url": self.url})).map(|answer| answer["localUrl"].as_str().unwrap().to_owned())
    }

    /// The port the app dials: the wire's when there is one, else the server's.
    fn port(&self) -> u16 {
        self.wire.as_ref().map_or_else(|| self.server.port(), |wire| wire.addr().port())
    }

    fn connect(&self, local_url: &str) -> Page {
        tauri::async_runtime::block_on(connect_page(local_url, &self.origin)).unwrap().0
    }

    fn inspect(&self) -> Value {
        let ask = Request::Control { method: "ui.inspect".into(), params: Value::Null };
        tauri::async_runtime::block_on(self.app.state::<Bridge>().ask(ask)).unwrap()["result"].clone()
    }

    fn remote(&self) -> Value {
        invoke(&self.window, "engine_command", json!({"id": "daemon.list"})).unwrap()["remote"].clone()
    }

    /// How many SSH connections the server has taken.
    fn connections(&self) -> usize {
        self.server.seen().connections
    }

    /// An upload of a small file: the engine opens its connection for it, on a thread of its own.
    fn upload(&self, id: &str) -> JoinHandle<Result<Value, Value>> {
        let file = self.work.path().join("up.bin");
        std::fs::write(&file, b"ssh bytes").unwrap();
        *self.picks.lock().unwrap() = vec![file];
        let handle = invoke(&self.window, "upload_pick", json!({})).unwrap()[0]["handle"].as_str().unwrap().to_owned();
        let (window, id) = (self.window.clone(), id.to_owned());
        std::thread::spawn(move || invoke(&window, "transfer_upload", json!({"id": id, "handle": handle, "path": "/srv/up.bin"})))
    }

    /// The machine woke: the engine's wait before its next attempt ends.
    fn wake(&self) {
        assert!(crate::resume::emit(self.app.handle(), &ResumeSignals::new(), Reason::Wake, 1_000_000));
    }
}

fn code_of<T: std::fmt::Debug>(refused: &Result<T, Value>) -> String {
    refused.as_ref().unwrap_err()["code"].as_str().unwrap().to_owned()
}

/// Wait for the Daemons screen's remote state to be `state`; a miss says what it was and what the app logged last.
fn wait_remote(f: &Fixture, state: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while f.remote() != json!({ "state": state }) {
        let tail: Vec<String> = logged().lines().rev().take(30).map(str::to_owned).collect();
        assert!(Instant::now() < deadline, "the remote state is {} and not {state}; the log ends:\n{}", f.remote(), tail.join("\n"));
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn settled(upload: JoinHandle<Result<Value, Value>>) -> Result<Value, Value> {
    wait_until("the upload settled", || upload.is_finished());
    upload.join().unwrap()
}

/// Nothing that identifies the user, the host or a secret is in the log.
fn assert_nothing_leaked(f: &Fixture) {
    let log = logged();
    let key_file = f.config.path().join("home").join("id_test").display().to_string();
    for secret in [USER, SSH_PASSWORD, DAEMON_PASSWORD, key_file.as_str(), CLI_VERSION] {
        assert!(!log.contains(secret), "the log holds {} bytes of a secret", secret.len());
    }
}

// ---- one session for the page and the engine

#[test]
fn an_ssh_entry_is_opened_through_the_session_and_the_pages_messages_reach_the_daemon_with_its_password() {
    let f = Fixture::new(&Options::default());
    assert_eq!(invoke(&f.window, "daemon_resolve_current", json!({})).unwrap(), json!({"url": f.url, "connect": true}));
    let local = f.open().unwrap();
    assert_eq!(f.server.seen().forwards, [("127.0.0.1".to_owned(), f.daemon.port)]);
    f.daemon.wait_for("0:open");
    assert_eq!(f.daemon.offered(), vec![Some(format!("pi-studio.bearer.{DAEMON_PASSWORD}"))], "the daemon's own password, as a direct entry offers it");
    let mut page = f.connect(&local);
    tauri::async_runtime::block_on(async {
        page.send(Message::text("héllo")).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::text("héllo"));
        let bytes = vec![0_u8, 1, 2, 255, 254];
        page.send(Message::binary(bytes.clone())).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::binary(bytes));
    });
    // The daemon was reached: the app's own look at it (a probe) gives the Daemons screen its state.
    wait_remote(&f, "running");
    assert!(f.ssh.seen_up(&EntryId::parse(&f.entry).unwrap()));
    // Neither answer the page sees holds a secret.
    let seen_by_page = [
        invoke(&f.window, "boot", json!({})).unwrap().to_string(),
        invoke(&f.window, "engine_command", json!({"id": "daemon.list"})).unwrap().to_string(),
        f.inspect().to_string(),
        local,
    ];
    for text in seen_by_page {
        // The user and the host are the entry's own fields, which the Daemons screen shows; the secrets are not.
        for secret in [SSH_PASSWORD, DAEMON_PASSWORD] {
            assert!(!text.contains(secret), "a secret reached the page");
        }
    }
    assert_nothing_leaked(&f);
}

#[test]
fn a_daemon_older_than_the_minimum_that_the_page_reaches_is_outdated_not_running() {
    let f = Fixture::new(&Options { daemon_version: Some("0.0.100"), ..Options::default() });
    let local = f.open().unwrap();
    let _page = f.connect(&local);
    let deadline = Instant::now() + Duration::from_secs(10);
    while f.remote() != json!({ "state": "outdated", "version": "0.0.100" }) {
        assert!(Instant::now() < deadline, "the remote state is {} and not outdated 0.0.100", f.remote());
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_nothing_leaked(&f);
}

#[test]
fn two_opens_at_once_share_one_connection_attempt_and_a_third_reuses_the_session() {
    let f = Fixture::new(&Options::default());
    let opens: Vec<_> = (0..2)
        .map(|_| {
            let (window, url) = (f.window.clone(), f.url.clone());
            std::thread::spawn(move || invoke(&window, "transport_open", json!({"url": url})))
        })
        .collect();
    for open in opens {
        assert!(open.join().unwrap().is_ok());
    }
    assert!(f.open().is_ok());
    // The daemon's first answer makes the app read its version over the session: one more channel, after the three.
    wait_remote(&f, "running");
    assert_eq!(f.connections(), 1, "one SSH connection for every channel");
    assert_eq!(f.server.seen().forwards.len(), 4, "the page's three and the app's one read of the version");
    assert!(f.ssh.is_open());
}

#[test]
fn the_page_and_the_engine_use_the_same_connection() {
    let f = Fixture::new(&Options::default());
    let local = f.open().unwrap();
    let _page = f.connect(&local);
    let upload = f.upload("both-1");
    wait_until("the engine's channel", || f.server.seen().forwards.len() == 2);
    // The stand-in is no daemon: the upload ends however it ends.
    let _ = invoke(&f.window, "transfer_cancel", json!({"id": "both-1"}));
    let _ = settled(upload);
    assert_eq!(f.connections(), 1);
}

// ---- when the session ends

#[test]
fn a_session_with_no_channel_is_closed_after_the_idle_time_and_the_next_open_dials_again() {
    let idle = Duration::from_millis(400);
    let f = Fixture::new(&Options { idle, ..Options::default() });
    let local = f.open().unwrap();
    let mut page = f.connect(&local);
    // A channel is open: the session outlives the idle time.
    std::thread::sleep(idle * 3);
    assert!(f.ssh.is_open());
    tauri::async_runtime::block_on(async {
        page.close(None).await.unwrap();
        while let Some(Ok(_)) = page.next().await {}
    });
    drop(page);
    wait_until("the idle session is closed", || !f.ssh.is_open());
    assert_eq!(f.connections(), 1);
    assert!(f.open().is_ok());
    assert_eq!(f.connections(), 2, "the next open redials");
}

#[test]
fn a_session_that_was_opened_and_never_used_is_closed_too() {
    let idle = Duration::from_millis(300);
    let f = Fixture::new(&Options { idle, daemon_port: Some(closed_port()), ..Options::default() });
    assert_eq!(code_of(&f.open()), "daemon_not_running");
    wait_until("the session is closed", || !f.ssh.is_open());
}

#[test]
fn a_daemon_switch_closes_the_session_and_coming_back_opens_a_new_one() {
    let f = Fixture::new(&Options::default());
    let local = f.open().unwrap();
    let _page = f.connect(&local);
    let other = invoke(&f.window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "D", "address": "127.0.0.1:1"}})).unwrap();
    assert_eq!(invoke(&f.window, "daemon_switch", json!({"id": other["id"]})).unwrap(), Value::Null);
    assert!(!f.ssh.is_open(), "the switch closed the session");
    f.make_current(&f.entry);
    assert!(f.open().is_ok());
    assert_eq!(f.connections(), 2);
}

#[test]
fn editing_the_entry_closes_its_session_and_the_next_open_uses_the_new_values() {
    let f = Fixture::new(&Options::default());
    assert!(f.open().is_ok());
    assert!(f.ssh.is_open());
    invoke(&f.window, "engine_command", json!({"id": "daemon.update", "params": {"id": f.entry, "name": "Renamed"}})).unwrap();
    wait_until("the edit closed the session", || !f.ssh.is_open());
    assert!(f.open().is_ok());
    assert_eq!(f.connections(), 2);
}

#[test]
fn a_connection_that_stops_answering_is_dropped_by_the_keepalive_and_the_next_open_redials() {
    let f = Fixture::new(&Options { keepalive: Some(Duration::from_millis(100)), wired: true, ..Options::default() });
    assert!(f.open().is_ok());
    assert!(f.ssh.is_open());
    f.wire.as_ref().unwrap().cut();
    wait_until("the keepalive ended the session", || !f.ssh.is_open());
}

// ---- the failures and what the engine does with them

#[test]
fn a_daemon_nobody_listens_to_is_daemon_not_running_and_asks_the_host_once() {
    let f = Fixture::new(&Options { daemon_port: Some(closed_port()), ..Options::default() });
    let refused = f.open();
    assert_eq!(code_of(&refused), "daemon_not_running");
    assert!(refused.unwrap_err()["message"].as_str().unwrap().contains("Start it in Daemons"));
    // The probe ran over the same session: the CLI is there and the daemon is not up.
    wait_remote(&f, "stopped");
    let commands = f.server.seen().commands;
    assert_eq!(commands.iter().filter(|line| line.contains("pi-studio-fact:os")).count(), 1, "one probe: {}", commands.len());
    assert_eq!(f.connections(), 1);
    // Another refusal in the same outage is no new probe.
    assert_eq!(code_of(&f.open()), "daemon_not_running");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(f.server.seen().commands.len(), commands.len());
    assert_eq!(f.inspect()["connection"]["lastError"]["code"], "daemon_not_running");
}

#[test]
fn a_stopped_daemon_is_started_over_the_same_session_and_the_page_is_told_to_connect_again() {
    let f = Fixture::new(&Options { daemon_port: Some(closed_port()), ..Options::default() });
    assert_eq!(code_of(&f.open()), "daemon_not_running");
    wait_remote(&f, "stopped");
    assert_eq!(f.started.load(Ordering::SeqCst), 0, "a probe tells nobody to connect");
    invoke(&f.window, "engine_command", json!({"id": "daemon.remote.start", "params": {}})).unwrap();
    wait_remote(&f, "running");
    wait_until("the page was told", || f.started.load(Ordering::SeqCst) == 1);
    assert!(f.server.seen().commands.iter().any(|line| line.contains("daemon start")));
    assert_eq!(f.connections(), 1, "the probe and the start ran over the session the refused open made");
    assert_nothing_leaked(&f);
}

#[test]
fn an_install_sends_the_archive_over_the_session_the_page_uses_and_ends_with_the_daemon_running() {
    let f = Fixture::new(&Options { daemon_port: Some(closed_port()), bare: true, ..Options::default() });
    // The refused open asked the host once: nothing is installed on it.
    assert_eq!(code_of(&f.open()), "daemon_not_running");
    wait_remote(&f, "not_installed");
    // Start has no binary to start.
    let refused = invoke(&f.window, "engine_command", json!({"id": "daemon.remote.start", "params": {}}));
    assert!(refused.unwrap_err().to_string().contains("not_installed"));
    invoke(&f.window, "engine_command", json!({"id": "daemon.remote.install", "params": {}})).unwrap();
    wait_remote(&f, "running");
    wait_until("the page was told", || f.started.load(Ordering::SeqCst) == 1);
    let seen = f.server.seen();
    // The archive reached the host's `cat` byte for byte, in one channel of the same connection, under `bin/tmp`.
    assert_eq!(seen.received.len(), 1);
    assert!(seen.received[0] == ARCHIVE, "the host got other bytes than were sent");
    let sends: Vec<&String> = seen.commands.iter().filter(|line| line.starts_with("/bin/sh -c ")).collect();
    assert!(sends.len() == 1 && sends[0].contains(&format!("{HOST_FOLDER}/bin/tmp/")) && sends[0].contains(".tar.gz"), "{sends:?}");
    // The host's steps, in order: facts, the folder, the check, the unpack, the start by the installed binary, the prune.
    let steps: Vec<&str> = seen
        .commands
        .iter()
        .filter_map(|line| match line {
            line if line.contains("pi-studio-fact:os") => Some("facts"),
            line if line.contains("-mmin") => Some("prepare"),
            line if line.starts_with("/bin/sh -c ") => Some("send"),
            line if line.contains("wc -c") => Some("check"),
            line if line.contains("tar -xzf") => Some("unpack"),
            line if line.contains("daemon start") => Some("start"),
            line if line.contains("readlink") => Some("prune"),
            _ => None,
        })
        .collect();
    assert_eq!(steps.iter().skip_while(|step| **step != "prepare").copied().collect::<Vec<_>>(), ["prepare", "send", "check", "unpack", "start", "prune"]);
    assert_eq!(f.connections(), 1, "everything ran over one session");
    assert_nothing_leaked(&f);
}

#[test]
fn a_start_that_leaves_the_daemon_running_tells_the_page_to_connect_again() {
    let f = Fixture::new(&Options::default());
    invoke(&f.window, "engine_command", json!({"id": "daemon.remote.start", "params": {}})).unwrap();
    wait_remote(&f, "running");
    wait_until("the page was told", || f.started.load(Ordering::SeqCst) == 1);
    let commands = f.server.seen().commands;
    assert!(commands.iter().any(|line| line.contains("pi-studio-fact:os")), "the host's facts were read first");
    // The installed binary by its absolute path (the wrapped line holds its quotes escaped).
    assert!(
        commands.iter().any(
            |line| line.contains(&format!("{HOST_FOLDER}/bin/current/pi-studio")) && line.contains(&format!("-H 127.0.0.1:{} daemon start", f.daemon.port))
        )
    );
    assert_eq!(f.connections(), 1, "the commands ran over one session");
    assert_nothing_leaked(&f);
}

#[test]
fn a_refused_login_is_auth_failed_and_names_what_was_tried_and_no_secret() {
    let f = Fixture::new(&Options { authorized: false, ssh_password: Some(SSH_PASSWORD), ..Options::default() });
    // The key is refused and the stored password is not the server's.
    let refused = f.open();
    assert_eq!(code_of(&refused), "auth_failed");
    let message = refused.unwrap_err()["message"].as_str().unwrap().to_owned();
    assert!(message.contains("key file id_test") && message.contains("password"), "{message}");
    assert!(!message.contains(SSH_PASSWORD) && !message.contains(USER));
    assert_nothing_leaked(&f);
}

#[test]
fn an_unknown_host_key_fails_at_once_with_host_key_unknown_and_a_changed_one_is_refused() {
    let f = Fixture::new(&Options { trusted: false, ..Options::default() });
    let refused = f.open();
    assert_eq!(code_of(&refused), "host_key_unknown");
    assert!(refused.unwrap_err()["message"].as_str().unwrap().contains("not known"));
    assert_eq!(f.connections(), 1);
    // The key of another server is in the app's file for this host: that is a change, not news.
    let other = ed25519(HOST_SEED + 1);
    let entry = f.config.path().join("known_hosts");
    let port = f.wire.as_ref().map_or_else(|| f.server.port(), |wire| wire.addr().port());
    known_hosts::trust("127.0.0.1", port, other.public_key(), &entry).unwrap();
    let changed = f.open();
    assert_eq!(code_of(&changed), "host_key_changed");
    assert!(changed.unwrap_err()["message"].as_str().unwrap().contains("known_hosts"));
}

/// The question the confirm hook was shown, and how the page was told to connect again.
fn questions(f: &Fixture) -> Vec<String> {
    f.questions.lock().unwrap().clone()
}

fn app_known_hosts(f: &Fixture) -> PathBuf {
    f.config.path().join("known_hosts")
}

#[test]
fn trusting_an_unknown_host_key_stores_it_tells_the_page_to_connect_again_and_the_next_open_works() {
    let f = Fixture::new(&Options { trusted: false, answer: Some(true), ..Options::default() });
    assert_eq!(code_of(&f.open()), "host_key_unknown", "the connect itself never waits for the person");
    wait_until("the host key was trusted", || f.resumed.load(Ordering::SeqCst) == 1);
    let shown = questions(&f);
    assert_eq!(shown.len(), 1, "{shown:?}");
    let key = ed25519(HOST_SEED);
    let described = known_hosts::describe(key.public_key());
    for part in ["127.0.0.1", &f.port().to_string(), described.algorithm.as_str(), described.fingerprint.as_str()] {
        assert!(shown[0].contains(part), "{} is not in the question: {}", part.len(), shown[0]);
    }
    assert!(!shown[0].contains("jump host"), "the final host is not a jump host");
    assert!(!shown[0].contains(USER) && !shown[0].contains(SSH_PASSWORD) && !shown[0].contains(DAEMON_PASSWORD));
    let stored = known_hosts::check("127.0.0.1", f.port(), key.public_key(), &[&app_known_hosts(&f)]).unwrap();
    assert_eq!(stored, known_hosts::HostKeyStatus::Known, "the key is in the app's file");
    // The page connects again, as it does on that signal, and gets through.
    let local_url = f.open().expect("the key is trusted now");
    drop(f.connect(&local_url));
    assert_eq!(questions(&f).len(), 1, "a trusted key is not asked about again");
    assert_nothing_leaked(&f);
}

#[test]
fn a_cancelled_question_is_not_asked_again_until_the_page_loads_again_and_nothing_is_stored() {
    let f = Fixture::new(&Options { trusted: false, answer: Some(false), ..Options::default() });
    assert_eq!(code_of(&f.open()), "host_key_unknown");
    wait_until("the refusal is remembered", || f.ssh.refused_keys() == 1);
    for _ in 0..2 {
        assert_eq!(code_of(&f.open()), "host_key_unknown");
    }
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(questions(&f).len(), 1, "one question per key");
    assert_eq!(f.resumed.load(Ordering::SeqCst), 0);
    assert!(!app_known_hosts(&f).exists(), "Cancel stores nothing");
    // A reloaded page asks `boot`: the refusal is forgotten there.
    invoke(&f.window, "boot", json!({})).unwrap();
    assert_eq!(f.ssh.refused_keys(), 0);
    assert_eq!(code_of(&f.open()), "host_key_unknown");
    wait_until("the second question", || questions(&f).len() == 2);
}

#[test]
fn switching_daemons_forgets_a_refused_key_too() {
    let f = Fixture::new(&Options { trusted: false, answer: Some(false), ..Options::default() });
    assert_eq!(code_of(&f.open()), "host_key_unknown");
    wait_until("the refusal is remembered", || f.ssh.refused_keys() == 1);
    tauri::async_runtime::block_on(f.ssh.close());
    assert_eq!(f.ssh.refused_keys(), 0);
}

#[test]
fn a_changed_host_key_is_refused_with_no_question() {
    let f = Fixture::new(&Options { trusted: false, answer: Some(true), ..Options::default() });
    known_hosts::trust("127.0.0.1", f.port(), ed25519(HOST_SEED + 1).public_key(), &app_known_hosts(&f)).unwrap();
    assert_eq!(code_of(&f.open()), "host_key_changed");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(questions(&f), Vec::<String>::new());
    assert_eq!(f.resumed.load(Ordering::SeqCst), 0);
}

#[test]
fn without_a_dialog_an_unknown_key_is_a_refusal() {
    let f = Fixture::new(&Options { trusted: false, ..Options::default() });
    assert_eq!(code_of(&f.open()), "host_key_unknown");
    wait_until("the refusal is remembered", || f.ssh.refused_keys() == 1);
    assert!(!app_known_hosts(&f).exists());
}

// ---- the list of the config's hosts

#[test]
fn the_page_lists_the_plain_hosts_of_the_config_and_nothing_else_of_it() {
    let f = Fixture::new(&Options::default());
    let config = f.config.path().join("home").join(".ssh").join("config");
    assert_eq!(invoke(&f.window, "ssh_config_hosts", json!({})).unwrap(), json!({"hosts": []}), "an absent file lists nothing");
    std::fs::write(
        &config,
        "Host alpha\n  HostName a.example.com\n  User deploy\n  Port 2222\n  IdentityFile /keys/alpha\n  ProxyJump bastion\nHost web-*\n  User wild\nHost beta\n",
    )
    .unwrap();
    let listed = invoke(&f.window, "ssh_config_hosts", json!({})).unwrap();
    assert_eq!(
        listed,
        json!({"hosts": [
            {"alias": "alpha", "hostName": "a.example.com", "user": "deploy", "port": 2222, "identityFile": "/keys/alpha", "jump": "bastion"},
            {"alias": "beta"}
        ]}),
        "in file order, without the wildcard block"
    );
    std::fs::write(&config, "Host a\n  Port 22\n  Port not-a-number\n").unwrap();
    let refused = invoke(&f.window, "ssh_config_hosts", json!({}));
    assert_eq!(code_of(&refused), "ssh_config");
    assert_eq!(f.connections(), 0, "listing the hosts opens nothing");
}

// ---- what `ui.inspect` shows

#[test]
fn inspect_shows_how_the_connection_goes_and_the_session_as_counts_and_nothing_that_identifies() {
    let f = Fixture::new(&Options::default());
    assert_eq!(f.inspect()["connection"]["ssh"], json!({"state": "none", "hops": 0, "channels": 0}));
    let local_url = f.open().unwrap();
    let _page = f.connect(&local_url);
    wait_until("the transport is open", || f.inspect()["connection"]["transports"][0]["state"] == "open");
    // The daemon's first answer makes the app read its version over the session, on a channel of its own for a moment.
    wait_remote(&f, "running");
    let seen = f.inspect();
    let connection = &seen["connection"];
    assert_eq!(connection["transports"][0]["via"], "ssh", "{connection}");
    assert_eq!(connection["transports"][0]["entryId"], f.entry.as_str());
    assert_eq!(connection["ssh"], json!({"state": "open", "hops": 0, "channels": 1}), "{connection}");
    let text = connection.to_string();
    for identifying in [USER, "127.0.0.1", "SHA256", SSH_PASSWORD, DAEMON_PASSWORD, "id_test"] {
        assert!(!text.contains(identifying), "{identifying} is in {text}");
    }
}

#[test]
fn the_engine_retries_daemon_not_running_and_a_wake_ends_the_wait() {
    let f = Fixture::new(&Options { daemon_port: Some(closed_port()), ..Options::default() });
    let upload = f.upload("down-1");
    wait_until("the engine waits to try again", || f.inspect()["transfers"]["connection"]["state"] == "waiting");
    let waiting = f.inspect()["transfers"].clone();
    assert_eq!(waiting["lastError"]["code"], "daemon_not_running", "{waiting}");
    assert!(!upload.is_finished(), "a daemon that is not running is waited for");
    let first = f.server.seen().forwards.len();
    f.wake();
    wait_until("the second attempt", || f.server.seen().forwards.len() > first);
    assert_eq!(f.connections(), 1, "the retry used the session that was open");
    assert_eq!(invoke(&f.window, "transfer_cancel", json!({"id": "down-1"})).unwrap(), json!({"cancelled": true}));
    assert_eq!(code_of(&settled(upload)), "cancelled");
}

#[test]
fn the_engine_stops_at_auth_failed_and_does_not_try_again() {
    let f = Fixture::new(&Options { authorized: false, ..Options::default() });
    let failed = settled(f.upload("auth-1"));
    assert_eq!(code_of(&failed), "auth_failed", "{failed:?}");
    let ended = f.inspect()["transfers"].clone();
    assert_eq!((ended["connection"]["state"].as_str(), ended["totals"]["failed"].as_u64()), (Some("closed"), Some(1)), "{ended}");
    assert_eq!(ended["lastError"]["code"], "auth_failed");
    assert_eq!(f.connections(), 1);
}

#[test]
fn the_engine_stops_at_an_unknown_host_key_too() {
    let f = Fixture::new(&Options { trusted: false, ..Options::default() });
    assert_eq!(code_of(&settled(f.upload("key-1"))), "host_key_unknown");
    assert_eq!(f.connections(), 1);
}

#[test]
fn an_address_that_is_not_the_entrys_loopback_daemon_is_address_mismatch_and_nothing_is_dialled() {
    let f = Fixture::new(&Options::default());
    let port = f.daemon.port;
    for url in [
        format!("ws://127.0.0.1:{}", port.wrapping_add(1)),
        format!("ws://localhost:{port}"),
        format!("ws://example.com:{port}"),
        format!("wss://127.0.0.1:{port}"),
        String::new(),
    ] {
        let refused = invoke(&f.window, "transport_open", json!({"url": url}));
        assert_eq!(code_of(&refused), "address_mismatch", "{url}");
    }
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(f.connections(), 0);
}

#[test]
fn the_wrong_daemon_password_is_unauthorized_as_for_a_direct_entry_and_the_session_stays_open() {
    let f = Fixture::new(&Options::default());
    // The stand-in daemon asks for no password; point the entry at one that does.
    let guarded = Daemon::start(Some("another-password"));
    invoke(&f.window, "engine_command", json!({"id": "daemon.update", "params": {"id": f.entry, "daemonPort": guarded.port}})).unwrap();
    wait_until("the edit is in", || {
        invoke(&f.window, "daemon_resolve_current", json!({})).is_ok_and(|answer| answer["url"] == format!("ws://127.0.0.1:{}", guarded.port))
    });
    let refused = invoke(&f.window, "transport_open", json!({"url": format!("ws://127.0.0.1:{}", guarded.port)}));
    assert_eq!(code_of(&refused), "unauthorized");
    assert!(f.ssh.is_open());
}
