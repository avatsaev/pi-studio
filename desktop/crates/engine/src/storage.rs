//! What the app keeps on disk besides documents: the settings, the workbench's stored keys, and
//! the files they live in, relative to one configuration directory:
//!
//! - `settings.json`: the settings and the global workbench keys;
//! - `daemon-state/<entry id>.json`: the current daemon entry's workbench keys.
//!
//! The workbench's keys are opaque strings written many times a second, so they are a plain API on
//! [`Session`](crate::Session), not commands; settings change only through `settings.set`. A
//! session without a configuration directory keeps everything in memory and writes nothing.
//! Log lines never contain a stored value.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use pistudiodesktop_model::{
    EntryId, EntryState, LOCAL_ENTRY, LimitError, MAX_KEY_BYTES, Scope, Settings, check_put, encode_entry_state, encode_settings, scope_of,
};
use serde_json::Value;

use crate::{EngineError, Result};

const SETTINGS_FILE: &str = "settings.json";
const ENTRY_DIR: &str = "daemon-state";

/// Something the user should be told once: a file could not be used and was set aside.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Notice {
    FileReset {
        /// The file that was reset, relative to the configuration directory.
        file: String,
        /// The set-aside file's new name, in the same directory. `None` when it could not be renamed.
        kept_as: Option<String>,
    },
}

impl Notice {
    /// `{ kind: "file_reset", file, keptAs }`.
    pub fn to_json(&self) -> Value {
        match self {
            Notice::FileReset { file, kept_as } => serde_json::json!({"kind": "file_reset", "file": file, "keptAs": kept_as}),
        }
    }
}

/// The id of the daemon entry whose keys are in use: `local` for now, the entry that always
/// exists. The registry replaces this body with the selected entry. `None` means there is no
/// current entry, and its keys then stay in memory.
pub fn current_entry_id() -> Option<EntryId> {
    EntryId::parse(LOCAL_ENTRY).ok()
}

fn entry_file(id: &EntryId) -> String {
    format!("{ENTRY_DIR}/{}.json", id.as_str())
}

pub(crate) struct Storage {
    /// `None`: in memory only.
    dir: Option<PathBuf>,
    settings: Settings,
    /// The settings file has changes that are not on disk.
    settings_unwritten: bool,
    entry: Option<EntryId>,
    entry_state: EntryState,
    entry_unwritten: bool,
}

impl Default for Storage {
    fn default() -> Self {
        Storage {
            dir: None,
            settings: Settings::default(),
            settings_unwritten: false,
            entry: current_entry_id(),
            entry_state: EntryState::default(),
            entry_unwritten: false,
        }
    }
}

impl Storage {
    /// Read the files in `dir`. Nothing is created: a missing file or directory means defaults.
    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) fn open(dir: PathBuf) -> (Storage, Vec<Notice>) {
        let mut notices = Vec::new();
        let mut storage = Storage::default();
        if let Some(settings) = load(&dir, SETTINGS_FILE, |bytes| pistudiodesktop_model::decode_settings(bytes).ok(), &mut notices) {
            storage.settings = settings;
        }
        if let Some(id) = &storage.entry
            && let Some(state) = load(&dir, &entry_file(id), |bytes| pistudiodesktop_model::decode_entry_state(bytes).ok(), &mut notices)
        {
            storage.entry_state = state;
        }
        storage.dir = Some(dir);
        (storage, notices)
    }

    pub(crate) fn settings(&self) -> &Settings {
        &self.settings
    }

    /// Change one setting and write `settings.json` before returning. When the write fails the
    /// setting is as it was and the error says so.
    pub(crate) fn set_setting(&mut self, name: &str, value: &Value) -> Result<()> {
        let before = (self.settings.auto_start_local_daemon, self.settings.cli_path.clone());
        self.settings.set(name, value).map_err(|e| EngineError::BadParams(e.to_string()))?;
        let was_unwritten = self.settings_unwritten;
        self.mark_unwritten(Scope::Global);
        self.write(Scope::Global).inspect_err(|_| {
            (self.settings.auto_start_local_daemon, self.settings.cli_path) = before;
            self.settings_unwritten = was_unwritten;
        })
    }

    /// The global keys plus the current entry's, as the workbench's boot snapshot.
    pub(crate) fn snapshot(&self) -> BTreeMap<String, String> {
        let mut all = self.entry_state.keys.clone();
        all.extend(self.settings.workbench.iter().map(|(k, v)| (k.clone(), v.clone())));
        all
    }

    /// Store one key in its scope. A key or value that breaks a cap is dropped, the previous value
    /// stays, and the error is returned (the log line names the key only).
    pub(crate) fn put(&mut self, key: &str, value: &str) -> std::result::Result<(), LimitError> {
        let scope = scope_of(key);
        let keys = match scope {
            Scope::Global => &mut self.settings.workbench,
            Scope::Entry => &mut self.entry_state.keys,
        };
        if let Err(e) = check_put(keys, key, value) {
            if key.len() <= MAX_KEY_BYTES {
                log::warn!("dropped a stored value for `{key}`: {e}");
            } else {
                log::warn!("dropped a stored value with an over-long key: {e}");
            }
            return Err(e);
        }
        if keys.get(key).is_some_and(|old| old == value) {
            return Ok(());
        }
        keys.insert(key.to_owned(), value.to_owned());
        self.mark_unwritten(scope);
        Ok(())
    }

    pub(crate) fn unwritten(&self) -> bool {
        self.settings_unwritten || self.entry_unwritten
    }

    /// Write every scope that changed. A scope that fails stays unwritten, the others are still
    /// tried, and the first error is returned.
    pub(crate) fn flush(&mut self) -> Result<()> {
        let mut first = None;
        for scope in [Scope::Global, Scope::Entry] {
            if self.is_unwritten(scope)
                && let Err(e) = self.write(scope)
            {
                first.get_or_insert(e);
            }
        }
        first.map_or(Ok(()), Err)
    }

    fn is_unwritten(&self, scope: Scope) -> bool {
        match scope {
            Scope::Global => self.settings_unwritten,
            Scope::Entry => self.entry_unwritten,
        }
    }

    fn set_unwritten(&mut self, scope: Scope, value: bool) {
        match scope {
            Scope::Global => self.settings_unwritten = value,
            Scope::Entry => self.entry_unwritten = value,
        }
    }

    /// Something to write only where a file will be written.
    fn mark_unwritten(&mut self, scope: Scope) {
        if self.dir.is_some() && (scope == Scope::Global || self.entry.is_some()) {
            self.set_unwritten(scope, true);
        }
    }

    /// The only writer of both files (`settings.json` has two kinds of change: a setting and a
    /// global key).
    fn write(&mut self, scope: Scope) -> Result<()> {
        let (Some(dir), Some((file, bytes))) = (&self.dir, self.encode(scope)) else {
            self.set_unwritten(scope, false);
            return Ok(());
        };
        match write_file(dir, &file, &bytes) {
            Ok(()) => {
                self.set_unwritten(scope, false);
                Ok(())
            }
            Err(e) => {
                log::warn!("cannot write {file}: {e}");
                Err(EngineError::Other(format!("cannot write {file}: {e}")))
            }
        }
    }

    /// The scope's file name and content; `None` when the scope has no file (no current entry).
    fn encode(&self, scope: Scope) -> Option<(String, Vec<u8>)> {
        match scope {
            Scope::Global => Some((SETTINGS_FILE.to_owned(), encode_settings(&self.settings))),
            Scope::Entry => self.entry.as_ref().map(|id| (entry_file(id), encode_entry_state(&self.entry_state))),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn load<T>(dir: &Path, file: &str, decode: fn(&[u8]) -> Option<T>, notices: &mut Vec<Notice>) -> Option<T> {
    use pistudiodesktop_store::Loaded;
    match pistudiodesktop_store::read(&dir.join(file), decode) {
        Loaded::Missing => None,
        Loaded::Value(value) => Some(value),
        Loaded::Reset { kept_as } => {
            notices.push(Notice::FileReset { file: file.to_owned(), kept_as });
            None
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn write_file(dir: &Path, file: &str, bytes: &[u8]) -> std::io::Result<()> {
    pistudiodesktop_store::write_atomic(&dir.join(file), bytes)
}

/// The browser build has no configuration directory, so a session there never has a `dir`.
#[cfg(target_arch = "wasm32")]
fn write_file(_: &Path, _: &str, _: &[u8]) -> std::io::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "files are not available in the browser build"))
}

#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod tests {
    use pistudiodesktop_model::{MAX_VALUE_BYTES, decode_settings};
    use serde_json::json;

    use crate::{EngineError, Notice, Session};

    fn names(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    fn open(dir: &std::path::Path) -> (Session, Vec<Notice>) {
        Session::with_config_dir(dir)
    }

    #[test]
    fn an_empty_directory_gives_defaults_and_creates_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, notices) = open(dir.path());
        assert!(notices.is_empty());
        assert_eq!(s.execute("settings.get", json!({})).unwrap(), json!({"autoStartLocalDaemon": true, "cliPath": null}));
        assert!(s.storage_snapshot().is_empty());
        assert!(!s.storage_unwritten());
        s.storage_flush().unwrap();
        assert!(names(dir.path()).is_empty());
        // A directory that does not exist yet is fine too.
        let (s, notices) = open(&dir.path().join("later"));
        assert!(notices.is_empty() && !s.storage_unwritten());
        assert!(!dir.path().join("later").exists());
    }

    #[test]
    fn a_setting_is_written_before_the_answer_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        let answer = s.execute("settings.set", json!({"key": "autoStartLocalDaemon", "value": false})).unwrap();
        assert_eq!(answer, json!({"autoStartLocalDaemon": false, "cliPath": null}));
        let on_disk = decode_settings(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
        assert!(!on_disk.auto_start_local_daemon);
        assert!(!s.storage_unwritten());
        s.execute("settings.set", json!({"key": "cliPath", "value": "/opt/pi"})).unwrap();

        let (mut again, notices) = open(dir.path());
        assert!(notices.is_empty());
        assert_eq!(again.execute("settings.get", json!({})).unwrap(), json!({"autoStartLocalDaemon": false, "cliPath": "/opt/pi"}));
    }

    #[test]
    fn a_rejected_setting_leaves_the_file_alone() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        s.execute("settings.set", json!({"key": "cliPath", "value": "/ok"})).unwrap();
        let before = std::fs::read(dir.path().join("settings.json")).unwrap();
        for (key, value) in [("nope", json!(1)), ("autoStartLocalDaemon", json!("yes")), ("cliPath", json!(7)), ("cliPath", json!("a".repeat(4097)))] {
            let e = s.execute("settings.set", json!({"key": key, "value": value})).unwrap_err();
            assert!(matches!(e, EngineError::BadParams(_)), "{key}: {e}");
        }
        assert!(matches!(s.execute("settings.set", json!({"key": "cliPath"})), Err(EngineError::BadParams(_))));
        assert!(matches!(s.execute("settings.set", json!({"value": 1})), Err(EngineError::BadParams(_))));
        assert_eq!(std::fs::read(dir.path().join("settings.json")).unwrap(), before);
        assert_eq!(s.settings().cli_path.as_deref(), Some("/ok"));
        // The longest path is accepted.
        s.execute("settings.set", json!({"key": "cliPath", "value": "a".repeat(4096)})).unwrap();
    }

    #[test]
    fn keys_land_in_their_scope_and_survive_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        s.storage_set("pi-studio-appearance", "dark").unwrap();
        s.storage_set("pi-studio-pane-layout", "{\"a\":1}").unwrap();
        assert!(s.storage_unwritten());
        assert!(names(dir.path()).is_empty(), "nothing is written until a flush");
        s.storage_flush().unwrap();
        assert!(!s.storage_unwritten());

        let settings = decode_settings(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings.workbench.get("pi-studio-appearance").map(String::as_str), Some("dark"));
        assert!(!settings.workbench.contains_key("pi-studio-pane-layout"));
        let entry: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.path().join("daemon-state/local.json")).unwrap()).unwrap();
        assert_eq!(entry["keys"], json!({"pi-studio-pane-layout": "{\"a\":1}"}));

        let (again, _) = open(dir.path());
        let snapshot = again.storage_snapshot();
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot.get("pi-studio-appearance").map(String::as_str), Some("dark"));
        assert_eq!(snapshot.get("pi-studio-pane-layout").map(String::as_str), Some("{\"a\":1}"));
    }

    #[test]
    fn only_the_changed_scope_is_written_and_an_unchanged_value_is_not_a_change() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        s.storage_set("pi-studio-pane-layout", "x").unwrap();
        s.storage_flush().unwrap();
        assert_eq!(names(dir.path()), ["daemon-state"]);
        s.storage_set("pi-studio-pane-layout", "x").unwrap();
        assert!(!s.storage_unwritten());
    }

    #[test]
    fn a_setting_write_carries_pending_global_keys() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        s.storage_set("pi-studio-appearance", "light").unwrap();
        s.execute("settings.set", json!({"key": "autoStartLocalDaemon", "value": false})).unwrap();
        assert!(!s.storage_unwritten());
        let (again, _) = open(dir.path());
        assert_eq!(again.storage_snapshot().get("pi-studio-appearance").map(String::as_str), Some("light"));
    }

    #[test]
    fn a_value_over_the_cap_is_dropped_and_the_old_value_stays() {
        let mut s = Session::new();
        s.storage_set("k", "old").unwrap();
        assert!(s.storage_set("k", &"a".repeat(MAX_VALUE_BYTES + 1)).is_err());
        assert_eq!(s.storage_snapshot().get("k").map(String::as_str), Some("old"));
        assert!(s.storage_set("k", &"a".repeat(MAX_VALUE_BYTES)).is_ok());
        assert!(s.storage_set("", "v").is_err());
    }

    #[test]
    fn an_in_memory_session_writes_nothing_and_is_never_unwritten() {
        let mut s = Session::new();
        s.storage_set("pi-studio-appearance", "dark").unwrap();
        s.storage_set("other", "v").unwrap();
        s.execute("settings.set", json!({"key": "cliPath", "value": "/x"})).unwrap();
        assert!(!s.storage_unwritten());
        s.storage_flush().unwrap();
        assert_eq!(s.storage_snapshot().len(), 2);
    }

    #[test]
    fn a_corrupt_settings_file_gives_defaults_a_kept_file_and_one_notice() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), b"{ not json").unwrap();
        let (mut s, notices) = open(dir.path());
        assert_eq!(s.execute("settings.get", json!({})).unwrap(), json!({"autoStartLocalDaemon": true, "cliPath": null}));
        let [Notice::FileReset { file, kept_as: Some(kept) }] = notices.as_slice() else { panic!("one notice with a kept name: {notices:?}") };
        assert_eq!(file, "settings.json");
        assert!(kept.starts_with("settings.json.corrupt-"), "{kept}");
        assert_eq!(std::fs::read(dir.path().join(kept)).unwrap(), b"{ not json");
        assert!(!dir.path().join("settings.json").exists());
        assert_eq!(notices[0].to_json(), json!({"kind": "file_reset", "file": "settings.json", "keptAs": kept}));
    }

    #[test]
    fn an_unknown_version_is_a_reset_too() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), br#"{"version":99}"#).unwrap();
        let (_, notices) = open(dir.path());
        assert_eq!(notices.len(), 1);
    }

    #[test]
    fn a_corrupt_state_file_costs_only_that_entrys_keys() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        s.storage_set("pi-studio-appearance", "dark").unwrap();
        s.storage_set("pi-studio-pane-layout", "x").unwrap();
        s.storage_flush().unwrap();
        std::fs::write(dir.path().join("daemon-state/local.json"), b"garbage").unwrap();

        let (again, notices) = open(dir.path());
        let [Notice::FileReset { file, kept_as: Some(_) }] = notices.as_slice() else { panic!("one notice: {notices:?}") };
        assert_eq!(file, "daemon-state/local.json");
        let snapshot = again.storage_snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot.get("pi-studio-appearance").map(String::as_str), Some("dark"));
    }

    #[test]
    fn a_flush_that_cannot_write_stays_unwritten_and_retries() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        // A non-empty directory where the file goes: the rename over it fails.
        std::fs::create_dir_all(dir.path().join("settings.json")).unwrap();
        std::fs::write(dir.path().join("settings.json/keep"), b"k").unwrap();
        s.storage_set("pi-studio-appearance", "dark").unwrap();
        s.storage_set("pi-studio-pane-layout", "x").unwrap();
        let e = s.storage_flush().unwrap_err();
        assert!(e.to_string().contains("settings.json"), "{e}");
        assert!(!e.to_string().contains("dark"));
        assert!(s.storage_unwritten());
        assert!(dir.path().join("daemon-state/local.json").exists(), "the other scope is still written");

        std::fs::remove_dir_all(dir.path().join("settings.json")).unwrap();
        s.storage_flush().unwrap();
        assert!(!s.storage_unwritten());
        assert!(dir.path().join("settings.json").is_file());
    }

    #[test]
    fn a_setting_that_cannot_be_written_is_an_error_and_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let (mut s, _) = open(dir.path());
        std::fs::create_dir_all(dir.path().join("settings.json")).unwrap();
        std::fs::write(dir.path().join("settings.json/keep"), b"k").unwrap();
        assert!(s.execute("settings.set", json!({"key": "cliPath", "value": "/x"})).is_err());
        assert_eq!(s.settings().cli_path, None);
        assert!(!s.storage_unwritten());
    }

    #[test]
    fn unknown_fields_in_the_files_are_kept_on_rewrite() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), br#"{"version":1,"future":{"a":1}}"#).unwrap();
        let (mut s, notices) = open(dir.path());
        assert!(notices.is_empty());
        s.execute("settings.set", json!({"key": "cliPath", "value": "/x"})).unwrap();
        let on_disk: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(on_disk["future"], json!({"a": 1}));
    }
}
