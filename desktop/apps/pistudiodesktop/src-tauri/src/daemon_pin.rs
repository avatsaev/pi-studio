//! The daemon pin of this launch: the one compiled in (`desktop/daemon-pin.json`), or the file that
//! `--daemon-pin <file>` names, which a check uses to install a binary of its own. The file is read
//! once, at launch, and an invalid one fails the launch. Nothing here logs or returns an address.

use std::io::Read as _;
use std::path::Path;

use pistudiodesktop_model::pin::DaemonPin;

/// The longest pin file accepted, in bytes: a pin is about 1 KiB.
const MAX_FILE_BYTES: u64 = 64 * 1024;

/// Where the pin of a launch came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    BuiltIn,
    Override,
}

impl Source {
    /// The word a log line carries.
    pub fn name(self) -> &'static str {
        match self {
            Source::BuiltIn => "built in",
            Source::Override => "override",
        }
    }
}

/// The pin to use: the file's when `file` is given, else the compiled-in one. The error names the
/// option and what was wrong, never the pin's contents or the file's path.
pub fn load(file: Option<&Path>) -> Result<(DaemonPin, Source), String> {
    let Some(file) = file else {
        return DaemonPin::built_in().map(|pin| (pin, Source::BuiltIn)).map_err(|e| format!("the pin compiled into this build is invalid: {e}"));
    };
    let mut text = String::new();
    let opened = std::fs::File::open(file).and_then(|f| f.take(MAX_FILE_BYTES + 1).read_to_string(&mut text));
    if opened.is_err() {
        return Err("--daemon-pin: the file cannot be read as text".to_owned());
    }
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("--daemon-pin: the file is longer than {MAX_FILE_BYTES} bytes"));
    }
    DaemonPin::parse(&text).map(|pin| (pin, Source::Override)).map_err(|e| format!("--daemon-pin: {e}"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    fn pin_text(version: &str) -> String {
        let asset = |target: &str| {
            format!(r#""{target}": {{"url": "https://private.example/{version}/{target}.tar.gz", "sha256": "{}", "size": 10}}"#, "cd".repeat(32))
        };
        let assets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map(asset).join(",");
        format!(r#"{{"version": "{version}", "assets": {{{assets}}}}}"#)
    }

    #[test]
    fn without_the_option_the_compiled_in_pin_is_used() {
        let (pin, source) = load(None).unwrap();
        assert_eq!(source, Source::BuiltIn);
        assert_eq!(pin, DaemonPin::built_in().unwrap());
    }

    #[test]
    fn a_file_replaces_the_pin() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pin.json");
        std::fs::write(&file, pin_text("9.8.7")).unwrap();
        let (pin, source) = load(Some(&file)).unwrap();
        assert_eq!((pin.version.as_str(), source), ("9.8.7", Source::Override));
        assert_ne!(pin, DaemonPin::built_in().unwrap());
    }

    #[test]
    fn a_bad_file_fails_with_the_option_and_no_address_or_path() {
        let dir = tempfile::tempdir().unwrap();
        let named = dir.path().join("secret-place.json");
        let cases = [
            (None, "--daemon-pin: the file cannot be read"),
            (Some("not json".to_owned()), "--daemon-pin: the pin is not valid JSON"),
            (Some(pin_text("9.8.7").replace("https://", "ftp://")), "--daemon-pin: the pin's `darwin-arm64` address is not an http(s) address"),
            (Some(" ".repeat(MAX_FILE_BYTES as usize + 1)), "--daemon-pin: the file is longer"),
        ];
        for (content, expected) in cases {
            if let Some(content) = &content {
                std::fs::write(&named, content).unwrap();
            }
            let message = load(Some(&named)).unwrap_err();
            assert!(message.starts_with(expected), "{message}");
            assert!(!message.contains("private.example") && !message.contains("secret-place"), "{message}");
            let _ = std::fs::remove_file(&named);
        }
    }
}
