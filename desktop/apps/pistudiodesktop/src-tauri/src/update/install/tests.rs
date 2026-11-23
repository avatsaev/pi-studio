//! The install steps over fakes: what `pkexec` exits with and what the install is called, the package
//! file's mode and its removal in every path, a signature failure writing nothing, the Windows
//! installer's order at the restart, and the plug-in's errors as codes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use pistudiodesktop_shell::update::{InstallKind, Progress, UpdateCode};
use tauri_plugin_updater::Error as PluginError;

use super::{Commands, Installer, Offered, Shutdown, download_code, install_code, package_outcome, remove_leftover};

/// What the fake `pkexec` does when it is run.
#[derive(Clone, Copy, Debug)]
enum Run {
    /// Exits with this code (`None`: a signal ended it).
    Exit(Option<i32>),
    /// Could not be started.
    NotStarted,
}

/// The package file as `pkexec` sees it when it runs.
#[derive(Debug, PartialEq, Eq)]
struct Seen {
    program: String,
    args: Vec<String>,
    /// The file's permission bits (unix only) and its content.
    mode: Option<u32>,
    content: Vec<u8>,
}

struct FakeCommands {
    run: Mutex<Run>,
    seen: Mutex<Vec<Seen>>,
}

impl FakeCommands {
    fn new(run: Run) -> Arc<Self> {
        Arc::new(Self { run: Mutex::new(run), seen: Mutex::new(Vec::new()) })
    }
}

impl Commands for FakeCommands {
    fn run(&self, program: &str, args: &[&OsStr]) -> io::Result<Option<i32>> {
        let file = Path::new(args.last().expect("the file is the last argument"));
        #[cfg(unix)]
        let mode = Some(std::os::unix::fs::PermissionsExt::mode(&std::fs::metadata(file).unwrap().permissions()) & 0o777);
        #[cfg(not(unix))]
        let mode = None;
        self.seen.lock().unwrap().push(Seen {
            program: program.to_owned(),
            args: args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect(),
            mode,
            content: std::fs::read(file).unwrap(),
        });
        match *self.run.lock().unwrap() {
            Run::Exit(code) => Ok(code),
            Run::NotStarted => Err(io::Error::new(io::ErrorKind::NotFound, "pkexec")),
        }
    }
}

/// What happened, in order, across the fakes.
type Log = Arc<Mutex<Vec<String>>>;

struct FakeOffered {
    download: Mutex<Result<Vec<u8>, UpdateCode>>,
    install: Mutex<Result<(), UpdateCode>>,
    reports: Vec<(u64, Option<u64>)>,
    log: Log,
}

impl FakeOffered {
    fn new(log: &Log, download: Result<Vec<u8>, UpdateCode>) -> Arc<Self> {
        Arc::new(Self { download: Mutex::new(download), install: Mutex::new(Ok(())), reports: vec![(3, Some(6)), (6, Some(6))], log: Arc::clone(log) })
    }
}

impl Offered for FakeOffered {
    fn download(&self, progress: Progress<'_>) -> Result<Vec<u8>, UpdateCode> {
        self.log.lock().unwrap().push("download".into());
        for (received, total) in &self.reports {
            progress(*received, *total);
        }
        self.download.lock().unwrap().clone()
    }

    fn install(&self, bytes: &[u8]) -> Result<(), UpdateCode> {
        self.log.lock().unwrap().push(format!("plug-in install {}", String::from_utf8_lossy(bytes)));
        *self.install.lock().unwrap()
    }
}

struct FakeShutdown {
    log: Log,
}

impl Shutdown for FakeShutdown {
    fn save_state(&self) {
        self.log.lock().unwrap().push("save state".into());
    }

    fn restart(&self) {
        self.log.lock().unwrap().push("restart".into());
    }
}

struct Rig {
    installer: Installer,
    commands: Arc<FakeCommands>,
    offered: Arc<FakeOffered>,
    log: Log,
    /// The cache directory (removed with the rig).
    cache: tempfile::TempDir,
}

impl Rig {
    fn dir(&self) -> PathBuf {
        self.cache.path().join("app")
    }

    /// The files left in the cache directory's `app` folder (none when it was never made).
    fn left(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.dir()) else { return Vec::new() };
        let mut names: Vec<String> = entries.map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    fn calls(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }
}

/// An installer of `kind` that has been offered a build whose download answers `download`.
fn rig(kind: InstallKind, run: Run, download: Result<Vec<u8>, UpdateCode>) -> Rig {
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let cache = tempfile::tempdir().unwrap();
    let commands = FakeCommands::new(run);
    let offered = FakeOffered::new(&log, download);
    let installer = Installer::new(kind, Some(cache.path().join("app")), commands.clone(), Arc::new(FakeShutdown { log: Arc::clone(&log) }));
    installer.offer(Some(offered.clone()));
    Rig { installer, commands, offered, log, cache }
}

fn bytes() -> Result<Vec<u8>, UpdateCode> {
    Ok(b"PKG".to_vec())
}

fn downloaded(kind: InstallKind, run: Run) -> Rig {
    let rig = rig(kind, run, bytes());
    rig.installer.download(&|_, _| {}).unwrap();
    rig
}

// --- the exit of pkexec -------------------------------------------------------------------------

#[test]
fn the_exit_of_pkexec_is_installed_refused_or_failed() {
    assert_eq!(package_outcome(&Ok(Some(0))), Ok(()));
    assert_eq!(package_outcome(&Ok(Some(126))), Err(UpdateCode::Refused), "dismissed or not authorised");
    assert_eq!(package_outcome(&Ok(Some(127))), Err(UpdateCode::Refused));
    for code in [1, 2, 100, 125, 128, 255, -1] {
        assert_eq!(package_outcome(&Ok(Some(code))), Err(UpdateCode::Install), "{code}: dpkg or rpm failed");
    }
    assert_eq!(package_outcome(&Ok(None)), Err(UpdateCode::Install), "ended by a signal");
    assert_eq!(package_outcome(&Err(io::Error::from(io::ErrorKind::NotFound))), Err(UpdateCode::Install), "pkexec could not be started");
}

// --- the package file -----------------------------------------------------------------------------

#[test]
fn a_deb_is_installed_by_pkexec_dpkg_from_a_private_file_that_is_removed_after() {
    let rig = downloaded(InstallKind::Deb, Run::Exit(Some(0)));
    assert_eq!(rig.installer.install(), Ok(()));
    let file = rig.dir().join("pi-studio-update.deb");
    let seen = rig.commands.seen.lock().unwrap();
    assert_eq!(
        *seen,
        [Seen {
            program: "pkexec".into(),
            args: vec!["dpkg".into(), "-i".into(), file.to_string_lossy().into_owned()],
            mode: if cfg!(unix) { Some(0o600) } else { None },
            content: b"PKG".to_vec(),
        }]
    );
    assert!(!file.exists(), "removed after the step");
    assert_eq!(rig.left(), Vec::<String>::new());
    assert_eq!(rig.calls(), ["download"], "the plug-in's own install is never used for a package");
}

#[test]
fn an_rpm_is_installed_by_pkexec_rpm() {
    let rig = downloaded(InstallKind::Rpm, Run::Exit(Some(0)));
    assert_eq!(rig.installer.install(), Ok(()));
    let seen = rig.commands.seen.lock().unwrap();
    let file = rig.dir().join("pi-studio-update.rpm").to_string_lossy().into_owned();
    assert_eq!((seen[0].program.as_str(), seen[0].args.as_slice()), ("pkexec", ["rpm".to_owned(), "-U".to_owned(), file].as_slice()));
    assert_eq!(rig.left(), Vec::<String>::new());
}

#[test]
fn the_files_mode_and_removal_hold_in_every_outcome_of_pkexec() {
    let cases = [
        (Run::Exit(Some(0)), Ok(())),
        (Run::Exit(Some(126)), Err(UpdateCode::Refused)),
        (Run::Exit(Some(127)), Err(UpdateCode::Refused)),
        (Run::Exit(Some(1)), Err(UpdateCode::Install)),
        (Run::Exit(None), Err(UpdateCode::Install)),
        (Run::NotStarted, Err(UpdateCode::Install)),
    ];
    for kind in [InstallKind::Deb, InstallKind::Rpm] {
        for (run, expected) in cases {
            let rig = downloaded(kind, run);
            assert_eq!(rig.installer.install(), expected, "{kind:?} {run:?}");
            let seen = rig.commands.seen.lock().unwrap();
            assert_eq!(seen.len(), 1, "{run:?}: run once");
            assert_eq!(seen[0].mode, if cfg!(unix) { Some(0o600) } else { None }, "{run:?}");
            assert_eq!(rig.left(), Vec::<String>::new(), "{kind:?} {run:?}: the file is removed whatever pkexec did");
        }
    }
}

#[cfg(unix)]
#[test]
fn the_directory_is_private_and_a_file_left_in_the_way_is_replaced_not_reused() {
    use std::os::unix::fs::PermissionsExt;
    let rig = downloaded(InstallKind::Deb, Run::Exit(Some(0)));
    std::fs::create_dir_all(rig.dir()).unwrap();
    let old = rig.dir().join("pi-studio-update.deb");
    std::fs::write(&old, b"old and world readable").unwrap();
    std::fs::set_permissions(&old, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(rig.installer.install(), Ok(()));
    let seen = rig.commands.seen.lock().unwrap();
    assert_eq!((seen[0].mode, seen[0].content.as_slice()), (Some(0o600), b"PKG".as_slice()));

    // A directory the app made is for it alone.
    let fresh = downloaded(InstallKind::Rpm, Run::Exit(Some(0)));
    fresh.installer.install().unwrap();
    assert_eq!(std::fs::metadata(fresh.dir()).unwrap().permissions().mode() & 0o777, 0o700);
}

#[test]
fn the_file_is_one_argument_even_when_its_directory_has_spaces_and_shell_characters() {
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let cache = tempfile::tempdir().unwrap();
    let dir = cache.path().join("a b; touch pwned $(id) `x`");
    let commands = FakeCommands::new(Run::Exit(Some(0)));
    let installer = Installer::new(InstallKind::Deb, Some(dir.clone()), commands.clone(), Arc::new(FakeShutdown { log: Arc::clone(&log) }));
    installer.offer(Some(FakeOffered::new(&log, bytes())));
    installer.download(&|_, _| {}).unwrap();
    installer.install().unwrap();
    let seen = commands.seen.lock().unwrap();
    assert_eq!(seen[0].args.len(), 3);
    assert_eq!(seen[0].args[2], dir.join("pi-studio-update.deb").to_string_lossy());
    assert!(!cache.path().join("pwned").exists());
}

#[test]
fn a_package_that_cannot_be_written_is_failed_install_and_pkexec_is_never_run() {
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let cache = tempfile::tempdir().unwrap();
    // The "directory" is a file: nothing can be made in it.
    let blocked = cache.path().join("blocked");
    std::fs::write(&blocked, b"x").unwrap();
    let commands = FakeCommands::new(Run::Exit(Some(0)));
    let installer = Installer::new(InstallKind::Deb, Some(blocked), commands.clone(), Arc::new(FakeShutdown { log: Arc::clone(&log) }));
    installer.offer(Some(FakeOffered::new(&log, bytes())));
    installer.download(&|_, _| {}).unwrap();
    assert_eq!(installer.install(), Err(UpdateCode::Install));
    assert!(commands.seen.lock().unwrap().is_empty());

    // No cache directory at all.
    let none = Installer::new(InstallKind::Rpm, None, commands.clone(), Arc::new(FakeShutdown { log: Arc::clone(&log) }));
    none.offer(Some(FakeOffered::new(&log, bytes())));
    none.download(&|_, _| {}).unwrap();
    assert_eq!(none.install(), Err(UpdateCode::Install));
    assert!(commands.seen.lock().unwrap().is_empty());
}

#[test]
fn a_leftover_package_is_removed_at_launch_and_nothing_else_is() {
    let cache = tempfile::tempdir().unwrap();
    for name in ["pi-studio-update.deb", "pi-studio-update.rpm", "keep-me.txt"] {
        std::fs::write(cache.path().join(name), b"x").unwrap();
    }
    remove_leftover(cache.path());
    let mut left: Vec<String> = std::fs::read_dir(cache.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    left.sort();
    assert_eq!(left, ["keep-me.txt"]);
    remove_leftover(cache.path());
    remove_leftover(&cache.path().join("missing"));
}

// --- the download ---------------------------------------------------------------------------------

#[test]
fn a_signature_failure_is_the_code_and_nothing_is_kept_or_written() {
    let rig = rig(InstallKind::Deb, Run::Exit(Some(0)), Err(UpdateCode::Signature));
    assert_eq!(rig.installer.download(&|_, _| {}), Err(UpdateCode::Signature));
    assert_eq!(rig.installer.install(), Err(UpdateCode::Install), "no verified bytes: nothing to install");
    assert!(rig.commands.seen.lock().unwrap().is_empty(), "pkexec never ran");
    assert!(!rig.dir().exists(), "not even the directory was made");
    assert_eq!(rig.calls(), ["download"]);
}

#[test]
fn a_download_reports_its_progress_and_keeps_the_verified_bytes() {
    let rig = rig(InstallKind::AppImage, Run::Exit(Some(0)), bytes());
    let reports = Mutex::new(Vec::new());
    rig.installer.download(&|received, total| reports.lock().unwrap().push((received, total))).unwrap();
    assert_eq!(*reports.lock().unwrap(), [(3, Some(6)), (6, Some(6))]);
    assert_eq!(rig.installer.install(), Ok(()));
    assert_eq!(rig.calls(), ["download", "plug-in install PKG"]);
}

#[test]
fn a_download_with_no_offer_is_failed_install_and_a_retry_downloads_from_zero() {
    let none = Installer::new(InstallKind::AppImage, None, FakeCommands::new(Run::Exit(Some(0))), Arc::new(FakeShutdown { log: Log::default() }));
    assert_eq!(none.download(&|_, _| {}), Err(UpdateCode::Install));

    let rig = rig(InstallKind::AppImage, Run::Exit(Some(0)), Err(UpdateCode::Download));
    assert_eq!(rig.installer.download(&|_, _| {}), Err(UpdateCode::Download));
    *rig.offered.download.lock().unwrap() = bytes();
    assert_eq!(rig.installer.download(&|_, _| {}), Ok(()), "the offer stays for the retry");
    assert_eq!(rig.calls(), ["download", "download"]);
}

#[test]
fn a_new_offer_drops_the_bytes_of_the_old_one() {
    let rig = downloaded(InstallKind::AppImage, Run::Exit(Some(0)));
    rig.installer.offer(Some(FakeOffered::new(&rig.log, bytes())));
    assert_eq!(rig.installer.install(), Err(UpdateCode::Install), "the kept bytes were of the build before");
    rig.installer.offer(None);
    assert_eq!(rig.installer.download(&|_, _| {}), Err(UpdateCode::Install), "a check that found nothing leaves nothing to download");
}

// --- the plug-in's own install --------------------------------------------------------------------

#[test]
fn an_appimage_and_a_macos_application_are_installed_by_the_plug_in_and_never_through_pkexec() {
    for kind in [InstallKind::AppImage, InstallKind::App] {
        let rig = downloaded(kind, Run::Exit(Some(0)));
        assert_eq!(rig.installer.install(), Ok(()), "{kind:?}");
        assert_eq!(rig.calls(), ["download", "plug-in install PKG"], "{kind:?}");
        assert!(rig.commands.seen.lock().unwrap().is_empty());
        assert!(!rig.dir().exists());
    }
}

#[test]
fn a_failed_plug_in_install_is_its_code_and_uses_the_bytes_up() {
    let rig = downloaded(InstallKind::AppImage, Run::Exit(Some(0)));
    *rig.offered.install.lock().unwrap() = Err(UpdateCode::Install);
    assert_eq!(rig.installer.install(), Err(UpdateCode::Install));
    assert_eq!(rig.installer.install(), Err(UpdateCode::Install));
    assert_eq!(rig.calls(), ["download", "plug-in install PKG"], "the second call had no bytes and did not reach the plug-in");
}

#[test]
fn the_kinds_that_install_at_the_restart_or_not_at_all_are_not_installed_at_the_first_click() {
    for kind in [InstallKind::Nsis, InstallKind::Msi, InstallKind::Unknown] {
        let rig = downloaded(kind, Run::Exit(Some(0)));
        assert_eq!(rig.installer.install(), Err(UpdateCode::Install), "{kind:?}");
        assert_eq!(rig.calls(), ["download"]);
        assert!(rig.commands.seen.lock().unwrap().is_empty());
    }
}

// --- the restart ----------------------------------------------------------------------------------

#[test]
fn the_restart_on_linux_and_macos_asks_the_app_to_restart_and_nothing_else() {
    for kind in [InstallKind::AppImage, InstallKind::App, InstallKind::Deb, InstallKind::Rpm] {
        let rig = downloaded(kind, Run::Exit(Some(0)));
        rig.installer.install().unwrap();
        rig.log.lock().unwrap().clear();
        assert_eq!(rig.installer.restart(), Ok(()), "{kind:?}");
        assert_eq!(rig.calls(), ["restart"], "{kind:?}: no state saved by hand and no plug-in install: the exit does the saving");
    }
}

#[test]
fn on_windows_the_state_is_saved_and_then_the_installer_starts_with_the_kept_bytes() {
    for kind in [InstallKind::Nsis, InstallKind::Msi] {
        let rig = downloaded(kind, Run::Exit(Some(0)));
        assert_eq!(rig.calls(), ["download"], "{kind:?}: the first click only downloads");
        assert_eq!(rig.installer.restart(), Ok(()), "{kind:?}");
        assert_eq!(rig.calls(), ["download", "save state", "plug-in install PKG"], "{kind:?}: saved before the installer ends the app");
    }
}

#[test]
fn on_windows_an_installer_that_cannot_start_is_failed_install_and_the_bytes_are_gone() {
    let rig = downloaded(InstallKind::Nsis, Run::Exit(Some(0)));
    *rig.offered.install.lock().unwrap() = Err(UpdateCode::Install);
    assert_eq!(rig.installer.restart(), Err(UpdateCode::Install));
    assert_eq!(rig.installer.restart(), Err(UpdateCode::Install), "a second try has nothing to run");
    assert_eq!(rig.calls(), ["download", "save state", "plug-in install PKG"], "the second try saved nothing and ran nothing");
}

#[test]
fn on_windows_a_restart_with_no_kept_bytes_saves_nothing() {
    let rig = rig(InstallKind::Msi, Run::Exit(Some(0)), bytes());
    assert_eq!(rig.installer.restart(), Err(UpdateCode::Install));
    assert_eq!(rig.calls(), Vec::<String>::new());
}

// --- the plug-in's errors as codes ----------------------------------------------------------------------

#[test]
fn the_plug_ins_download_errors_are_the_codes_of_the_spec() {
    let cases: Vec<(PluginError, UpdateCode)> = vec![
        (PluginError::SignatureUtf8("x".into()), UpdateCode::Signature),
        (PluginError::MissingSignedVersion, UpdateCode::Signature),
        (PluginError::SignedVersionMismatch { signed: "1.0.0".into(), announced: "2.0.0".into() }, UpdateCode::Signature),
        (PluginError::Network("Download request failed with status: 404 Not Found".into()), UpdateCode::Download),
        (PluginError::Io(io::Error::from(io::ErrorKind::UnexpectedEof)), UpdateCode::Download),
        (PluginError::ReleaseNotFound, UpdateCode::Download),
    ];
    for (error, code) in cases {
        assert_eq!(download_code(&error), code, "{error}");
    }
}

#[test]
fn the_plug_ins_install_errors_are_install_unless_it_refused_the_signature() {
    assert_eq!(install_code(&PluginError::MissingSignedVersion), UpdateCode::Signature);
    for error in [
        PluginError::InvalidUpdaterFormat,
        PluginError::TempDirNotOnSameMountPoint,
        PluginError::BinaryNotFoundInArchive,
        PluginError::PackageInstallFailed,
        PluginError::Io(io::Error::from(io::ErrorKind::PermissionDenied)),
    ] {
        assert_eq!(install_code(&error), UpdateCode::Install, "{error}");
    }
}
