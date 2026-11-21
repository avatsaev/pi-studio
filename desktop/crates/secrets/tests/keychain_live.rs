//! Checks against a real keychain. They are `#[ignore]`d so that an ordinary `cargo test` never
//! writes to a developer's keychain; `docs/development.md` § The keychain in the container runs them
//! inside a container with a Secret Service (`-- --ignored --test-threads=1`) or, for the second,
//! without one. Each item they write lives in a scope of its own and is removed again.
#![cfg(target_os = "linux")]

use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use pistudiodesktop_model::EntryId;
use pistudiodesktop_secrets::{KeychainStore, PROBE_TIMEOUT, SERVICE, Scope, Secret, SecretKey, SecretKind, SecretStore};

const MARKER: &str = "live-MARKER-value";

fn scratch_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    PathBuf::from(format!("/pi-studio-live-check/{tag}-{}-{nanos}", std::process::id()))
}

/// What `secret-tool lookup` prints for an item, or `None` when it finds none.
fn secret_tool_lookup(account: &str) -> Option<String> {
    let out =
        Command::new("secret-tool").args(["lookup", "service", SERVICE, "username", account]).output().expect("secret-tool is installed in the check image");
    if !out.status.success() || out.stdout.is_empty() { None } else { Some(String::from_utf8_lossy(&out.stdout).into_owned()) }
}

#[test]
#[ignore = "needs a Secret Service on the session bus; run in the container (docs/development.md)"]
fn set_get_and_delete_round_trip_and_secret_tool_sees_the_item() {
    let scope = Scope::for_config_dir(&scratch_dir("round-trip"));
    let other = Scope::for_config_dir(&scratch_dir("other"));
    let store = KeychainStore::probe(scope).expect("a keychain answers the probe");
    let elsewhere = KeychainStore::probe(other).expect("a keychain answers the probe");
    let pw = SecretKey::new(EntryId::local(), SecretKind::Password);
    let link = SecretKey::new(EntryId::local(), SecretKind::PairingLink);
    let (pw_account, link_account) = (store.account(&pw), store.account(&link));

    assert_eq!(store.get(&pw), Ok(None));
    store.set(&pw, &Secret::new(MARKER)).expect("set");
    store.set(&link, &Secret::new("pi-studio://pair/abc")).expect("set the link");
    assert_eq!(store.get(&pw).expect("get").expect("present").expose(), MARKER);
    store.set(&pw, &Secret::new("replaced")).expect("replace");
    assert_eq!(store.get(&pw).expect("get").expect("present").expose(), "replaced");

    // The service and account names, seen by a tool that is not this crate.
    assert_eq!(secret_tool_lookup(&pw_account).as_deref(), Some("replaced"));
    assert_eq!(secret_tool_lookup(&link_account).as_deref(), Some("pi-studio://pair/abc"));
    // Another configuration directory is another scope.
    assert_eq!(elsewhere.get(&pw), Ok(None));

    store.delete(&pw).expect("delete");
    store.delete(&link).expect("delete the link");
    store.delete(&pw).expect("deleting what is absent succeeds");
    assert_eq!(store.get(&pw), Ok(None));
    assert_eq!(secret_tool_lookup(&pw_account), None);
    assert_eq!(secret_tool_lookup(&link_account), None);
}

#[test]
#[ignore = "needs a machine with no Secret Service; run in the container without a keyring daemon (docs/development.md)"]
fn the_probe_without_a_secret_service_is_unavailable_within_two_seconds() {
    let started = Instant::now();
    let err = KeychainStore::probe(Scope::standard()).expect_err("no keychain here");
    let took = started.elapsed();
    assert_eq!(err.code(), "unavailable", "{err}");
    assert!(took < PROBE_TIMEOUT + Duration::from_millis(500), "took {took:?}");
    eprintln!("probe answered `{err}` in {took:?}");
}
