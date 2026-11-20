use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;

use pistudiodesktop_model::{EntryId, EntryView, LimitError, LocalState, NewEntry, Registry, Settings, Update};
use serde_json::{Map, Value};

use crate::local::LocalQueue;
use crate::storage::Storage;
use crate::{EngineError, Result, commands, params};

/// One user's working state: the settings and the workbench's stored keys.
pub struct Session {
    storage: Storage,
    local: LocalState,
    pub(crate) local_queue: LocalQueue,
    changed: bool,
}

impl Default for Session {
    fn default() -> Self {
        Session { storage: Storage::default(), local: LocalState::Checking, local_queue: LocalQueue::default(), changed: false }
    }
}

impl Session {
    /// A session with default settings that reads and writes no files (tests, the browser).
    pub fn new() -> Self {
        Self::default()
    }

    /// A session whose settings and workbench keys live in `dir`. Nothing is created: a missing
    /// file or directory means defaults, and files appear when something is written. The notices
    /// say which files could not be used and were set aside; the session starts either way.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn with_config_dir(dir: impl Into<PathBuf>) -> (Self, Vec<crate::Notice>) {
        let (storage, notices) = Storage::open(dir.into());
        (Session { storage, ..Session::default() }, notices)
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

    /// The registry. Secrets are in it: callers send only `Entry::view`s out.
    pub fn registry(&self) -> &Registry {
        self.storage.registry()
    }

    /// The entry whose stored keys are loaded: `lastUsedId` when that entry exists, else `local`.
    /// `None` only after the current entry was removed, until a switch.
    pub fn current_entry_id(&self) -> Option<&EntryId> {
        self.storage.current()
    }

    pub(crate) fn mark_changed(&mut self) {
        self.changed = true;
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

    /// Add an entry (see `daemon.add`); the registry is on disk before this returns.
    pub(crate) fn add_entry(&mut self, new: NewEntry) -> std::result::Result<EntryView, &'static str> {
        let view = self.storage.add_entry(new)?;
        self.changed = true;
        Ok(view)
    }

    pub(crate) fn update_entry(&mut self, id: &str, update: Update) -> std::result::Result<EntryView, &'static str> {
        let view = self.storage.update_entry(id, update)?;
        self.changed = true;
        Ok(view)
    }

    pub(crate) fn remove_entry(&mut self, id: &str) -> std::result::Result<(), &'static str> {
        self.storage.remove_entry(id)?;
        self.changed = true;
        Ok(())
    }

    pub fn settings(&self) -> &Settings {
        self.storage.settings()
    }

    pub(crate) fn set_setting(&mut self, name: &str, value: &Value) -> Result<()> {
        self.storage.set_setting(name, value)
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
