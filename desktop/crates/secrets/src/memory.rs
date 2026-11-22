use std::collections::BTreeMap;
use std::sync::Mutex;

use crate::{Secret, SecretError, SecretKey, SecretStore, StoreKind, check_len, lock};

/// Secrets held in this process only: tests, and a session without a configuration directory.
#[derive(Debug, Default)]
pub struct MemoryStore {
    items: Mutex<BTreeMap<SecretKey, Secret>>,
}

impl MemoryStore {
    pub fn new() -> MemoryStore {
        MemoryStore::default()
    }
}

impl SecretStore for MemoryStore {
    fn kind(&self) -> StoreKind {
        StoreKind::Memory
    }

    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError> {
        Ok(lock(&self.items).get(key).cloned())
    }

    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError> {
        check_len(key.kind, secret)?;
        lock(&self.items).insert(key.clone(), secret.clone());
        Ok(())
    }

    fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
        lock(&self.items).remove(key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_model::EntryId;

    use super::*;
    use crate::SecretKind;

    fn key(kind: SecretKind) -> SecretKey {
        SecretKey::new(EntryId::local(), kind)
    }

    #[test]
    fn set_get_and_delete_round_trip() {
        let store = MemoryStore::new();
        assert_eq!(store.kind(), StoreKind::Memory);
        let (pw, link) = (key(SecretKind::Password), key(SecretKind::PairingLink));
        assert_eq!(store.get(&pw), Ok(None));
        store.set(&pw, &Secret::new("one")).unwrap();
        store.set(&link, &Secret::new("link")).unwrap();
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "one");
        store.set(&pw, &Secret::new("two")).unwrap();
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "two");
        store.delete(&pw).unwrap();
        assert_eq!(store.get(&pw), Ok(None));
        assert_eq!(store.get(&link).unwrap().unwrap().expose(), "link");
    }

    #[test]
    fn deleting_an_absent_key_succeeds() {
        let store = MemoryStore::new();
        store.delete(&key(SecretKind::Password)).unwrap();
        store.set(&key(SecretKind::Password), &Secret::new("x")).unwrap();
        store.delete(&key(SecretKind::Password)).unwrap();
        store.delete(&key(SecretKind::Password)).unwrap();
    }

    #[test]
    fn a_refused_value_changes_nothing() {
        let store = MemoryStore::new();
        let k = key(SecretKind::Password);
        store.set(&k, &Secret::new("kept")).unwrap();
        assert!(store.set(&k, &Secret::new("x".repeat(1025))).is_err());
        assert!(store.set(&k, &Secret::new("")).is_err());
        assert_eq!(store.get(&k).unwrap().unwrap().expose(), "kept");
    }

    #[test]
    fn the_store_does_not_show_its_secrets() {
        let store = MemoryStore::new();
        store.set(&key(SecretKind::Password), &Secret::new("hunter2-MARKER")).unwrap();
        assert!(!format!("{store:?}").contains("MARKER"));
    }
}
