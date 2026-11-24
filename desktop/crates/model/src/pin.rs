//! The daemon pin: the one `pi-studio` binary version this build of the app installs, with the address,
//! SHA-256 and size of its archive for each of the four systems (`desktop/daemon-pin.json`, S5 of
//! `swe/features/single-binary-daemon.md`). The file is compiled in ([`BUILT_IN_JSON`]); a launch may
//! replace it (`--daemon-pin <file>`). Pure data: parsing and checking only, nothing is read or run.
//!
//! An asset's address is data, not a secret, but it is never put in an error or a log line: a pin
//! given on the command line may name a private server.

use std::collections::BTreeMap;

use serde::Deserialize;

/// The committed `desktop/daemon-pin.json`, as the app was built with it. The release workflow
/// overwrites the runner's copy before the build.
pub const BUILT_IN_JSON: &str = include_str!("../../../daemon-pin.json");

/// The four systems a binary is published for (S2), in the order the file lists them.
pub const TARGETS: [&str; 4] = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];

/// Longest address a pin may hold, in characters.
const MAX_URL_CHARS: usize = 2048;

/// Why a pin was refused. The message never holds an address or a checksum.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PinError {
    #[error("the pin is not valid JSON of the expected shape")]
    Json,
    #[error("the pin's version is not `<major>.<minor>.<patch>`")]
    Version,
    #[error("the pin has no asset for `{0}`")]
    MissingTarget(&'static str),
    #[error("the pin has an asset for `{0}`, which is not a target")]
    UnknownTarget(String),
    #[error("the pin's `{0}` address is not an http(s) address")]
    Url(&'static str),
    #[error("the pin's `{0}` checksum is not 64 hexadecimal digits")]
    Sha256(&'static str),
    #[error("the pin's `{0}` size is not positive")]
    Size(&'static str),
}

/// One archive of the pinned version.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct PinAsset {
    pub url: String,
    /// Lower- or upper-case hexadecimal, 64 digits.
    pub sha256: String,
    /// The archive's size in bytes; a download reads no more than this.
    pub size: u64,
}

/// The pinned daemon version and its archives. Construct it with [`DaemonPin::parse`]: every value
/// of this type holds all four targets and valid assets.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct DaemonPin {
    pub version: String,
    assets: BTreeMap<String, PinAsset>,
}

fn version_ok(version: &str) -> bool {
    let mut parts = version.split('.');
    let numeric = |part: Option<&str>| part.is_some_and(|p| !p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit()));
    numeric(parts.next()) && numeric(parts.next()) && numeric(parts.next()) && parts.next().is_none()
}

fn url_ok(url: &str) -> bool {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"));
    url.chars().count() <= MAX_URL_CHARS && rest.is_some_and(|r| !r.is_empty() && !r.chars().any(|c| c.is_whitespace() || c.is_control()))
}

fn sha256_ok(sha256: &str) -> bool {
    sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit())
}

impl DaemonPin {
    /// Reads a pin and checks it: a `<major>.<minor>.<patch>` version, exactly the four [`TARGETS`],
    /// each with an http(s) address, a 64-digit hexadecimal checksum and a positive size.
    pub fn parse(json: &str) -> Result<Self, PinError> {
        let pin: DaemonPin = serde_json::from_str(json).map_err(|_| PinError::Json)?;
        if !version_ok(&pin.version) {
            return Err(PinError::Version);
        }
        if let Some(extra) = pin.assets.keys().find(|key| !TARGETS.contains(&key.as_str())) {
            return Err(PinError::UnknownTarget(extra.chars().take(32).collect()));
        }
        for target in TARGETS {
            let asset = pin.assets.get(target).ok_or(PinError::MissingTarget(target))?;
            if !url_ok(&asset.url) {
                return Err(PinError::Url(target));
            }
            if !sha256_ok(&asset.sha256) {
                return Err(PinError::Sha256(target));
            }
            if asset.size == 0 {
                return Err(PinError::Size(target));
            }
        }
        Ok(pin)
    }

    /// The pin this build was compiled with ([`BUILT_IN_JSON`]).
    pub fn built_in() -> Result<Self, PinError> {
        Self::parse(BUILT_IN_JSON)
    }

    /// The archive for `target` (one of [`TARGETS`]).
    pub fn asset(&self, target: &str) -> Option<&PinAsset> {
        self.assets.get(target)
    }
}

/// The target of an operating system and processor named as `std::env::consts::OS` and `ARCH` name
/// them; `None` for a system with no published binary (Windows, a musl or 32-bit build, wasm).
pub fn target_of(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("linux", "x86_64") => Some("linux-x64"),
        _ => None,
    }
}

/// This machine's target, from the operating system and processor this build was compiled for
/// (never from the environment at run time). `None` where no binary is published.
pub fn this_target() -> Option<&'static str> {
    target_of(std::env::consts::OS, std::env::consts::ARCH)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use serde_json::{Value, json};

    use super::*;

    fn asset(target: &str) -> Value {
        json!({"url": format!("https://example.test/daemon-v0.0.131/pi-studio-0.0.131-{target}.tar.gz"), "sha256": "ab".repeat(32), "size": 1234})
    }

    fn pin() -> Value {
        json!({"version": "0.0.131", "assets": TARGETS.iter().map(|t| ((*t).to_owned(), asset(t))).collect::<serde_json::Map<_, _>>()})
    }

    fn parse(value: &Value) -> Result<DaemonPin, PinError> {
        DaemonPin::parse(&value.to_string())
    }

    /// The committed file is what the app is built with: an invalid one fails this test.
    #[test]
    fn the_committed_pin_is_valid() {
        let pin = DaemonPin::built_in().expect("desktop/daemon-pin.json must be valid");
        for target in TARGETS {
            let asset = pin.asset(target).unwrap();
            assert!(asset.url.contains(&pin.version) && asset.url.ends_with(&format!("-{target}.tar.gz")), "{target}");
        }
    }

    #[test]
    fn a_valid_pin_is_read() {
        let parsed = parse(&pin()).unwrap();
        assert_eq!(parsed.version, "0.0.131");
        assert_eq!(parsed.asset("linux-x64").unwrap().size, 1234);
        assert_eq!(parsed.asset("linux-x64").unwrap().sha256, "ab".repeat(32));
        assert!(parsed.asset("windows-x64").is_none());
        let mut http = pin();
        http["assets"]["darwin-x64"]["url"] = json!("http://127.0.0.1:8000/a.tar.gz");
        assert!(parse(&http).is_ok());
    }

    #[test]
    fn a_bad_version_is_refused() {
        for bad in ["", "0.0", "0.0.1.2", "v0.0.1", "0.0.x", "0..1", "0.0.1-beta", " 0.0.1", "1234567890.0.1"] {
            let mut p = pin();
            p["version"] = json!(bad);
            assert_eq!(parse(&p), Err(PinError::Version), "{bad:?}");
        }
    }

    #[test]
    fn the_four_targets_are_required_and_no_other() {
        for target in TARGETS {
            let mut p = pin();
            p["assets"].as_object_mut().unwrap().remove(target);
            assert_eq!(parse(&p), Err(PinError::MissingTarget(target)));
        }
        let mut p = pin();
        p["assets"]["windows-x64"] = asset("windows-x64");
        assert_eq!(parse(&p), Err(PinError::UnknownTarget("windows-x64".into())));
    }

    #[test]
    fn an_asset_is_checked_field_by_field() {
        let cases: [(&str, Value, PinError); 11] = [
            ("url", json!("ftp://example.test/a"), PinError::Url("linux-x64")),
            ("url", json!("https://"), PinError::Url("linux-x64")),
            ("url", json!("example.test/a.tar.gz"), PinError::Url("linux-x64")),
            ("url", json!("https://example.test/a b"), PinError::Url("linux-x64")),
            ("url", json!(format!("https://example.test/{}", "a".repeat(MAX_URL_CHARS))), PinError::Url("linux-x64")),
            ("sha256", json!("ab".repeat(31)), PinError::Sha256("linux-x64")),
            ("sha256", json!("zz".repeat(32)), PinError::Sha256("linux-x64")),
            ("sha256", json!(format!("{}é", "a".repeat(62))), PinError::Sha256("linux-x64")),
            ("size", json!(0), PinError::Size("linux-x64")),
            ("size", json!(-1), PinError::Json),
            ("size", json!("12"), PinError::Json),
        ];
        for (field, value, error) in cases {
            let mut p = pin();
            p["assets"]["linux-x64"][field] = value.clone();
            assert_eq!(parse(&p), Err(error), "{field} = {value}");
        }
        let mut upper = pin();
        upper["assets"]["linux-x64"]["sha256"] = json!("AB".repeat(32));
        assert!(parse(&upper).is_ok());
    }

    #[test]
    fn a_document_of_another_shape_is_refused() {
        for bad in ["", "null", "[]", "{}", r#"{"version":"0.0.1"}"#, r#"{"version":"0.0.1","assets":[]}"#, "not json"] {
            assert_eq!(DaemonPin::parse(bad), Err(PinError::Json), "{bad:?}");
        }
    }

    #[test]
    fn an_error_never_carries_an_address_or_a_checksum() {
        let mut p = pin();
        p["assets"]["linux-x64"]["url"] = json!("https://private.example/secret-path with space");
        p["assets"]["darwin-x64"]["sha256"] = json!("not-a-checksum");
        let shown = parse(&p).unwrap_err().to_string();
        assert!(!shown.contains("private") && !shown.contains("not-a-checksum"), "{shown}");
    }

    #[test]
    fn the_machine_maps_to_its_target() {
        assert_eq!(target_of("macos", "aarch64"), Some("darwin-arm64"));
        assert_eq!(target_of("macos", "x86_64"), Some("darwin-x64"));
        assert_eq!(target_of("linux", "aarch64"), Some("linux-arm64"));
        assert_eq!(target_of("linux", "x86_64"), Some("linux-x64"));
        for (os, arch) in [("windows", "x86_64"), ("windows", "aarch64"), ("linux", "x86"), ("linux", "arm"), ("freebsd", "x86_64"), ("", "")] {
            assert_eq!(target_of(os, arch), None, "{os} {arch}");
        }
        // Every target the mapping can answer is one the pin carries.
        for (os, arch) in [("macos", "aarch64"), ("macos", "x86_64"), ("linux", "aarch64"), ("linux", "x86_64")] {
            assert!(TARGETS.contains(&target_of(os, arch).unwrap()));
        }
        if let Some(target) = this_target() {
            assert!(DaemonPin::built_in().unwrap().asset(target).is_some());
        }
    }
}
