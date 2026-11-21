use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use pistudiodesktop_store::{Loaded, read, write_private};
use serde::{Deserialize, Serialize};

use crate::{Secret, SecretError, SecretKey, SecretStore, StoreKind, check_len, lock};

/// The file's name in the configuration directory.
pub const FILE_NAME: &str = "secrets.json";

/// The document's version; any other is not understood and the file is set aside.
const VERSION: u32 = 1;

/// A `secrets.json` that could not be used and was set aside, for the caller to tell the user.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reset {
    /// The set-aside file's new name, in the same directory. `None` when it could not be renamed.
    /// The copy keeps mode 0600 and may hold secrets.
    pub kept_as: Option<String>,
}

/// A store opened with [`FileStore::open`].
#[derive(Debug)]
pub struct Opened {
    pub store: FileStore,
    /// `Some` once, when the file was unusable and the store started empty.
    pub reset: Option<Reset>,
}

/// Secrets in `secrets.json`, mode 0600 on Unix (the user profile's permissions on Windows):
/// `{ "version": 1, "items": { "<entry id>/<kind>": "<secret>" } }`.
///
/// The file is read once, at open; this store is its only writer. Every change is written
/// atomically before it is kept: when the write fails, the store and the file are as they were.
pub struct FileStore {
    path: PathBuf,
    items: Mutex<BTreeMap<SecretKey, Secret>>,
}

impl std::fmt::Debug for FileStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileStore").field("path", &self.path).finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct Document {
    version: u32,
    items: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct DocumentRef<'a> {
    version: u32,
    items: BTreeMap<String, &'a str>,
}

impl FileStore {
    /// Open `dir/secrets.json`. A missing file is an empty store and creates nothing. A file that
    /// cannot be read or understood is set aside (as the other files are) and the store starts empty.
    pub fn open(dir: &Path) -> Opened {
        let path = dir.join(FILE_NAME);
        let (items, reset) = match read(&path, decode) {
            Loaded::Missing => (BTreeMap::new(), None),
            Loaded::Value(items) => (items, None),
            Loaded::Reset { kept_as } => (BTreeMap::new(), Some(Reset { kept_as })),
        };
        Opened { store: FileStore { path, items: Mutex::new(items) }, reset }
    }

    fn save(&self, items: &BTreeMap<SecretKey, Secret>) -> Result<(), SecretError> {
        let doc = DocumentRef { version: VERSION, items: items.iter().map(|(k, v)| (k.name(), v.expose())).collect() };
        let bytes = serde_json::to_vec_pretty(&doc).map_err(|_| SecretError::Failed("the secrets could not be encoded".to_owned()))?;
        write_private(&self.path, &bytes).map_err(|e| {
            // The OS text names no path and no content; the log line says only the file's name.
            log::warn!("cannot write {FILE_NAME}: {e}");
            match e.kind() {
                ErrorKind::PermissionDenied => SecretError::Denied(format!("{FILE_NAME} cannot be written: {e}")),
                _ => SecretError::Failed(format!("{FILE_NAME} cannot be written: {e}")),
            }
        })
    }
}

impl SecretStore for FileStore {
    fn kind(&self) -> StoreKind {
        StoreKind::File
    }

    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError> {
        Ok(lock(&self.items).get(key).cloned())
    }

    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError> {
        check_len(key.kind, secret)?;
        let mut items = lock(&self.items);
        let previous = items.insert(key.clone(), secret.clone());
        let saved = self.save(&items);
        if saved.is_err() {
            match previous {
                Some(old) => items.insert(key.clone(), old),
                None => items.remove(key),
            };
        }
        saved
    }

    fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
        let mut items = lock(&self.items);
        // Nothing to remove: succeed without writing, so that no file appears for a no-op.
        let Some(old) = items.remove(key) else { return Ok(()) };
        let saved = self.save(&items);
        if saved.is_err() {
            items.insert(key.clone(), old);
        }
        saved
    }
}

/// Decode the document. Anything unexpected (not JSON, another version, a key that is not
/// `<entry id>/<kind>`, a value that would be refused) refuses the whole file, which is then set
/// aside whole: a partial load would drop secrets without a trace on the next write.
fn decode(bytes: &[u8]) -> Option<BTreeMap<SecretKey, Secret>> {
    let doc: Document = serde_json::from_slice(bytes).ok()?;
    if doc.version != VERSION {
        return None;
    }
    let mut items = BTreeMap::new();
    for (name, value) in doc.items {
        let key = SecretKey::parse(&name)?;
        let secret = Secret::new(value);
        check_len(key.kind, &secret).ok()?;
        items.insert(key, secret);
    }
    Some(items)
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_model::EntryId;

    use super::*;
    use crate::SecretKind;

    const ID: &str = "123e4567-e89b-12d3-a456-426614174000";

    fn key(kind: SecretKind) -> SecretKey {
        SecretKey::new(EntryId::parse(ID).unwrap(), kind)
    }

    fn open(dir: &Path) -> FileStore {
        let opened = FileStore::open(dir);
        assert_eq!(opened.reset, None);
        opened.store
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[cfg(unix)]
    fn mode(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn set_get_and_delete_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        assert_eq!(store.kind(), StoreKind::File);
        let (pw, link) = (key(SecretKind::Password), key(SecretKind::PairingLink));
        assert_eq!(store.get(&pw), Ok(None));
        store.set(&pw, &Secret::new("one")).unwrap();
        store.set(&link, &Secret::new("link")).unwrap();
        store.set(&pw, &Secret::new("two")).unwrap();
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "two");
        store.delete(&pw).unwrap();
        assert_eq!(store.get(&pw), Ok(None));
        assert_eq!(store.get(&link).unwrap().unwrap().expose(), "link");
    }

    #[test]
    fn the_file_has_the_documented_shape() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        store.set(&key(SecretKind::Password), &Secret::new("p")).unwrap();
        store.set(&key(SecretKind::PairingLink), &Secret::new("l")).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.path().join("secrets.json")).unwrap()).unwrap();
        assert_eq!(json, serde_json::json!({"version": 1, "items": {format!("{ID}/password"): "p", format!("{ID}/pairingLink"): "l"}}));
        assert_eq!(names(dir.path()), ["secrets.json"]);
    }

    #[test]
    fn secrets_survive_a_reopen_and_a_delete_is_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        store.set(&key(SecretKind::Password), &Secret::new("p")).unwrap();
        store.set(&key(SecretKind::PairingLink), &Secret::new("l")).unwrap();
        store.delete(&key(SecretKind::Password)).unwrap();
        let again = open(dir.path());
        assert_eq!(again.get(&key(SecretKind::Password)), Ok(None));
        assert_eq!(again.get(&key(SecretKind::PairingLink)).unwrap().unwrap().expose(), "l");
    }

    #[test]
    fn deleting_an_absent_key_succeeds_and_creates_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        store.delete(&key(SecretKind::Password)).unwrap();
        assert!(names(dir.path()).is_empty());
        store.set(&key(SecretKind::Password), &Secret::new("x")).unwrap();
        store.delete(&key(SecretKind::Password)).unwrap();
        store.delete(&key(SecretKind::Password)).unwrap();
    }

    #[test]
    fn opening_creates_nothing_and_a_missing_directory_is_made_on_the_first_set() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("cfg").join("pi");
        let store = open(&nested);
        assert!(!nested.exists());
        store.set(&key(SecretKind::Password), &Secret::new("x")).unwrap();
        assert!(nested.join("secrets.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_0600_when_created_and_after_a_rewrite() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        let store = open(dir.path());
        store.set(&key(SecretKind::Password), &Secret::new("x")).unwrap();
        assert_eq!(mode(&path), 0o600);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        store.set(&key(SecretKind::PairingLink), &Secret::new("y")).unwrap();
        assert_eq!(mode(&path), 0o600);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        store.delete(&key(SecretKind::Password)).unwrap();
        assert_eq!(mode(&path), 0o600);
    }

    #[test]
    fn a_value_over_the_cap_is_refused_and_nothing_changes() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let (pw, link) = (key(SecretKind::Password), key(SecretKind::PairingLink));
        store.set(&pw, &Secret::new("kept")).unwrap();
        let before = std::fs::read(dir.path().join("secrets.json")).unwrap();
        assert!(store.set(&pw, &Secret::new("x".repeat(1025))).is_err());
        assert!(store.set(&link, &Secret::new("x".repeat(4097))).is_err());
        assert!(store.set(&pw, &Secret::new("")).is_err());
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "kept");
        assert_eq!(store.get(&link), Ok(None));
        assert_eq!(std::fs::read(dir.path().join("secrets.json")).unwrap(), before);
        store.set(&link, &Secret::new("x".repeat(4096))).unwrap();
        store.set(&pw, &Secret::new("x".repeat(1024))).unwrap();
    }

    #[test]
    fn a_failed_write_leaves_the_store_as_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        let (pw, link) = (key(SecretKind::Password), key(SecretKind::PairingLink));
        store.set(&pw, &Secret::new("old")).unwrap();
        // The file's place is taken by a non-empty directory: the rename over it fails.
        std::fs::remove_file(dir.path().join("secrets.json")).unwrap();
        std::fs::create_dir(dir.path().join("secrets.json")).unwrap();
        std::fs::write(dir.path().join("secrets.json").join("keep"), b"k").unwrap();
        let err = store.set(&pw, &Secret::new("hunter2-MARKER")).unwrap_err();
        assert_eq!(err.code(), "failed");
        assert!(!format!("{err} {err:?}").contains("MARKER"));
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "old");
        assert!(store.set(&link, &Secret::new("l")).is_err());
        assert_eq!(store.get(&link), Ok(None));
        assert!(store.delete(&pw).is_err());
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "old");
    }

    #[cfg(unix)]
    #[test]
    fn a_corrupt_file_is_set_aside_with_its_mode_and_the_store_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.json");
        write_private(&path, b"{ not json hunter2-MARKER").unwrap();
        let opened = FileStore::open(dir.path());
        let Some(Reset { kept_as: Some(kept) }) = opened.reset else { panic!("expected a notice with a kept name: {:?}", opened.reset) };
        assert!(kept.starts_with("secrets.json.corrupt-"), "{kept}");
        assert!(!path.exists());
        assert_eq!(mode(&dir.path().join(&kept)), 0o600);
        assert_eq!(std::fs::read(dir.path().join(&kept)).unwrap(), b"{ not json hunter2-MARKER");
        assert_eq!(opened.store.get(&key(SecretKind::Password)), Ok(None));
        // The notice is returned once: the store now writes a fresh file and a reopen is quiet.
        opened.store.set(&key(SecretKind::Password), &Secret::new("fresh")).unwrap();
        assert_eq!(open(dir.path()).get(&key(SecretKind::Password)).unwrap().unwrap().expose(), "fresh");
        assert_eq!(names(dir.path()).len(), 2);
    }

    #[test]
    fn a_document_that_is_not_understood_is_set_aside_whole() {
        let id = ID;
        let cases = [
            "[]".to_owned(),
            r#"{"items":{}}"#.to_owned(),
            r#"{"version":2,"items":{}}"#.to_owned(),
            r#"{"version":1}"#.to_owned(),
            r#"{"version":1,"items":{"local/password":5}}"#.to_owned(),
            r#"{"version":1,"items":{"local/token":"x"}}"#.to_owned(),
            r#"{"version":1,"items":{"../x/password":"x"}}"#.to_owned(),
            format!(r#"{{"version":1,"items":{{"{id}/password":"ok","local/password":"{}"}}}}"#, "x".repeat(1025)),
            r#"{"version":1,"items":{"local/password":""}}"#.to_owned(),
        ];
        for text in cases {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("secrets.json"), &text).unwrap();
            let opened = FileStore::open(dir.path());
            assert!(matches!(opened.reset, Some(Reset { kept_as: Some(_) })), "{text}");
            assert_eq!(opened.store.get(&key(SecretKind::Password)), Ok(None), "{text}");
            assert!(!dir.path().join("secrets.json").exists(), "{text}");
        }
    }

    #[test]
    fn a_directory_in_place_of_the_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("secrets.json")).unwrap();
        let opened = FileStore::open(dir.path());
        assert!(matches!(opened.reset, Some(Reset { kept_as: Some(_) })));
    }

    #[test]
    fn nothing_the_store_prints_shows_a_secret() {
        let dir = tempfile::tempdir().unwrap();
        let store = open(dir.path());
        store.set(&key(SecretKind::Password), &Secret::new("hunter2-MARKER")).unwrap();
        let got = store.get(&key(SecretKind::Password)).unwrap();
        for shown in [format!("{store:?}"), format!("{got:?}"), format!("{:?}", store.get(&key(SecretKind::Password)))] {
            assert!(!shown.contains("MARKER"), "{shown}");
        }
    }
}
