//! A keychain that lives in memory, for tests of this crate and of the callers of a
//! [`KeychainStore`](crate::KeychainStore): it can wait before every call (a keychain that is
//! showing a prompt), fail on demand, and count the calls. It stands in for the operating system's
//! store behind `KeychainStore::with_backend`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use keyring_core::api::{CredentialApi, CredentialStoreApi};
use keyring_core::{Credential, CredentialPersistence, Entry, Error};

use crate::lock;

/// How the next calls fail (see [`FakeKeychain::fail_with`]); each is what a real store reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FakeFailure {
    /// The keychain is locked or the user refused (`Denied`).
    NoAccess,
    /// The platform call failed (`Failed`; `Unavailable` when probing).
    Platform,
    /// The stored value is not text (`Failed`).
    BadEncoding,
}

impl FakeFailure {
    fn error(self) -> Error {
        match self {
            FakeFailure::NoAccess => Error::NoStorageAccess("fake keychain: locked".into()),
            FakeFailure::Platform => Error::PlatformFailure("fake keychain: failure".into()),
            FakeFailure::BadEncoding => Error::BadEncoding(b"fake keychain: not text".to_vec()),
        }
    }
}

#[derive(Default)]
struct Shared {
    /// `(service, user)` to the stored bytes.
    items: Mutex<BTreeMap<(String, String), Vec<u8>>>,
    delay: Mutex<Duration>,
    failure: Mutex<Option<FakeFailure>>,
    calls: AtomicUsize,
}

/// An in-memory credential store. Clones share their items, delay and failure, so a test keeps one
/// handle and gives another to the store under test.
#[derive(Clone, Default)]
pub struct FakeKeychain {
    shared: Arc<Shared>,
}

impl FakeKeychain {
    pub fn new() -> FakeKeychain {
        FakeKeychain::default()
    }

    /// A keychain that waits `delay` inside every get, set and delete, like one that is waiting for
    /// the user to answer a prompt.
    pub fn blocking(delay: Duration) -> FakeKeychain {
        let fake = FakeKeychain::new();
        fake.set_delay(delay);
        fake
    }

    /// Change the wait of every later call.
    pub fn set_delay(&self, delay: Duration) {
        *lock(&self.shared.delay) = delay;
    }

    /// Make every later call fail like this, or stop failing with `None`.
    pub fn fail_with(&self, failure: Option<FakeFailure>) {
        *lock(&self.shared.failure) = failure;
    }

    /// How many gets, sets and deletes have been made (failed ones included).
    pub fn calls(&self) -> usize {
        self.shared.calls.load(Ordering::SeqCst)
    }

    /// The stored bytes of one item, for a test to look at what the store wrote.
    pub fn held(&self, service: &str, user: &str) -> Option<Vec<u8>> {
        lock(&self.shared.items).get(&(service.to_string(), user.to_string())).cloned()
    }

    /// Every `(service, user)` held, in order.
    pub fn names(&self) -> Vec<(String, String)> {
        lock(&self.shared.items).keys().cloned().collect()
    }

    /// Put bytes in as another application could have, whatever they are.
    pub fn put_raw(&self, service: &str, user: &str, bytes: &[u8]) {
        lock(&self.shared.items).insert((service.to_string(), user.to_string()), bytes.to_vec());
    }
}

impl std::fmt::Debug for FakeKeychain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FakeKeychain").field("items", &lock(&self.shared.items).len()).finish()
    }
}

impl CredentialStoreApi for FakeKeychain {
    fn vendor(&self) -> String {
        "Fake keychain, pistudiodesktop-secrets".to_string()
    }

    fn id(&self) -> String {
        "fake".to_string()
    }

    fn build(&self, service: &str, user: &str, _modifiers: Option<&std::collections::HashMap<&str, &str>>) -> keyring_core::Result<Entry> {
        Ok(Entry::new_with_credential(Arc::new(FakeCredential { shared: self.shared.clone(), name: (service.to_string(), user.to_string()) })))
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn persistence(&self) -> CredentialPersistence {
        CredentialPersistence::ProcessOnly
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

struct FakeCredential {
    shared: Arc<Shared>,
    name: (String, String),
}

impl FakeCredential {
    /// What every call does first: count, wait, fail when told to.
    fn enter(&self) -> keyring_core::Result<()> {
        self.shared.calls.fetch_add(1, Ordering::SeqCst);
        let delay = *lock(&self.shared.delay);
        if !delay.is_zero() {
            std::thread::sleep(delay);
        }
        match *lock(&self.shared.failure) {
            Some(failure) => Err(failure.error()),
            None => Ok(()),
        }
    }
}

impl CredentialApi for FakeCredential {
    fn set_secret(&self, secret: &[u8]) -> keyring_core::Result<()> {
        self.enter()?;
        lock(&self.shared.items).insert(self.name.clone(), secret.to_vec());
        Ok(())
    }

    fn get_secret(&self) -> keyring_core::Result<Vec<u8>> {
        self.enter()?;
        lock(&self.shared.items).get(&self.name).cloned().ok_or(Error::NoEntry)
    }

    fn delete_credential(&self) -> keyring_core::Result<()> {
        self.enter()?;
        lock(&self.shared.items).remove(&self.name).map(|_| ()).ok_or(Error::NoEntry)
    }

    fn get_credential(&self) -> keyring_core::Result<Option<Arc<Credential>>> {
        self.enter()?;
        if lock(&self.shared.items).contains_key(&self.name) { Ok(None) } else { Err(Error::NoEntry) }
    }

    fn get_specifiers(&self) -> Option<(String, String)> {
        Some(self.name.clone())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The name only: never the value.
        f.debug_struct("FakeCredential").field("name", &self.name).finish()
    }
}
