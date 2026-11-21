//! Which secret store a launch uses: the operating system's keychain when it can be used, else
//! the file (`secrets.json` in the configuration directory), or what `--secret-store` says.
//!
//! The keychain is checked off the calling thread and within [`PROBE_TIMEOUT`] in all: the platform
//! store is opened and a missing item read ([`KeychainStore::probe`]), then a throwaway item is
//! written and deleted through the store. The read alone passes on a Secret Service whose default
//! collection is locked or absent, and the first real `set` would then fail with `Denied`; the
//! write finds that out here. The throwaway item is deleted at once, also when the caller has
//! already given up waiting (the worker thread finishes on its own); it has a fixed name, so one a
//! crash left behind is overwritten by the next check.
//!
//! The check can start before the configuration directory is known ([`start`]) and be collected
//! once it is ([`Pending::finish`]): the keychain's scope is fixed by the arguments, the file
//! store's directory is not.
//!
//! Without `--secret-store`, a keychain that cannot be used means the file, with a
//! [`Notice::SecretStoreFallback`] that names the reason. With `--secret-store keychain` it is an
//! error that names the option; with `file` the keychain is not touched at all.
//!
//! Nothing here logs or returns a secret: the error text of a store holds none.

use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::Notice;
use pistudiodesktop_model::EntryId;
use pistudiodesktop_secrets::{FILE_NAME, FileStore, KeychainStore, PROBE_TIMEOUT, Scope, Secret, SecretError, SecretKey, SecretKind, SecretStore};

/// What `--secret-store` asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preference {
    Keychain,
    File,
}

impl FromStr for Preference {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "keychain" => Ok(Preference::Keychain),
            "file" => Ok(Preference::File),
            other => Err(format!("`{}` is not a secret store; use `keychain` or `file`", other.chars().take(32).collect::<String>())),
        }
    }
}

/// The store a launch uses, and what the user should be told about how it was chosen or opened.
pub struct Chosen {
    pub store: Arc<dyn SecretStore>,
    pub notices: Vec<Notice>,
}

/// What the worker thread answers: a store that took and gave back a throwaway item, or why not.
type Probed = Result<Arc<dyn SecretStore>, SecretError>;

/// A keychain check in progress, started by [`start`].
pub struct Pending {
    preference: Option<Preference>,
    /// `None` when the keychain is not to be touched (`--secret-store file`).
    probe: Option<Receiver<Probed>>,
    deadline: Instant,
}

/// The keychain's scope for this launch: `default` without an explicit configuration directory,
/// otherwise a hash of the directory as it was given.
pub fn scope_for(explicit_config_dir: Option<&Path>) -> Scope {
    explicit_config_dir.map_or_else(Scope::standard, Scope::for_config_dir)
}

/// Start checking the platform keychain on a thread of its own, unless `preference` is `file`.
pub fn start(preference: Option<Preference>, scope: Scope) -> Pending {
    start_with(preference, move || KeychainStore::probe(scope).map(|store| Arc::new(store) as Arc<dyn SecretStore>), PROBE_TIMEOUT)
}

/// [`start`] with the way to open the store and the time allowed given, for tests.
fn start_with(preference: Option<Preference>, open: impl FnOnce() -> Probed + Send + 'static, timeout: Duration) -> Pending {
    let deadline = Instant::now() + timeout;
    if preference == Some(Preference::File) {
        return Pending { preference, probe: None, deadline };
    }
    let (tx, rx) = mpsc::channel();
    let spawned = std::thread::Builder::new().name("secret-store-check".to_owned()).spawn(move || {
        // The receiver is gone when the caller gave up waiting: the answer is no longer wanted,
        // but the throwaway item was still deleted by `exercise`.
        tx.send(exercise(open)).ok();
    });
    if let Err(e) = spawned {
        let (tx, rx) = mpsc::channel();
        tx.send(Err(SecretError::Failed(format!("cannot start the keychain check: {e}")))).ok();
        return Pending { preference, probe: Some(rx), deadline };
    }
    Pending { preference, probe: Some(rx), deadline }
}

/// Open the store, write a throwaway item and delete it.
fn exercise(open: impl FnOnce() -> Probed) -> Probed {
    let store = open()?;
    // A name no entry can have (the nil UUID is not one that `EntryId` generates), so the check
    // never touches a real secret.
    let id = EntryId::parse("00000000-0000-4000-8000-000000000000").map_err(|_| SecretError::Failed("the check item has no valid name".to_owned()))?;
    let key = SecretKey::new(id, SecretKind::Password);
    store.set(&key, &Secret::new("probe"))?;
    if let Err(e) = store.delete(&key) {
        // The write worked, so the store can be used; the item is overwritten by the next check.
        log::warn!("the keychain check's throwaway item could not be deleted: {}", e.code());
    }
    Ok(store)
}

impl Pending {
    /// Wait for the check (what is left of its time) and open the file store in `config_dir`
    /// when the keychain is not used. The error names `--secret-store` when the keychain was asked for.
    pub fn finish(self, config_dir: &Path) -> Result<Chosen, String> {
        let mut notices = Vec::new();
        if let Some(rx) = self.probe {
            // `recv_timeout(0)` still takes an answer that is already there.
            let waited = rx.recv_timeout(self.deadline.saturating_duration_since(Instant::now()));
            let probed = match waited {
                Ok(answer) => answer,
                Err(RecvTimeoutError::Timeout) => Err(SecretError::Unavailable("the keychain did not answer in time".to_owned())),
                Err(RecvTimeoutError::Disconnected) => Err(SecretError::Failed("the keychain check stopped without answering".to_owned())),
            };
            match probed {
                Ok(store) => return Ok(Chosen { store, notices }),
                Err(e) if self.preference == Some(Preference::Keychain) => {
                    return Err(format!(
                        "--secret-store keychain: the keychain cannot be used ({e}); use --secret-store file to keep secrets in {FILE_NAME} instead"
                    ));
                }
                Err(e) => {
                    log::warn!("the keychain cannot be used, secrets go to {FILE_NAME}: {e}");
                    notices.push(Notice::SecretStoreFallback { reason: e.code().to_owned() });
                }
            }
        }
        let opened = FileStore::open(config_dir);
        if let Some(reset) = opened.reset {
            notices.push(Notice::FileReset { file: FILE_NAME.to_owned(), kept_as: reset.kept_as });
        }
        Ok(Chosen { store: Arc::new(opened.store), notices })
    }
}

/// [`start`] and [`Pending::finish`] in one, for a caller that knows its directory already.
pub fn choose(preference: Option<Preference>, scope: Scope, config_dir: &Path) -> Result<Chosen, String> {
    start(preference, scope).finish(config_dir)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use pistudiodesktop_secrets::{FakeFailure, FakeKeychain, StoreKind};

    use super::*;

    const LONG: Duration = Duration::from_secs(30);

    fn fake_open(fake: &FakeKeychain) -> impl FnOnce() -> Probed + Send + 'static + use<> {
        let fake = fake.clone();
        move || Ok(Arc::new(KeychainStore::with_backend(Arc::new(fake), Scope::standard())) as Arc<dyn SecretStore>)
    }

    fn refuse(error: SecretError) -> impl FnOnce() -> Probed + Send + 'static {
        move || Err(error)
    }

    #[test]
    fn the_file_option_never_touches_the_keychain() {
        let touched = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&touched);
        let dir = tempfile::tempdir().unwrap();
        let chosen = start_with(
            Some(Preference::File),
            move || {
                flag.store(true, Ordering::SeqCst);
                Err(SecretError::Unavailable("not asked".into()))
            },
            LONG,
        )
        .finish(dir.path())
        .unwrap();
        assert_eq!(chosen.store.kind(), StoreKind::File);
        assert!(chosen.notices.is_empty(), "a choice made on purpose is not a notice: {:?}", chosen.notices);
        assert!(!touched.load(Ordering::SeqCst));
        assert!(!dir.path().join(FILE_NAME).exists(), "an empty file store creates nothing");
    }

    #[test]
    fn a_keychain_that_answers_is_used_and_the_throwaway_item_is_gone() {
        let fake = FakeKeychain::new();
        let dir = tempfile::tempdir().unwrap();
        for preference in [None, Some(Preference::Keychain)] {
            let chosen = start_with(preference, fake_open(&fake), LONG).finish(dir.path()).unwrap();
            assert_eq!(chosen.store.kind(), StoreKind::Keychain, "{preference:?}");
            assert!(chosen.notices.is_empty());
        }
        assert!(fake.calls() >= 4, "the check wrote and deleted an item: {}", fake.calls());
        assert_eq!(fake.names(), vec![], "the probe item is never left behind");
        assert!(!dir.path().join(FILE_NAME).exists());
    }

    #[test]
    fn no_keychain_means_the_file_with_a_notice_that_says_why() {
        let dir = tempfile::tempdir().unwrap();
        for (error, reason) in [
            (SecretError::Unavailable("no bus".into()), "unavailable"),
            (SecretError::Denied("locked".into()), "denied"),
            (SecretError::Failed("odd".into()), "failed"),
        ] {
            let chosen = start_with(None, refuse(error), LONG).finish(dir.path()).unwrap();
            assert_eq!(chosen.store.kind(), StoreKind::File);
            assert_eq!(chosen.notices, vec![Notice::SecretStoreFallback { reason: reason.into() }]);
        }
    }

    #[test]
    fn a_read_that_passes_and_a_write_that_is_denied_means_the_file() {
        // The Secret Service whose default collection is locked or absent: the platform store
        // opens, and only the write says no.
        let fake = FakeKeychain::new();
        fake.fail_with(Some(FakeFailure::NoAccess));
        let dir = tempfile::tempdir().unwrap();
        let chosen = start_with(None, fake_open(&fake), LONG).finish(dir.path()).unwrap();
        assert_eq!(chosen.store.kind(), StoreKind::File);
        assert_eq!(chosen.notices, vec![Notice::SecretStoreFallback { reason: "denied".into() }]);
        assert_eq!(fake.names(), vec![]);
    }

    #[test]
    fn a_keychain_that_does_not_answer_in_time_means_the_file_and_the_item_is_still_removed() {
        let fake = FakeKeychain::blocking(Duration::from_millis(600));
        let dir = tempfile::tempdir().unwrap();
        let begun = Instant::now();
        let chosen = start_with(None, fake_open(&fake), Duration::from_millis(100)).finish(dir.path()).unwrap();
        assert!(begun.elapsed() < Duration::from_millis(500), "the launch did not wait for the keychain: {:?}", begun.elapsed());
        assert_eq!(chosen.store.kind(), StoreKind::File);
        assert_eq!(chosen.notices, vec![Notice::SecretStoreFallback { reason: "unavailable".into() }]);
        // The worker finishes by itself: the set, then the delete (each call counts when it starts).
        let end = Instant::now() + Duration::from_secs(5);
        while (fake.calls() < 2 || !fake.names().is_empty()) && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(fake.calls() >= 2, "the worker deleted the item it wrote");
        assert_eq!(fake.names(), vec![]);
    }

    #[test]
    fn asking_for_the_keychain_without_one_fails_and_names_the_option() {
        let dir = tempfile::tempdir().unwrap();
        let Err(message) = start_with(Some(Preference::Keychain), refuse(SecretError::Unavailable("no bus".into())), LONG).finish(dir.path()) else {
            panic!("the launch must fail");
        };
        assert!(message.contains("--secret-store keychain") && message.contains("--secret-store file") && message.contains("no bus"), "{message}");
        assert!(!dir.path().join(FILE_NAME).exists());
    }

    #[test]
    fn an_unreadable_secrets_file_is_set_aside_and_told() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), "{ not json").unwrap();
        let chosen = start_with(Some(Preference::File), refuse(SecretError::Unavailable("x".into())), LONG).finish(dir.path()).unwrap();
        let [Notice::FileReset { file, kept_as: Some(kept) }] = chosen.notices.as_slice() else { panic!("one notice with a kept name: {:?}", chosen.notices) };
        assert_eq!(file, FILE_NAME);
        assert!(kept.starts_with("secrets.json.corrupt-") && dir.path().join(kept).exists(), "{kept}");
    }

    #[test]
    fn a_fallback_and_a_reset_are_both_told() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), "{ not json").unwrap();
        let chosen = start_with(None, refuse(SecretError::Unavailable("no bus".into())), LONG).finish(dir.path()).unwrap();
        assert_eq!(chosen.notices.len(), 2, "{:?}", chosen.notices);
        assert!(matches!(chosen.notices[0], Notice::SecretStoreFallback { .. }) && matches!(chosen.notices[1], Notice::FileReset { .. }));
    }

    #[test]
    fn the_option_parses_two_words_and_says_what_else_is_wrong() {
        assert_eq!("keychain".parse(), Ok(Preference::Keychain));
        assert_eq!("file".parse(), Ok(Preference::File));
        let err = "memory".parse::<Preference>().unwrap_err();
        assert!(err.contains("keychain") && err.contains("file"), "{err}");
        let long = "x".repeat(500).parse::<Preference>().unwrap_err();
        assert!(long.len() < 150, "the echoed value is capped");
    }

    #[test]
    fn the_scope_is_the_default_unless_the_directory_was_given() {
        assert_eq!(scope_for(None), Scope::standard());
        let dir = Path::new("/tmp/pi-scratch");
        assert_eq!(scope_for(Some(dir)), Scope::for_config_dir(dir));
        assert_ne!(scope_for(Some(dir)), Scope::standard());
    }
}
