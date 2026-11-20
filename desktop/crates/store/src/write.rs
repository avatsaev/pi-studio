use std::io::Write;
use std::path::Path;

use crate::log_name;

/// Replace `path` with `bytes`, or leave it exactly as it was.
///
/// Creates missing parent directories, writes a temporary file in the destination's directory,
/// flushes it to disk and renames it over the destination. On any failure the destination is
/// untouched and no temporary file is left behind (the temporary file removes itself on drop).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    // The temporary file must be on the destination's file system for the rename to be atomic.
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).inspect_err(|e| log::warn!("cannot create the directory for {}: {e}", log_name(path)))?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error).inspect_err(|e| log::warn!("cannot replace {}: {e}", log_name(path)))?;
    Ok(())
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
    use super::{remove, write_atomic};

    fn names(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
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
