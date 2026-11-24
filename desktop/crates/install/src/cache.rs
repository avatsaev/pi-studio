//! The archive cache (S9): `<dir>/<version>/<target>.tar.gz`, kept for the pinned version only, so that an install of the
//! same system again (an SSH install, a second local attempt) does not download again (P10).

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::download::{Asset, download, hex};
use crate::error::DownloadError;
use crate::names::is_plain_name;

/// The folder the archives are kept in (the app's data folder's `daemon-archives`).
#[derive(Debug, Clone)]
pub struct ArchiveCache {
    pub dir: PathBuf,
}

impl ArchiveCache {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Where the archive of `version` for `target` is kept; `None` when either is not one plain file name.
    pub fn path(&self, version: &str, target: &str) -> Option<PathBuf> {
        (is_plain_name(version) && is_plain_name(target)).then(|| self.dir.join(version).join(format!("{target}.tar.gz")))
    }

    /// The cached archive when it is the pinned file, else a download of it.
    ///
    /// A cached file of another size or hash is deleted and fetched again. Partial files an earlier run left in
    /// this version's folder (a quit during a download) are removed first.
    ///
    /// # Errors
    /// [`DownloadError::InvalidName`] for a version or target that is not a plain name, else as [`download`].
    pub async fn get_or_download(
        &self,
        version: &str,
        target: &str,
        asset: &Asset<'_>,
        stall: Duration,
        progress: impl FnMut(u64, u64),
    ) -> Result<PathBuf, DownloadError> {
        let path = self.path(version, target).ok_or(DownloadError::InvalidName)?;
        let (probe_path, size, sha256) = (path.clone(), asset.size, asset.sha256.to_string());
        let cached = tokio::task::spawn_blocking(move || {
            remove_partial_files(&probe_path);
            matches_pin(&probe_path, size, &sha256)
        })
        .await
        .map_err(|_| DownloadError::Io("the cache check did not finish".to_string()))?;
        if cached {
            return Ok(path);
        }
        download(asset, &path, stall, progress).await?;
        Ok(path)
    }

    /// Removes every version folder (and stray file) of the cache but `version`'s. A missing cache is fine.
    ///
    /// # Errors
    /// The first removal that failed, after the others were tried.
    pub fn retain_only(&self, version: &str) -> io::Result<()> {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        let mut first_error = None;
        for entry in entries {
            let result = entry.and_then(|entry| {
                if entry.file_name().to_str() == Some(version) {
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
}

/// Removes the `*.part` files in the folder of `archive` (best effort: the download makes its own anyway).
fn remove_partial_files(archive: &Path) {
    let Some(dir) = archive.parent() else { return };
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if entry.path().extension().is_some_and(|e| e == "part") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// True when `path` is a file of `size` bytes with the SHA-256 `sha256`; a file that is not is removed.
fn matches_pin(path: &Path, size: u64, sha256: &str) -> bool {
    let Ok(mut file) = fs::File::open(path) else { return false };
    if file.metadata().map(|m| m.len()).ok() != Some(size) {
        drop(file);
        let _ = fs::remove_file(path);
        return false;
    }
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(_) => return false,
        }
    }
    drop(file);
    let same = hex(&hasher.finalize()).eq_ignore_ascii_case(sha256);
    if !same {
        let _ = fs::remove_file(path);
    }
    same
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_is_version_then_target() {
        let cache = ArchiveCache::new("/data/daemon-archives");
        assert_eq!(cache.path("0.0.130", "linux-x64"), Some(PathBuf::from("/data/daemon-archives/0.0.130/linux-x64.tar.gz")));
    }

    #[test]
    fn path_refuses_names_that_are_not_plain() {
        let cache = ArchiveCache::new("/data");
        for (v, t) in [("..", "linux-x64"), ("1.0.0", "../x"), ("a/b", "t"), ("", "t"), ("1.0.0", ""), ("1.0.0", "a\\b")] {
            assert_eq!(cache.path(v, t), None, "{v} {t}");
        }
    }

    #[test]
    fn retain_only_keeps_the_one_version() {
        let dir = tempfile::tempdir().unwrap();
        for v in ["0.0.129", "0.0.130", "0.0.131"] {
            fs::create_dir_all(dir.path().join(v)).unwrap();
            fs::write(dir.path().join(v).join("linux-x64.tar.gz"), b"x").unwrap();
        }
        fs::write(dir.path().join("stray"), b"x").unwrap();
        ArchiveCache::new(dir.path()).retain_only("0.0.130").unwrap();
        let mut left: Vec<String> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["0.0.130"]);
        assert!(dir.path().join("0.0.130/linux-x64.tar.gz").is_file());
    }

    #[test]
    fn retain_only_on_a_missing_cache_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        ArchiveCache::new(dir.path().join("absent")).retain_only("1").unwrap();
    }
}
