//! The manifests `scripts/release/update-manifest.mjs` makes, read with the plug-in's own type.
//!
//! `scripts/release/fixtures/*.json` are the script's output for a complete set of update files
//! (the script's node test fails when they are stale). The updater reads a static manifest by
//! deserializing `RemoteRelease` and looking up the entry of the running build's target, first
//! `{os}-{arch}-{installer}` and then `{os}-{arch}`; `resolve` repeats that order over the type's
//! public lookups, because the plug-in's own `get_urls` is private.

use std::path::{Path, PathBuf};

use tauri_plugin_updater::RemoteRelease;

/// The fixture `name`, read by the plug-in's type.
fn load(name: &str) -> RemoteRelease {
    let path: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/release/fixtures").join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: the plug-in cannot read it: {e}", path.display()))
}

/// The URL and signature the updater picks for a build of `os`, `arch` and `installer`.
fn resolve<'a>(release: &'a RemoteRelease, os: &str, arch: &str, installer: &str) -> Option<(&'a str, &'a str)> {
    [format!("{os}-{arch}-{installer}"), format!("{os}-{arch}")].iter().find_map(|target| {
        let url = release.download_url(target).ok()?;
        let signature = release.signature(target).ok()?;
        Some((url.as_str(), signature.as_str()))
    })
}

/// Every system and install kind the app updates (spec § 2).
const BUILDS: [(&str, &str, &str); 7] = [
    ("linux", "x86_64", "appimage"),
    ("linux", "x86_64", "deb"),
    ("linux", "x86_64", "rpm"),
    ("darwin", "aarch64", "app"),
    ("darwin", "x86_64", "app"),
    ("windows", "x86_64", "nsis"),
    ("windows", "x86_64", "msi"),
];

const DOWNLOADS: &str = "https://github.com/avatsaev/pi-studio/releases/download/desktop-v0.3.0/";

#[test]
fn latest_manifest_resolves_every_target() {
    let release = load("latest.json");
    assert_eq!(release.version.to_string(), "0.3.0");
    assert_eq!(release.notes.as_deref(), Some("https://github.com/avatsaev/pi-studio/releases/tag/desktop-v0.3.0"));
    assert!(release.pub_date.is_some(), "pub_date is RFC 3339");
    for (os, arch, installer) in BUILDS {
        let (url, signature) = resolve(&release, os, arch, installer).unwrap_or_else(|| panic!("{os}-{arch}-{installer} does not resolve"));
        assert!(url.starts_with(DOWNLOADS), "{os}-{arch}-{installer}: {url}");
        assert!(!url.contains(' '), "{url}");
        assert!(!signature.is_empty(), "{os}-{arch}-{installer} has no signature");
    }
}

#[test]
fn each_install_kind_gets_its_own_file_and_both_macs_the_one_universal_file() {
    let release = load("latest.json");
    let url = |os, arch, installer| resolve(&release, os, arch, installer).map(|(url, _)| url.to_owned());
    let mut distinct: Vec<_> = BUILDS.iter().map(|&(os, arch, installer)| url(os, arch, installer)).collect();
    distinct.sort();
    distinct.dedup();
    // Seven builds, six files: the two macOS builds share one.
    assert_eq!(distinct.len(), 6);
    assert_eq!(url("darwin", "aarch64", "app"), url("darwin", "x86_64", "app"));
    assert_eq!(url("windows", "x86_64", "nsis"), Some(format!("{DOWNLOADS}Pi.Studio_0.3.0_x64-setup.exe")));
    assert_eq!(url("darwin", "aarch64", "app"), Some(format!("{DOWNLOADS}Pi.Studio.app.tar.gz")));
}

#[test]
fn a_target_the_manifest_lacks_does_not_resolve() {
    let release = load("latest.json");
    assert!(resolve(&release, "linux", "aarch64", "appimage").is_none());
    assert!(resolve(&release, "windows", "x86_64", "exe").is_none());
}

#[test]
fn self_check_manifest_offers_the_same_files_under_a_greater_version() {
    let latest = load("latest.json");
    let self_check = load("self-check.json");
    assert_eq!(self_check.version.to_string(), "0.3.1-selfcheck");
    assert!(self_check.version > latest.version, "the plug-in only installs a version greater than the running one");
    for (os, arch, installer) in BUILDS {
        assert_eq!(resolve(&self_check, os, arch, installer), resolve(&latest, os, arch, installer), "{os}-{arch}-{installer}");
    }
}
