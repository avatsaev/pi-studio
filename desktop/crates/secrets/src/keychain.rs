//! The operating system's keychain as a [`SecretStore`]: the macOS Keychain, the Windows
//! Credential Manager, and the Secret Service (GNOME Keyring, KWallet) on Linux.
//!
//! Items are named `service = "com.avatsaev.pi-studio"`, `account = "<scope>/<entry id>/<kind>"`
//! (see [`Scope`]). The platform stores come from the `keyring-core` family, one crate per platform
//! chosen by `cfg`, so a build links only its own. Whether a keychain can be used at all is asked by
//! [`KeychainStore::probe`], which answers within [`PROBE_TIMEOUT`] even when the platform call hangs.
//!
//! A call after the probe may still block (macOS and the Secret Service can wait for the user):
//! callers keep it off the main and the owner thread.
//!
//! A platform error is turned into a [`SecretError`] by its kind, with a fixed text for the kinds that
//! carry the stored bytes, so no error holds a secret. This module does not log.

use std::fmt;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use keyring_core::{CredentialStore, Entry, Error};

use crate::{Secret, SecretError, SecretKey, SecretStore, StoreKind, check_len};

/// The keychain's service name for every item.
pub const SERVICE: &str = "com.avatsaev.pi-studio";

/// How long [`KeychainStore::probe`] waits for the keychain.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The account of the item the probe reads. It has one segment after the scope where a secret's
/// account has two, so no secret can have it.
const PROBE_NAME: &str = "probe";

/// Longest platform message kept in an error, in characters.
const MAX_DETAIL_CHARS: usize = 200;

/// Which set of items a launch owns: `default`, or, for an app started with `--config-dir`, 16
/// hexadecimal digits of a hash of that directory's path. Two configuration directories therefore
/// never read each other's secrets, and a scratch run never touches the real ones.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scope(String);

impl Scope {
    /// The scope of an app with the default configuration directory.
    pub fn standard() -> Scope {
        Scope("default".to_string())
    }

    /// The scope of an app with this configuration directory. The path is hashed as given (FNV-1a
    /// over its bytes: stable across runs and versions, which `std`'s hashers do not promise), so
    /// the caller passes the same form of the path at every launch.
    pub fn for_config_dir(dir: &Path) -> Scope {
        const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const PRIME: u64 = 0x0000_0100_0000_01b3;
        let hash = dir.as_os_str().as_encoded_bytes().iter().fold(OFFSET, |h, b| (h ^ u64::from(*b)).wrapping_mul(PRIME));
        Scope(format!("{hash:016x}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for Scope {
    fn default() -> Scope {
        Scope::standard()
    }
}

/// The secrets of one [`Scope`] in a platform credential store.
pub struct KeychainStore {
    backend: Arc<CredentialStore>,
    scope: Scope,
}

impl KeychainStore {
    /// Open the platform's keychain and read an item that does not exist, to learn whether the
    /// keychain can be used. Answers within [`PROBE_TIMEOUT`]: when the platform does not, the
    /// answer is `Unavailable` and the call is left to finish on its own thread.
    ///
    /// Errors: `Unavailable` (no keychain, no session bus, no answer in time), `Denied` (the system
    /// or the user refused access), `Failed` (anything else).
    pub fn probe(scope: Scope) -> Result<KeychainStore, SecretError> {
        probe_with(platform_store, scope, PROBE_TIMEOUT)
    }

    /// A store over a credential store you hold: the platform's, or a
    /// [`FakeKeychain`](crate::FakeKeychain) in a test. Nothing is read.
    pub fn with_backend(backend: Arc<CredentialStore>, scope: Scope) -> KeychainStore {
        KeychainStore { backend, scope }
    }

    pub fn scope(&self) -> &Scope {
        &self.scope
    }

    /// The keychain account of `key`: `<scope>/<entry id>/<kind>`.
    pub fn account(&self, key: &SecretKey) -> String {
        format!("{}/{}", self.scope.as_str(), key.name())
    }

    fn entry(&self, key: &SecretKey) -> Result<Entry, SecretError> {
        self.backend.build(SERVICE, &self.account(key), None).map_err(map_error)
    }
}

impl fmt::Debug for KeychainStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeychainStore").field("scope", &self.scope).finish_non_exhaustive()
    }
}

impl SecretStore for KeychainStore {
    fn kind(&self) -> StoreKind {
        StoreKind::Keychain
    }

    fn get(&self, key: &SecretKey) -> Result<Option<Secret>, SecretError> {
        match self.entry(key)?.get_password() {
            Ok(value) => {
                // Another application can write an item of this name: what this crate would
                // not have stored is not handed on.
                // The cap applies to a value read as to one written.
                let secret = Secret::new(value);
                check_len(key.kind, &secret).map_err(|_| {
                    SecretError::Failed(format!("the stored {} is empty or longer than {} characters", key.kind.describe(), key.kind.max_chars()))
                })?;
                Ok(Some(secret))
            }
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(map_error(e)),
        }
    }

    fn set(&self, key: &SecretKey, secret: &Secret) -> Result<(), SecretError> {
        check_len(key.kind, secret)?;
        self.entry(key)?.set_password(secret.expose()).map_err(map_error)
    }

    fn delete(&self, key: &SecretKey) -> Result<(), SecretError> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(map_error(e)),
        }
    }
}

/// Open the store with `open`, read the probe item, and answer within `timeout`. The work runs on a
/// thread of its own: a platform call that hangs (a bus with nobody to answer, a prompt) is left
/// there and the caller gets `Unavailable`.
fn probe_with<F>(open: F, scope: Scope, timeout: Duration) -> Result<KeychainStore, SecretError>
where
    F: FnOnce() -> keyring_core::Result<Arc<CredentialStore>> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    let account = format!("{}/{PROBE_NAME}", scope.as_str());
    let spawned = std::thread::Builder::new().name("secret-probe".to_string()).spawn(move || {
        // The receiver is gone when the probe timed out: the answer is no longer wanted.
        tx.send(open_and_read(open, &account)).ok();
    });
    if let Err(e) = spawned {
        return Err(SecretError::Failed(format!("cannot start the keychain probe: {e}")));
    }
    match rx.recv_timeout(timeout) {
        Ok(Ok(backend)) => Ok(KeychainStore { backend, scope }),
        Ok(Err(e)) => Err(e),
        Err(RecvTimeoutError::Timeout) => Err(SecretError::Unavailable(format!("the keychain did not answer within {timeout:?}"))),
        // The probe thread panicked inside the platform store.
        Err(RecvTimeoutError::Disconnected) => Err(SecretError::Failed("the keychain stopped without answering".to_string())),
    }
}

fn open_and_read<F>(open: F, account: &str) -> Result<Arc<CredentialStore>, SecretError>
where
    F: FnOnce() -> keyring_core::Result<Arc<CredentialStore>>,
{
    let backend = open().map_err(probe_error)?;
    let entry = backend.build(SERVICE, account, None).map_err(probe_error)?;
    match entry.get_secret() {
        Ok(_) | Err(Error::NoEntry) => Ok(backend),
        Err(e) => Err(probe_error(e)),
    }
}

/// An error while probing: a refusal is `Denied`, a platform that cannot be reached or does not
/// work is `Unavailable` (the caller falls back to the file), anything else is `Failed`.
fn probe_error(e: Error) -> SecretError {
    match e {
        Error::PlatformFailure(err) => SecretError::Unavailable(detail(&*err)),
        other => map_error(other),
    }
}

/// An error of a get, set or delete. A platform error says what the platform said; the kinds that
/// carry the stored bytes get a fixed text.
fn map_error(e: Error) -> SecretError {
    match e {
        Error::NoStorageAccess(err) => SecretError::Denied(detail(&*err)),
        Error::PlatformFailure(err) => SecretError::Failed(detail(&*err)),
        Error::NoEntry => SecretError::Failed("no such item".to_string()),
        Error::BadEncoding(_) => SecretError::Failed("the stored value is not text".to_string()),
        Error::BadDataFormat(..) => SecretError::Failed("the stored value is not in the format the keychain expects".to_string()),
        Error::BadStoreFormat(_) => SecretError::Failed("the keychain's data is malformed".to_string()),
        Error::TooLong(name, limit) => SecretError::Failed(format!("{name} is longer than the keychain's limit of {limit} characters")),
        Error::Invalid(name, _) => SecretError::Failed(format!("the keychain refused {name}")),
        Error::Ambiguous(_) => SecretError::Failed("more than one keychain item has this name".to_string()),
        Error::NoDefaultStore => SecretError::Failed("the keychain was not opened".to_string()),
        Error::NotSupportedByStore(_) => SecretError::Failed("the keychain does not support this".to_string()),
        // `Error` is non-exhaustive.
        _ => SecretError::Failed("the keychain reported an error".to_string()),
    }
}

/// A platform error's text, one line, capped.
fn detail(err: &(dyn std::error::Error + 'static)) -> String {
    let text = err.to_string();
    let mut line: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_DETAIL_CHARS + 1).collect();
    if line.chars().count() > MAX_DETAIL_CHARS {
        line = line.chars().take(MAX_DETAIL_CHARS).collect();
        line.push('…');
    }
    if line.is_empty() { "no detail".to_string() } else { line }
}

/// The platform's credential store.
#[cfg(target_os = "macos")]
fn platform_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Ok(apple_native_keyring_store::keychain::Store::new()?)
}

#[cfg(target_os = "windows")]
fn platform_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Ok(windows_native_keyring_store::Store::new()?)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android"))))]
fn platform_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Ok(zbus_secret_service_keyring_store::Store::new()?)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", all(unix, not(any(target_os = "ios", target_os = "android"))))))]
fn platform_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Err(Error::PlatformFailure("this platform has no keychain support".into()))
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use pistudiodesktop_model::EntryId;

    use super::*;
    use crate::{FakeFailure, FakeKeychain, SecretKind};

    const MARKER: &str = "hunter2-MARKER";

    /// Every log line of this test binary, to look for a secret in.
    static CAPTURED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

    struct CaptureLogger;

    impl log::Log for CaptureLogger {
        fn enabled(&self, _: &log::Metadata<'_>) -> bool {
            true
        }

        fn log(&self, record: &log::Record<'_>) {
            CAPTURED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).push(format!("{}", record.args()));
        }

        fn flush(&self) {}
    }

    fn key(kind: SecretKind) -> SecretKey {
        SecretKey::new(EntryId::local(), kind)
    }

    fn store_over(fake: &FakeKeychain, scope: Scope) -> KeychainStore {
        KeychainStore::with_backend(Arc::new(fake.clone()), scope)
    }

    #[test]
    fn set_get_and_delete_round_trip_under_the_service_and_account_names() {
        let fake = FakeKeychain::new();
        let store = store_over(&fake, Scope::standard());
        assert_eq!(store.kind(), StoreKind::Keychain);
        let pw = key(SecretKind::Password);
        assert_eq!(store.get(&pw), Ok(None));
        store.set(&pw, &Secret::new(MARKER)).unwrap();
        assert_eq!(fake.names(), [("com.avatsaev.pi-studio".to_string(), "default/local/password".to_string())]);
        assert_eq!(fake.held(SERVICE, "default/local/password"), Some(MARKER.as_bytes().to_vec()));
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), MARKER);
        store.set(&pw, &Secret::new("second")).unwrap();
        assert_eq!(store.get(&pw).unwrap().unwrap().expose(), "second");
        let link = key(SecretKind::PairingLink);
        store.set(&link, &Secret::new("pi://x")).unwrap();
        assert_eq!(store.account(&link), "default/local/pairingLink");
        store.delete(&pw).unwrap();
        assert_eq!(store.get(&pw), Ok(None));
        assert_eq!(store.get(&link).unwrap().unwrap().expose(), "pi://x", "delete took only its own item");
        store.delete(&pw).unwrap();
    }

    #[test]
    fn two_configuration_directories_are_two_scopes() {
        let fake = FakeKeychain::new();
        let a = store_over(&fake, Scope::for_config_dir(Path::new("/home/u/.config/pi-a")));
        let b = store_over(&fake, Scope::for_config_dir(Path::new("/home/u/.config/pi-b")));
        let default = store_over(&fake, Scope::standard());
        let pw = key(SecretKind::Password);
        a.set(&pw, &Secret::new("for-a")).unwrap();
        assert_eq!(b.get(&pw), Ok(None));
        assert_eq!(default.get(&pw), Ok(None));
        b.set(&pw, &Secret::new("for-b")).unwrap();
        assert_eq!(a.get(&pw).unwrap().unwrap().expose(), "for-a");
        b.delete(&pw).unwrap();
        assert_eq!(a.get(&pw).unwrap().unwrap().expose(), "for-a", "deleting in one scope leaves the other");
        assert_eq!(fake.names().len(), 1);
    }

    #[test]
    fn a_scope_is_sixteen_hex_digits_of_a_stable_hash() {
        // FNV-1a 64 of "" is its offset basis and of "a" is af63dc4c8601ec8c: the algorithm is pinned.
        assert_eq!(Scope::for_config_dir(Path::new("")).as_str(), "cbf29ce484222325");
        assert_eq!(Scope::for_config_dir(Path::new("a")).as_str(), "af63dc4c8601ec8c");
        let scope = Scope::for_config_dir(Path::new("/tmp/pi/config"));
        assert_eq!(scope.as_str().len(), 16);
        assert!(scope.as_str().bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        assert_eq!(scope, Scope::for_config_dir(Path::new("/tmp/pi/config")));
        assert_ne!(scope, Scope::for_config_dir(Path::new("/tmp/pi/config2")));
        assert_eq!(Scope::default().as_str(), "default");
    }

    #[test]
    fn a_secret_that_would_be_refused_elsewhere_is_refused_here() {
        let fake = FakeKeychain::new();
        let store = store_over(&fake, Scope::standard());
        let pw = key(SecretKind::Password);
        for bad in [String::new(), "x".repeat(1025)] {
            assert_eq!(store.set(&pw, &Secret::new(bad)).unwrap_err().code(), "failed");
        }
        assert_eq!(fake.calls(), 0, "nothing reached the keychain");
        // And a value another application wrote that this crate would not have.
        fake.put_raw(SERVICE, "default/local/password", "y".repeat(1025).as_bytes());
        assert_eq!(store.get(&pw).unwrap_err().code(), "failed");
        fake.put_raw(SERVICE, "default/local/password", b"");
        assert_eq!(store.get(&pw).unwrap_err().code(), "failed");
    }

    #[test]
    fn platform_errors_map_to_the_three_codes() {
        let fake = FakeKeychain::new();
        let store = store_over(&fake, Scope::standard());
        let pw = key(SecretKind::Password);
        let secret = Secret::new("v");
        for (failure, code) in [(FakeFailure::NoAccess, "denied"), (FakeFailure::Platform, "failed"), (FakeFailure::BadEncoding, "failed")] {
            fake.fail_with(Some(failure));
            assert_eq!(store.get(&pw).unwrap_err().code(), code, "{failure:?} get");
            assert_eq!(store.set(&pw, &secret).unwrap_err().code(), code, "{failure:?} set");
            assert_eq!(store.delete(&pw).unwrap_err().code(), code, "{failure:?} delete");
        }
        fake.fail_with(None);
        store.set(&pw, &secret).unwrap();
    }

    #[test]
    fn no_error_and_no_log_line_holds_a_secret() {
        log::set_logger(&CaptureLogger).ok();
        log::set_max_level(log::LevelFilter::Trace);
        // Errors the platform could attach the bytes to, and every other kind.
        let bytes = MARKER.as_bytes().to_vec();
        let platform: Box<dyn std::error::Error + Send + Sync> = "platform said no".into();
        let all = [
            Error::BadEncoding(bytes.clone()),
            Error::BadDataFormat(bytes.clone(), MARKER.into()),
            Error::BadStoreFormat(MARKER.to_string()),
            Error::Invalid("account".to_string(), MARKER.to_string()),
            Error::NotSupportedByStore(MARKER.to_string()),
            Error::NoStorageAccess(platform),
            Error::NoEntry,
            Error::NoDefaultStore,
        ];
        for e in all {
            let (mapped, probed) = (map_error(clone_kind(&e)), probe_error(clone_kind(&e)));
            for shown in [format!("{mapped} {mapped:?}"), format!("{probed} {probed:?}")] {
                assert!(!shown.contains("MARKER"), "{shown}");
            }
        }
        // Running every operation through failures leaves nothing in what the store logs.
        let fake = FakeKeychain::new();
        let store = store_over(&fake, Scope::standard());
        let pw = key(SecretKind::Password);
        fake.fail_with(Some(FakeFailure::BadEncoding));
        for shown in [format!("{:?}", store.set(&pw, &Secret::new(MARKER))), format!("{:?}", store.get(&pw)), format!("{store:?}"), format!("{fake:?}")] {
            assert!(!shown.contains("MARKER"), "{shown}");
        }
        fake.fail_with(None);
        store.set(&pw, &Secret::new(MARKER)).unwrap();
        let shown = format!("{store:?} {fake:?} {:?}", store.get(&pw));
        assert!(!shown.contains("MARKER"), "{shown}");
        let logged = CAPTURED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(logged.iter().all(|line| !line.contains("MARKER")), "{logged:?}");
    }

    /// `keyring_core::Error` is not `Clone`: rebuild the same kind.
    fn clone_kind(e: &Error) -> Error {
        match e {
            Error::BadEncoding(b) => Error::BadEncoding(b.clone()),
            Error::BadDataFormat(b, _) => Error::BadDataFormat(b.clone(), MARKER.into()),
            Error::BadStoreFormat(s) => Error::BadStoreFormat(s.clone()),
            Error::Invalid(a, r) => Error::Invalid(a.clone(), r.clone()),
            Error::NotSupportedByStore(s) => Error::NotSupportedByStore(s.clone()),
            Error::NoStorageAccess(_) => Error::NoStorageAccess("platform said no".into()),
            Error::NoEntry => Error::NoEntry,
            _ => Error::NoDefaultStore,
        }
    }

    #[test]
    fn a_platform_message_is_one_capped_line() {
        let long: Box<dyn std::error::Error + Send + Sync> = format!("line one\nline two {}", "z".repeat(500)).into();
        let SecretError::Failed(text) = map_error(Error::PlatformFailure(long)) else { panic!("expected Failed") };
        assert!(!text.contains('\n'));
        assert_eq!(text.chars().count(), MAX_DETAIL_CHARS + 1);
        assert!(text.starts_with("line one line two z"));
        let empty: Box<dyn std::error::Error + Send + Sync> = String::new().into();
        assert_eq!(map_error(Error::PlatformFailure(empty)), SecretError::Failed("no detail".to_string()));
    }

    #[test]
    fn the_fake_blocks_for_its_delay() {
        let fake = FakeKeychain::blocking(Duration::from_millis(150));
        let store = store_over(&fake, Scope::standard());
        let started = Instant::now();
        store.get(&key(SecretKind::Password)).unwrap();
        assert!(started.elapsed() >= Duration::from_millis(150));
        assert_eq!(fake.calls(), 1);
    }

    #[test]
    fn the_probe_opens_reads_a_missing_item_and_hands_back_the_store() {
        let fake = FakeKeychain::new();
        let backend = fake.clone();
        let store = probe_with(move || Ok(Arc::new(backend)), Scope::standard(), PROBE_TIMEOUT).unwrap();
        assert_eq!(fake.calls(), 1);
        assert!(fake.names().is_empty(), "the probe writes nothing");
        store.set(&key(SecretKind::Password), &Secret::new("v")).unwrap();
        assert_eq!(fake.names(), [(SERVICE.to_string(), "default/local/password".to_string())]);
    }

    #[test]
    fn the_probe_gives_up_on_a_keychain_that_does_not_answer() {
        for (what, fake) in [("a get that blocks", Some(FakeKeychain::blocking(Duration::from_secs(5)))), ("an open that blocks", None)] {
            let started = Instant::now();
            let result = match fake {
                Some(fake) => probe_with(move || Ok(Arc::new(fake)), Scope::standard(), Duration::from_millis(200)),
                None => probe_with(
                    || {
                        std::thread::sleep(Duration::from_secs(5));
                        Err(Error::NoEntry)
                    },
                    Scope::standard(),
                    Duration::from_millis(200),
                ),
            };
            let SecretError::Unavailable(text) = result.unwrap_err() else { panic!("{what}: expected Unavailable") };
            assert!(text.contains("200ms"), "{text}");
            assert!(started.elapsed() < Duration::from_secs(2), "{what}: took {:?}", started.elapsed());
        }
    }

    #[test]
    fn the_probe_maps_what_the_platform_says() {
        let denied = FakeKeychain::new();
        denied.fail_with(Some(FakeFailure::NoAccess));
        let broken = FakeKeychain::new();
        broken.fail_with(Some(FakeFailure::Platform));
        let odd = FakeKeychain::new();
        odd.fail_with(Some(FakeFailure::BadEncoding));
        let cases = [(denied, "denied"), (broken, "unavailable"), (odd, "failed")];
        for (fake, code) in cases {
            let err = probe_with(move || Ok(Arc::new(fake)), Scope::standard(), PROBE_TIMEOUT).unwrap_err();
            assert_eq!(err.code(), code);
        }
        let no_bus = probe_with(|| Err(Error::PlatformFailure("no session bus".into())), Scope::standard(), PROBE_TIMEOUT).unwrap_err();
        assert_eq!(no_bus, SecretError::Unavailable("no session bus".to_string()));
        let refused = probe_with(|| Err(Error::NoStorageAccess("locked".into())), Scope::standard(), PROBE_TIMEOUT).unwrap_err();
        assert_eq!(refused.code(), "denied");
    }

    #[test]
    fn a_panic_inside_the_platform_store_is_a_failed_probe() {
        let result = probe_with(|| -> keyring_core::Result<Arc<CredentialStore>> { panic!("the store panicked") }, Scope::standard(), PROBE_TIMEOUT);
        assert_eq!(result.unwrap_err().code(), "failed");
    }
}
