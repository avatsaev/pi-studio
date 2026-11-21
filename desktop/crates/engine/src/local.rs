//! The local daemon as the engine sees it: a queue of requests for the host to run, a busy flag
//! that lasts until the host hands back the outcome, and the answer to "what do I dial".
//!
//! The engine never starts a process. A command records what was asked; the host drains
//! [`Session::take_local_requests`], does the work and applies the new state with
//! [`Session::apply_local_outcome`].

use pistudiodesktop_model::{EntryId, EntryV2, Kind, LocalState, Secret};
use serde_json::{Value, json};

use crate::commands::{CommandSpec, always};
use crate::{EngineError, Result, Session};

/// What the host is asked to do, in the order it was accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalRequest {
    Start,
    Stop,
    Restart,
    Probe,
}

/// An action the user asked for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Action {
    Start,
    Stop,
    Restart,
    Refresh,
}

/// Requests waiting for the host, and whether an action is in flight.
#[derive(Default)]
pub(crate) struct LocalQueue {
    requests: Vec<LocalRequest>,
    busy: bool,
    refreshing: bool,
}

/// What to do to open the current entry.
#[derive(Clone, PartialEq, Eq)]
pub enum Dial {
    /// Connect to `url`. The password is the stored one; this answer is for the page that dials
    /// and must go nowhere else.
    Connect { url: String, password: Option<Secret> },
    /// The local daemon is stopped and the setting asks for it to be started first.
    StartNeeded,
    /// The local daemon is changing state; ask again when it has settled.
    Wait,
}

impl std::fmt::Debug for Dial {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Dial::Connect { url, password } => f.debug_struct("Connect").field("url", url).field("password", &password.as_ref().map(|_| "<secret>")).finish(),
            Dial::StartNeeded => f.write_str("StartNeeded"),
            Dial::Wait => f.write_str("Wait"),
        }
    }
}

/// What to dial, before a secret that lives in the store has been read. The session answers with
/// this because a store read may block (a keychain waits for the user), and the thread that
/// owns the session must keep answering; the caller finishes it where blocking is allowed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DialPlan {
    /// Nothing to read: the answer is final.
    Ready(Dial),
    /// Connect to `url` with the password of `entry`, which the store holds.
    Password { url: String, entry: EntryId },
    /// Connect to the pairing link of the relay entry `entry`, which the store holds.
    PairingLink { entry: EntryId },
}

#[cfg(not(target_arch = "wasm32"))]
impl DialPlan {
    /// Read what the plan needs from `store`. This may block until the user answers a system
    /// prompt: never call it on the thread that owns the session. `Err` is the code
    /// `resolveCurrent` rejects with: `secret_missing` when the store has no such item (it was
    /// removed behind the app's back), `secret_unavailable` when it could not be read.
    pub fn finish(self, store: &dyn pistudiodesktop_secrets::SecretStore) -> std::result::Result<Dial, &'static str> {
        use crate::secret::{Slot, key, read_code};
        Ok(match self {
            DialPlan::Ready(dial) => dial,
            DialPlan::Password { url, entry } => {
                let password = read_code(store.get(&key(&entry, Slot::Password)))?;
                Dial::Connect { url, password: Some(Secret::new(password.expose())) }
            }
            DialPlan::PairingLink { entry } => {
                let link = read_code(store.get(&key(&entry, Slot::PairingLink)))?;
                Dial::Connect { url: link.expose().to_owned(), password: None }
            }
        })
    }
}

impl Session {
    /// Whether a request is waiting for the host to take it.
    pub(crate) fn local_requests_waiting(&self) -> bool {
        !self.local_queue.requests.is_empty()
    }

    /// Record an action. `Err` is the code the command answers with.
    pub(crate) fn request_local(&mut self, action: Action) -> std::result::Result<(), &'static str> {
        match self.local_state() {
            LocalState::Unsupported => return Err("unsupported"),
            // Retry in the Daemons screen is a refresh, so a refresh goes through these two.
            LocalState::CliMissing { .. } if action != Action::Refresh => return Err("cli_missing"),
            LocalState::CliOutdated { .. } if action != Action::Refresh => return Err("cli_outdated"),
            _ => {}
        }
        let queue = &mut self.local_queue;
        if queue.busy {
            // A refresh while a refresh is pending merges into it.
            return if action == Action::Refresh && queue.refreshing { Ok(()) } else { Err("busy") };
        }
        queue.busy = true;
        queue.refreshing = action == Action::Refresh;
        let (request, state) = match action {
            Action::Start => (LocalRequest::Start, Some(LocalState::Starting)),
            Action::Restart => (LocalRequest::Restart, Some(LocalState::Starting)),
            Action::Stop => (LocalRequest::Stop, Some(LocalState::Stopping)),
            Action::Refresh => (LocalRequest::Probe, None),
        };
        queue.requests.push(request);
        if let Some(state) = state {
            self.set_local_state(state);
        }
        Ok(())
    }

    /// The requests accepted since the last call. The session stays busy until the outcome of
    /// each is applied.
    pub fn take_local_requests(&mut self) -> Vec<LocalRequest> {
        std::mem::take(&mut self.local_queue.requests)
    }

    /// Store the state the host reached for the request it ran, clear busy and mark the
    /// registry view as changed.
    pub fn apply_local_outcome(&mut self, state: LocalState) {
        self.local_queue.busy = false;
        self.local_queue.refreshing = false;
        self.set_local_state(state);
        self.mark_changed();
    }

    /// What to dial for the current entry, as far as the session can say without touching the
    /// secret store: when the entry has a secret the plan says which one and the caller reads it
    /// ([`DialPlan::finish`]) on a thread that may block. Not a command. `dial_address` builds the
    /// URL of a running local daemon from its host and port. `Err` is the code `resolveCurrent`
    /// rejects with.
    pub fn plan_dial(&self, dial_address: impl Fn(&str, u16) -> String) -> std::result::Result<DialPlan, &'static str> {
        let id = self.current_entry_id().ok_or("no_current")?;
        let entry = self.registry().get(id.as_str()).ok_or("no_current")?;
        match entry.kind {
            Kind::Direct => Ok(self.plan_connect(entry, entry.address.clone().ok_or("not_found")?)),
            Kind::Relay => Ok(match self.held_secret(&entry.id) {
                // The pairing link is the address: with the link held in memory there is nothing to read.
                Some(link) => DialPlan::Ready(Dial::Connect { url: link.expose().to_owned(), password: None }),
                None => DialPlan::PairingLink { entry: entry.id.clone() },
            }),
            Kind::Local => match self.local_state() {
                LocalState::Unsupported => Err("unsupported"),
                LocalState::CliMissing { .. } => Err("cli_missing"),
                LocalState::CliOutdated { .. } => Err("cli_outdated"),
                LocalState::Running { host, port } => Ok(self.plan_connect(entry, dial_address(host, *port))),
                LocalState::Stopped if self.settings().auto_start_local_daemon => Ok(DialPlan::Ready(Dial::StartNeeded)),
                LocalState::Stopped => Err("local_stopped"),
                LocalState::Failed { reason } => Err(reason.code()),
                LocalState::Checking | LocalState::Starting | LocalState::Stopping => Ok(DialPlan::Ready(Dial::Wait)),
            },
        }
    }

    /// Connect to `url` as `entry`: with its password when the registry says it has one.
    fn plan_connect(&self, entry: &EntryV2, url: String) -> DialPlan {
        if !entry.has_password {
            return DialPlan::Ready(Dial::Connect { url, password: None });
        }
        match self.held_secret(&entry.id) {
            Some(password) => DialPlan::Ready(Dial::Connect { url, password: Some(password.clone()) }),
            None => DialPlan::Password { url, entry: entry.id.clone() },
        }
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "daemon.local.start", label: "Start Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: start },
        CommandSpec { id: "daemon.local.stop", label: "Stop Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: stop },
        CommandSpec { id: "daemon.local.restart", label: "Restart Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: restart },
        CommandSpec { id: "daemon.local.refresh", label: "Refresh Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: refresh },
    ]
}

fn accept(s: &mut Session, action: Action) -> Result<Value> {
    s.request_local(action).map_err(|code| EngineError::Other(code.to_owned()))?;
    Ok(json!({"accepted": true}))
}

fn start(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, Action::Start)
}

fn stop(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, Action::Stop)
}

fn restart(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, Action::Restart)
}

fn refresh(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, Action::Refresh)
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_model::{FailReason, LocalState};
    use serde_json::json;

    use super::{Dial, LocalRequest};
    use crate::Session;

    fn ready() -> Session {
        let mut s = Session::new();
        s.set_local_state(LocalState::Stopped);
        s
    }

    fn code(s: &mut Session, id: &str) -> String {
        s.execute(id, json!({})).unwrap_err().to_string()
    }

    fn url(host: &str, port: u16) -> String {
        format!("ws://{host}:{port}")
    }

    #[test]
    fn start_queues_one_request_and_sets_starting() {
        let mut s = ready();
        assert_eq!(s.execute("daemon.local.start", json!({})).unwrap(), json!({"accepted": true}));
        assert_eq!(s.local_state(), &LocalState::Starting);
        assert_eq!(s.take_local_requests(), vec![LocalRequest::Start]);
        assert!(s.take_local_requests().is_empty());
    }

    #[test]
    fn stop_and_restart_set_their_states() {
        let mut s = ready();
        s.execute("daemon.local.stop", json!({})).unwrap();
        assert_eq!((s.local_state().clone(), s.take_local_requests()), (LocalState::Stopping, vec![LocalRequest::Stop]));
        s.apply_local_outcome(LocalState::Stopped);
        s.execute("daemon.local.restart", json!({})).unwrap();
        assert_eq!((s.local_state().clone(), s.take_local_requests()), (LocalState::Starting, vec![LocalRequest::Restart]));
    }

    #[test]
    fn refresh_leaves_the_state_and_merges() {
        let mut s = ready();
        let _ = s.take_registry_changed();
        s.execute("daemon.local.refresh", json!({})).unwrap();
        s.execute("daemon.local.refresh", json!({})).unwrap();
        assert_eq!(s.local_state(), &LocalState::Stopped);
        assert_eq!(s.take_local_requests(), vec![LocalRequest::Probe]);
        assert_eq!(code(&mut s, "daemon.local.start"), "busy");
    }

    #[test]
    fn a_second_action_is_busy_and_queues_nothing() {
        let mut s = ready();
        s.execute("daemon.local.start", json!({})).unwrap();
        let _ = s.take_local_requests();
        for id in ["daemon.local.start", "daemon.local.stop", "daemon.local.restart", "daemon.local.refresh"] {
            assert_eq!(code(&mut s, id), "busy", "{id}");
        }
        assert!(s.take_local_requests().is_empty());
        assert_eq!(s.local_state(), &LocalState::Starting);
    }

    #[test]
    fn an_outcome_clears_busy_and_shows_in_the_list() {
        let mut s = ready();
        s.execute("daemon.local.start", json!({})).unwrap();
        let _ = s.take_local_requests();
        let _ = s.take_registry_changed();
        s.apply_local_outcome(LocalState::Running { host: "127.0.0.1".into(), port: 7777 });
        assert!(s.take_registry_changed());
        let list = s.execute("daemon.list", json!({})).unwrap();
        assert_eq!(list["local"], json!({"state": "running", "host": "127.0.0.1", "port": 7777}));
        s.execute("daemon.local.stop", json!({})).unwrap();
    }

    #[test]
    fn an_outcome_equal_to_the_state_still_marks_a_change() {
        let mut s = ready();
        s.execute("daemon.local.refresh", json!({})).unwrap();
        let _ = s.take_registry_changed();
        s.apply_local_outcome(LocalState::Stopped);
        assert!(s.take_registry_changed());
        assert!(s.execute("daemon.local.refresh", json!({})).is_ok());
    }

    #[test]
    fn without_a_local_daemon_everything_is_unsupported() {
        let mut s = Session::new();
        s.set_local_supported(false);
        for id in ["daemon.local.start", "daemon.local.stop", "daemon.local.restart", "daemon.local.refresh"] {
            assert_eq!(code(&mut s, id), "unsupported", "{id}");
        }
        assert!(s.take_local_requests().is_empty());
    }

    #[test]
    fn a_missing_or_old_cli_refuses_actions_but_not_a_refresh() {
        for (state, expected) in [(LocalState::CliMissing { path: None }, "cli_missing"), (LocalState::CliOutdated { version: "0.0.1".into() }, "cli_outdated")]
        {
            let mut s = Session::new();
            s.set_local_state(state.clone());
            for id in ["daemon.local.start", "daemon.local.stop", "daemon.local.restart"] {
                assert_eq!(code(&mut s, id), expected, "{id}");
            }
            assert!(s.take_local_requests().is_empty());
            assert!(s.execute("daemon.local.refresh", json!({})).is_ok());
            assert_eq!(s.local_state(), &state);
            assert_eq!(s.take_local_requests(), vec![LocalRequest::Probe]);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    mod dial {
        use std::sync::Arc;
        use std::sync::atomic::Ordering;

        use pistudiodesktop_model::EntryId;

        use super::*;
        use crate::DialPlan;
        use crate::test_store::FakeStore;

        /// What a caller that may block gets: the plan, then the store read.
        fn resolve(s: &Session) -> std::result::Result<Dial, &'static str> {
            s.plan_dial(url)?.finish(&*s.secret_store())
        }

        fn expect_url(d: Dial) -> (String, Option<String>) {
            match d {
                Dial::Connect { url, password } => (url, password.map(|p| p.expose().to_owned())),
                other => panic!("{other:?}"),
            }
        }

        fn with_entry(s: &mut Session, new: serde_json::Value) -> String {
            let id = s.execute("daemon.add", new).unwrap()["id"].as_str().unwrap().to_owned();
            s.execute("daemon.switch", json!({"id": id})).unwrap();
            id
        }

        fn session_with_store() -> (Session, Arc<FakeStore>) {
            let dir = tempfile::tempdir().unwrap();
            let store = Arc::new(FakeStore::default());
            // The directory outlives the test through the leaked path only for the session's lifetime.
            let (s, _) = Session::with_config_dir(dir.keep(), store.clone());
            (s, store)
        }

        #[test]
        fn direct_and_relay() {
            let mut s = Session::new();
            with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            assert_eq!(expect_url(resolve(&s).unwrap()), ("h:1".into(), Some("pw".into())));
            with_entry(&mut s, json!({"kind": "direct", "name": "N", "address": "h:2"}));
            assert_eq!(expect_url(resolve(&s).unwrap()), ("h:2".into(), None));
            with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": "pi://l"}));
            assert_eq!(expect_url(resolve(&s).unwrap()), ("pi://l".into(), None));
        }

        #[test]
        fn the_plan_reads_nothing_and_names_the_item() {
            let (mut s, store) = session_with_store();
            let id = with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            let rid = with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": "pi://l"}));
            let calls = store.calls.load(Ordering::SeqCst);
            assert_eq!(s.plan_dial(url), Ok(DialPlan::PairingLink { entry: EntryId::parse(&rid).unwrap() }));
            s.execute("daemon.switch", json!({"id": id})).unwrap();
            assert_eq!(s.plan_dial(url), Ok(DialPlan::Password { url: "h:1".into(), entry: EntryId::parse(&id).unwrap() }));
            assert_eq!(store.calls.load(Ordering::SeqCst), calls, "planning never calls the store");
            // A direct entry without a password has nothing to read.
            let open = with_entry(&mut s, json!({"kind": "direct", "name": "O", "address": "h:3"}));
            assert!(!open.is_empty());
            assert_eq!(s.plan_dial(url), Ok(DialPlan::Ready(Dial::Connect { url: "h:3".into(), password: None })));
        }

        #[test]
        fn an_item_deleted_behind_the_apps_back_is_secret_missing() {
            let (mut s, store) = session_with_store();
            let id = with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            assert_eq!(expect_url(resolve(&s).unwrap()), ("h:1".into(), Some("pw".into())));
            store.take(&format!("{id}/password"));
            assert_eq!(resolve(&s), Err("secret_missing"));
            let rid = with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": "pi://l"}));
            store.take(&format!("{rid}/pairingLink"));
            assert_eq!(resolve(&s), Err("secret_missing"));
        }

        #[test]
        fn a_store_that_cannot_be_read_is_secret_unavailable() {
            let (mut s, store) = session_with_store();
            with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            store.fail_get.store(true, Ordering::SeqCst);
            assert_eq!(resolve(&s), Err("secret_unavailable"));
            store.fail_get.store(false, Ordering::SeqCst);
            assert!(resolve(&s).is_ok());
        }

        #[test]
        fn no_current_entry() {
            let (mut s, _) = session_with_store();
            let id = with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1"}));
            s.execute("daemon.remove", json!({"id": id})).unwrap();
            assert_eq!(s.plan_dial(url), Err("no_current"));
        }

        #[test]
        fn local_rows() {
            let mut s = Session::new();
            s.execute("daemon.update", json!({"id": "local", "password": "lp"})).unwrap();
            type Want = std::result::Result<Option<(String, Option<String>)>, &'static str>;
            let cases: Vec<(LocalState, Want)> = vec![
                (LocalState::Unsupported, Err("unsupported")),
                (LocalState::CliMissing { path: None }, Err("cli_missing")),
                (LocalState::CliOutdated { version: "1".into() }, Err("cli_outdated")),
                (LocalState::Failed { reason: FailReason::Timeout }, Err("timeout")),
                (LocalState::Failed { reason: FailReason::NotHealthy }, Err("not_healthy")),
                (LocalState::Failed { reason: FailReason::BadOutput }, Err("bad_output")),
                (LocalState::Failed { reason: FailReason::SpawnFailed }, Err("spawn_failed")),
                (LocalState::Running { host: "127.0.0.1".into(), port: 9 }, Ok(Some(("ws://127.0.0.1:9".into(), Some("lp".into()))))),
            ];
            for (state, expected) in cases {
                s.set_local_state(state.clone());
                match (resolve(&s), expected) {
                    (Ok(d), Ok(Some(want))) => assert_eq!(expect_url(d), want, "{state:?}"),
                    (Err(got), Err(want)) => assert_eq!(got, want, "{state:?}"),
                    (got, want) => panic!("{state:?}: {got:?} vs {want:?}"),
                }
            }
            for state in [LocalState::Checking, LocalState::Starting, LocalState::Stopping] {
                s.set_local_state(state);
                assert_eq!(resolve(&s), Ok(Dial::Wait));
            }
        }

        #[test]
        fn stopped_follows_the_setting() {
            let mut s = ready();
            assert_eq!(resolve(&s), Ok(Dial::StartNeeded));
            s.execute("settings.set", json!({"key": "autoStartLocalDaemon", "value": false})).unwrap();
            assert_eq!(resolve(&s), Err("local_stopped"));
        }

        #[test]
        fn only_a_finished_dial_returns_a_password() {
            let mut s = Session::new();
            s.execute("daemon.update", json!({"id": "local", "password": "topsecret"})).unwrap();
            s.set_local_state(LocalState::Running { host: "h".into(), port: 1 });
            let _ = s.execute("daemon.add", json!({"kind": "direct", "name": "D", "address": "a:1", "password": "topsecret"}));
            let mut out = Vec::new();
            for id in ["daemon.list", "daemon.local.refresh", "settings.get"] {
                out.push(s.execute(id, json!({})).map(|v| v.to_string()).unwrap_or_else(|e| e.to_string()));
            }
            s.apply_local_outcome(LocalState::Stopped);
            for id in ["daemon.local.start", "daemon.local.stop", "daemon.local.restart"] {
                out.push(s.execute(id, json!({})).map(|v| v.to_string()).unwrap_or_else(|e| e.to_string()));
            }
            assert!(out.iter().all(|o| !o.contains("topsecret")), "{out:?}");
            s.set_local_state(LocalState::Running { host: "h".into(), port: 1 });
            assert!(!format!("{:?}", s.plan_dial(url).unwrap()).contains("topsecret"));
            assert!(!format!("{:?}", resolve(&s).unwrap()).contains("topsecret"));
        }
    }
}
