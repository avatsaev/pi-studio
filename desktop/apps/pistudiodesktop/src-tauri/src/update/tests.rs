//! The self-update in the app binary: the install kind and each `cannot_install` rule with injected
//! probes, the plug-in's errors as codes, the dialogs of "Check for Updates…", the schedule over a
//! fake owner, and the real plug-in reading manifests a test server serves over local HTTP.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::UpdateAction;
use pistudiodesktop_shell::update::{
    CheckOutcome, InstallKind, Manifest, Offer, Origin, Progress, Reason, Trigger, UpdateCode, UpdateState, Updater, UpdaterHook,
};
use serde_json::{Value, json};
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::utils::config::BundleType;

use super::{
    Answer, Env, Owner, Place, PluginUpdater, Prompts, RELEASES_URL, Runner, answer_for, cannot_install_with, check_code, entry_target, kind_of, on_path,
    release_url,
};

const BUNDLES: [Option<BundleType>; 8] = [
    Some(BundleType::AppImage),
    Some(BundleType::Deb),
    Some(BundleType::Rpm),
    Some(BundleType::Msi),
    Some(BundleType::Nsis),
    Some(BundleType::App),
    Some(BundleType::Dmg),
    None,
];

fn place(exe: &str, appimage: Option<&str>) -> Place {
    Place { exe: PathBuf::from(exe), appimage: appimage.map(PathBuf::from), path: None }
}

// --- the install kind ---------------------------------------------------------------------------------

#[test]
fn the_bundle_type_is_the_kind_and_app_counts_only_inside_an_application_bundle() {
    let exe = Path::new("/opt/pi-studio/pistudiodesktop");
    let kinds: Vec<InstallKind> = BUNDLES.iter().cloned().map(|bundle| kind_of(bundle, exe)).collect();
    assert_eq!(
        kinds,
        [
            InstallKind::AppImage,
            InstallKind::Deb,
            InstallKind::Rpm,
            InstallKind::Msi,
            InstallKind::Nsis,
            InstallKind::Unknown,
            InstallKind::Unknown,
            InstallKind::Unknown
        ],
        "`App` outside a `*.app` is a development build, and so are a disk image's type and no type"
    );
    let inside = Path::new("/Applications/Pi Studio.app/Contents/MacOS/pistudiodesktop");
    assert_eq!(kind_of(Some(BundleType::App), inside), InstallKind::App);
    for outside in [
        "/Applications/Pi Studio.app/Contents/pistudiodesktop",
        "/Applications/Pi Studio/Contents/MacOS/pistudiodesktop",
        "/Applications/Pi Studio.app/MacOS/pistudiodesktop",
        "/Users/me/pi-studio/target/debug/pistudiodesktop",
        "pistudiodesktop",
    ] {
        assert_eq!(kind_of(Some(BundleType::App), Path::new(outside)), InstallKind::Unknown, "{outside}");
    }
    assert_eq!(kind_of(Some(BundleType::Deb), inside), InstallKind::Deb, "only `App` looks at the path");
}

// --- cannot_install ---------------------------------------------------------------------------------

#[test]
fn an_unknown_kind_is_a_development_build_whatever_else_holds() {
    assert_eq!(cannot_install_with(InstallKind::Unknown, &place("/x/pi", None), |_| true, true), Some(Reason::DevelopmentBuild));
}

#[test]
fn an_appimage_needs_its_file_and_its_directory_writable() {
    let at = place("/tmp/.mount_x/usr/bin/pi", Some("/home/me/Apps/Pi.AppImage"));
    let probe = |writable: &'static [&'static str]| move |path: &Path| writable.iter().any(|w| Path::new(w) == path);
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&["/home/me/Apps/Pi.AppImage", "/home/me/Apps"]), false), None);
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&["/home/me/Apps"]), false), Some(Reason::NotWritable), "the file");
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&["/home/me/Apps/Pi.AppImage"]), false), Some(Reason::NotWritable), "its directory");
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&[]), true), Some(Reason::NotWritable), "pkexec does not matter here");
    // Without `APPIMAGE` the executable is the file asked about (and the mounted one is read-only).
    let no_variable = place("/home/me/Apps/pi", None);
    assert_eq!(cannot_install_with(InstallKind::AppImage, &no_variable, probe(&["/home/me/Apps/pi", "/home/me/Apps"]), false), None);
}

#[test]
fn a_macos_application_on_a_disk_image_or_translocated_is_a_read_only_location() {
    let reason = |exe: &str| cannot_install_with(InstallKind::App, &place(exe, None), |_| true, true);
    assert_eq!(reason("/Applications/Pi Studio.app/Contents/MacOS/pi"), None);
    assert_eq!(reason("/Users/me/Applications/Pi Studio.app/Contents/MacOS/pi"), None);
    assert_eq!(reason("/Volumes/Pi Studio/Pi Studio.app/Contents/MacOS/pi"), Some(Reason::ReadOnlyLocation));
    assert_eq!(reason("/private/var/folders/ab/T/AppTranslocation/1234-5678/d/Pi Studio.app/Contents/MacOS/pi"), Some(Reason::ReadOnlyLocation));
    assert_eq!(reason("/VolumesX/Pi Studio.app/Contents/MacOS/pi"), None, "a directory merely starting with the name is not a volume");
}

#[test]
fn a_deb_or_rpm_needs_pkexec_and_the_windows_installers_need_nothing() {
    let at = place("/usr/bin/pistudiodesktop", None);
    for kind in [InstallKind::Deb, InstallKind::Rpm] {
        assert_eq!(cannot_install_with(kind, &at, |_| false, false), Some(Reason::NoPkexec), "{kind:?}");
        assert_eq!(cannot_install_with(kind, &at, |_| false, true), None, "{kind:?}: a package is installed by pkexec, not by a write of ours");
    }
    for kind in [InstallKind::Nsis, InstallKind::Msi] {
        assert_eq!(cannot_install_with(kind, &at, |_| false, false), None, "{kind:?}");
    }
}

#[test]
fn pkexec_is_looked_for_in_each_directory_of_the_path() {
    let path = std::env::join_paths(["/nowhere", "/usr/bin", "/bin"]).unwrap();
    let only = |found: &'static str| move |p: &Path| p == Path::new(found);
    assert!(on_path("pkexec", Some(&path), only("/bin/pkexec")));
    assert!(on_path("pkexec", Some(&path), only("/usr/bin/pkexec")));
    assert!(!on_path("pkexec", Some(&path), only("/sbin/pkexec")));
    assert!(!on_path("pkexec", None, |_| true), "no path, no pkexec");
}

#[test]
fn a_directory_is_writable_when_a_file_can_be_made_in_it_and_a_missing_path_is_not() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("Pi.AppImage");
    std::fs::write(&file, b"x").unwrap();
    assert!(super::is_writable(dir.path()));
    assert!(super::is_writable(&file));
    assert!(!super::is_writable(&dir.path().join("missing")));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "the probe leaves nothing behind");
    let mut permissions = std::fs::metadata(&file).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&file, permissions).unwrap();
    assert!(!super::is_writable(&file));
}

// --- the entry of the manifest and the errors of the plug-in ------------------------------------------------

#[test]
fn each_kind_reads_its_own_entry_and_an_unknown_one_the_systems_first() {
    let name = |kind| entry_target("linux-x86_64", kind);
    assert_eq!(name(InstallKind::AppImage), "linux-x86_64-appimage");
    assert_eq!(name(InstallKind::Deb), "linux-x86_64-deb");
    assert_eq!(name(InstallKind::Rpm), "linux-x86_64-rpm");
    assert_eq!(name(InstallKind::Nsis), "linux-x86_64-nsis");
    assert_eq!(name(InstallKind::Msi), "linux-x86_64-msi");
    assert_eq!(name(InstallKind::App), "linux-x86_64", "the two macOS entries name the one universal file and carry no kind");
    let first = if cfg!(target_os = "macos") {
        InstallKind::App
    } else if cfg!(windows) {
        InstallKind::Nsis
    } else {
        InstallKind::AppImage
    };
    assert_eq!(name(InstallKind::Unknown), name(first), "U12");
}

#[test]
fn the_plug_ins_errors_are_the_codes_of_the_spec() {
    use tauri_plugin_updater::Error as E;
    let json_error = serde_json::from_str::<Value>("{").unwrap_err();
    let cases: Vec<(E, UpdateCode)> = vec![
        (E::TargetNotFound("linux-x86_64-appimage".into()), UpdateCode::NoTarget),
        (E::TargetsNotFound(vec!["a".into(), "b".into()]), UpdateCode::NoTarget),
        (E::UnsupportedOs, UpdateCode::NoTarget),
        (E::UnsupportedArch, UpdateCode::NoTarget),
        (E::Serialization(json_error), UpdateCode::ManifestInvalid),
        (E::EmptyEndpoints, UpdateCode::ManifestInvalid),
        (E::InsecureTransportProtocol, UpdateCode::ManifestInvalid),
        (E::ReleaseNotFound, UpdateCode::Offline),
        (E::Network("reset".into()), UpdateCode::Offline),
    ];
    for (error, code) in cases {
        assert_eq!(check_code(&error), code, "{error}");
    }
}

#[test]
fn the_release_page_is_the_manifests_notes_when_they_are_an_https_address() {
    assert_eq!(
        release_url(Some("https://github.com/avatsaev/pi-studio/releases/tag/desktop-v0.4.0")),
        "https://github.com/avatsaev/pi-studio/releases/tag/desktop-v0.4.0"
    );
    assert_eq!(release_url(Some("  https://example.test/r  ")), "https://example.test/r");
    for notes in [None, Some(""), Some("Fixes things"), Some("http://example.test/r"), Some("javascript:alert(1)"), Some("file:///etc/passwd")] {
        assert_eq!(release_url(notes), RELEASES_URL, "{notes:?}");
    }
}

// --- the dialog of "Check for Updates…" ---------------------------------------------------------------------

#[test]
fn the_dialog_of_each_outcome_is_the_one_of_the_spec() {
    let up_to_date = Ok(UpdateState::UpToDate { checked_at: 1 });
    assert_eq!(answer_for(&up_to_date, "0.3.0"), Some(Answer::Alert("Pi Studio 0.3.0 is up to date.".into())));
    let available = Ok(UpdateState::Available { version: "0.4.0".into(), release_url: RELEASES_URL.into() });
    assert_eq!(answer_for(&available, "0.3.0"), Some(Answer::Offer("Pi Studio 0.4.0 is available.".into())));
    let cannot = Ok(UpdateState::CannotInstall { version: "0.4.0".into(), release_url: RELEASES_URL.into(), reason: Reason::NoPkexec });
    assert_eq!(
        answer_for(&cannot, "0.3.0"),
        Some(Answer::Alert("Pi Studio 0.4.0 is available. Installing a package needs pkexec, which is not available.".into()))
    );
    assert_eq!(answer_for(&Err(UpdateCode::Offline), "0.3.0"), Some(Answer::Alert("Could not reach the update server".into())));
    assert_eq!(answer_for(&Ok(UpdateState::Idle), "0.3.0"), None);
}

// --- the runner, over fakes ---------------------------------------------------------------------------------

struct FakeHook {
    check: Mutex<Result<CheckOutcome, UpdateCode>>,
    kind: InstallKind,
    checks: AtomicUsize,
}

impl FakeHook {
    fn new(check: Result<CheckOutcome, UpdateCode>) -> Arc<Self> {
        Arc::new(Self { check: Mutex::new(check), kind: InstallKind::AppImage, checks: AtomicUsize::new(0) })
    }
}

impl UpdaterHook for FakeHook {
    fn check(&self, _: &Manifest) -> Result<CheckOutcome, UpdateCode> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        self.check.lock().unwrap().clone()
    }
    fn install_kind(&self) -> InstallKind {
        self.kind
    }
    fn cannot_install(&self, _: InstallKind, _: &str) -> Option<Reason> {
        None
    }
    fn download(&self, _: Progress<'_>) -> Result<(), UpdateCode> {
        Err(UpdateCode::Install)
    }
    fn install(&self) -> Result<(), UpdateCode> {
        Err(UpdateCode::Install)
    }
    fn restart(&self) {}
}

#[derive(Default)]
struct FakePrompts {
    alerts: Mutex<Vec<String>>,
    offers: Mutex<Vec<String>>,
    install: bool,
}

impl Prompts for FakePrompts {
    fn alert(&self, message: &str) {
        self.alerts.lock().unwrap().push(message.to_owned());
    }
    fn offer(&self, message: &str) -> bool {
        self.offers.lock().unwrap().push(message.to_owned());
        self.install
    }
}

/// What the session answers: a result per command, accepting by default; every command is kept.
#[derive(Default)]
struct FakeOwner {
    answers: Mutex<HashMap<String, Result<Value, String>>>,
    seen: Mutex<Vec<String>>,
}

impl FakeOwner {
    fn answering(self, command: &str, answer: Result<Value, String>) -> Self {
        self.answers.lock().unwrap().insert(command.to_owned(), answer);
        self
    }
}

impl Owner for FakeOwner {
    fn execute(&self, command: &str, _: Value) -> Result<Value, String> {
        self.seen.lock().unwrap().push(command.to_owned());
        self.answers.lock().unwrap().get(command).cloned().unwrap_or_else(|| Ok(json!({"accepted": true})))
    }
}

struct Rig {
    hook: Arc<FakeHook>,
    updater: Arc<Updater>,
    prompts: Arc<FakePrompts>,
    owner: Arc<FakeOwner>,
    runner: Arc<Runner>,
}

fn rig(check: Result<CheckOutcome, UpdateCode>, install: bool, owner: FakeOwner) -> Rig {
    let hook = FakeHook::new(check);
    let updater = Arc::new(Updater::new(Some(hook.clone()), Manifest::Default));
    let prompts = Arc::new(FakePrompts { install, ..FakePrompts::default() });
    let owner = Arc::new(owner);
    let runner = Arc::new(Runner::new(Arc::clone(&updater), prompts.clone(), owner.clone(), "0.3.0".into()));
    Rig { hook, updater, prompts, owner, runner }
}

fn newer() -> Result<CheckOutcome, UpdateCode> {
    Ok(CheckOutcome::Found(Offer { version: "0.4.0".into(), release_url: "https://example.test/r".into() }))
}

fn alerts(rig: &Rig) -> Vec<String> {
    rig.prompts.alerts.lock().unwrap().clone()
}

fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_check_from_the_menu_answers_up_to_date_with_a_dialog() {
    let rig = rig(Ok(CheckOutcome::UpToDate), false, FakeOwner::default());
    rig.runner.menu_check();
    assert_eq!(rig.owner.seen.lock().unwrap().as_slice(), ["update.check"], "the click is the registry command");
    // The owner thread hands the accepted command over; the job is what the blocking pool runs.
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["Pi Studio 0.3.0 is up to date."]);
    assert!(matches!(rig.updater.state(), UpdateState::UpToDate { .. }));
}

#[test]
fn a_check_from_the_menu_that_fails_says_why() {
    let rig = rig(Err(UpdateCode::Offline), false, FakeOwner::default());
    rig.runner.menu_check();
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["Could not reach the update server"]);
    assert_eq!(rig.updater.state(), UpdateState::Failed { code: UpdateCode::Offline, version: None, release_url: None });
}

#[test]
fn a_check_from_the_menu_that_finds_a_build_offers_it_and_install_runs_the_command() {
    let rig = rig(newer(), true, FakeOwner::default());
    rig.runner.menu_check();
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(rig.prompts.offers.lock().unwrap().as_slice(), ["Pi Studio 0.4.0 is available."]);
    assert_eq!(rig.owner.seen.lock().unwrap().as_slice(), ["update.check", "update.install"]);
    assert!(alerts(&rig).is_empty());

    let later = rig_later();
    later.runner.menu_check();
    later.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(later.owner.seen.lock().unwrap().as_slice(), ["update.check"], "Later runs nothing");
    assert!(matches!(later.updater.state(), UpdateState::Available { .. }), "and the build stays offered");
}

fn rig_later() -> Rig {
    rig(newer(), false, FakeOwner::default())
}

#[test]
fn an_install_the_session_refuses_is_alerted_with_its_reason() {
    let owner = FakeOwner::default().answering("update.install", Err("`update.install` is unavailable: there is no update to install".into()));
    let rig = rig(newer(), true, owner);
    rig.runner.menu_check();
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["`update.install` is unavailable: there is no update to install"]);
}

#[test]
fn a_refused_menu_check_alerts_the_reason_and_the_next_check_shows_no_dialog() {
    let owner = FakeOwner::default().answering("update.check", Err("`update.check` is unavailable: an update is downloading".into()));
    let rig = rig(Ok(CheckOutcome::UpToDate), false, owner);
    rig.runner.menu_check();
    assert_eq!(alerts(&rig), ["`update.check` is unavailable: an update is downloading"]);
    // A page's check later: it is not the menu's, so it ends in the state and in no dialog.
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["`update.check` is unavailable: an update is downloading"]);
    assert!(matches!(rig.updater.state(), UpdateState::UpToDate { .. }));
}

#[test]
fn a_check_the_state_refuses_when_it_begins_is_alerted_for_the_menu_and_logged_for_the_rest() {
    let rig = rig(Ok(CheckOutcome::UpToDate), false, FakeOwner::default());
    let ticket = rig.updater.begin_check(Origin::Automatic, 1).unwrap();
    rig.runner.menu_check();
    // The automatic check began between the click and the command: the state says so.
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["an update check is already running"]);
    assert!(rig.runner.prepare(UpdateAction::Check).is_none(), "no dialog wanted: nothing to run");
    drop(ticket);
}

#[test]
fn a_check_of_the_page_changes_the_state_and_shows_nothing() {
    let rig = rig(newer(), true, FakeOwner::default());
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert!(rig.prompts.offers.lock().unwrap().is_empty());
    assert!(alerts(&rig).is_empty());
    assert_eq!(rig.updater.state(), UpdateState::Available { version: "0.4.0".into(), release_url: "https://example.test/r".into() });
}

#[test]
fn an_install_is_begun_at_once_and_the_missing_install_step_ends_in_failed_install() {
    let rig = rig(newer(), false, FakeOwner::default());
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    let job = rig.runner.prepare(UpdateAction::Install).unwrap();
    assert!(matches!(rig.updater.state(), UpdateState::Downloading { .. }), "begun on the owner thread, before the job runs");
    job();
    assert_eq!(
        rig.updater.state(),
        UpdateState::Failed { code: UpdateCode::Install, version: Some("0.4.0".into()), release_url: Some("https://example.test/r".into()) }
    );
    assert!(rig.runner.prepare(UpdateAction::Restart).is_some(), "the restart is handed on; the state refuses it");
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert!(matches!(rig.updater.state(), UpdateState::Failed { .. }));
}

#[test]
fn an_install_the_state_does_not_allow_runs_nothing() {
    let rig = rig(newer(), false, FakeOwner::default());
    assert!(rig.runner.prepare(UpdateAction::Install).is_none(), "idle: nothing to install");
}

#[test]
fn handle_runs_the_job_on_the_blocking_pool() {
    let rig = rig(Ok(CheckOutcome::UpToDate), false, FakeOwner::default());
    rig.runner.menu_check();
    rig.runner.handle(UpdateAction::Check);
    wait_until("the dialog", || !alerts(&rig).is_empty());
    assert_eq!(alerts(&rig), ["Pi Studio 0.3.0 is up to date."]);
}

#[test]
fn the_menu_item_is_enabled_as_the_state_allows() {
    let rig = rig(newer(), false, FakeOwner::default());
    assert!(rig.runner.check_enabled());
    let ticket = rig.updater.begin_check(Origin::Manual, 1).unwrap();
    assert!(!rig.runner.check_enabled(), "a check is running");
    rig.updater.run_check(ticket).unwrap();
    assert!(rig.runner.check_enabled());
}

#[test]
fn the_schedule_reads_the_setting_and_checks_at_launch_and_then_when_due() {
    let owner = FakeOwner::default().answering("settings.get", Ok(json!({"autoStartLocalDaemon": true, "checkForUpdates": true, "cliPath": null})));
    let rig = rig(Ok(CheckOutcome::UpToDate), false, owner);
    rig.runner.scheduled(Trigger::Launch);
    assert_eq!(rig.hook.checks.load(Ordering::SeqCst), 1);
    assert!(matches!(rig.updater.state(), UpdateState::UpToDate { .. }));
    rig.runner.scheduled(Trigger::Elapsed);
    assert_eq!(rig.hook.checks.load(Ordering::SeqCst), 1, "the last check is not a day old");
    assert!(alerts(&rig).is_empty(), "the checks of the schedule show no dialog");
}

#[test]
fn with_the_setting_off_or_unreadable_the_schedule_never_checks() {
    let off = FakeOwner::default().answering("settings.get", Ok(json!({"checkForUpdates": false})));
    let rig_off = rig(Ok(CheckOutcome::UpToDate), false, off);
    rig_off.runner.scheduled(Trigger::Launch);
    assert_eq!(rig_off.hook.checks.load(Ordering::SeqCst), 0);
    assert_eq!(rig_off.updater.state(), UpdateState::Idle);

    let broken = FakeOwner::default().answering("settings.get", Err("the app is shutting down".into()));
    let rig_broken = rig(Ok(CheckOutcome::UpToDate), false, broken);
    rig_broken.runner.scheduled(Trigger::Launch);
    assert_eq!(rig_broken.hook.checks.load(Ordering::SeqCst), 0);

    // A check from the menu still works with the setting off.
    rig_off.runner.menu_check();
    rig_off.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(rig_off.hook.checks.load(Ordering::SeqCst), 1);
}

#[test]
fn a_failed_check_of_the_schedule_is_silent_and_leaves_the_state() {
    let owner = FakeOwner::default().answering("settings.get", Ok(json!({"checkForUpdates": true})));
    let rig = rig(Err(UpdateCode::Offline), false, owner);
    rig.runner.scheduled(Trigger::Launch);
    assert_eq!(rig.updater.state(), UpdateState::Idle);
    assert!(alerts(&rig).is_empty());
}

// --- the plug-in, against a manifest served over local HTTP ------------------------------------------------------------

/// A page the test server serves: `status`, `content_type` and `body` for `path`.
struct Route {
    path: &'static str,
    status: u16,
    content_type: &'static str,
    body: String,
}

fn route(path: &'static str, body: Value) -> Route {
    Route { path, status: 200, content_type: "application/json", body: body.to_string() }
}

/// A server on a free loopback port that answers each request from `routes` (404 for the others)
/// and closes the connection. Returns its address and the text of every request it got.
fn serve(routes: Vec<Route>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&requests);
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            answer(&mut stream, &routes, &log);
        }
    });
    (base, requests)
}

fn answer(stream: &mut TcpStream, routes: &[Route], log: &Mutex<Vec<String>>) {
    let mut request = Vec::new();
    let mut chunk = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => request.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&request).into_owned();
    let path = text.split_whitespace().nth(1).unwrap_or("/").to_owned();
    log.lock().unwrap().push(text);
    let (status, content_type, body) =
        routes.iter().find(|r| r.path == path).map_or((404, "text/plain", String::new()), |r| (r.status, r.content_type, r.body.clone()));
    let _ = write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

/// A manifest of the static format naming `version`, with an entry for `target`.
fn manifest_for(version: &str, target: &str) -> Value {
    json!({
        "version": version,
        "pub_date": "2026-11-23T00:00:00Z",
        "notes": format!("https://example.test/releases/desktop-v{version}"),
        "platforms": { target: { "url": "https://example.test/files/Pi.Studio.AppImage", "signature": "c2lnbmF0dXJl" } }
    })
}

/// The target a manifest must carry for `kind` on this system.
fn target_of(kind: InstallKind) -> String {
    entry_target(&tauri_plugin_updater::target().unwrap(), kind)
}

/// A mock app whose configuration has the updater's section a build has, plain HTTP allowed as in a test build.
fn app() -> tauri::App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({"pubkey": "dW50cnVzdGVk", "endpoints": ["https://example.test/latest.json"], "dangerousInsecureTransportProtocol": true}),
    );
    mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap()
}

/// A copy of kind `kind` that can be installed over: an AppImage file in a directory of its own.
fn env(kind: InstallKind, home: &Path) -> Env {
    let file = home.join("Pi.AppImage");
    std::fs::write(&file, b"x").unwrap();
    Env { kind, place: Place { exe: file.clone(), appimage: Some(file), path: None } }
}

/// What a check of `kind` reads from `path` of the server, through the whole shell updater.
fn check_at(kind: InstallKind, url: String) -> Result<UpdateState, UpdateCode> {
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let updater = Updater::new(Some(Arc::new(PluginUpdater::new(app.handle().clone(), env(kind, home.path())))), Manifest::Override(url));
    updater.run_check(updater.begin_check(Origin::Manual, 7).unwrap())
}

#[test]
fn a_newer_manifest_is_available_with_its_release_page() {
    let (base, requests) = serve(vec![route("/latest.json", manifest_for("0.2.0", &target_of(InstallKind::AppImage)))]);
    assert_eq!(
        check_at(InstallKind::AppImage, format!("{base}/latest.json")),
        Ok(UpdateState::Available { version: "0.2.0".into(), release_url: "https://example.test/releases/desktop-v0.2.0".into() })
    );
    let seen = requests.lock().unwrap().join("\n").to_lowercase();
    assert!(seen.starts_with("get /latest.json "), "{seen}");
    assert!(seen.contains("accept: application/json"), "{seen}");
    assert!(seen.contains("user-agent: tauri-plugin-updater/"), "{seen}");
}

#[test]
fn an_equal_or_older_manifest_is_up_to_date() {
    // The mock app is version 0.1.0.
    for version in ["0.1.0", "0.0.9"] {
        let (base, _) = serve(vec![route("/latest.json", manifest_for(version, &target_of(InstallKind::AppImage)))]);
        assert_eq!(check_at(InstallKind::AppImage, format!("{base}/latest.json")), Ok(UpdateState::UpToDate { checked_at: 7 }), "{version}");
    }
}

#[test]
fn an_older_manifest_without_this_kinds_entry_is_still_up_to_date_and_a_newer_one_is_no_target() {
    let other = target_of(InstallKind::Deb);
    let (base, _) = serve(vec![route("/old.json", manifest_for("0.0.9", &other)), route("/new.json", manifest_for("0.2.0", &other))]);
    assert_eq!(check_at(InstallKind::AppImage, format!("{base}/old.json")), Ok(UpdateState::UpToDate { checked_at: 7 }));
    assert_eq!(check_at(InstallKind::AppImage, format!("{base}/new.json")), Err(UpdateCode::NoTarget));
}

#[test]
fn each_kind_finds_the_entry_of_its_own() {
    let mut platforms = serde_json::Map::new();
    for kind in [InstallKind::AppImage, InstallKind::Deb, InstallKind::Rpm, InstallKind::Nsis, InstallKind::Msi] {
        platforms.insert(target_of(kind), json!({"url": format!("https://example.test/files/{}", kind.as_str()), "signature": "c2ln"}));
    }
    let manifest = json!({"version": "0.2.0", "notes": "https://example.test/r", "platforms": platforms});
    let (base, _) = serve(vec![route("/latest.json", manifest)]);
    // Each finds its entry, so the state is the kind's own rule's: an AppImage over its writable file
    // and the Windows installers are installable; a package needs pkexec, which the test's place lacks.
    let expected = [
        (InstallKind::AppImage, "available", None),
        (InstallKind::Nsis, "available", None),
        (InstallKind::Msi, "available", None),
        (InstallKind::Deb, "cannot_install", Some("no_pkexec")),
        (InstallKind::Rpm, "cannot_install", Some("no_pkexec")),
    ];
    for (kind, state, reason) in expected {
        let found = serde_json::to_value(check_at(kind, format!("{base}/latest.json")).unwrap()).unwrap();
        assert_eq!((found["state"].as_str(), found["reason"].as_str(), found["version"].as_str()), (Some(state), reason, Some("0.2.0")), "{kind:?}");
    }
}

#[test]
fn an_unknown_kind_reads_the_first_entry_and_cannot_install_a_development_build() {
    let (base, _) = serve(vec![route("/latest.json", manifest_for("0.2.0", &target_of(InstallKind::Unknown)))]);
    assert_eq!(
        check_at(InstallKind::Unknown, format!("{base}/latest.json")),
        Ok(UpdateState::CannotInstall {
            version: "0.2.0".into(),
            release_url: "https://example.test/releases/desktop-v0.2.0".into(),
            reason: Reason::DevelopmentBuild
        })
    );
}

#[test]
fn an_appimage_that_cannot_be_written_shows_the_newer_build_with_its_reason() {
    let (base, _) = serve(vec![route("/latest.json", manifest_for("0.2.0", &target_of(InstallKind::AppImage)))]);
    let app = app();
    let missing = Env {
        kind: InstallKind::AppImage,
        place: Place { exe: PathBuf::from("/nonexistent/Pi.AppImage"), appimage: Some(PathBuf::from("/nonexistent/Pi.AppImage")), path: None },
    };
    let updater = Updater::new(Some(Arc::new(PluginUpdater::new(app.handle().clone(), missing))), Manifest::Override(format!("{base}/latest.json")));
    let state = updater.run_check(updater.begin_check(Origin::Manual, 7).unwrap()).unwrap();
    assert!(matches!(state, UpdateState::CannotInstall { reason: Reason::NotWritable, .. }), "{state:?}");
}

#[test]
fn a_manifest_that_is_not_valid_is_manifest_invalid() {
    let wrong_version = json!({"version": "banana", "platforms": {}});
    let not_a_manifest = json!({"hello": "world"});
    let html = Route { path: "/page", status: 200, content_type: "text/html", body: "<html>sorry</html>".into() };
    let (base, _) = serve(vec![route("/banana.json", wrong_version), route("/object.json", not_a_manifest), html]);
    for path in ["/banana.json", "/object.json", "/page"] {
        assert_eq!(check_at(InstallKind::AppImage, format!("{base}{path}")), Err(UpdateCode::ManifestInvalid), "{path}");
    }
}

#[test]
fn a_missing_manifest_and_a_closed_port_are_offline() {
    let (base, _) = serve(Vec::new());
    assert_eq!(check_at(InstallKind::AppImage, format!("{base}/latest.json")), Err(UpdateCode::Offline), "404");
    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}/latest.json", listener.local_addr().unwrap())
    };
    assert_eq!(check_at(InstallKind::AppImage, closed), Err(UpdateCode::Offline), "connection refused");
}

#[test]
fn an_address_that_is_not_one_is_manifest_invalid_and_the_state_shows_override() {
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let hook = PluginUpdater::new(app.handle().clone(), env(InstallKind::AppImage, home.path()));
    assert_eq!(hook.check(&Manifest::Override("not an address".into())).err(), Some(UpdateCode::ManifestInvalid));
    let updater = Updater::new(Some(Arc::new(hook)), Manifest::Override("https://updates.example/latest.json".into()));
    assert_eq!(updater.inspect("0.1.0", true)["manifest"], "override");
}

#[test]
fn the_download_and_install_are_not_built_yet_and_say_so() {
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let hook = PluginUpdater::new(app.handle().clone(), env(InstallKind::AppImage, home.path()));
    assert_eq!(hook.download(&|_, _| {}), Err(UpdateCode::Install));
    assert_eq!(hook.install(), Err(UpdateCode::Install));
}

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::UpdateAction;
use pistudiodesktop_shell::update::{
    CheckOutcome, InstallKind, Manifest, Offer, Origin, Progress, Reason, Trigger, UpdateCode, UpdateState, Updater, UpdaterHook,
};
use serde_json::{Value, json};
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::utils::config::BundleType;

use super::{
    Answer, Env, Owner, Place, PluginUpdater, Prompts, RELEASES_URL, Runner, answer_for, cannot_install_with, check_code, entry_target, kind_of, on_path,
    release_url,
};

const BUNDLES: [Option<BundleType>; 8] = [
    Some(BundleType::AppImage),
    Some(BundleType::Deb),
    Some(BundleType::Rpm),
    Some(BundleType::Msi),
    Some(BundleType::Nsis),
    Some(BundleType::App),
    Some(BundleType::Dmg),
    None,
];

fn place(exe: &str, appimage: Option<&str>) -> Place {
    Place { exe: PathBuf::from(exe), appimage: appimage.map(PathBuf::from), path: None }
}

// --- the install kind ---------------------------------------------------------------------------------

#[test]
fn the_bundle_type_is_the_kind_and_app_counts_only_inside_an_application_bundle() {
    let exe = Path::new("/opt/pi-studio/pistudiodesktop");
    let kinds: Vec<InstallKind> = BUNDLES.iter().cloned().map(|bundle| kind_of(bundle, exe)).collect();
    assert_eq!(
        kinds,
        [
            InstallKind::AppImage,
            InstallKind::Deb,
            InstallKind::Rpm,
            InstallKind::Msi,
            InstallKind::Nsis,
            InstallKind::Unknown,
            InstallKind::Unknown,
            InstallKind::Unknown
        ],
        "`App` outside a `*.app` is a development build, and so are a disk image's type and no type"
    );
    let inside = Path::new("/Applications/Pi Studio.app/Contents/MacOS/pistudiodesktop");
    assert_eq!(kind_of(Some(BundleType::App), inside), InstallKind::App);
    for outside in [
        "/Applications/Pi Studio.app/Contents/pistudiodesktop",
        "/Applications/Pi Studio/Contents/MacOS/pistudiodesktop",
        "/Applications/Pi Studio.app/MacOS/pistudiodesktop",
        "/Users/me/pi-studio/target/debug/pistudiodesktop",
        "pistudiodesktop",
    ] {
        assert_eq!(kind_of(Some(BundleType::App), Path::new(outside)), InstallKind::Unknown, "{outside}");
    }
    assert_eq!(kind_of(Some(BundleType::Deb), inside), InstallKind::Deb, "only `App` looks at the path");
}

// --- cannot_install ---------------------------------------------------------------------------------

#[test]
fn an_unknown_kind_is_a_development_build_whatever_else_holds() {
    assert_eq!(cannot_install_with(InstallKind::Unknown, &place("/x/pi", None), |_| true, true), Some(Reason::DevelopmentBuild));
}

#[test]
fn an_appimage_needs_its_file_and_its_directory_writable() {
    let at = place("/tmp/.mount_x/usr/bin/pi", Some("/home/me/Apps/Pi.AppImage"));
    let probe = |writable: &'static [&'static str]| move |path: &Path| writable.iter().any(|w| Path::new(w) == path);
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&["/home/me/Apps/Pi.AppImage", "/home/me/Apps"]), false), None);
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&["/home/me/Apps"]), false), Some(Reason::NotWritable), "the file");
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&["/home/me/Apps/Pi.AppImage"]), false), Some(Reason::NotWritable), "its directory");
    assert_eq!(cannot_install_with(InstallKind::AppImage, &at, probe(&[]), true), Some(Reason::NotWritable), "pkexec does not matter here");
    // Without `APPIMAGE` the executable is the file asked about (and the mounted one is read-only).
    let no_variable = place("/home/me/Apps/pi", None);
    assert_eq!(cannot_install_with(InstallKind::AppImage, &no_variable, probe(&["/home/me/Apps/pi", "/home/me/Apps"]), false), None);
}

#[test]
fn a_macos_application_on_a_disk_image_or_translocated_is_a_read_only_location() {
    let reason = |exe: &str| cannot_install_with(InstallKind::App, &place(exe, None), |_| true, true);
    assert_eq!(reason("/Applications/Pi Studio.app/Contents/MacOS/pi"), None);
    assert_eq!(reason("/Users/me/Applications/Pi Studio.app/Contents/MacOS/pi"), None);
    assert_eq!(reason("/Volumes/Pi Studio/Pi Studio.app/Contents/MacOS/pi"), Some(Reason::ReadOnlyLocation));
    assert_eq!(reason("/private/var/folders/ab/T/AppTranslocation/1234-5678/d/Pi Studio.app/Contents/MacOS/pi"), Some(Reason::ReadOnlyLocation));
    assert_eq!(reason("/VolumesX/Pi Studio.app/Contents/MacOS/pi"), None, "a directory merely starting with the name is not a volume");
}

#[test]
fn a_deb_or_rpm_needs_pkexec_and_the_windows_installers_need_nothing() {
    let at = place("/usr/bin/pistudiodesktop", None);
    for kind in [InstallKind::Deb, InstallKind::Rpm] {
        assert_eq!(cannot_install_with(kind, &at, |_| false, false), Some(Reason::NoPkexec), "{kind:?}");
        assert_eq!(cannot_install_with(kind, &at, |_| false, true), None, "{kind:?}: a package is installed by pkexec, not by a write of ours");
    }
    for kind in [InstallKind::Nsis, InstallKind::Msi] {
        assert_eq!(cannot_install_with(kind, &at, |_| false, false), None, "{kind:?}");
    }
}

#[test]
fn pkexec_is_looked_for_in_each_directory_of_the_path() {
    let path = std::env::join_paths(["/nowhere", "/usr/bin", "/bin"]).unwrap();
    let only = |found: &'static str| move |p: &Path| p == Path::new(found);
    assert!(on_path("pkexec", Some(&path), only("/bin/pkexec")));
    assert!(on_path("pkexec", Some(&path), only("/usr/bin/pkexec")));
    assert!(!on_path("pkexec", Some(&path), only("/sbin/pkexec")));
    assert!(!on_path("pkexec", None, |_| true), "no path, no pkexec");
}

#[test]
fn a_directory_is_writable_when_a_file_can_be_made_in_it_and_a_missing_path_is_not() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("Pi.AppImage");
    std::fs::write(&file, b"x").unwrap();
    assert!(super::is_writable(dir.path()));
    assert!(super::is_writable(&file));
    assert!(!super::is_writable(&dir.path().join("missing")));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "the probe leaves nothing behind");
    let mut permissions = std::fs::metadata(&file).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&file, permissions).unwrap();
    assert!(!super::is_writable(&file));
}

// --- the entry of the manifest and the errors of the plug-in ------------------------------------------------

#[test]
fn each_kind_reads_its_own_entry_and_an_unknown_one_the_systems_first() {
    let name = |kind| entry_target("linux-x86_64", kind);
    assert_eq!(name(InstallKind::AppImage), "linux-x86_64-appimage");
    assert_eq!(name(InstallKind::Deb), "linux-x86_64-deb");
    assert_eq!(name(InstallKind::Rpm), "linux-x86_64-rpm");
    assert_eq!(name(InstallKind::Nsis), "linux-x86_64-nsis");
    assert_eq!(name(InstallKind::Msi), "linux-x86_64-msi");
    assert_eq!(name(InstallKind::App), "linux-x86_64", "the two macOS entries name the one universal file and carry no kind");
    let first = if cfg!(target_os = "macos") {
        InstallKind::App
    } else if cfg!(windows) {
        InstallKind::Nsis
    } else {
        InstallKind::AppImage
    };
    assert_eq!(name(InstallKind::Unknown), name(first), "U12");
}

#[test]
fn the_plug_ins_errors_are_the_codes_of_the_spec() {
    use tauri_plugin_updater::Error as E;
    let json_error = serde_json::from_str::<Value>("{").unwrap_err();
    let cases: Vec<(E, UpdateCode)> = vec![
        (E::TargetNotFound("linux-x86_64-appimage".into()), UpdateCode::NoTarget),
        (E::TargetsNotFound(vec!["a".into(), "b".into()]), UpdateCode::NoTarget),
        (E::UnsupportedOs, UpdateCode::NoTarget),
        (E::UnsupportedArch, UpdateCode::NoTarget),
        (E::Serialization(json_error), UpdateCode::ManifestInvalid),
        (E::EmptyEndpoints, UpdateCode::ManifestInvalid),
        (E::InsecureTransportProtocol, UpdateCode::ManifestInvalid),
        (E::ReleaseNotFound, UpdateCode::Offline),
        (E::Network("reset".into()), UpdateCode::Offline),
    ];
    for (error, code) in cases {
        assert_eq!(check_code(&error), code, "{error}");
    }
}

#[test]
fn the_release_page_is_the_manifests_notes_when_they_are_an_https_address() {
    assert_eq!(
        release_url(Some("https://github.com/avatsaev/pi-studio/releases/tag/desktop-v0.4.0")),
        "https://github.com/avatsaev/pi-studio/releases/tag/desktop-v0.4.0"
    );
    assert_eq!(release_url(Some("  https://example.test/r  ")), "https://example.test/r");
    for notes in [None, Some(""), Some("Fixes things"), Some("http://example.test/r"), Some("javascript:alert(1)"), Some("file:///etc/passwd")] {
        assert_eq!(release_url(notes), RELEASES_URL, "{notes:?}");
    }
}

// --- the dialog of "Check for Updates…" ---------------------------------------------------------------------

#[test]
fn the_dialog_of_each_outcome_is_the_one_of_the_spec() {
    let up_to_date = Ok(UpdateState::UpToDate { checked_at: 1 });
    assert_eq!(answer_for(&up_to_date, "0.3.0"), Some(Answer::Alert("Pi Studio 0.3.0 is up to date.".into())));
    let available = Ok(UpdateState::Available { version: "0.4.0".into(), release_url: RELEASES_URL.into() });
    assert_eq!(answer_for(&available, "0.3.0"), Some(Answer::Offer("Pi Studio 0.4.0 is available.".into())));
    let cannot = Ok(UpdateState::CannotInstall { version: "0.4.0".into(), release_url: RELEASES_URL.into(), reason: Reason::NoPkexec });
    assert_eq!(
        answer_for(&cannot, "0.3.0"),
        Some(Answer::Alert("Pi Studio 0.4.0 is available. Installing a package needs pkexec, which is not available.".into()))
    );
    assert_eq!(answer_for(&Err(UpdateCode::Offline), "0.3.0"), Some(Answer::Alert("Could not reach the update server".into())));
    assert_eq!(answer_for(&Ok(UpdateState::Idle), "0.3.0"), None);
}

// --- the runner, over fakes ---------------------------------------------------------------------------------

struct FakeHook {
    check: Mutex<Result<CheckOutcome, UpdateCode>>,
    kind: InstallKind,
    checks: AtomicUsize,
    download: Mutex<Result<(), UpdateCode>>,
    restart: Mutex<Result<(), UpdateCode>>,
    restarts: AtomicUsize,
}

impl FakeHook {
    fn new(check: Result<CheckOutcome, UpdateCode>) -> Arc<Self> {
        Arc::new(Self {
            check: Mutex::new(check),
            kind: InstallKind::AppImage,
            checks: AtomicUsize::new(0),
            download: Mutex::new(Ok(())),
            restart: Mutex::new(Ok(())),
            restarts: AtomicUsize::new(0),
        })
    }
}

impl UpdaterHook for FakeHook {
    fn check(&self, _: &Manifest) -> Result<CheckOutcome, UpdateCode> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        self.check.lock().unwrap().clone()
    }
    fn install_kind(&self) -> InstallKind {
        self.kind
    }
    fn cannot_install(&self, _: InstallKind, _: &str) -> Option<Reason> {
        None
    }
    fn download(&self, _: Progress<'_>) -> Result<(), UpdateCode> {
        *self.download.lock().unwrap()
    }
    fn install(&self) -> Result<(), UpdateCode> {
        Ok(())
    }
    fn restart(&self) -> Result<(), UpdateCode> {
        self.restarts.fetch_add(1, Ordering::SeqCst);
        *self.restart.lock().unwrap()
    }
}

#[derive(Default)]
struct FakePrompts {
    alerts: Mutex<Vec<String>>,
    offers: Mutex<Vec<String>>,
    confirms: Mutex<Vec<String>>,
    install: bool,
    /// What the close question is answered.
    confirm: bool,
}

impl Prompts for FakePrompts {
    fn alert(&self, message: &str) {
        self.alerts.lock().unwrap().push(message.to_owned());
    }
    fn offer(&self, message: &str) -> bool {
        self.offers.lock().unwrap().push(message.to_owned());
        self.install
    }
    fn confirm(&self, question: &str) -> bool {
        self.confirms.lock().unwrap().push(question.to_owned());
        self.confirm
    }
}

/// What the session answers: a result per command, accepting by default; every command is kept.
#[derive(Default)]
struct FakeOwner {
    answers: Mutex<HashMap<String, Result<Value, String>>>,
    seen: Mutex<Vec<String>>,
}

impl FakeOwner {
    fn answering(self, command: &str, answer: Result<Value, String>) -> Self {
        self.answers.lock().unwrap().insert(command.to_owned(), answer);
        self
    }
}

impl Owner for FakeOwner {
    fn execute(&self, command: &str, _: Value) -> Result<Value, String> {
        self.seen.lock().unwrap().push(command.to_owned());
        self.answers.lock().unwrap().get(command).cloned().unwrap_or_else(|| Ok(json!({"accepted": true})))
    }
}

struct Rig {
    hook: Arc<FakeHook>,
    updater: Arc<Updater>,
    prompts: Arc<FakePrompts>,
    owner: Arc<FakeOwner>,
    /// The count of running transfers the runner reads.
    transfers: Arc<AtomicUsize>,
    runner: Arc<Runner>,
}

fn rig(check: Result<CheckOutcome, UpdateCode>, install: bool, owner: FakeOwner) -> Rig {
    let hook = FakeHook::new(check);
    let updater = Arc::new(Updater::new(Some(hook.clone()), Manifest::Default));
    let prompts = Arc::new(FakePrompts { install, ..FakePrompts::default() });
    let owner = Arc::new(owner);
    let transfers = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&transfers);
    let runner = Arc::new(Runner::new(Arc::clone(&updater), prompts.clone(), owner.clone(), "0.3.0".into(), Arc::new(move || count.load(Ordering::SeqCst))));
    Rig { hook, updater, prompts, owner, transfers, runner }
}

fn newer() -> Result<CheckOutcome, UpdateCode> {
    Ok(CheckOutcome::Found(Offer { version: "0.4.0".into(), release_url: "https://example.test/r".into() }))
}

fn alerts(rig: &Rig) -> Vec<String> {
    rig.prompts.alerts.lock().unwrap().clone()
}

fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn a_check_from_the_menu_answers_up_to_date_with_a_dialog() {
    let rig = rig(Ok(CheckOutcome::UpToDate), false, FakeOwner::default());
    rig.runner.menu_check();
    assert_eq!(rig.owner.seen.lock().unwrap().as_slice(), ["update.check"], "the click is the registry command");
    // The owner thread hands the accepted command over; the job is what the blocking pool runs.
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["Pi Studio 0.3.0 is up to date."]);
    assert!(matches!(rig.updater.state(), UpdateState::UpToDate { .. }));
}

#[test]
fn a_check_from_the_menu_that_fails_says_why() {
    let rig = rig(Err(UpdateCode::Offline), false, FakeOwner::default());
    rig.runner.menu_check();
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["Could not reach the update server"]);
    assert_eq!(rig.updater.state(), UpdateState::Failed { code: UpdateCode::Offline, version: None, release_url: None });
}

#[test]
fn a_check_from_the_menu_that_finds_a_build_offers_it_and_install_runs_the_command() {
    let rig = rig(newer(), true, FakeOwner::default());
    rig.runner.menu_check();
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(rig.prompts.offers.lock().unwrap().as_slice(), ["Pi Studio 0.4.0 is available."]);
    assert_eq!(rig.owner.seen.lock().unwrap().as_slice(), ["update.check", "update.install"]);
    assert!(alerts(&rig).is_empty());

    let later = rig_later();
    later.runner.menu_check();
    later.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(later.owner.seen.lock().unwrap().as_slice(), ["update.check"], "Later runs nothing");
    assert!(matches!(later.updater.state(), UpdateState::Available { .. }), "and the build stays offered");
}

fn rig_later() -> Rig {
    rig(newer(), false, FakeOwner::default())
}

#[test]
fn an_install_the_session_refuses_is_alerted_with_its_reason() {
    let owner = FakeOwner::default().answering("update.install", Err("`update.install` is unavailable: there is no update to install".into()));
    let rig = rig(newer(), true, owner);
    rig.runner.menu_check();
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["`update.install` is unavailable: there is no update to install"]);
}

#[test]
fn a_refused_menu_check_alerts_the_reason_and_the_next_check_shows_no_dialog() {
    let owner = FakeOwner::default().answering("update.check", Err("`update.check` is unavailable: an update is downloading".into()));
    let rig = rig(Ok(CheckOutcome::UpToDate), false, owner);
    rig.runner.menu_check();
    assert_eq!(alerts(&rig), ["`update.check` is unavailable: an update is downloading"]);
    // A page's check later: it is not the menu's, so it ends in the state and in no dialog.
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["`update.check` is unavailable: an update is downloading"]);
    assert!(matches!(rig.updater.state(), UpdateState::UpToDate { .. }));
}

#[test]
fn a_check_the_state_refuses_when_it_begins_is_alerted_for_the_menu_and_logged_for_the_rest() {
    let rig = rig(Ok(CheckOutcome::UpToDate), false, FakeOwner::default());
    let ticket = rig.updater.begin_check(Origin::Automatic, 1).unwrap();
    rig.runner.menu_check();
    // The automatic check began between the click and the command: the state says so.
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(alerts(&rig), ["an update check is already running"]);
    assert!(rig.runner.prepare(UpdateAction::Check).is_none(), "no dialog wanted: nothing to run");
    drop(ticket);
}

#[test]
fn a_check_of_the_page_changes_the_state_and_shows_nothing() {
    let rig = rig(newer(), true, FakeOwner::default());
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    assert!(rig.prompts.offers.lock().unwrap().is_empty());
    assert!(alerts(&rig).is_empty());
    assert_eq!(rig.updater.state(), UpdateState::Available { version: "0.4.0".into(), release_url: "https://example.test/r".into() });
}

#[test]
fn an_install_is_begun_at_once_and_ends_in_restart_needed() {
    let rig = rig(newer(), false, FakeOwner::default());
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    let job = rig.runner.prepare(UpdateAction::Install).unwrap();
    assert!(matches!(rig.updater.state(), UpdateState::Downloading { .. }), "begun on the owner thread, before the job runs");
    job();
    assert_eq!(rig.updater.state(), UpdateState::RestartNeeded { version: "0.4.0".into() });
}

#[test]
fn a_failed_download_is_failed_with_the_version_and_the_link_and_the_restart_is_refused_by_the_state() {
    let rig = rig(newer(), false, FakeOwner::default());
    *rig.hook.download.lock().unwrap() = Err(UpdateCode::Signature);
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    rig.runner.prepare(UpdateAction::Install).unwrap()();
    assert_eq!(
        rig.updater.state(),
        UpdateState::Failed { code: UpdateCode::Signature, version: Some("0.4.0".into()), release_url: Some("https://example.test/r".into()) }
    );
    rig.transfers.store(2, Ordering::SeqCst);
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert!(rig.prompts.confirms.lock().unwrap().is_empty(), "nothing waits for a restart: no question");
    assert_eq!(rig.hook.restarts.load(Ordering::SeqCst), 0);
}

fn installed(rig: &Rig) {
    rig.runner.prepare(UpdateAction::Check).unwrap()();
    rig.runner.prepare(UpdateAction::Install).unwrap()();
    assert_eq!(rig.updater.state(), UpdateState::RestartNeeded { version: "0.4.0".into() });
}

#[test]
fn the_restart_with_no_transfer_running_asks_nothing_and_restarts() {
    let rig = rig(newer(), false, FakeOwner::default());
    installed(&rig);
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert!(rig.prompts.confirms.lock().unwrap().is_empty());
    assert_eq!(rig.hook.restarts.load(Ordering::SeqCst), 1);
}

#[test]
fn the_restart_with_transfers_running_asks_the_close_question_and_no_keeps_everything() {
    let rig = rig(newer(), false, FakeOwner::default());
    installed(&rig);
    rig.transfers.store(2, Ordering::SeqCst);
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert_eq!(rig.prompts.confirms.lock().unwrap().as_slice(), ["2 file transfers are still running. Quit anyway?"]);
    assert_eq!(rig.hook.restarts.load(Ordering::SeqCst), 0, "answered no: the app does not restart");
    assert_eq!(rig.updater.state(), UpdateState::RestartNeeded { version: "0.4.0".into() }, "the update stays installed, waiting");
    assert!(alerts(&rig).is_empty());
}

#[test]
fn the_restart_with_transfers_running_restarts_when_the_close_question_is_answered_yes_and_asks_again_after_a_no() {
    let mut yes = rig(newer(), false, FakeOwner::default());
    yes.prompts = Arc::new(FakePrompts { confirm: true, ..FakePrompts::default() });
    yes.runner = Arc::new(Runner::new(Arc::clone(&yes.updater), yes.prompts.clone(), yes.owner.clone(), "0.3.0".into(), Arc::new(|| 1)));
    installed(&yes);
    yes.runner.prepare(UpdateAction::Restart).unwrap()();
    assert_eq!(yes.prompts.confirms.lock().unwrap().as_slice(), ["1 file transfer is still running. Quit anyway?"]);
    assert_eq!(yes.hook.restarts.load(Ordering::SeqCst), 1);

    // After a no the next click asks again: the question's "no" does not lock the button.
    let no = rig(newer(), false, FakeOwner::default());
    installed(&no);
    no.transfers.store(1, Ordering::SeqCst);
    no.runner.prepare(UpdateAction::Restart).unwrap()();
    no.runner.prepare(UpdateAction::Restart).unwrap()();
    assert_eq!(no.prompts.confirms.lock().unwrap().len(), 2);
    assert_eq!(no.hook.restarts.load(Ordering::SeqCst), 0);
}

#[test]
fn a_second_click_while_the_restart_is_made_restarts_once() {
    let rig = rig(newer(), false, FakeOwner::default());
    installed(&rig);
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert_eq!(rig.hook.restarts.load(Ordering::SeqCst), 1, "the app is on its way out");
}

#[test]
fn a_restart_whose_installer_did_not_start_is_failed_and_the_retry_can_restart_again() {
    let rig = rig(newer(), false, FakeOwner::default());
    installed(&rig);
    *rig.hook.restart.lock().unwrap() = Err(UpdateCode::Install);
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert_eq!(
        rig.updater.state(),
        UpdateState::Failed { code: UpdateCode::Install, version: Some("0.4.0".into()), release_url: Some("https://example.test/r".into()) }
    );
    *rig.hook.restart.lock().unwrap() = Ok(());
    rig.runner.prepare(UpdateAction::Install).unwrap()();
    rig.runner.prepare(UpdateAction::Restart).unwrap()();
    assert_eq!(rig.hook.restarts.load(Ordering::SeqCst), 2, "the flag of a restart in progress was cleared by the failure");
}

#[test]
fn an_install_the_state_does_not_allow_runs_nothing() {
    let rig = rig(newer(), false, FakeOwner::default());
    assert!(rig.runner.prepare(UpdateAction::Install).is_none(), "idle: nothing to install");
}

#[test]
fn handle_runs_the_job_on_the_blocking_pool() {
    let rig = rig(Ok(CheckOutcome::UpToDate), false, FakeOwner::default());
    rig.runner.menu_check();
    rig.runner.handle(UpdateAction::Check);
    wait_until("the dialog", || !alerts(&rig).is_empty());
    assert_eq!(alerts(&rig), ["Pi Studio 0.3.0 is up to date."]);
}

#[test]
fn the_menu_item_is_enabled_as_the_state_allows() {
    let rig = rig(newer(), false, FakeOwner::default());
    assert!(rig.runner.check_enabled());
    let ticket = rig.updater.begin_check(Origin::Manual, 1).unwrap();
    assert!(!rig.runner.check_enabled(), "a check is running");
    rig.updater.run_check(ticket).unwrap();
    assert!(rig.runner.check_enabled());
}

#[test]
fn the_schedule_reads_the_setting_and_checks_at_launch_and_then_when_due() {
    let owner = FakeOwner::default().answering("settings.get", Ok(json!({"autoStartLocalDaemon": true, "checkForUpdates": true, "cliPath": null})));
    let rig = rig(Ok(CheckOutcome::UpToDate), false, owner);
    rig.runner.scheduled(Trigger::Launch);
    assert_eq!(rig.hook.checks.load(Ordering::SeqCst), 1);
    assert!(matches!(rig.updater.state(), UpdateState::UpToDate { .. }));
    rig.runner.scheduled(Trigger::Elapsed);
    assert_eq!(rig.hook.checks.load(Ordering::SeqCst), 1, "the last check is not a day old");
    assert!(alerts(&rig).is_empty(), "the checks of the schedule show no dialog");
}

#[test]
fn with_the_setting_off_or_unreadable_the_schedule_never_checks() {
    let off = FakeOwner::default().answering("settings.get", Ok(json!({"checkForUpdates": false})));
    let rig_off = rig(Ok(CheckOutcome::UpToDate), false, off);
    rig_off.runner.scheduled(Trigger::Launch);
    assert_eq!(rig_off.hook.checks.load(Ordering::SeqCst), 0);
    assert_eq!(rig_off.updater.state(), UpdateState::Idle);

    let broken = FakeOwner::default().answering("settings.get", Err("the app is shutting down".into()));
    let rig_broken = rig(Ok(CheckOutcome::UpToDate), false, broken);
    rig_broken.runner.scheduled(Trigger::Launch);
    assert_eq!(rig_broken.hook.checks.load(Ordering::SeqCst), 0);

    // A check from the menu still works with the setting off.
    rig_off.runner.menu_check();
    rig_off.runner.prepare(UpdateAction::Check).unwrap()();
    assert_eq!(rig_off.hook.checks.load(Ordering::SeqCst), 1);
}

#[test]
fn a_failed_check_of_the_schedule_is_silent_and_leaves_the_state() {
    let owner = FakeOwner::default().answering("settings.get", Ok(json!({"checkForUpdates": true})));
    let rig = rig(Err(UpdateCode::Offline), false, owner);
    rig.runner.scheduled(Trigger::Launch);
    assert_eq!(rig.updater.state(), UpdateState::Idle);
    assert!(alerts(&rig).is_empty());
}

// --- the plug-in, against a manifest served over local HTTP ------------------------------------------------------------

/// A page the test server serves: `status`, `content_type` and `body` for `path`.
struct Route {
    path: &'static str,
    status: u16,
    content_type: &'static str,
    body: String,
}

fn route(path: &'static str, body: Value) -> Route {
    Route { path, status: 200, content_type: "application/json", body: body.to_string() }
}

/// A server on a free loopback port that answers each request from `routes` (404 for the others)
/// and closes the connection. Returns its address and the text of every request it got.
fn serve(routes: Vec<Route>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&requests);
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            answer(&mut stream, &routes, &log);
        }
    });
    (base, requests)
}

fn answer(stream: &mut TcpStream, routes: &[Route], log: &Mutex<Vec<String>>) {
    let mut request = Vec::new();
    let mut chunk = [0u8; 1024];
    while !request.windows(4).any(|w| w == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => request.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&request).into_owned();
    let path = text.split_whitespace().nth(1).unwrap_or("/").to_owned();
    log.lock().unwrap().push(text);
    let (status, content_type, body) =
        routes.iter().find(|r| r.path == path).map_or((404, "text/plain", String::new()), |r| (r.status, r.content_type, r.body.clone()));
    let _ = write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

/// A manifest of the static format naming `version`, with an entry for `target`.
fn manifest_for(version: &str, target: &str) -> Value {
    json!({
        "version": version,
        "pub_date": "2026-11-23T00:00:00Z",
        "notes": format!("https://example.test/releases/desktop-v{version}"),
        "platforms": { target: { "url": "https://example.test/files/Pi.Studio.AppImage", "signature": "c2lnbmF0dXJl" } }
    })
}

/// The target a manifest must carry for `kind` on this system.
fn target_of(kind: InstallKind) -> String {
    entry_target(&tauri_plugin_updater::target().unwrap(), kind)
}

/// A mock app whose configuration has the updater's section a build has, plain HTTP allowed as in a test build.
fn app() -> tauri::App<MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({"pubkey": "dW50cnVzdGVk", "endpoints": ["https://example.test/latest.json"], "dangerousInsecureTransportProtocol": true}),
    );
    mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap()
}

/// A copy of kind `kind` that can be installed over: an AppImage file in a directory of its own.
fn env(kind: InstallKind, home: &Path) -> Env {
    let file = home.join("Pi.AppImage");
    std::fs::write(&file, b"x").unwrap();
    Env { kind, place: Place { exe: file.clone(), appimage: Some(file), path: None } }
}

/// What a check of `kind` reads from `path` of the server, through the whole shell updater.
fn check_at(kind: InstallKind, url: String) -> Result<UpdateState, UpdateCode> {
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let updater = Updater::new(Some(Arc::new(PluginUpdater::new(app.handle().clone(), env(kind, home.path())))), Manifest::Override(url));
    updater.run_check(updater.begin_check(Origin::Manual, 7).unwrap())
}

#[test]
fn a_newer_manifest_is_available_with_its_release_page() {
    let (base, requests) = serve(vec![route("/latest.json", manifest_for("0.2.0", &target_of(InstallKind::AppImage)))]);
    assert_eq!(
        check_at(InstallKind::AppImage, format!("{base}/latest.json")),
        Ok(UpdateState::Available { version: "0.2.0".into(), release_url: "https://example.test/releases/desktop-v0.2.0".into() })
    );
    let seen = requests.lock().unwrap().join("\n").to_lowercase();
    assert!(seen.starts_with("get /latest.json "), "{seen}");
    assert!(seen.contains("accept: application/json"), "{seen}");
    assert!(seen.contains("user-agent: tauri-plugin-updater/"), "{seen}");
}

#[test]
fn an_equal_or_older_manifest_is_up_to_date() {
    // The mock app is version 0.1.0.
    for version in ["0.1.0", "0.0.9"] {
        let (base, _) = serve(vec![route("/latest.json", manifest_for(version, &target_of(InstallKind::AppImage)))]);
        assert_eq!(check_at(InstallKind::AppImage, format!("{base}/latest.json")), Ok(UpdateState::UpToDate { checked_at: 7 }), "{version}");
    }
}

#[test]
fn an_older_manifest_without_this_kinds_entry_is_still_up_to_date_and_a_newer_one_is_no_target() {
    let other = target_of(InstallKind::Deb);
    let (base, _) = serve(vec![route("/old.json", manifest_for("0.0.9", &other)), route("/new.json", manifest_for("0.2.0", &other))]);
    assert_eq!(check_at(InstallKind::AppImage, format!("{base}/old.json")), Ok(UpdateState::UpToDate { checked_at: 7 }));
    assert_eq!(check_at(InstallKind::AppImage, format!("{base}/new.json")), Err(UpdateCode::NoTarget));
}

#[test]
fn each_kind_finds_the_entry_of_its_own() {
    let mut platforms = serde_json::Map::new();
    for kind in [InstallKind::AppImage, InstallKind::Deb, InstallKind::Rpm, InstallKind::Nsis, InstallKind::Msi] {
        platforms.insert(target_of(kind), json!({"url": format!("https://example.test/files/{}", kind.as_str()), "signature": "c2ln"}));
    }
    let manifest = json!({"version": "0.2.0", "notes": "https://example.test/r", "platforms": platforms});
    let (base, _) = serve(vec![route("/latest.json", manifest)]);
    // Each finds its entry, so the state is the kind's own rule's: an AppImage over its writable file
    // and the Windows installers are installable; a package needs pkexec, which the test's place lacks.
    let expected = [
        (InstallKind::AppImage, "available", None),
        (InstallKind::Nsis, "available", None),
        (InstallKind::Msi, "available", None),
        (InstallKind::Deb, "cannot_install", Some("no_pkexec")),
        (InstallKind::Rpm, "cannot_install", Some("no_pkexec")),
    ];
    for (kind, state, reason) in expected {
        let found = serde_json::to_value(check_at(kind, format!("{base}/latest.json")).unwrap()).unwrap();
        assert_eq!((found["state"].as_str(), found["reason"].as_str(), found["version"].as_str()), (Some(state), reason, Some("0.2.0")), "{kind:?}");
    }
}

#[test]
fn an_unknown_kind_reads_the_first_entry_and_cannot_install_a_development_build() {
    let (base, _) = serve(vec![route("/latest.json", manifest_for("0.2.0", &target_of(InstallKind::Unknown)))]);
    assert_eq!(
        check_at(InstallKind::Unknown, format!("{base}/latest.json")),
        Ok(UpdateState::CannotInstall {
            version: "0.2.0".into(),
            release_url: "https://example.test/releases/desktop-v0.2.0".into(),
            reason: Reason::DevelopmentBuild
        })
    );
}

#[test]
fn an_appimage_that_cannot_be_written_shows_the_newer_build_with_its_reason() {
    let (base, _) = serve(vec![route("/latest.json", manifest_for("0.2.0", &target_of(InstallKind::AppImage)))]);
    let app = app();
    let missing = Env {
        kind: InstallKind::AppImage,
        place: Place { exe: PathBuf::from("/nonexistent/Pi.AppImage"), appimage: Some(PathBuf::from("/nonexistent/Pi.AppImage")), path: None },
    };
    let updater = Updater::new(Some(Arc::new(PluginUpdater::new(app.handle().clone(), missing))), Manifest::Override(format!("{base}/latest.json")));
    let state = updater.run_check(updater.begin_check(Origin::Manual, 7).unwrap()).unwrap();
    assert!(matches!(state, UpdateState::CannotInstall { reason: Reason::NotWritable, .. }), "{state:?}");
}

#[test]
fn a_manifest_that_is_not_valid_is_manifest_invalid() {
    let wrong_version = json!({"version": "banana", "platforms": {}});
    let not_a_manifest = json!({"hello": "world"});
    let html = Route { path: "/page", status: 200, content_type: "text/html", body: "<html>sorry</html>".into() };
    let (base, _) = serve(vec![route("/banana.json", wrong_version), route("/object.json", not_a_manifest), html]);
    for path in ["/banana.json", "/object.json", "/page"] {
        assert_eq!(check_at(InstallKind::AppImage, format!("{base}{path}")), Err(UpdateCode::ManifestInvalid), "{path}");
    }
}

#[test]
fn a_missing_manifest_and_a_closed_port_are_offline() {
    let (base, _) = serve(Vec::new());
    assert_eq!(check_at(InstallKind::AppImage, format!("{base}/latest.json")), Err(UpdateCode::Offline), "404");
    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}/latest.json", listener.local_addr().unwrap())
    };
    assert_eq!(check_at(InstallKind::AppImage, closed), Err(UpdateCode::Offline), "connection refused");
}

#[test]
fn an_address_that_is_not_one_is_manifest_invalid_and_the_state_shows_override() {
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let hook = PluginUpdater::new(app.handle().clone(), env(InstallKind::AppImage, home.path()));
    assert_eq!(hook.check(&Manifest::Override("not an address".into())).err(), Some(UpdateCode::ManifestInvalid));
    let updater = Updater::new(Some(Arc::new(hook)), Manifest::Override("https://updates.example/latest.json".into()));
    assert_eq!(updater.inspect("0.1.0", true)["manifest"], "override");
}

// --- the download, through the plug-in --------------------------------------------------------------------------------

/// A manifest for the AppImage kind whose file is at `url`.
fn manifest_of_file(url: &str) -> Value {
    json!({
        "version": "0.2.0",
        "notes": "https://example.test/releases/desktop-v0.2.0",
        "platforms": { target_of(InstallKind::AppImage): { "url": url, "signature": "c2lnbmF0dXJl" } }
    })
}

/// A check and an install of the AppImage kind over a manifest naming `file_url`: the state it ends in, and
/// what is left of the directory the app's file is in.
fn install_from(file_url: &str) -> (UpdateState, Result<(), UpdateCode>, Vec<String>) {
    let (base, _) = serve(vec![route("/latest.json", manifest_of_file(file_url))]);
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let updater = Updater::new(
        Some(Arc::new(PluginUpdater::new(app.handle().clone(), env(InstallKind::AppImage, home.path())))),
        Manifest::Override(format!("{base}/latest.json")),
    );
    updater.run_check(updater.begin_check(Origin::Manual, 7).unwrap()).unwrap();
    let outcome = updater.run_install(updater.begin_install().unwrap());
    let mut files: Vec<String> = std::fs::read_dir(home.path()).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
    files.sort();
    assert_eq!(std::fs::read(home.path().join("Pi.AppImage")).unwrap(), b"x", "the installed file is untouched");
    (updater.state(), outcome, files)
}

fn failed(code: UpdateCode) -> UpdateState {
    UpdateState::Failed { code, version: Some("0.2.0".into()), release_url: Some("https://example.test/releases/desktop-v0.2.0".into()) }
}

#[test]
fn a_download_whose_signature_does_not_match_is_failed_signature_and_nothing_is_written() {
    let file = Route { path: "/Pi.AppImage", status: 200, content_type: "application/octet-stream", body: "not what was signed".into() };
    let (files, requests) = serve(vec![file]);
    let (state, outcome, left) = install_from(&format!("{files}/Pi.AppImage"));
    assert_eq!(outcome, Err(UpdateCode::Signature));
    assert_eq!(state, failed(UpdateCode::Signature));
    assert_eq!(left, ["Pi.AppImage"], "no file of the update is written next to the app");
    let seen = requests.lock().unwrap().join("\n").to_lowercase();
    assert!(seen.starts_with("get /pi.appimage "), "the file was fetched, then refused: {seen}");
    assert!(seen.contains("accept: application/octet-stream"), "{seen}");
}

#[test]
fn a_download_that_answers_an_error_status_is_failed_download() {
    let (files, _) = serve(Vec::new());
    let (state, outcome, left) = install_from(&format!("{files}/Pi.AppImage"));
    assert_eq!(outcome, Err(UpdateCode::Download), "404");
    assert_eq!(state, failed(UpdateCode::Download));
    assert_eq!(left, ["Pi.AppImage"]);
}

#[test]
fn a_download_from_a_closed_port_is_failed_offline() {
    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}/Pi.AppImage", listener.local_addr().unwrap())
    };
    let (state, outcome, left) = install_from(&closed);
    assert_eq!(outcome, Err(UpdateCode::Offline), "connection refused");
    assert_eq!(state, failed(UpdateCode::Offline));
    assert_eq!(left, ["Pi.AppImage"]);
}

#[test]
fn a_retry_after_a_failed_download_fetches_the_same_offer_again() {
    let (files, requests) = serve(Vec::new());
    let (base, _) = serve(vec![route("/latest.json", manifest_of_file(&format!("{files}/Pi.AppImage")))]);
    let app = app();
    let home = tempfile::tempdir().unwrap();
    let updater = Updater::new(
        Some(Arc::new(PluginUpdater::new(app.handle().clone(), env(InstallKind::AppImage, home.path())))),
        Manifest::Override(format!("{base}/latest.json")),
    );
    updater.run_check(updater.begin_check(Origin::Manual, 7).unwrap()).unwrap();
    for _ in 0..2 {
        assert_eq!(updater.run_install(updater.begin_install().unwrap()), Err(UpdateCode::Download));
    }
    assert_eq!(requests.lock().unwrap().len(), 2, "the kept offer is fetched again, from zero");
}
