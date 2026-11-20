use std::io::Write;
use std::path::Path;

use crate::log_name;

/// Replace `path` with `bytes`, or leave it exactly as it was.
///
/// Creates missing parent directories, writes a temporary file in the destination's directory,
/// flushes it to disk and renames it over the destination. On any failure the destination is
/// untouched and no temporary file is left behind (the temporary file removes itself on drop).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_with(path, bytes, false)
}

/// Like [`write_atomic`], for a file only the user may read (passwords, pairing links).
///
/// On Unix the temporary file is created with mode 0600, so the content is never readable by
/// others, also not briefly, and the file keeps that mode after replacing a looser one. On Windows
/// it behaves as [`write_atomic`]: the user profile's default permissions apply.
pub fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_with(path, bytes, true)
}

fn write_with(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<()> {
    // The temporary file must be on the destination's file system for the rename to be atomic.
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).inspect_err(|e| log::warn!("cannot create the directory for {}: {e}", log_name(path)))?;
    let mut tmp = create_temp(dir, private)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error).inspect_err(|e| log::warn!("cannot replace {}: {e}", log_name(path)))?;
    Ok(())
}

#[cfg(unix)]
fn create_temp(dir: &Path, private: bool) -> std::io::Result<tempfile::NamedTempFile> {
    use std::os::unix::fs::PermissionsExt;
    let mut builder = tempfile::Builder::new();
    if private {
        builder.permissions(std::fs::Permissions::from_mode(0o600));
    }
    builder.tempfile_in(dir)
}

#[cfg(not(unix))]
fn create_temp(dir: &Path, _private: bool) -> std::io::Result<tempfile::NamedTempFile> {
    tempfile::NamedTempFile::new_in(dir)
}

/// Delete `path`. A file that is already gone is a success.
pub fn remove(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::{remove, write_atomic, write_private};

    fn names(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[cfg(unix)]
    fn mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn a_private_write_of_a_new_file_is_0600() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemons.json");
        write_private(&path, b"{}").unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(names(dir.path()), ["daemons.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_private_write_over_a_looser_file_leaves_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemons.json");
        std::fs::write(&path, b"old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&path, b"new").unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[cfg(not(unix))]
    #[test]
    fn a_private_write_writes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemons.json");
        write_private(&path, b"{}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{}");
    }

    #[test]
    fn replaces_an_existing_file_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert_eq!(names(dir.path()), ["settings.json"]);
    }

    #[test]
    fn creates_missing_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("state.json");
        write_atomic(&path, b"{}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{}");
        assert_eq!(names(&dir.path().join("a").join("b")), ["state.json"]);
    }

    #[test]
    fn a_directory_that_cannot_be_created_is_an_error_and_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        // A file where a directory is needed.
        let blocker = dir.path().join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        assert!(write_atomic(&blocker.join("sub").join("f.json"), b"{}").is_err());
        assert_eq!(names(dir.path()), ["blocker"]);
        assert_eq!(std::fs::read(&blocker).unwrap(), b"x");
    }

    #[test]
    fn a_failed_rename_leaves_the_destination_and_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        // The destination is a non-empty directory: the rename over it fails.
        let dest = dir.path().join("dest");
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("keep"), b"k").unwrap();
        assert!(write_atomic(&dest, b"new").is_err());
        assert_eq!(names(dir.path()), ["dest"]);
        assert_eq!(std::fs::read(dest.join("keep")).unwrap(), b"k");
    }

    #[test]
    fn removing_a_missing_file_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gone.json");
        remove(&path).unwrap();
        std::fs::write(&path, b"x").unwrap();
        remove(&path).unwrap();
        assert!(!path.exists());
        remove(&path).unwrap();
    }
}
