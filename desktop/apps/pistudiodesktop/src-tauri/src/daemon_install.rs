//! The daemon installer of the local entry: the shell's [`Installer`] hook over `pistudiodesktop-install` and the launch's
//! pin (`swe/features/single-binary-daemon.md`, "The local entry"). The shell decides when to install; this fetches the pinned
//! archive (the archive cache, else a download with a 60 s stall limit), unpacks it under `$PI_STUDIO_HOME/bin/versions/`,
//! switches `current`, and after a start that reached `running` removes the old versions. The same object is the shell's
//! [`ArchiveSource`]: an install over SSH takes the archive of the host's target from the same cache.
//!
//! The pin's addresses are never logged: a failure is logged by its kind.

use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::time::Duration;

use pistudiodesktop_install::{
    ArchiveCache, Asset, BINARY, DownloadError, InstallError, VERSION_LIMIT, binary_version, current_version, install_version, prune, switch_current,
    version_dir,
};
use pistudiodesktop_model::pin::{DaemonPin, this_target};
use pistudiodesktop_shell::cli_answers::parse_version;
use pistudiodesktop_shell::services::{Archive, ArchiveSource, FetchFailure, InstallFailure, InstallProgress, Installer};

/// The folder of the archive cache in the app's data folder (S9).
pub const ARCHIVE_DIR: &str = "daemon-archives";

/// How long a download may wait for the answer, and for each piece of the body (S8). There is no total limit.
const STALL: Duration = Duration::from_secs(60);

/// The installer of the local entry for one launch's pin.
pub struct LocalInstaller {
    pin: DaemonPin,
    /// `None` on a system with no published binary: every install then fails.
    target: Option<&'static str>,
    cache: ArchiveCache,
}

impl LocalInstaller {
    /// An installer of `pin` for this machine's target, keeping archives in `archive_dir`.
    pub fn new(pin: DaemonPin, archive_dir: PathBuf) -> Self {
        Self { pin, target: this_target(), cache: ArchiveCache::new(archive_dir) }
    }

    /// The archive of the pin for this machine, from the cache or downloaded, reporting `(received, total)`. The download runs
    /// on a thread of its own with its own runtime, so that this works whatever thread calls it (inside a runtime or not);
    /// the progress comes back to the caller's thread over a channel.
    fn download_archive(&self, target: &str, asset: &Asset<'_>, progress: &mut dyn FnMut(u64, u64)) -> Result<PathBuf, DownloadError> {
        let (pieces, received) = channel::<(u64, u64)>();
        std::thread::scope(|scope| {
            let worker = scope.spawn(move || {
                let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| DownloadError::Io(e.to_string()))?;
                runtime.block_on(self.cache.get_or_download(&self.pin.version, target, asset, STALL, move |got, total| {
                    let _ = pieces.send((got, total));
                }))
            });
            // Ends when the worker has finished and dropped its end.
            for (got, total) in received {
                progress(got, total);
            }
            worker.join().unwrap_or_else(|_| Err(DownloadError::Io("the download thread stopped".to_owned())))
        })
    }
}

/// How the shell is told a download ended: a wrong size or hash is `checksum_mismatch`, the rest `download_failed`.
fn fetch_failure(error: &DownloadError) -> FetchFailure {
    // The error never holds an address (`DownloadError`), so it may be logged.
    log::warn!("daemon download failed: {error}");
    if error.is_integrity_failure() { FetchFailure::Checksum } else { FetchFailure::Download }
}

/// What the screen shows beside a failed install: the error's own words, and what the unpacked program printed when it ran.
fn install_failure(error: &InstallError) -> InstallFailure {
    log::warn!("daemon install failed: {error}");
    InstallFailure::Install { output: Some(error.output().map_or_else(|| error.to_string(), |output| format!("{error}\n{output}"))) }
}

/// The version folder to keep beside `current`: the greatest of `names` that is not `current` and is a version. A folder that
/// is not a version (a stray file, a half-made name) is never kept.
fn previous_of(names: &[String], current: &str) -> Option<String> {
    names.iter().filter(|name| name.as_str() != current).filter_map(|name| Some((parse_version(name)?, name))).max().map(|(_, name)| name.clone())
}

/// The names in `<bin_dir>/versions/`; empty when it cannot be read.
fn installed_names(bin_dir: &Path) -> Vec<String> {
    let versions = version_dir(bin_dir, "x").parent().map(Path::to_path_buf).unwrap_or_default();
    std::fs::read_dir(versions).map(|entries| entries.filter_map(|entry| entry.ok()?.file_name().into_string().ok()).collect()).unwrap_or_default()
}

impl ArchiveSource for LocalInstaller {
    fn version(&self) -> &str {
        &self.pin.version
    }

    /// The archive for any of the four systems: an install over SSH sends the host's own, not this machine's. The same
    /// cache folder as the local install: an archive is downloaded once whichever entry asks for it.
    fn fetch(&self, target: &str, progress: &mut dyn FnMut(u64, u64)) -> Result<Archive, FetchFailure> {
        let Some(pinned) = self.pin.asset(target) else {
            log::warn!("daemon download failed: the pin has no archive for this target");
            return Err(FetchFailure::Download);
        };
        let asset = Asset { url: &pinned.url, sha256: &pinned.sha256, size: pinned.size };
        let path = self.download_archive(target, &asset, progress).map_err(|e| fetch_failure(&e))?;
        Ok(Archive { path, size: pinned.size, sha256: pinned.sha256.clone() })
    }
}

impl Installer for LocalInstaller {
    fn version(&self) -> &str {
        &self.pin.version
    }

    fn adopt_installed(&self, bin_dir: &Path) -> bool {
        let program = version_dir(bin_dir, &self.pin.version).join(BINARY);
        binary_version(&program, VERSION_LIMIT).is_ok_and(|found| found == self.pin.version) && switch_current(bin_dir, &self.pin.version).is_ok()
    }

    fn install(&self, bin_dir: &Path, progress: &mut dyn FnMut(InstallProgress)) -> Result<(), InstallFailure> {
        let target = self.target.ok_or(InstallFailure::Install { output: Some("No daemon binary is published for this system.".to_owned()) })?;
        let Some(asset) = self.pin.asset(target) else {
            return Err(InstallFailure::Install { output: Some("The pin has no daemon binary for this system.".to_owned()) });
        };
        let asset = Asset { url: &asset.url, sha256: &asset.sha256, size: asset.size };
        // A download that failed its checksum is deleted by the cache; nothing of it is unpacked.
        let archive =
            self.download_archive(target, &asset, &mut |received, total| progress(InstallProgress::Downloading { received, total })).map_err(|e| {
                match fetch_failure(&e) {
                    FetchFailure::Checksum => InstallFailure::Checksum,
                    FetchFailure::Download => InstallFailure::Download,
                }
            })?;
        progress(InstallProgress::Installing);
        install_version(&archive, bin_dir, &self.pin.version).map_err(|e| install_failure(&e))
    }

    fn tidy(&self, bin_dir: &Path) {
        // Never the version `current` points to (`prune` keeps it); beside it, the previous one.
        let current = current_version(bin_dir);
        let previous = current.as_deref().and_then(|current| previous_of(&installed_names(bin_dir), current));
        let keep: Vec<&str> = previous.iter().map(String::as_str).collect();
        if let Err(e) = prune(bin_dir, &keep) {
            log::warn!("old daemon versions were not all removed: {e}");
        }
        if let Err(e) = self.cache.retain_only(&self.pin.version) {
            log::warn!("old daemon archives were not all removed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    fn names(of: &[&str]) -> Vec<String> {
        of.iter().map(|n| (*n).to_owned()).collect()
    }

    #[test]
    fn the_previous_version_is_the_greatest_other_one() {
        assert_eq!(previous_of(&names(&["0.0.131", "0.0.130", "0.0.99"]), "0.0.131"), Some("0.0.130".to_owned()));
        // Compared as numbers, not as text.
        assert_eq!(previous_of(&names(&["0.0.9", "0.0.10", "0.0.131"]), "0.0.131"), Some("0.0.10".to_owned()));
        // A newer folder than `current` (a rollback) is the one beside it.
        assert_eq!(previous_of(&names(&["0.0.131", "0.0.140"]), "0.0.131"), Some("0.0.140".to_owned()));
        assert_eq!(previous_of(&names(&["0.0.131"]), "0.0.131"), None);
        assert_eq!(previous_of(&names(&["0.0.131", "stray", "tmp", "1.2"]), "0.0.131"), None);
    }

    #[test]
    fn a_wrong_hash_or_size_is_a_checksum_mismatch_and_every_other_failure_a_failed_download() {
        assert_eq!(fetch_failure(&DownloadError::ChecksumMismatch), FetchFailure::Checksum);
        assert_eq!(fetch_failure(&DownloadError::WrongSize { expected: 2, received: 1 }), FetchFailure::Checksum);
        for other in [
            DownloadError::Stalled,
            DownloadError::Status(404),
            DownloadError::Request("reset".into()),
            DownloadError::Io("disk".into()),
            DownloadError::InvalidName,
        ] {
            assert_eq!(fetch_failure(&other), FetchFailure::Download, "{other}");
        }
    }

    #[test]
    fn the_archive_of_any_target_comes_from_the_cache_when_it_is_the_pinned_file_and_from_the_download_otherwise() {
        // The SHA-256 of the body.
        let body: &'static [u8] = b"a pinned archive";
        let sha256 = "938558376e47ad4fb46af7fdbec526fa568a30402c47434003b7d35b069480d7".to_owned();
        let dir = tempfile::tempdir().unwrap();
        let archives = dir.path().join("archives");
        // Nothing listens at the address: only a cache hit can answer.
        let installer = LocalInstaller::new(pin("1.2.3", "http://127.0.0.1:1/x", &sha256, body.len() as u64), archives.clone());
        std::fs::create_dir_all(archives.join("1.2.3")).unwrap();
        std::fs::write(archives.join("1.2.3/darwin-arm64.tar.gz"), body).unwrap();
        let mut seen = Vec::new();
        let archive = ArchiveSource::fetch(&installer, "darwin-arm64", &mut |got, total| seen.push((got, total))).unwrap();
        assert_eq!(archive, Archive { path: archives.join("1.2.3/darwin-arm64.tar.gz"), size: body.len() as u64, sha256: sha256.clone() });
        assert!(seen.is_empty(), "a cached file is not downloaded");
        assert_eq!(ArchiveSource::version(&installer), "1.2.3");
        // Another target is not cached: the download fails here (nothing listens) and leaves no file.
        assert_eq!(ArchiveSource::fetch(&installer, "linux-x64", &mut |_, _| {}), Err(FetchFailure::Download));
        assert!(!archives.join("1.2.3/linux-x64.tar.gz").exists());
        // A target the pin has no archive for.
        assert_eq!(ArchiveSource::fetch(&installer, "plan9-mips", &mut |_, _| {}), Err(FetchFailure::Download));
        // A download of something else is a checksum mismatch, with its progress.
        let other: &'static [u8] = b"something else..";
        let installer = LocalInstaller::new(pin("1.2.3", &serve_once(other), &sha256, other.len() as u64), dir.path().join("second"));
        let mut seen = Vec::new();
        assert_eq!(ArchiveSource::fetch(&installer, "linux-arm64", &mut |got, total| seen.push((got, total))), Err(FetchFailure::Checksum));
        assert_eq!(seen.last(), Some(&(other.len() as u64, other.len() as u64)));
    }

    #[test]
    fn an_install_failure_carries_the_errors_words_and_what_the_program_printed() {
        assert_eq!(install_failure(&InstallError::NoBinary), InstallFailure::Install { output: Some("The archive holds no pi-studio program.".to_owned()) });
        let wrong = InstallFailure::Install { output: Some("The unpacked program answers version 9.9.9, not the expected one.\n9.9.9".to_owned()) };
        assert_eq!(install_failure(&InstallError::WrongVersion { found: "9.9.9".to_owned() }), wrong);
    }

    /// A pin whose four archives are one and the same file at `url`.
    fn pin(version: &str, url: &str, sha256: &str, size: u64) -> DaemonPin {
        let asset = |target: &str| format!(r#""{target}": {{"url": "{url}", "sha256": "{sha256}", "size": {size}}}"#);
        let assets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map(asset).join(",");
        DaemonPin::parse(&format!(r#"{{"version": "{version}", "assets": {{{assets}}}}}"#)).unwrap()
    }

    #[test]
    fn a_system_with_no_published_binary_fails_with_a_message_and_no_request() {
        let dir = tempfile::tempdir().unwrap();
        let mut installer = LocalInstaller::new(pin("1.2.3", "http://127.0.0.1:1/x", &"ab".repeat(32), 10), dir.path().join("archives"));
        installer.target = None;
        let mut seen = Vec::new();
        let result = installer.install(&dir.path().join("bin"), &mut |p| seen.push(p));
        assert!(matches!(result, Err(InstallFailure::Install { output: Some(_) })), "{result:?}");
        assert!(seen.is_empty());
    }

    /// Serves `body` to one request on a loopback port; the address to GET it from.
    fn serve_once(body: &'static [u8]) -> String {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request);
                let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        format!("http://{address}/pi-studio.tar.gz")
    }

    #[test]
    fn an_archive_that_is_not_the_pinned_file_is_a_checksum_mismatch_with_its_progress_reported_and_nothing_kept() {
        let body: &'static [u8] = b"not the pinned archive";
        let dir = tempfile::tempdir().unwrap();
        let archives = dir.path().join("archives");
        let installer = LocalInstaller::new(pin("1.2.3", &serve_once(body), &"ab".repeat(32), body.len() as u64), archives.clone());
        let mut seen = Vec::new();
        let result = installer.install(&dir.path().join("bin"), &mut |p| seen.push(p));
        assert_eq!(result, Err(InstallFailure::Checksum));
        // The pieces reached the caller's thread, the last one with every byte; `installing` never came.
        assert_eq!(seen.last(), Some(&InstallProgress::Downloading { received: body.len() as u64, total: body.len() as u64 }), "{seen:?}");
        assert!(!seen.contains(&InstallProgress::Installing));
        // The bad archive was deleted, and nothing was unpacked.
        let kept: Vec<_> = std::fs::read_dir(archives.join("1.2.3")).map(|entries| entries.flatten().collect()).unwrap_or_default();
        assert!(kept.is_empty(), "{kept:?}");
        assert!(!dir.path().join("bin").exists());
    }

    #[test]
    fn a_download_that_cannot_connect_is_a_failed_download_and_leaves_nothing() {
        // Nothing listens on port 1.
        let dir = tempfile::tempdir().unwrap();
        let installer = LocalInstaller::new(pin("1.2.3", "http://127.0.0.1:1/x", &"ab".repeat(32), 10), dir.path().join("archives"));
        let result = installer.install(&dir.path().join("bin"), &mut |_| {});
        assert_eq!(result, Err(InstallFailure::Download));
        assert!(!dir.path().join("bin").exists());
    }

    #[test]
    fn the_pin_that_is_installed_is_adopted_without_an_archive_and_a_missing_one_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let installer = LocalInstaller::new(pin("1.2.3", "http://127.0.0.1:1/x", &"ab".repeat(32), 10), dir.path().join("archives"));
        assert!(!installer.adopt_installed(dir.path()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let version = version_dir(dir.path(), "1.2.3");
            std::fs::create_dir_all(&version).unwrap();
            let program = version.join(BINARY);
            std::fs::write(&program, "#!/bin/sh\necho 1.2.3\n").unwrap();
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(installer.adopt_installed(dir.path()));
            assert_eq!(current_version(dir.path()).as_deref(), Some("1.2.3"));
            // A folder of that name whose program answers another version is not adopted.
            std::fs::write(&program, "#!/bin/sh\necho 9.9.9\n").unwrap();
            std::fs::remove_file(dir.path().join("current")).unwrap();
            assert!(!installer.adopt_installed(dir.path()));
            assert_eq!(current_version(dir.path()), None);
        }
    }

    #[cfg(unix)]
    #[test]
    fn tidy_keeps_current_and_the_previous_version_and_the_pins_archive_only() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        for version in ["0.0.129", "0.0.130", "0.0.131"] {
            let folder = version_dir(&bin, version);
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join(BINARY), "x").unwrap();
        }
        switch_current(&bin, "0.0.131").unwrap();
        let archives = dir.path().join("archives");
        for version in ["0.0.130", "0.0.131"] {
            std::fs::create_dir_all(archives.join(version)).unwrap();
            std::fs::write(archives.join(version).join("linux-x64.tar.gz"), "x").unwrap();
        }
        LocalInstaller::new(pin("0.0.131", "http://127.0.0.1:1/x", &"ab".repeat(32), 10), archives.clone()).tidy(&bin);
        let mut left = installed_names(&bin);
        left.sort();
        assert_eq!(left, ["0.0.130", "0.0.131"]);
        assert_eq!(current_version(&bin).as_deref(), Some("0.0.131"));
        assert!(archives.join("0.0.131").is_dir() && !archives.join("0.0.130").exists());
    }
}
