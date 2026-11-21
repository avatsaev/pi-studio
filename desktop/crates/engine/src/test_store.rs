//! A secret store for the engine's tests: a memory store that fails on demand, counts calls and
//! lists what it holds.

use std::collections::BTreeSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use pistudiodesktop_secrets::{MemoryStore, Secret, SecretError, SecretKey, SecretStore, StoreKind};

#[derive(Default)]
pub(crate) struct FakeStore {
    inner: MemoryStore,
    held: Mutex<BTreeSet<String>>,
    pub(crate) fail_set: AtomicBool,
    pub(crate) fail_get: AtomicBool,
    pub(crate) fail_delete: AtomicBool,
    pub(crate) calls: AtomicUsize,
}

impl FakeStore {
    pub(crate) fn has(&self, name: &str) -> bool {
        self.all().iter().any(|n| n == name)
    }

    /// The name of every item held, sorted.
    pub(crate) fn all(&self) -> Vec<String> {
        self.held.lock().map(|h| h.iter().cloned().collect()).unwrap_or_default()
    }

    /// Make every call fail.
    pub(crate) fn fail_all(&self) {
        for flag in [&self.fail_set, &self.fail_get, &self.fail_delete] {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// Take an item away without counting a call or failing (it vanishes behind the app's back).
    pub(crate) fn take(&self, name: &str) {
        if let Some(key) = SecretKey::parse(name) {
            let _ = self.inner.delete(&key);
            if let Ok(mut held) = self.held.lock() {
                held.remove(name);
            }
        }
    }

    pub(crate) fn value(&self, name: &str) -> Option<String> {
        let key = SecretKey::parse(name)?;
        self.inner.get(&key).ok().flatten().map(|s| s.expose().to_owned())
    }
}

fn refuse() -> SecretError {
    SecretError::Unavailable("the fake store is down".into())
}

impl SecretStore for FakeStore {
    fn kind(&self) -> StoreKind {
        StoreKind::Memory
    }

    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_get.load(Ordering::SeqCst) { Err(refuse()) } else { self.inner.get(key) }
    }

    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_set.load(Ordering::SeqCst) {
            return Err(refuse());
        }
        self.inner.set(key, secret)?;
        if let Ok(mut held) = self.held.lock() {
            held.insert(key.name());
        }
        Ok(())
    }

    fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(refuse());
        }
        self.inner.delete(key)?;
        if let Ok(mut held) = self.held.lock() {
            held.remove(&key.name());
        }
        Ok(())
    }
}
