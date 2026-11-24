//! The local daemon as the engine sees it: a queue of requests for the host to run, a busy flag
//! that lasts until the host hands back the outcome, and the answer to "what do I dial".
//!
//! The engine never starts a process. A command records what was asked; the host drains
//! [`Session::take_local_requests`], does the work and applies the new state with
//! [`Session::apply_local_outcome`].

use pistudiodesktop_model::{EntryId, EntryV3, Kind, LocalState, Secret};
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
    /// `pi-studio update`, then the version again, then a start.
    Update,
}

/// An action the user asked for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Action {
    Start,
    Stop,
    Restart,
    Refresh,
    Update,
}

/// Requests waiting for the host, and whether an action is in flight.
#[derive(Default)]
pub(crate) struct LocalQueue {
    requests: Vec<LocalRequest>,
    busy: bool,
    refreshing: bool,
}

/// What to do to open the current entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Dial {
    /// Connect to `url`: the address of a local or direct entry, or a relay entry's host hint
    /// (`ws(s)://<relay host>`, derived from its pairing link; [`relay_address`]). This is what the
    /// page is told, so it holds no password and no link: both are read by the transport bridge
    /// ([`BridgePlan`]), in Rust, for its own dial.
    Connect { url: String },
    /// The local daemon is stopped and the setting asks for it to be started first.
    StartNeeded,
    /// The local daemon is changing state; ask again when it has settled.
    Wait,
}

/// What to dial, before a secret that lives in the store has been read. The session answers with
/// this because a store read may block (a keychain waits for the user), and the thread that
/// owns the session must keep answering; the caller finishes it where blocking is allowed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DialPlan {
    /// Nothing to read: the answer is final.
    Ready(Dial),
    /// A local or direct entry: its address and where its password is. The page is told the
    /// address only ([`DialPlan::finish`] never reads the password); the transport bridge dials
    /// with it ([`Session::plan_bridge`]).
    Open(BridgePlan),
    /// The relay entry `entry`, whose pairing link the store holds: the page is told the relay's
    /// address, which `finish` derives from the link without answering it.
    PairingLink { entry: EntryId },
}

#[cfg(not(target_arch = "wasm32"))]
impl DialPlan {
    /// Read what the plan needs from `store`: only a relay entry's pairing link, of which the
    /// page is told the relay's address and nothing else. A local or direct entry's password is
    /// never read here. This may block until the user answers a system prompt: never call it on
    /// the thread that owns
    /// the session. `Err` is the code `resolveCurrent` rejects with: `secret_missing` when the
    /// store has no such item (it was removed behind the app's back), `secret_unavailable` when
    /// it could not be read.
    pub fn finish(self, store: &dyn pistudiodesktop_secrets::SecretStore) -> std::result::Result<Dial, &'static str> {
        use crate::secret::{Slot, key, read_code};
        Ok(match self {
            DialPlan::Ready(dial) => dial,
            DialPlan::Open(plan) => Dial::Connect { url: plan.url },
            DialPlan::PairingLink { entry } => {
                let link = read_code(store.get(&key(&entry, Slot::PairingLink)))?;
                Dial::Connect { url: relay_address(link.expose())? }
            }
        })
    }
}

/// The address the page (and the bridge's address check) uses for a relay entry, from its pairing
/// link: `wss://<relay>` or `ws://<relay>`, or `ws://<host>` for a link with a host hint. Never the
/// link. `Err` is `invalid_link`.
pub fn relay_address(link: &str) -> std::result::Result<String, &'static str> {
    use pistudiodesktop_model::pairing::{Target, parse};
    Ok(match parse(link).map_err(|_| "invalid_link")?.target {
        Target::Relay { host, tls } => format!("{}://{host}", if tls { "wss" } else { "ws" }),
        Target::Direct { host } => format!("ws://{host}"),
    })
}

/// Where the secret a bridged connection needs comes from: a local or direct entry's password, a
/// relay entry's pairing link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BridgePassword {
    /// The entry has none.
    None,
    /// Held in memory (a version 1 file's secret that could not be moved to the store).
    Held(Secret),
    /// In the secret store: the caller reads it ([`BridgePlan::read_password`]) where blocking is allowed.
    Stored,
}

/// What the transport bridge needs to know about the current entry before it dials: which entry
/// and of what kind, the address to dial and where its secret is. For a local entry the address is
/// the running daemon's, for a direct entry the stored one; for a relay entry it is the relay's
/// ([`relay_address`]), known here only when the link is held in memory: with the link in the
/// store `url` is empty and the caller derives it from the link it reads. Like [`DialPlan`], it
/// never reads the store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgePlan {
    pub entry: EntryId,
    pub kind: Kind,
    pub url: String,
    pub password: BridgePassword,
}

#[cfg(not(target_arch = "wasm32"))]
impl BridgePlan {
    /// The entry's secret, read from `store` when it lives there: a local or direct entry's
    /// password, a relay entry's pairing link. This may block until the user answers a system
    /// prompt: never call it on the thread that owns the session. `Err` is
    /// `secret_missing` (the registry says the entry has one and the store has none) or
    /// `secret_unavailable` (the store could not be read).
    pub fn read_password(&self, store: &dyn pistudiodesktop_secrets::SecretStore) -> std::result::Result<Option<Secret>, &'static str> {
        use crate::secret::{Slot, key, read_code};
        let slot = if self.kind == Kind::Relay { Slot::PairingLink } else { Slot::Password };
        match &self.password {
            BridgePassword::None => Ok(None),
            BridgePassword::Held(password) => Ok(Some(password.clone())),
            BridgePassword::Stored => Ok(Some(Secret::new(read_code(store.get(&key(&self.entry, slot)))?.expose()))),
        }
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
            // Retry in the Daemons screen is a refresh, so a refresh goes through these two; an
            // update is what an outdated CLI is offered.
            LocalState::CliMissing { .. } if action != Action::Refresh => return Err("cli_missing"),
            LocalState::CliOutdated { .. } if !matches!(action, Action::Refresh | Action::Update) => return Err("cli_outdated"),
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
            Action::Update => (LocalRequest::Update, Some(LocalState::Updating)),
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
    /// secret store: a relay entry's plan says which item to read (the pairing link, the address)
    /// and the caller reads it ([`DialPlan::finish`]) on a thread that may block. A local or
    /// direct entry's plan names where its password is and `finish` leaves it unread. Not a
    /// command. `dial_address` builds the URL of a running local daemon from its host and port.
    /// `Err` is the code `resolveCurrent` rejects with.
    pub fn plan_dial(&self, dial_address: impl Fn(&str, u16) -> String) -> std::result::Result<DialPlan, &'static str> {
        let id = self.current_entry_id().ok_or("no_current")?;
        let entry = self.registry().get(id.as_str()).ok_or("no_current")?;
        match entry.kind {
            Kind::Direct => Ok(self.plan_open(entry, entry.address.clone().ok_or("not_found")?)),
            Kind::Relay => Ok(match self.held_secret(&entry.id) {
                // With the link held in memory there is nothing to read: the page is told its address.
                Some(link) => DialPlan::Ready(Dial::Connect { url: relay_address(link.expose())? }),
                None => DialPlan::PairingLink { entry: entry.id.clone() },
            }),
            // The page and the bridge's address check see the tunnel's far end: the daemon's own
            // port on the host's loopback, as the host sees it (`ssh_plan` has the rest).
            Kind::Ssh => Ok(self.plan_open(entry, crate::remote::ssh_address(entry.daemon_port.ok_or("not_found")?))),
            Kind::Local => match self.local_state() {
                LocalState::Unsupported => Err("unsupported"),
                LocalState::CliMissing { .. } => Err("cli_missing"),
                LocalState::CliOutdated { .. } => Err("cli_outdated"),
                LocalState::Running { host, port } => Ok(self.plan_open(entry, dial_address(host, *port))),
                LocalState::Stopped if self.settings().auto_start_local_daemon => Ok(DialPlan::Ready(Dial::StartNeeded)),
                LocalState::Stopped => Err("local_stopped"),
                LocalState::Failed { reason, .. } => Err(reason.code()),
                LocalState::Checking | LocalState::Starting | LocalState::Stopping | LocalState::Updating => Ok(DialPlan::Ready(Dial::Wait)),
            },
        }
    }

    /// What the transport bridge dials for the current entry, as far as the session can say without
    /// touching the secret store. `Err` is a code of `transport_open`: `local_not_ready` while the
    /// local daemon is stopped to be started or changing state, `no_current`, `invalid_link` for a
    /// held link that does not parse, and the codes of [`Session::plan_dial`] for a local daemon
    /// that cannot be reached at all.
    pub fn plan_bridge(&self, dial_address: impl Fn(&str, u16) -> String) -> std::result::Result<BridgePlan, &'static str> {
        let id = self.current_entry_id().ok_or("no_current")?;
        let entry = self.registry().get(id.as_str()).ok_or("no_current")?;
        if entry.kind == Kind::Relay {
            return Ok(match self.held_secret(&entry.id) {
                Some(link) => {
                    BridgePlan { entry: entry.id.clone(), kind: Kind::Relay, url: relay_address(link.expose())?, password: BridgePassword::Held(link.clone()) }
                }
                None => BridgePlan { entry: entry.id.clone(), kind: Kind::Relay, url: String::new(), password: BridgePassword::Stored },
            });
        }
        match self.plan_dial(dial_address)? {
            DialPlan::Open(plan) => Ok(plan),
            DialPlan::Ready(Dial::StartNeeded | Dial::Wait) => Err("local_not_ready"),
            // Only a relay entry plans a link, and it returned above.
            DialPlan::Ready(Dial::Connect { .. }) | DialPlan::PairingLink { .. } => Err("internal"),
        }
    }

    /// Open `entry` at `url`: where its password is, when the registry says it has one.
    fn plan_open(&self, entry: &EntryV3, url: String) -> DialPlan {
        let password = match (entry.has_password, self.held_secret(&entry.id)) {
            (false, _) => BridgePassword::None,
            (true, Some(held)) => BridgePassword::Held(held.clone()),
            (true, None) => BridgePassword::Stored,
        };
        DialPlan::Open(BridgePlan { entry: entry.id.clone(), kind: entry.kind, url, password })
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "daemon.local.start", label: "Start Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: start },
        CommandSpec { id: "daemon.local.stop", label: "Stop Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: stop },
        CommandSpec { id: "daemon.local.restart", label: "Restart Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: restart },
        CommandSpec { id: "daemon.local.refresh", label: "Refresh Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: refresh },
        CommandSpec { id: "daemon.local.update", label: "Update Local Daemon", menu: &[], shortcut: None, params: "{}", enabled: update_enabled, run: update },
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

fn update_offered(state: &LocalState) -> bool {
    matches!(state, LocalState::CliOutdated { .. } | LocalState::Stopped)
}

/// Update is offered for an outdated CLI and a stopped daemon; the reason says why not otherwise.
fn update_enabled(s: &Session) -> std::result::Result<(), String> {
    match s.local_state() {
        LocalState::Unsupported => Err("unsupported".to_owned()),
        LocalState::CliMissing { .. } => Err("cli_missing".to_owned()),
        state if update_offered(state) => Ok(()),
        _ => Err("update_not_offered".to_owned()),
    }
}

fn update(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, Action::Update)
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
    fn update_state_json_and_command_list_row() {
        let mut s = ready();
        let rows = s.execute("command.list", json!({"filter": "daemon.local."})).unwrap();
        let row = rows.as_array().unwrap().iter().find(|r| r["id"] == "daemon.local.update").unwrap().clone();
        assert_eq!((row["enabled"].clone(), row["label"].clone()), (json!(true), json!("Update Local Daemon")));
        s.execute("daemon.local.update", json!({})).unwrap();
        assert_eq!(s.local_state(), &LocalState::Updating);
        assert_eq!(s.take_local_requests(), vec![LocalRequest::Update]);
        let list = s.execute("daemon.list", json!({})).unwrap();
        assert_eq!(list["local"], json!({"state": "updating"}));
    }

    #[test]
    fn update_is_enabled_for_stopped_and_an_outdated_cli_only() {
        let outdated = LocalState::CliOutdated { version: "0.0.1".into() };
        let failed = LocalState::Failed { reason: FailReason::UpdateFailed, output: None };
        let cases = [
            (LocalState::Stopped, None),
            (outdated.clone(), None),
            (LocalState::Unsupported, Some("unsupported")),
            (LocalState::CliMissing { path: None }, Some("cli_missing")),
            (LocalState::Checking, Some("update_not_offered")),
            (LocalState::Starting, Some("update_not_offered")),
            (LocalState::Stopping, Some("update_not_offered")),
            (LocalState::Updating, Some("update_not_offered")),
            (LocalState::Running { host: "h".into(), port: 1 }, Some("update_not_offered")),
            (failed, Some("update_not_offered")),
        ];
        for (state, refusal) in cases {
            let mut s = Session::new();
            s.set_local_state(state.clone());
            let rows = s.execute("command.list", json!({"filter": "daemon.local.update"})).unwrap();
            assert_eq!(rows[0]["enabled"], json!(refusal.is_none()), "{state:?}");
            assert_eq!(rows[0]["reason"], json!(refusal), "{state:?}");
            match refusal {
                None => assert!(s.execute("daemon.local.update", json!({})).is_ok(), "{state:?}"),
                Some(reason) => {
                    assert!(code(&mut s, "daemon.local.update").ends_with(reason), "{state:?}");
                    assert!(s.take_local_requests().is_empty());
                }
            }
        }
    }

    #[test]
    fn an_outdated_cli_updates_and_a_second_action_is_busy() {
        let mut s = Session::new();
        s.set_local_state(LocalState::CliOutdated { version: "0.0.1".into() });
        s.execute("daemon.local.update", json!({})).unwrap();
        assert_eq!((s.local_state().clone(), s.take_local_requests()), (LocalState::Updating, vec![LocalRequest::Update]));
        assert_eq!(code(&mut s, "daemon.local.refresh"), "busy");
        s.apply_local_outcome(LocalState::Stopped);
        assert!(s.execute("daemon.local.start", json!({})).is_ok());
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

        use pistudiodesktop_model::{EntryId, Kind};

        use super::*;
        use crate::DialPlan;
        use crate::test_store::FakeStore;

        /// A pairing link `model::pairing` reads.
        const LINK: &str = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=l";
        const TLS_RELAY_LINK: &str = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&relay=https://relay.example:8443/&relayTls=1";
        const PLAIN_RELAY_LINK: &str = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&relay=relay.example";

        /// What a caller that may block gets: the plan, then the store read.
        fn resolve(s: &Session) -> std::result::Result<Dial, &'static str> {
            s.plan_dial(url)?.finish(&*s.secret_store())
        }

        fn expect_url(d: Dial) -> String {
            match d {
                Dial::Connect { url } => url,
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
            assert_eq!(expect_url(resolve(&s).unwrap()), "h:1");
            with_entry(&mut s, json!({"kind": "direct", "name": "N", "address": "h:2"}));
            assert_eq!(expect_url(resolve(&s).unwrap()), "h:2");
            with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": LINK}));
            assert_eq!(expect_url(resolve(&s).unwrap()), "ws://l", "a link with a host hint is answered as that host");
            with_entry(&mut s, json!({"kind": "relay", "name": "T", "pairingLink": TLS_RELAY_LINK}));
            assert_eq!(expect_url(resolve(&s).unwrap()), "wss://relay.example:8443");
            with_entry(&mut s, json!({"kind": "relay", "name": "P", "pairingLink": PLAIN_RELAY_LINK}));
            assert_eq!(expect_url(resolve(&s).unwrap()), "ws://relay.example");
        }

        #[test]
        fn the_plan_reads_nothing_and_names_where_the_secret_is() {
            use super::super::{BridgePassword, BridgePlan};
            let (mut s, store) = session_with_store();
            let id = with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            let rid = with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": LINK}));
            let calls = store.calls.load(Ordering::SeqCst);
            assert_eq!(s.plan_dial(url), Ok(DialPlan::PairingLink { entry: EntryId::parse(&rid).unwrap() }));
            s.execute("daemon.switch", json!({"id": id})).unwrap();
            let entry = EntryId::parse(&id).unwrap();
            assert_eq!(s.plan_dial(url), Ok(DialPlan::Open(BridgePlan { entry, kind: Kind::Direct, url: "h:1".into(), password: BridgePassword::Stored })));
            assert_eq!(store.calls.load(Ordering::SeqCst), calls, "planning never calls the store");
            // A direct entry without a password has nothing to read.
            let open = with_entry(&mut s, json!({"kind": "direct", "name": "O", "address": "h:3"}));
            let entry = EntryId::parse(&open).unwrap();
            assert_eq!(s.plan_dial(url), Ok(DialPlan::Open(BridgePlan { entry, kind: Kind::Direct, url: "h:3".into(), password: BridgePassword::None })));
        }

        #[test]
        fn the_page_never_reads_a_local_or_direct_entrys_password() {
            let (mut s, store) = session_with_store();
            let id = with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            let calls = store.calls.load(Ordering::SeqCst);
            assert_eq!(expect_url(resolve(&s).unwrap()), "h:1");
            // Neither a missing item nor an unreadable store is the page's concern: the bridge reads it.
            store.take(&format!("{id}/password"));
            store.fail_get.store(true, Ordering::SeqCst);
            assert_eq!(expect_url(resolve(&s).unwrap()), "h:1");
            assert_eq!(store.calls.load(Ordering::SeqCst), calls, "the page's dial never calls the store");
        }

        #[test]
        fn a_relay_link_deleted_behind_the_apps_back_is_secret_missing() {
            let (mut s, store) = session_with_store();
            let rid = with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": LINK}));
            assert_eq!(expect_url(resolve(&s).unwrap()), "ws://l");
            store.take(&format!("{rid}/pairingLink"));
            assert_eq!(resolve(&s), Err("secret_missing"));
        }

        #[test]
        fn a_store_that_cannot_be_read_is_secret_unavailable() {
            let (mut s, store) = session_with_store();
            with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": LINK}));
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
        fn the_bridge_plan_names_the_entry_the_address_and_where_the_password_is() {
            use super::super::{BridgePassword, BridgePlan};
            let (mut s, store) = session_with_store();
            let id = with_entry(&mut s, json!({"kind": "direct", "name": "D", "address": "h:1", "password": "pw"}));
            let entry = EntryId::parse(&id).unwrap();
            let calls = store.calls.load(Ordering::SeqCst);
            let plan = s.plan_bridge(url).unwrap();
            assert_eq!(plan, BridgePlan { entry: entry.clone(), kind: Kind::Direct, url: "h:1".into(), password: BridgePassword::Stored });
            assert_eq!(store.calls.load(Ordering::SeqCst), calls, "planning never calls the store");
            assert_eq!(plan.read_password(&*s.secret_store()).unwrap().map(|p| p.expose().to_owned()), Some("pw".to_owned()));
            store.take(&format!("{id}/password"));
            assert_eq!(plan.read_password(&*s.secret_store()), Err("secret_missing"));
            store.fail_get.store(true, Ordering::SeqCst);
            assert_eq!(plan.read_password(&*s.secret_store()), Err("secret_unavailable"));

            with_entry(&mut s, json!({"kind": "direct", "name": "N", "address": "h:2"}));
            let plain = s.plan_bridge(url).unwrap();
            assert_eq!((plain.url.as_str(), &plain.password), ("h:2", &BridgePassword::None));
            assert_eq!(plain.read_password(&*s.secret_store()), Ok(None));
        }

        #[test]
        fn a_relay_entry_is_bridged_with_its_link_read_from_the_store() {
            use super::super::{BridgePassword, BridgePlan};
            let (mut s, store) = session_with_store();
            let rid = with_entry(&mut s, json!({"kind": "relay", "name": "R", "pairingLink": LINK}));
            let entry = EntryId::parse(&rid).unwrap();
            let calls = store.calls.load(Ordering::SeqCst);
            let plan = s.plan_bridge(url).unwrap();
            assert_eq!(plan, BridgePlan { entry, kind: Kind::Relay, url: String::new(), password: BridgePassword::Stored });
            assert_eq!(store.calls.load(Ordering::SeqCst), calls, "planning never calls the store");
            assert_eq!(plan.read_password(&*s.secret_store()).unwrap().map(|p| p.expose().to_owned()), Some(LINK.to_owned()));
            store.take(&format!("{rid}/pairingLink"));
            assert_eq!(plan.read_password(&*s.secret_store()), Err("secret_missing"));
            store.fail_get.store(true, Ordering::SeqCst);
            assert_eq!(plan.read_password(&*s.secret_store()), Err("secret_unavailable"));
        }

        #[test]
        fn the_relay_address_is_derived_from_the_link_and_is_never_the_link() {
            use super::super::relay_address;
            assert_eq!(relay_address(LINK), Ok("ws://l".to_owned()));
            assert_eq!(relay_address(TLS_RELAY_LINK), Ok("wss://relay.example:8443".to_owned()));
            assert_eq!(relay_address(PLAIN_RELAY_LINK), Ok("ws://relay.example".to_owned()));
            assert_eq!(relay_address("not a link"), Err("invalid_link"));
        }

        #[test]
        fn the_local_entry_is_planned_by_its_state() {
            let mut s = Session::new();
            s.execute("daemon.switch", json!({"id": "local"})).unwrap();
            s.set_local_state(LocalState::Running { host: "127.0.0.1".into(), port: 9 });
            let plan = s.plan_bridge(url).unwrap();
            assert_eq!((plan.entry.as_str(), plan.url.as_str()), ("local", "ws://127.0.0.1:9"));
            for (state, code) in [
                (LocalState::Starting, "local_not_ready"),
                (LocalState::Checking, "local_not_ready"),
                (LocalState::Stopped, "local_not_ready"),
                (LocalState::CliMissing { path: None }, "cli_missing"),
                (LocalState::Unsupported, "unsupported"),
            ] {
                s.set_local_state(state.clone());
                assert_eq!(s.plan_bridge(url), Err(code), "{state:?}");
            }
            s.execute("settings.set", json!({"key": "autoStartLocalDaemon", "value": false})).unwrap();
            s.set_local_state(LocalState::Stopped);
            assert_eq!(s.plan_bridge(url), Err("local_stopped"));
        }

        #[test]
        fn local_rows() {
            let mut s = Session::new();
            s.execute("daemon.update", json!({"id": "local", "password": "lp"})).unwrap();
            type Want = std::result::Result<Option<String>, &'static str>;
            let cases: Vec<(LocalState, Want)> = vec![
                (LocalState::Unsupported, Err("unsupported")),
                (LocalState::CliMissing { path: None }, Err("cli_missing")),
                (LocalState::CliOutdated { version: "1".into() }, Err("cli_outdated")),
                (LocalState::Failed { reason: FailReason::Timeout, output: None }, Err("timeout")),
                (LocalState::Failed { reason: FailReason::NotHealthy, output: None }, Err("not_healthy")),
                (LocalState::Failed { reason: FailReason::BadOutput, output: None }, Err("bad_output")),
                (LocalState::Failed { reason: FailReason::SpawnFailed, output: None }, Err("spawn_failed")),
                (LocalState::Failed { reason: FailReason::UpdateFailed, output: Some("x".into()) }, Err("update_failed")),
                (LocalState::Running { host: "127.0.0.1".into(), port: 9 }, Ok(Some("ws://127.0.0.1:9".into()))),
            ];
            for (state, expected) in cases {
                s.set_local_state(state.clone());
                match (resolve(&s), expected) {
                    (Ok(d), Ok(Some(want))) => assert_eq!(expect_url(d), want, "{state:?}"),
                    (Err(got), Err(want)) => assert_eq!(got, want, "{state:?}"),
                    (got, want) => panic!("{state:?}: {got:?} vs {want:?}"),
                }
            }
            for state in [LocalState::Checking, LocalState::Starting, LocalState::Stopping, LocalState::Updating] {
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
        fn no_dial_answer_holds_a_password() {
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
