//! The folder layout on a machine (P3), under `$PI_STUDIO_HOME/bin/`:
//!
//! ```text
//! versions/<version>/pi-studio     one folder per installed version
//! current -> versions/<version>    a symbolic link, switched by rename
//! tmp/                             unpacking; emptied at every install
//! ```

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::names::is_plain_name;

/// The executable's file name in a version folder.
pub const BINARY: &str = "pi-studio";

const VERSIONS: &str = "versions";
const CURRENT: &str = "current";
const CURRENT_NEW: &str = "current.new";
pub(crate) const TMP: &str = "tmp";

/// `<bin_dir>/versions/<version>`.
pub fn version_dir(bin_dir: &Path, version: &str) -> PathBuf {
    bin_dir.join(VERSIONS).join(version)
}

pub(crate) fn tmp_dir(bin_dir: &Path) -> PathBuf {
    bin_dir.join(TMP)
}

/// The version `current` points to, by its folder's name; `None` when `current` is missing, is not one of our links
/// (`versions/<version>`), is broken, or its folder has no `pi-studio` (P10: treated as not installed). It does not run
/// the program: see [`crate::binary_version`].
pub fn current_version(bin_dir: &Path) -> Option<String> {
    let link = bin_dir.join(CURRENT);
    let target = fs::read_link(&link).ok()?;
    let version = target.file_name()?.to_str()?;
    let in_versions = target.parent()?.file_name().is_some_and(|n| n == VERSIONS);
    // A link that reached the folder by another name is not ours to read a version from.
    if !in_versions || !is_plain_name(version) {
        return None;
    }
    // `is_file` follows the link: a folder that is gone, or has no program, is "not installed".
    link.join(BINARY).is_file().then(|| version.to_string())
}

/// Removes every folder of `versions/` that is not in `keep`, and never the one `current` points to (a link must not
/// be left broken). A missing `versions/` is fine.
///
/// # Errors
/// The first removal that failed, after the others were tried.
pub fn prune(bin_dir: &Path, keep: &[&str]) -> io::Result<()> {
    let versions = bin_dir.join(VERSIONS);
    let entries = match fs::read_dir(&versions) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let current = current_version(bin_dir);
    let mut first_error = None;
    for entry in entries {
        let result = entry.and_then(|entry| {
            let name = entry.file_name();
            if name.to_str().is_some_and(|n| keep.contains(&n) || current.as_deref() == Some(n)) {
                return Ok(());
            }
            let path = entry.path();
            // `file_type` does not follow a link: a link is removed, never entered.
            if entry.file_type()?.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) }
        });
        if let Err(e) = result {
            first_error.get_or_insert(e);
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Makes `current` point to `versions/<version>`: a link `current.new` is made beside it and renamed over it, so a
/// reader sees the old target or the new one, never none. For a version folder that is already installed (the app
/// uses it when the pinned version is in `versions/` and `current` points elsewhere); [`crate::install_version`] calls
/// it after unpacking.
///
/// # Errors
/// `InvalidInput` for a version that is not one plain file name; otherwise the link could not be made or renamed.
pub fn switch_current(bin_dir: &Path, version: &str) -> io::Result<()> {
    if !is_plain_name(version) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "the version is not a plain name"));
    }
    let staging = bin_dir.join(CURRENT_NEW);
    match fs::remove_file(&staging) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let target = Path::new(VERSIONS).join(version);
    symlink_dir(&target, &staging)?;
    if let Err(e) = fs::rename(&staging, bin_dir.join(CURRENT)) {
        let _ = fs::remove_file(&staging);
        return Err(e);
    }
    Ok(())
}

#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

/// Installing a daemon binary is not offered on Windows (the local entry is `unsupported` there).
#[cfg(not(unix))]
fn symlink_dir(_target: &Path, _link: &Path) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "a symbolic link switch is not supported on this system"))
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::time::{Duration, Instant};

    use super::*;

    fn install_fake(bin: &Path, version: &str) {
        let dir = version_dir(bin, version);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(BINARY), b"x").unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    #[test]
    fn current_is_none_until_switched() {
        let bin = tempfile::tempdir().unwrap();
        assert_eq!(current_version(bin.path()), None);
        install_fake(bin.path(), "1.0.0");
        assert_eq!(current_version(bin.path()), None);
        switch_current(bin.path(), "1.0.0").unwrap();
        assert_eq!(current_version(bin.path()).as_deref(), Some("1.0.0"));
        assert_eq!(fs::read_link(bin.path().join("current")).unwrap(), PathBuf::from("versions/1.0.0"));
        assert!(!bin.path().join("current.new").exists());
    }

    #[test]
    fn a_broken_or_foreign_current_is_not_installed() {
        let bin = tempfile::tempdir().unwrap();
        install_fake(bin.path(), "1.0.0");
        switch_current(bin.path(), "1.0.0").unwrap();
        fs::remove_dir_all(version_dir(bin.path(), "1.0.0")).unwrap();
        assert_eq!(current_version(bin.path()), None, "folder gone");
        fs::remove_file(bin.path().join("current")).unwrap();
        install_fake(bin.path(), "2.0.0");
        std::os::unix::fs::symlink(version_dir(bin.path(), "2.0.0"), bin.path().join("current")).unwrap();
        assert_eq!(current_version(bin.path()).as_deref(), Some("2.0.0"), "an absolute link into versions/ is read");
        fs::remove_file(bin.path().join("current")).unwrap();
        std::os::unix::fs::symlink(bin.path(), bin.path().join("current")).unwrap();
        assert_eq!(current_version(bin.path()), None, "a link elsewhere");
    }

    #[test]
    fn a_current_that_is_a_folder_is_not_a_link_of_ours() {
        let bin = tempfile::tempdir().unwrap();
        fs::create_dir_all(bin.path().join("current")).unwrap();
        fs::write(bin.path().join("current").join(BINARY), b"x").unwrap();
        assert_eq!(current_version(bin.path()), None);
    }

    #[test]
    fn the_switch_is_atomic() {
        let bin = tempfile::tempdir().unwrap();
        install_fake(bin.path(), "1.0.0");
        install_fake(bin.path(), "2.0.0");
        switch_current(bin.path(), "1.0.0").unwrap();
        let stop = AtomicBool::new(false);
        let reads = AtomicU32::new(0);
        let current = bin.path().join("current");
        std::thread::scope(|scope| {
            let reader = scope.spawn(|| {
                while !stop.load(Ordering::Relaxed) {
                    let target = fs::read_link(&current).expect("current is never missing");
                    assert!(target == Path::new("versions/1.0.0") || target == Path::new("versions/2.0.0"), "{target:?}");
                    assert!(current.join(BINARY).is_file(), "current always reaches a program");
                    reads.fetch_add(1, Ordering::Relaxed);
                }
            });
            // Switch until the reader has looked many times in between (and at least 300 switches), however the threads are scheduled.
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut i = 0u32;
            while (i < 300 || reads.load(Ordering::Relaxed) < 200) && Instant::now() < deadline {
                switch_current(bin.path(), if i.is_multiple_of(2) { "2.0.0" } else { "1.0.0" }).unwrap();
                i += 1;
            }
            stop.store(true, Ordering::Relaxed);
            reader.join().unwrap();
            assert!(reads.load(Ordering::Relaxed) >= 200, "the reader looked while the switches ran");
        });
    }

    #[test]
    fn the_switch_refuses_a_version_that_is_not_a_plain_name() {
        let bin = tempfile::tempdir().unwrap();
        for bad in ["", "..", "a/b", "../x"] {
            assert_eq!(switch_current(bin.path(), bad).unwrap_err().kind(), io::ErrorKind::InvalidInput, "{bad}");
        }
        assert!(!bin.path().join("current").exists() && !bin.path().join("current.new").exists());
    }

    #[test]
    fn a_stale_staging_link_does_not_block_the_switch() {
        let bin = tempfile::tempdir().unwrap();
        install_fake(bin.path(), "1.0.0");
        std::os::unix::fs::symlink("nowhere", bin.path().join("current.new")).unwrap();
        switch_current(bin.path(), "1.0.0").unwrap();
        assert_eq!(current_version(bin.path()).as_deref(), Some("1.0.0"));
    }

    #[test]
    fn prune_keeps_the_given_versions_and_current() {
        let bin = tempfile::tempdir().unwrap();
        for v in ["1.0.0", "2.0.0", "3.0.0", "4.0.0"] {
            install_fake(bin.path(), v);
        }
        fs::write(bin.path().join("versions").join("stray"), b"x").unwrap();
        switch_current(bin.path(), "3.0.0").unwrap();
        prune(bin.path(), &["2.0.0", "absent"]).unwrap();
        assert_eq!(names(&bin.path().join("versions")), ["2.0.0", "3.0.0"]);
        assert_eq!(current_version(bin.path()).as_deref(), Some("3.0.0"));
    }

    #[test]
    fn prune_without_versions_is_fine() {
        let bin = tempfile::tempdir().unwrap();
        prune(bin.path(), &[]).unwrap();
    }
}
