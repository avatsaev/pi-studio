use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

#[cfg(not(target_arch = "wasm32"))]
use pistudiodesktop_secrets::SecretStore;

use pistudiodesktop_model::{
    EntryId, EntryV2, EntryView, Kind, LimitError, LocalState, NewEntry, RegistryV2, Secret, Settings, Update, check_link, check_password,
};
use serde_json::{Map, Value};

use crate::local::LocalQueue;
use crate::secret::{STORE_FAILED, Slot, Vault};
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

    /// Add an entry (see `daemon.add`). `secret` is a direct entry's password, if it has one, or a
    /// relay entry's pairing link. It is stored first, and the registry is on disk before this
    /// returns: when the store refuses nothing is written, and the registry never says `hasPassword`
    /// for a password that is not stored.
    pub(crate) fn add_entry(&mut self, new: NewEntry, secret: Option<Secret>) -> std::result::Result<EntryView, &'static str> {
        self.refuse_while_unmigrated()?;
        let slot = Slot::of(if matches!(new, NewEntry::Relay { .. }) { Kind::Relay } else { Kind::Direct });
        let (id, next) = self.storage.plan_add(new)?;
        if let Some(secret) = &secret {
            check_secret(slot, secret)?;
            self.vault.set(&id, slot, secret)?;
        }
        if let Err(e) = self.storage.commit(next) {
            if secret.is_some() {
                // Nothing keeps the entry, so nothing may keep its secret (the failure is logged).
                let _ = self.vault.delete(&id, slot);
            }
            return Err(e);
        }
        self.changed = true;
        self.storage.registry().get(id.as_str()).map(EntryV2::view).ok_or("not_found")
    }

    /// Change an entry (see `daemon.update`). A secret is stored (or, for a cleared password,
    /// removed) before the registry is written, so a refused store leaves the file as it was.
    pub(crate) fn update_entry(&mut self, id: &str, change: EntryChange) -> std::result::Result<EntryView, &'static str> {
        self.refuse_while_unmigrated()?;
        let update = Update {
            name: change.name,
            address: change.address,
            has_password: change.password.as_ref().map(Option::is_some),
            new_link: change.pairing_link.is_some(),
        };
        let next = self.storage.plan_update(id, update)?;
        let entry_id = self.storage.registry().get(id).map(|e| e.id.clone()).ok_or("not_found")?;
        if let Some(Some(password)) = &change.password {
            check_secret(Slot::Password, password)?;
        }
        if let Some(link) = &change.pairing_link {
            check_secret(Slot::PairingLink, link)?;
        }
        match &change.password {
            Some(Some(password)) => self.vault.set(&entry_id, Slot::Password, password)?,
            Some(None) => self.vault.delete(&entry_id, Slot::Password)?,
            None => {}
        }
        if let Some(link) = &change.pairing_link {
            self.vault.set(&entry_id, Slot::PairingLink, link)?;
        }
        self.storage.commit(next)?;
        self.changed = true;
        self.storage.registry().get(id).map(EntryV2::view).ok_or("not_found")
    }

    /// Remove an entry (see `daemon.remove`): the registry first, then its secrets. A secret that
    /// cannot be removed is logged with the entry id; the entry is gone all the same.
    pub(crate) fn remove_entry(&mut self, id: &str) -> std::result::Result<(), &'static str> {
        self.refuse_while_unmigrated()?;
        let next = self.storage.plan_remove(id)?;
        let entry_id = self.storage.registry().get(id).map(|e| e.id.clone()).ok_or("not_found")?;
        self.storage.commit(next)?;
        self.storage.forget_entry(id);
        for slot in [Slot::Password, Slot::PairingLink] {
            let _ = self.vault.delete(&entry_id, slot);
        }
        self.changed = true;
        Ok(())
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
