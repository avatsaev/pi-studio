use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::log_name;
use crate::stamp::utc_stamp;

/// The largest file read: a bigger one is treated as corrupt, never loaded into memory.
pub const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// How many `-N` suffixes are tried when set-aside names collide before giving up on a name.
const MAX_COLLISIONS: u32 = 1_000;

/// The outcome of [`read`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Loaded<T> {
    /// There is no file. Nothing was touched.
    Missing,
    /// The file was read and decoded.
    Value(T),
    /// The file could not be read or decoded and was set aside; the caller uses its defaults.
    Reset {
        /// The new name (a file name, not a path) of the set-aside file, in the same directory.
        /// `None` when even the rename failed: the bad file is still in place.
        kept_as: Option<String>,
    },
}

/// Read `path` and decode it with `decode`, which answers `None` to refuse the bytes.
///
/// A file that cannot be read, is not a regular file, is larger than [`MAX_BYTES`] or is refused by
/// the decoder is renamed to `<name>.corrupt-<UTC timestamp>` beside itself, so the app can start
/// with defaults and the user keeps the bytes. Two resets in one second get different names.
pub fn read<T>(path: &Path, decode: impl FnOnce(&[u8]) -> Option<T>) -> Loaded<T> {
    match load_bytes(path) {
        Bytes::Missing => Loaded::Missing,
        Bytes::Unusable => reset(path),
        Bytes::Data(bytes) => decode(&bytes).map_or_else(|| reset(path), Loaded::Value),
    }
}

enum Bytes {
    Missing,
    Unusable,
    Data(Vec<u8>),
}

fn load_bytes(path: &Path) -> Bytes {
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Bytes::Missing,
        Err(e) => {
            log::warn!("cannot read {}: {e}", log_name(path));
            return Bytes::Unusable;
        }
    };
    // Checked before opening: opening a pipe would block, and a huge file must not be read.
    if !meta.is_file() || meta.len() > MAX_BYTES {
        log::warn!("{} is not a regular file or is larger than {MAX_BYTES} bytes", log_name(path));
        return Bytes::Unusable;
    }
    let mut bytes = Vec::new();
    // `take` bounds the read even if the file grew since the metadata call.
    let read = std::fs::File::open(path).and_then(|f| f.take(MAX_BYTES + 1).read_to_end(&mut bytes));
    match read {
        Ok(n) if u64::try_from(n).is_ok_and(|n| n <= MAX_BYTES) => Bytes::Data(bytes),
        Ok(_) => {
            log::warn!("{} is larger than {MAX_BYTES} bytes", log_name(path));
            Bytes::Unusable
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Bytes::Missing,
        Err(e) => {
            log::warn!("cannot read {}: {e}", log_name(path));
            Bytes::Unusable
        }
    }
}

fn reset<T>(path: &Path) -> Loaded<T> {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    Loaded::Reset { kept_as: set_aside(path, secs) }
}

/// Rename `path` to a free `<name>.corrupt-<stamp>[-N]` beside it; the new file name, or `None`
/// when no name could be taken (logged).
fn set_aside(path: &Path, secs: u64) -> Option<String> {
    let Some(name) = path.file_name() else {
        log::warn!("cannot set aside a path without a file name");
        return None;
    };
    let base = format!(".corrupt-{}", utc_stamp(secs));
    for attempt in 0..=MAX_COLLISIONS {
        let mut kept = OsString::from(name);
        kept.push(&base);
        if attempt > 0 {
            kept.push(format!("-{attempt}"));
        }
        let target: PathBuf = path.with_file_name(&kept);
        // `rename` replaces silently on Unix, so a taken name must be skipped first. The app is
        // the only writer of its files, so the gap between this check and the rename is harmless.
        if target.symlink_metadata().is_ok() {
            continue;
        }
        return match std::fs::rename(path, &target) {
            Ok(()) => {
                let kept = kept.to_string_lossy().into_owned();
                log::warn!("{} could not be used and was kept as {kept}", log_name(path));
                Some(kept)
            }
            Err(e) => {
                log::warn!("{} could not be used and could not be set aside: {e}", log_name(path));
                None
            }
        };
    }
    log::warn!("{} could not be used and no free name was found to set it aside", log_name(path));
    None
}

#[cfg(test)]
mod tests {
    use super::{Loaded, MAX_BYTES, read, set_aside};

    fn decode_json(bytes: &[u8]) -> Option<String> {
        let text = std::str::from_utf8(bytes).ok()?;
        text.strip_prefix("ok:").map(str::to_owned)
    }

    fn names(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn a_missing_file_is_missing_and_creates_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(read(&path, decode_json), Loaded::Missing);
        assert!(names(dir.path()).is_empty());
    }

    #[test]
    fn a_missing_directory_is_missing_too() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(&dir.path().join("nope").join("settings.json"), decode_json), Loaded::Missing);
        assert!(names(dir.path()).is_empty());
    }

    #[test]
    fn a_decodable_file_gives_its_value_and_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"ok:hello").unwrap();
        assert_eq!(read(&path, decode_json), Loaded::Value("hello".to_owned()));
        assert_eq!(names(dir.path()), ["settings.json"]);
    }

    #[test]
    fn garbage_is_set_aside_with_its_bytes_and_the_name_is_free() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let garbage = [0xff, 0x00, 0xfe, b'{'];
        std::fs::write(&path, garbage).unwrap();
        let Loaded::Reset { kept_as: Some(kept) } = read(&path, decode_json) else {
            panic!("expected a reset with a kept name");
        };
        assert!(kept.starts_with("settings.json.corrupt-"), "{kept}");
        assert!(!path.exists());
        assert_eq!(std::fs::read(dir.path().join(&kept)).unwrap(), garbage);
        assert_eq!(names(dir.path()), [kept]);
    }

    #[test]
    fn two_resets_in_one_second_keep_two_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemons.json");
        std::fs::write(&path, b"first").unwrap();
        let first = set_aside(&path, 1_700_000_000).unwrap();
        std::fs::write(&path, b"second").unwrap();
        let second = set_aside(&path, 1_700_000_000).unwrap();
        assert_eq!(first, "daemons.json.corrupt-20231114T221320Z");
        assert_ne!(first, second);
        assert_eq!(std::fs::read(dir.path().join(&first)).unwrap(), b"first");
        assert_eq!(std::fs::read(dir.path().join(&second)).unwrap(), b"second");
        assert_eq!(names(dir.path()).len(), 2);
    }

    #[test]
    fn two_real_resets_in_a_row_keep_two_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        for bytes in [&b"one"[..], b"two"] {
            std::fs::write(&path, bytes).unwrap();
            assert!(matches!(read(&path, decode_json), Loaded::Reset { kept_as: Some(_) }));
        }
        assert_eq!(names(dir.path()).len(), 2);
    }

    #[test]
    fn a_file_over_the_cap_is_set_aside_without_being_decoded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_BYTES + 1).unwrap();
        let loaded = read(&path, |_| -> Option<()> { panic!("the decoder must not see an oversized file") });
        assert!(matches!(loaded, Loaded::Reset { kept_as: Some(_) }));
        assert!(!path.exists());
    }

    #[test]
    fn a_file_exactly_at_the_cap_is_decoded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("edge.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_BYTES).unwrap();
        assert_eq!(read(&path, |b| Some(b.len())), Loaded::Value(usize::try_from(MAX_BYTES).unwrap()));
    }

    #[test]
    fn a_directory_in_place_of_the_file_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::create_dir(&path).unwrap();
        assert!(matches!(read(&path, decode_json), Loaded::Reset { kept_as: Some(_) }));
        assert!(!path.exists());
    }

    #[test]
    fn a_failed_rename_still_answers_reset_without_a_name() {
        // The set-aside name is taken by 1,001 entries: no free name, so the file stays.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        std::fs::write(&path, b"bad").unwrap();
        let stamp = "x.json.corrupt-19700101T000000Z";
        std::fs::write(dir.path().join(stamp), b"").unwrap();
        for n in 1..=super::MAX_COLLISIONS {
            std::fs::write(dir.path().join(format!("{stamp}-{n}")), b"").unwrap();
        }
        assert_eq!(set_aside(&path, 0), None);
        assert_eq!(std::fs::read(&path).unwrap(), b"bad");
    }

    #[test]
    fn a_path_without_a_file_name_is_not_set_aside() {
        assert_eq!(set_aside(std::path::Path::new("/"), 0), None);
    }
}
