//! The engine's side of the secret store: a [`Vault`] that a session holds, and the one rule for
//! which item an entry's secret is.
//!
//! A store call may block (the keychain can wait for the user to answer a system prompt), so
//! nothing the thread that owns a session runs in answer to a page or control request may wait on
//! one. The rule that keeps it so is in `docs/architecture.md` § Decisions: the session only
//! *plans* a read (`DialPlan` in `local.rs`) and hands out its store ([`Session::secret_store`]),
//! and the caller does the blocking step on a thread of its own. `daemon.add`, `.update` and
//! `.remove` are split the same way (`SecretJob` in `secret_job.rs`). The one call that still runs
//! where the session lives is at launch: migration, before any window or owner thread exists.
//!
//! The browser build has no store: reads are not planned there, and a command that must store a
//! secret fails with `secret_store_failed`.

use pistudiodesktop_model::Kind;

/// The code a command answers with when a secret could not be stored.
pub(crate) const STORE_FAILED: &str = "secret_store_failed";

/// Which item of an entry a secret is: a relay entry's is its pairing link, the others' a password;
/// an SSH entry also has the account's password and the identity file's passphrase.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    Password,
    PairingLink,
    SshPassword,
    SshPassphrase,
}

impl Slot {
    /// The slot of the secret an entry of `kind` is dialled with: the daemon's password, or a
    /// relay entry's pairing link.
    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) fn of(kind: Kind) -> Slot {
        if kind == Kind::Relay { Slot::PairingLink } else { Slot::Password }
    }

    /// Every slot an entry of `kind` can have an item in.
    pub(crate) fn all_of(kind: Kind) -> &'static [Slot] {
        match kind {
            Kind::Relay => &[Slot::PairingLink],
            Kind::Ssh => &[Slot::Password, Slot::SshPassword, Slot::SshPassphrase],
            Kind::Local | Kind::Direct => &[Slot::Password],
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::sync::Arc;

    use pistudiodesktop_model::{EntryId, MigratedSecret, Secret};
    use pistudiodesktop_secrets::{MemoryStore, SecretError, SecretKey, SecretKind, SecretStore};

    use super::{STORE_FAILED, Slot};

    pub(crate) fn key(id: &EntryId, slot: Slot) -> SecretKey {
        SecretKey::new(
            id.clone(),
            match slot {
                Slot::Password => SecretKind::Password,
                Slot::PairingLink => SecretKind::PairingLink,
                Slot::SshPassword => SecretKind::SshPassword,
                Slot::SshPassphrase => SecretKind::SshPassphrase,
            },
        )
    }

    /// The code a read that failed answers with: the item is missing, or the store cannot say.
    pub(crate) fn read_code(result: Result<Option<pistudiodesktop_secrets::Secret>, SecretError>) -> Result<pistudiodesktop_secrets::Secret, &'static str> {
        match result {
            Ok(Some(secret)) => Ok(secret),
            Ok(None) => Err("secret_missing"),
            Err(e) => {
                // The error text never holds a secret; the code is enough for the log.
                log::warn!("the secret store could not be read: {}", e.code());
                Err("secret_unavailable")
            }
        }
    }

    /// A session's secret store.
    #[derive(Clone)]
    pub(crate) struct Vault {
        pub(crate) store: Arc<dyn SecretStore>,
    }

    impl Default for Vault {
        fn default() -> Self {
            Vault { store: Arc::new(MemoryStore::default()) }
        }
    }

    impl Vault {
        pub(crate) fn with(store: Arc<dyn SecretStore>) -> Vault {
            Vault { store }
        }

        pub(crate) fn set(&self, id: &EntryId, slot: Slot, secret: &Secret) -> Result<(), &'static str> {
            self.store.set(&key(id, slot), &pistudiodesktop_secrets::Secret::new(secret.expose())).map_err(|e| {
                log::warn!("the secret store refused a secret: {}", e.code());
                STORE_FAILED
            })
        }

        /// Remove the item. Removing one that is absent succeeds.
        pub(crate) fn delete(&self, id: &EntryId, slot: Slot) -> Result<(), &'static str> {
            self.store.delete(&key(id, slot)).map_err(|e| {
                log::warn!("the secret store could not remove a secret of entry {}: {}", id.as_str(), e.code());
                STORE_FAILED
            })
        }

        /// Store every secret a version 1 file held. `true` when all are stored.
        pub(crate) fn migrate(&self, secrets: &[MigratedSecret]) -> bool {
            secrets.iter().all(|m| self.set(&m.id, Slot::of(m.kind), &m.secret).is_ok())
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use native::{Vault, key, read_code};

#[cfg(target_arch = "wasm32")]
use pistudiodesktop_model::{EntryId, Secret};

/// The browser build holds no secret.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Default)]
pub(crate) struct Vault;

#[cfg(target_arch = "wasm32")]
impl Vault {
    pub(crate) fn set(&self, _: &EntryId, _: Slot, _: &Secret) -> Result<(), &'static str> {
        Err(STORE_FAILED)
    }

    pub(crate) fn delete(&self, _: &EntryId, _: Slot) -> Result<(), &'static str> {
        Ok(())
    }
}

#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod tests;
