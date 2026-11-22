use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use pistudiodesktop_secrets::SecretStore;

use pistudiodesktop_model::{EntryId, EntryV2, Kind, LimitError, LocalState, NewEntry, RegistryV2, Secret, Settings, Update, check_link, check_password};
use serde_json::{Map, Value};

use crate::local::LocalQueue;
use crate::secret::{STORE_FAILED, Slot, Vault};
use crate::secret_job::{Op, SecretJob, Work};
use crate::storage::Storage;
use crate::{EngineError, Result, commands, params};

/// What `daemon.update` changes. `None` leaves a field as it is.
#[derive(Default)]
pub(crate) struct EntryChange {
    pub(crate) name: Option<String>,
    pub(crate) address: Option<String>,
    /// `Some(None)` clears the password.
    pub(crate) password: Option<Option<Secret>>,
    pub(crate) pairing_link: Option<Secret>,
}

/// Refuse what the registry has always refused: a secret outside 1 to its cap.
fn check_secret(slot: Slot, secret: &Secret) -> std::result::Result<(), &'static str> {
    match slot {
        Slot::Password => check_password(secret.expose()),
        Slot::PairingLink => check_link(secret.expose()),
    }
    .map_err(|e| e.code())
}

/// One user's working state: the settings and the workbench's stored keys.
pub struct Session {
    storage: Storage,
    vault: Vault,
    local: LocalState,
    pub(crate) local_queue: LocalQueue,
    changed: bool,
}

impl Default for Session {
    fn default() -> Self {
        Session { storage: Storage::default(), vault: Vault::default(), local: LocalState::Checking, local_queue: LocalQueue::default(), changed: false }
    }
}

impl Session {
    /// A session with default settings that reads and writes no files and keeps its secrets in
    /// memory (tests, the browser).
    pub fn new() -> Self {
        Self::default()
    }

    /// A session whose settings and workbench keys live in `dir`, and whose secrets are in `store`.
    /// Nothing is created: a missing file or directory means defaults, and files appear when
    /// something is written. A version 1 `daemons.json` is migrated here: its secrets go to
    /// `store` (which may block: call this before the window and the owner thread exist) and the
    /// file becomes version 2. The notices say which files could not be used and were set aside,
    /// and whether secrets could not be moved; the session starts either way.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn with_config_dir(dir: impl Into<PathBuf>, store: Arc<dyn SecretStore>) -> (Self, Vec<crate::Notice>) {
        let vault = Vault::with(store);
        let (storage, notices) = Storage::open(dir.into(), &vault);
        (Session { storage, vault, ..Session::default() }, notices)
    }

    /// Say whether this platform can run a local daemon. When it cannot, the local state is
    /// `unsupported` for good; otherwise it starts as `checking`.
    pub fn set_local_supported(&mut self, supported: bool) {
        if supported {
            if self.local == LocalState::Unsupported {
                self.set_local_state(LocalState::Checking);
            }
        } else {
            self.set_local_state(LocalState::Unsupported);
        }
    }

    /// The local daemon's state as last stored here.
    pub fn local_state(&self) -> &LocalState {
        &self.local
    }

    /// Store the local daemon's state; a different one counts as a change.
    pub fn set_local_state(&mut self, state: LocalState) {
        if self.local != state {
            self.local = state;
            self.changed = true;
        }
    }

    /// The registry: the version 2 document, with no secret in it.
    pub fn registry(&self) -> &RegistryV2 {
        self.storage.registry()
    }

    /// The secret store this session uses, for a caller that must read a secret: a read may block
    /// (a system prompt), so it is never done by the session itself on the thread that owns it
    /// (see [`DialPlan`](crate::DialPlan)).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn secret_store(&self) -> Arc<dyn SecretStore> {
        Arc::clone(&self.vault.store)
    }

    /// A secret of a version 1 file that could not be moved to the store at launch, held in memory
    /// for this run (see `Storage::open`).
    pub(crate) fn held_secret(&self, id: &EntryId) -> Option<&Secret> {
        self.storage.held(id)
    }

    /// The entry whose stored keys are loaded: `lastUsedId` when that entry exists, else `local`.
    /// `None` only after the current entry was removed, until a switch.
    pub fn current_entry_id(&self) -> Option<&EntryId> {
        self.storage.current()
    }

    pub(crate) fn mark_changed(&mut self) {
        self.changed = true;
    }

    /// Whether a local daemon request is waiting for the host to take it.
    pub fn has_local_requests(&self) -> bool {
        self.local_requests_waiting()
    }

    /// Whether the registry view or the local state changed since this was last asked.
    pub fn take_registry_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }

    /// Make `id` the current entry (see `daemon.switch`). `Ok(true)` when it changed.
    pub(crate) fn switch_entry(&mut self, id: &str) -> std::result::Result<bool, &'static str> {
        let changed = self.storage.switch(id)?;
        self.changed |= changed;
        Ok(changed)
    }

    /// Plan `daemon.add` (see [`SecretJob`]). `secret` is a direct entry's password, if it has
    /// one, or a relay entry's pairing link; it is stored first and the registry written after,
    /// so a refused store writes nothing and the registry never says `hasPassword` for a password
    /// that is not stored. Pure: nothing is stored or written until the job runs.
    pub(crate) fn plan_add_job(&self, new: NewEntry, secret: Option<Secret>) -> std::result::Result<SecretJob, &'static str> {
        self.refuse_while_unmigrated()?;
        let slot = Slot::of(if matches!(new, NewEntry::Relay { .. }) { Kind::Relay } else { Kind::Direct });
        let (id, _) = self.storage.plan_add(new.clone())?;
        let mut before = Vec::new();
        if let Some(secret) = secret {
            check_secret(slot, &secret)?;
            before.push(Op { entry: id.clone(), slot, secret: Some(secret) });
        }
        Ok(SecretJob { vault: self.vault.clone(), entry: id.clone(), work: Work::Add { id, new: Some(new) }, before, after: Vec::new() })
    }

    /// Plan `daemon.update`: a secret is stored (or, for a cleared password, removed) before the
    /// registry is written, so a refused store leaves the file as it was.
    pub(crate) fn plan_update_job(&self, id: &str, change: EntryChange) -> std::result::Result<SecretJob, &'static str> {
        self.refuse_while_unmigrated()?;
        let update = Update {
            name: change.name,
            address: change.address,
            has_password: change.password.as_ref().map(Option::is_some),
            new_link: change.pairing_link.is_some(),
        };
        self.storage.plan_update(id, update.clone())?;
        let entry = self.storage.registry().get(id).map(|e| e.id.clone()).ok_or("not_found")?;
        let mut before = Vec::new();
        match change.password {
            Some(Some(password)) => {
                check_secret(Slot::Password, &password)?;
                before.push(Op { entry: entry.clone(), slot: Slot::Password, secret: Some(password) });
            }
            Some(None) => before.push(Op { entry: entry.clone(), slot: Slot::Password, secret: None }),
            None => {}
        }
        if let Some(link) = change.pairing_link {
            check_secret(Slot::PairingLink, &link)?;
            before.push(Op { entry: entry.clone(), slot: Slot::PairingLink, secret: Some(link) });
        }
        Ok(SecretJob { vault: self.vault.clone(), entry, work: Work::Update { id: id.to_owned(), update: Some(update) }, before, after: Vec::new() })
    }

    /// Plan `daemon.remove`: the registry first, then the entry's secrets. A secret that cannot be
    /// removed is logged with the entry id and reported as a notice; the entry is gone all the same.
    pub(crate) fn plan_remove_job(&self, id: &str) -> std::result::Result<SecretJob, &'static str> {
        self.refuse_while_unmigrated()?;
        self.storage.plan_remove(id)?;
        let entry = self.storage.registry().get(id).map(|e| e.id.clone()).ok_or("not_found")?;
        let after = [Slot::Password, Slot::PairingLink].map(|slot| Op { entry: entry.clone(), slot, secret: None }).into();
        Ok(SecretJob { vault: self.vault.clone(), entry, work: Work::Remove { id: id.to_owned() }, before: Vec::new(), after })
    }

    /// The step of a [`SecretJob`] that changes the registry: planned again against the registry as
    /// it is now (it may have changed since the plan), written, and answered like the command.
    pub fn commit_secret_job(&mut self, job: &mut SecretJob) -> std::result::Result<Value, &'static str> {
        let view = |s: &Session, id: &str| -> std::result::Result<Value, &'static str> {
            let entry = s.storage.registry().get(id).ok_or("not_found")?;
            serde_json::to_value(EntryV2::view(entry)).map_err(|_| "write_failed")
        };
        let answer = match &mut job.work {
            Work::Add { id, new } => {
                let next = self.storage.registry().add(id.clone(), new.take().ok_or("write_failed")?).map_err(|e| e.code())?;
                self.storage.commit(next)?;
                view(self, id.as_str())?
            }
            Work::Update { id, update } => {
                let next = self.storage.plan_update(id, update.take().ok_or("write_failed")?)?;
                self.storage.commit(next)?;
                view(self, id)?
            }
            Work::Remove { id } => {
                let next = self.storage.plan_remove(id)?;
                self.storage.commit(next)?;
                self.storage.forget_entry(id);
                serde_json::json!({"removed": true})
            }
        };
        self.changed = true;
        Ok(answer)
    }

    /// Plan the command `id` if it keeps a secret in the store (`daemon.add`, `daemon.update`,
    /// `daemon.remove`), else `None`: run it with [`SecretJob::store`] (which may block, so not
    /// on the thread that owns the session), [`Session::commit_secret_job`] and
    /// [`SecretJob::finish`], or let [`execute_unlocked`](crate::execute_unlocked) do all three.
    /// [`Session::execute`] runs the same steps in one go, blocking.
    pub fn plan_secret_command(&self, id: &str, params: &Value) -> Option<Result<SecretJob>> {
        crate::daemon_cmds::splits(id).then(|| {
            let empty = Value::Object(Map::new());
            match params {
                Value::Null => crate::daemon_cmds::plan(self, id, &empty),
                Value::Object(_) => crate::daemon_cmds::plan(self, id, params),
                other => Err(EngineError::BadParams(format!("`{id}` takes a JSON object, got {}", params::kind(other)))),
            }
        })
    }

    /// While a version 1 file's secrets are held in memory (see `Storage::open`) the registry is
    /// not rewritten, so nothing that changes it or the store may run: the file would be left
    /// out of step with the store.
    fn refuse_while_unmigrated(&self) -> std::result::Result<(), &'static str> {
        if self.storage.unmigrated() { Err(STORE_FAILED) } else { Ok(()) }
    }

    pub fn settings(&self) -> &Settings {
        self.storage.settings()
    }

    pub(crate) fn set_setting(&mut self, name: &str, value: &Value) -> Result<()> {
        self.storage.set_setting(name, value)?;
        self.changed = true;
        Ok(())
    }

    /// The workbench's stored keys: the global ones and the current entry's.
    pub fn storage_snapshot(&self) -> BTreeMap<String, String> {
        self.storage.snapshot()
    }

    /// Store one workbench key (opaque string) in memory; a flush writes it. A key or value over
    /// the caps is dropped, the old value stays, and the error says which cap.
    pub fn storage_set(&mut self, key: &str, value: &str) -> std::result::Result<(), LimitError> {
        self.storage.put(key, value)
    }

    /// Some stored key has changed since the last successful write.
    pub fn storage_unwritten(&self) -> bool {
        self.storage.unwritten()
    }

    /// Write every scope with changes. A scope that cannot be written stays unwritten for the
    /// next flush; the first error is returned.
    pub fn storage_flush(&mut self) -> Result<()> {
        self.storage.flush()
    }

    /// Run a command by id. Never panics: unknown ids, wrong params and commands that cannot
    /// run now are errors, and a panic inside a command is caught and reported as one.
    pub fn execute(&mut self, id: &str, params: Value) -> Result<Value> {
        let spec = commands::find(id).ok_or_else(|| EngineError::UnknownCommand(id.to_string()))?;
        let params = match params {
            Value::Null => Value::Object(Map::new()),
            Value::Object(_) => params,
            other => return Err(EngineError::BadParams(format!("`{id}` takes a JSON object, got {}", params::kind(&other)))),
        };
        (spec.enabled)(self).map_err(|reason| EngineError::Disabled { id: id.to_string(), reason })?;
        // Last-resort guard, not a licence to panic.
        catch_unwind(AssertUnwindSafe(|| (spec.run)(self, &params))).unwrap_or_else(|_| {
            log::error!("command `{id}` panicked");
            Err(EngineError::Other(format!("`{id}` failed with an internal error (logged)")))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_panic_in_a_command_is_an_error_and_the_session_survives() {
        let mut s = Session::new();
        let e = s.execute("test.panic", json!({})).unwrap_err();
        assert!(e.to_string().contains("internal error"), "{e}");
        assert!(s.execute("settings.get", json!({})).is_ok());
    }

    #[test]
    fn params_must_be_an_object_and_ids_must_exist() {
        let mut s = Session::new();
        assert!(matches!(s.execute("settings.get", json!([1, 2])), Err(EngineError::BadParams(m)) if m.contains("an array")));
        assert_eq!(s.execute("settings.gt", json!({})), Err(EngineError::UnknownCommand("settings.gt".into())));
    }
}
