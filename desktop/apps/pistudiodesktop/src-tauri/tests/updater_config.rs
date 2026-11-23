//! The updater's configuration: what `tauri.conf.json` may hold, and what the test overlay holds.
//!
//! `tauri.conf.json` is what every shipped build is made from, so it never carries a `dangerous*`
//! updater key (they switch off the plug-in's HTTPS requirement and certificate checks) or
//! `createUpdaterArtifacts` (the bundler then fails without the signing key). The overlay
//! `tauri.update-test.conf.json` carries both, for test builds only. It has no `pubkey`: a run
//! generates a throwaway pair (`npx tauri signer generate --ci -w <key file>`), merges the public key
//! into a copy of the overlay (`{"plugins":{"updater":{"pubkey":"<public key>"}}}`), passes that as
//! `tauri build --config <copy>` and signs with the private key through `TAURI_SIGNING_PRIVATE_KEY`.
//! The pair is never stored.

use std::path::{Path, PathBuf};

use serde_json::Value;

fn load(name: &str) -> Value {
    let path: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR")).join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The keys of the `plugins.updater` object that start with `dangerous`.
fn dangerous_keys(config: &Value) -> Vec<&str> {
    let Some(updater) = config.pointer("/plugins/updater").and_then(Value::as_object) else { return Vec::new() };
    updater.keys().map(String::as_str).filter(|k| k.starts_with("dangerous")).collect()
}

#[test]
fn shipped_config_has_no_dangerous_updater_key() {
    let config = load("tauri.conf.json");
    assert_eq!(dangerous_keys(&config), Vec::<&str>::new(), "tauri.conf.json must not hold a dangerous* updater key (U5)");
}

#[test]
fn shipped_config_does_not_make_update_files() {
    let config = load("tauri.conf.json");
    assert!(config.pointer("/bundle/createUpdaterArtifacts").is_none(), "createUpdaterArtifacts belongs to the publishing job's overlay (U2)");
}

#[test]
fn shipped_config_names_the_fixed_manifest_and_a_key() {
    let config = load("tauri.conf.json");
    assert_eq!(
        config.pointer("/plugins/updater/endpoints"),
        Some(&serde_json::json!(["https://github.com/avatsaev/pi-studio/releases/download/desktop-updates/latest.json"]))
    );
    assert_eq!(config.pointer("/plugins/updater/windows/installMode"), Some(&Value::from("passive")));
    assert!(config.pointer("/plugins/updater/pubkey").and_then(Value::as_str).is_some_and(|k| !k.is_empty()));
}

#[test]
fn test_overlay_makes_update_files_over_plain_http_and_holds_no_key() {
    let overlay = load("tauri.update-test.conf.json");
    assert_eq!(overlay.pointer("/bundle/createUpdaterArtifacts"), Some(&Value::Bool(true)));
    assert_eq!(overlay.pointer("/plugins/updater/dangerousInsecureTransportProtocol"), Some(&Value::Bool(true)));
    assert!(overlay.pointer("/plugins/updater/pubkey").is_none(), "a test build's key is generated per run, never stored");
}

#[test]
fn the_guard_sees_a_dangerous_key() {
    let config = serde_json::json!({ "plugins": { "updater": { "dangerousInsecureTransportProtocol": true } } });
    assert_eq!(dangerous_keys(&config), vec!["dangerousInsecureTransportProtocol"]);
}
