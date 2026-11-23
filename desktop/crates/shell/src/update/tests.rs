//! The update state machine and its schedule, over a fake hook and a fake clock.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::{
    CHECK_INTERVAL_MS, CheckOutcome, InstallKind, Manifest, Offer, Origin, Reason, Refusal, TICK_MS, Trigger, UpdateCode, UpdateState, Updater, UpdaterHook,
    due, worth_sending,
};

const HOUR: u64 = 60 * 60 * 1000;
const DAY: u64 = 24 * HOUR;
const T0: u64 = 1_800_000_000_000;

const CODES: [UpdateCode; 7] = [
    UpdateCode::Offline,
    UpdateCode::ManifestInvalid,
    UpdateCode::NoTarget,
    UpdateCode::Signature,
    UpdateCode::Download,
    UpdateCode::Install,
    UpdateCode::Refused,
];

type Check = Result<CheckOutcome, UpdateCode>;

/// A scripted updater. Every field is what the next calls answer; `calls` is what was asked.
struct Fake {
    checks: Mutex<VecDeque<Check>>,
    kind: Mutex<InstallKind>,
    cannot: Mutex<Option<Reason>>,
    download: Mutex<Result<(), UpdateCode>>,
    install: Mutex<Result<(), UpdateCode>>,
    restart: Mutex<Result<(), UpdateCode>>,
    /// What `download` reports before it answers.
    reports: Mutex<Vec<(u64, Option<u64>)>>,
    calls: Mutex<Vec<&'static str>>,
    asked_manifests: Mutex<Vec<Manifest>>,
    asked_cannot: Mutex<Vec<(InstallKind, String)>>,
    /// The `Updater` the download reports to, to read the state in the middle of a download.
    midway: Mutex<Option<Arc<Updater>>>,
    seen_midway: Mutex<Vec<UpdateState>>,
}

impl Fake {
    fn new(kind: InstallKind) -> Arc<Self> {
        Arc::new(Self {
            checks: Mutex::new(VecDeque::new()),
            kind: Mutex::new(kind),
            cannot: Mutex::new(None),
            download: Mutex::new(Ok(())),
            install: Mutex::new(Ok(())),
            restart: Mutex::new(Ok(())),
            reports: Mutex::new(Vec::new()),
            calls: Mutex::new(Vec::new()),
            asked_manifests: Mutex::new(Vec::new()),
            asked_cannot: Mutex::new(Vec::new()),
            midway: Mutex::new(None),
            seen_midway: Mutex::new(Vec::new()),
        })
    }

    fn then(&self, check: Check) -> &Self {
        self.checks.lock().unwrap().push_back(check);
        self
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.lock().unwrap().clone()
    }
}

impl UpdaterHook for Fake {
    fn check(&self, manifest: &Manifest) -> Check {
        self.calls.lock().unwrap().push("check");
        self.asked_manifests.lock().unwrap().push(manifest.clone());
        self.checks.lock().unwrap().pop_front().unwrap_or(Ok(CheckOutcome::UpToDate))
    }

    fn install_kind(&self) -> InstallKind {
        *self.kind.lock().unwrap()
    }

    fn cannot_install(&self, kind: InstallKind, version: &str) -> Option<Reason> {
        self.asked_cannot.lock().unwrap().push((kind, version.to_owned()));
        *self.cannot.lock().unwrap()
    }

    fn download(&self, progress: super::Progress<'_>) -> Result<(), UpdateCode> {
        self.calls.lock().unwrap().push("download");
        for (received, total) in self.reports.lock().unwrap().iter() {
            progress(*received, *total);
            if let Some(updater) = self.midway.lock().unwrap().as_ref() {
                self.seen_midway.lock().unwrap().push(updater.state());
            }
        }
        *self.download.lock().unwrap()
    }

    fn install(&self) -> Result<(), UpdateCode> {
        self.calls.lock().unwrap().push("install");
        *self.install.lock().unwrap()
    }

    fn restart(&self) -> Result<(), UpdateCode> {
        self.calls.lock().unwrap().push("restart");
        *self.restart.lock().unwrap()
    }
}

fn found(version: &str) -> Check {
    Ok(CheckOutcome::Found(Offer { version: version.to_owned(), release_url: format!("https://example.test/releases/{version}") }))
}

fn available(version: &str) -> UpdateState {
    UpdateState::Available { version: version.to_owned(), release_url: format!("https://example.test/releases/{version}") }
}

/// An updater over the fake, and every state it announces.
fn rig(kind: InstallKind) -> (Arc<Fake>, Arc<Updater>, Arc<Mutex<Vec<UpdateState>>>) {
    rig_with(kind, Manifest::Default)
}

fn rig_with(kind: InstallKind, manifest: Manifest) -> (Arc<Fake>, Arc<Updater>, Arc<Mutex<Vec<UpdateState>>>) {
    let fake = Fake::new(kind);
    let hook: Arc<dyn UpdaterHook> = fake.clone();
    let updater = Arc::new(Updater::new(Some(hook), manifest));
    let heard = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&heard);
    updater.set_notify(Arc::new(move |state| sink.lock().unwrap().push(state.clone())));
    *fake.midway.lock().unwrap() = Some(Arc::clone(&updater));
    (fake, updater, heard)
}

fn check(updater: &Updater, origin: Origin, now_ms: u64) -> Result<UpdateState, UpdateCode> {
    updater.run_check(updater.begin_check(origin, now_ms).unwrap())
}

fn install(updater: &Updater) -> Result<(), UpdateCode> {
    updater.run_install(updater.begin_install().unwrap())
}

fn heard(heard: &Mutex<Vec<UpdateState>>) -> Vec<UpdateState> {
    heard.lock().unwrap().clone()
}

// --- the state's JSON -----------------------------------------------------------------------

#[test]
fn a_new_updater_is_idle() {
    let (_, updater, heard) = rig(InstallKind::AppImage);
    assert_eq!(updater.state(), UpdateState::Idle);
    assert_eq!(updater.state_json(), json!({"state": "idle"}));
    assert!(heard.lock().unwrap().is_empty(), "nothing is announced before something changes");
}

#[test]
fn every_state_has_the_json_of_the_spec() {
    let cases = [
        (UpdateState::Idle, json!({"state": "idle"})),
        (UpdateState::Checking, json!({"state": "checking"})),
        (UpdateState::UpToDate { checked_at: 42 }, json!({"state": "up_to_date", "checkedAt": 42})),
        (available("0.3.1"), json!({"state": "available", "version": "0.3.1", "releaseUrl": "https://example.test/releases/0.3.1"})),
        (
            UpdateState::Downloading { version: "0.3.1".into(), received: 5, total: Some(10) },
            json!({"state": "downloading", "version": "0.3.1", "received": 5, "total": 10}),
        ),
        (UpdateState::Downloading { version: "0.3.1".into(), received: 5, total: None }, json!({"state": "downloading", "version": "0.3.1", "received": 5})),
        (UpdateState::RestartNeeded { version: "0.3.1".into() }, json!({"state": "restart_needed", "version": "0.3.1"})),
        (
            UpdateState::CannotInstall { version: "0.3.1".into(), release_url: "u".into(), reason: Reason::NoPkexec },
            json!({"state": "cannot_install", "version": "0.3.1", "releaseUrl": "u", "reason": "no_pkexec"}),
        ),
        (UpdateState::Failed { code: UpdateCode::Offline, version: None, release_url: None }, json!({"state": "failed", "code": "offline"})),
        (
            UpdateState::Failed { code: UpdateCode::Signature, version: Some("0.3.1".into()), release_url: Some("u".into()) },
            json!({"state": "failed", "code": "signature", "version": "0.3.1", "releaseUrl": "u"}),
        ),
    ];
    for (state, expected) in cases {
        assert_eq!(super::state_json(&state), expected, "{state:?}");
    }
}

#[test]
fn every_code_and_reason_has_its_name_and_text() {
    let names: Vec<&str> = CODES.iter().map(|c| c.as_str()).collect();
    assert_eq!(names, ["offline", "manifest_invalid", "no_target", "signature", "download", "install", "refused"]);
    for code in CODES {
        assert_eq!(serde_json::to_value(code).unwrap(), json!(code.as_str()));
        assert!(!code.text().is_empty());
    }
    assert_eq!(UpdateCode::Offline.text(), "Could not reach the update server");
    assert_eq!(UpdateCode::ManifestInvalid.text(), "The update information is not valid");
    assert_eq!(UpdateCode::NoTarget.text(), "No update for this kind of install");
    assert_eq!(UpdateCode::Signature.text(), "The update's signature does not match");
    assert_eq!(UpdateCode::Download.text(), "The download failed");
    assert_eq!(UpdateCode::Install.text(), "The update could not be installed");
    assert_eq!(UpdateCode::Refused.text(), "The system did not allow the install");
    let reasons = [Reason::DevelopmentBuild, Reason::NotWritable, Reason::ReadOnlyLocation, Reason::NoPkexec];
    let names: Vec<&str> = reasons.iter().map(|r| r.as_str()).collect();
    assert_eq!(names, ["development_build", "not_writable", "read_only_location", "no_pkexec"]);
    for reason in reasons {
        assert_eq!(serde_json::to_value(reason).unwrap(), json!(reason.as_str()));
        assert!(!reason.text().is_empty());
    }
}

#[test]
fn the_kinds_are_named_as_ui_inspect_says_and_the_windows_ones_install_at_the_restart() {
    let kinds = [InstallKind::AppImage, InstallKind::Deb, InstallKind::Rpm, InstallKind::App, InstallKind::Nsis, InstallKind::Msi, InstallKind::Unknown];
    let names: Vec<&str> = kinds.iter().map(|k| k.as_str()).collect();
    assert_eq!(names, ["appimage", "deb", "rpm", "app", "nsis", "msi", "unknown"]);
    let late: Vec<bool> = kinds.iter().map(|k| k.installs_at_restart()).collect();
    assert_eq!(late, [false, false, false, false, true, true, false]);
}

// --- the check ------------------------------------------------------------------------------

#[test]
fn a_manual_check_that_finds_a_build_goes_through_checking_to_available() {
    let (fake, updater, heard_states) = rig(InstallKind::AppImage);
    fake.then(found("0.3.1"));
    let ticket = updater.begin_check(Origin::Manual, T0).unwrap();
    assert_eq!(ticket.origin(), Origin::Manual);
    assert_eq!(updater.state(), UpdateState::Checking);
    assert_eq!(updater.run_check(ticket), Ok(available("0.3.1")));
    assert_eq!(updater.state(), available("0.3.1"));
    assert_eq!(heard(&heard_states), [UpdateState::Checking, available("0.3.1")]);
    assert_eq!(fake.asked_manifests.lock().unwrap().as_slice(), [Manifest::Default]);
    assert_eq!(fake.asked_cannot.lock().unwrap().as_slice(), [(InstallKind::AppImage, "0.3.1".to_owned())]);
}

#[test]
fn a_check_reads_the_manifest_the_updater_was_given() {
    let (fake, updater, _) = rig_with(InstallKind::App, Manifest::Override("https://example.test/m.json".into()));
    check(&updater, Origin::Manual, T0).unwrap();
    assert_eq!(fake.asked_manifests.lock().unwrap().as_slice(), [Manifest::Override("https://example.test/m.json".into())]);
}

#[test]
fn a_check_that_finds_nothing_newer_is_up_to_date_with_the_time_of_the_check() {
    let (fake, updater, heard_states) = rig(InstallKind::Deb);
    fake.then(Ok(CheckOutcome::UpToDate));
    assert_eq!(check(&updater, Origin::Manual, T0), Ok(UpdateState::UpToDate { checked_at: T0 }));
    assert_eq!(heard(&heard_states), [UpdateState::Checking, UpdateState::UpToDate { checked_at: T0 }]);
    assert_eq!(updater.state_json(), json!({"state": "up_to_date", "checkedAt": T0}));
}

#[test]
fn a_build_that_cannot_be_installed_in_place_is_shown_with_its_reason() {
    let cases = [
        (InstallKind::AppImage, Reason::NotWritable),
        (InstallKind::App, Reason::ReadOnlyLocation),
        (InstallKind::Deb, Reason::NoPkexec),
        (InstallKind::Rpm, Reason::NoPkexec),
    ];
    for (kind, reason) in cases {
        let (fake, updater, _) = rig(kind);
        *fake.cannot.lock().unwrap() = Some(reason);
        fake.then(found("0.4.0"));
        let state = check(&updater, Origin::Manual, T0).unwrap();
        assert_eq!(
            state,
            UpdateState::CannotInstall { version: "0.4.0".into(), release_url: "https://example.test/releases/0.4.0".into(), reason },
            "{kind:?}"
        );
        assert_eq!(updater.state(), state);
        assert_eq!(updater.state().install_refusal(), Some(Refusal::NothingToInstall), "a copy that cannot be updated offers no install");
    }
}

#[test]
fn a_development_build_is_cannot_install_without_asking_the_hook() {
    let (fake, updater, _) = rig(InstallKind::Unknown);
    *fake.cannot.lock().unwrap() = Some(Reason::NoPkexec);
    fake.then(found("0.4.0"));
    let state = check(&updater, Origin::Manual, T0).unwrap();
    assert!(matches!(state, UpdateState::CannotInstall { reason: Reason::DevelopmentBuild, .. }), "{state:?}");
    assert!(fake.asked_cannot.lock().unwrap().is_empty());
}

#[test]
fn a_manual_check_that_fails_is_failed_with_the_code_for_every_code() {
    for code in CODES {
        let (fake, updater, heard_states) = rig(InstallKind::AppImage);
        fake.then(Err(code));
        assert_eq!(check(&updater, Origin::Manual, T0), Err(code));
        let expected = UpdateState::Failed { code, version: None, release_url: None };
        assert_eq!(updater.state(), expected);
        assert_eq!(heard(&heard_states), [UpdateState::Checking, expected]);
        assert_eq!(updater.state().install_refusal(), Some(Refusal::NothingToInstall), "a failed check has no version to install");
    }
}

#[test]
fn an_automatic_check_that_fails_is_silent_and_the_state_before_stays() {
    // From idle.
    let (fake, updater, heard_states) = rig(InstallKind::AppImage);
    fake.then(Err(UpdateCode::Offline));
    assert_eq!(check(&updater, Origin::Automatic, T0), Err(UpdateCode::Offline));
    assert_eq!(updater.state(), UpdateState::Idle);
    // The page heard `checking` and then `idle`, never `failed`.
    assert_eq!(heard(&heard_states), [UpdateState::Checking, UpdateState::Idle]);
    assert_eq!(updater.inspect("0.3.0", true)["lastError"], "offline", "the code is kept for ui.inspect");

    // From a state with something to show: it is still shown.
    for before in [UpdateState::UpToDate { checked_at: T0 }, available("0.3.1")] {
        let (fake, updater, _) = rig(InstallKind::AppImage);
        match &before {
            UpdateState::UpToDate { .. } => fake.then(Ok(CheckOutcome::UpToDate)),
            _ => fake.then(found("0.3.1")),
        };
        check(&updater, Origin::Manual, T0).unwrap();
        assert_eq!(updater.state(), before);
        fake.then(Err(UpdateCode::ManifestInvalid));
        assert_eq!(check(&updater, Origin::Automatic, T0 + DAY), Err(UpdateCode::ManifestInvalid));
        assert_eq!(updater.state(), before, "silent");
    }
}

#[test]
fn an_automatic_failure_after_a_failure_stays_failed_and_a_manual_one_replaces_the_version() {
    let (fake, updater, _) = rig(InstallKind::Deb);
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    *fake.download.lock().unwrap() = Err(UpdateCode::Download);
    install(&updater).unwrap_err();
    let failed =
        UpdateState::Failed { code: UpdateCode::Download, version: Some("0.3.1".into()), release_url: Some("https://example.test/releases/0.3.1".into()) };
    assert_eq!(updater.state(), failed);

    fake.then(Err(UpdateCode::Offline));
    check(&updater, Origin::Automatic, T0 + DAY).unwrap_err();
    assert_eq!(updater.state(), failed, "an automatic failure puts the failed install back");

    fake.then(Err(UpdateCode::Offline));
    check(&updater, Origin::Manual, T0 + 2 * DAY).unwrap_err();
    assert_eq!(updater.state(), UpdateState::Failed { code: UpdateCode::Offline, version: None, release_url: None });
}

#[test]
fn a_check_while_one_runs_and_while_downloading_is_refused() {
    let (fake, updater, _) = rig(InstallKind::AppImage);
    fake.then(found("0.3.1"));
    let ticket = updater.begin_check(Origin::Manual, T0).unwrap();
    assert_eq!(updater.begin_check(Origin::Manual, T0).err(), Some(Refusal::Checking));
    assert_eq!(updater.begin_check(Origin::Automatic, T0).err(), Some(Refusal::Checking));
    assert_eq!(updater.begin_install().err(), Some(Refusal::Checking));
    updater.run_check(ticket).unwrap();

    let ticket = updater.begin_install().unwrap();
    assert_eq!(updater.begin_check(Origin::Manual, T0).err(), Some(Refusal::Downloading));
    assert_eq!(updater.begin_check(Origin::Automatic, T0).err(), Some(Refusal::Downloading));
    assert!(updater.scheduled(Trigger::Launch, true, T0 + 10 * DAY).is_none());
    assert_eq!(updater.begin_install().err(), Some(Refusal::Downloading));
    assert!(matches!(updater.state(), UpdateState::Downloading { .. }));
    updater.run_install(ticket).unwrap();
}

#[test]
fn nothing_checks_after_the_install_until_the_app_restarts() {
    let (fake, updater, heard_states) = rig(InstallKind::AppImage);
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    install(&updater).unwrap();
    assert_eq!(updater.state(), UpdateState::RestartNeeded { version: "0.3.1".into() });
    let announced = heard(&heard_states).len();
    let calls = fake.calls();

    assert_eq!(updater.begin_check(Origin::Manual, T0 + DAY).err(), Some(Refusal::RestartNeeded));
    assert_eq!(updater.begin_check(Origin::Automatic, T0 + DAY).err(), Some(Refusal::RestartNeeded));
    for trigger in [Trigger::Launch, Trigger::Elapsed] {
        assert!(updater.scheduled(trigger, true, T0 + 30 * DAY).is_none(), "{trigger:?}");
    }
    assert_eq!(updater.begin_install().err(), Some(Refusal::RestartNeeded));
    assert_eq!(heard(&heard_states).len(), announced, "no state change");
    assert_eq!(fake.calls(), calls, "the hook was not asked");
}

// --- the install ------------------------------------------------------------------------------

#[test]
fn an_install_downloads_installs_and_waits_for_the_restart_on_linux_and_macos() {
    for kind in [InstallKind::AppImage, InstallKind::App, InstallKind::Deb, InstallKind::Rpm] {
        let (fake, updater, heard_states) = rig(kind);
        fake.then(found("0.3.1"));
        check(&updater, Origin::Manual, T0).unwrap();
        let ticket = updater.begin_install().unwrap();
        assert_eq!(updater.state(), UpdateState::Downloading { version: "0.3.1".into(), received: 0, total: None });
        updater.run_install(ticket).unwrap();
        assert_eq!(fake.calls(), ["check", "download", "install"], "{kind:?}");
        assert_eq!(updater.state(), UpdateState::RestartNeeded { version: "0.3.1".into() });
        let states = heard(&heard_states);
        assert_eq!(states.last(), Some(&UpdateState::RestartNeeded { version: "0.3.1".into() }));
        assert!(states.contains(&UpdateState::Downloading { version: "0.3.1".into(), received: 0, total: None }));
    }
}

#[test]
fn on_windows_the_first_click_only_downloads_and_the_restart_installs() {
    for kind in [InstallKind::Nsis, InstallKind::Msi] {
        let (fake, updater, _) = rig(kind);
        fake.then(found("0.3.1"));
        check(&updater, Origin::Manual, T0).unwrap();
        install(&updater).unwrap();
        assert_eq!(fake.calls(), ["check", "download"], "{kind:?}: the installer runs at the restart");
        assert_eq!(updater.state(), UpdateState::RestartNeeded { version: "0.3.1".into() });
        updater.restart().unwrap();
        assert_eq!(fake.calls(), ["check", "download", "restart"]);
    }
}

#[test]
fn a_failed_download_or_install_is_failed_with_the_version_and_the_link_for_every_code() {
    for code in CODES {
        for step in ["download", "install"] {
            let (fake, updater, heard_states) = rig(InstallKind::AppImage);
            fake.then(found("0.3.1"));
            check(&updater, Origin::Manual, T0).unwrap();
            if step == "download" {
                *fake.download.lock().unwrap() = Err(code);
            } else {
                *fake.install.lock().unwrap() = Err(code);
            }
            assert_eq!(install(&updater), Err(code));
            let expected = UpdateState::Failed { code, version: Some("0.3.1".into()), release_url: Some("https://example.test/releases/0.3.1".into()) };
            assert_eq!(updater.state(), expected, "{step} {code:?}");
            assert_eq!(heard(&heard_states).last(), Some(&expected));
            let expected_calls: &[&str] = if step == "download" { &["check", "download"] } else { &["check", "download", "install"] };
            assert_eq!(fake.calls(), expected_calls);
            assert_eq!(updater.inspect("0.3.0", true)["lastError"], code.as_str());
        }
    }
}

#[test]
fn a_failed_install_can_be_tried_again_and_starts_from_zero() {
    let (fake, updater, _) = rig(InstallKind::Deb);
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    *fake.install.lock().unwrap() = Err(UpdateCode::Refused);
    assert_eq!(install(&updater), Err(UpdateCode::Refused));
    assert_eq!(updater.state().install_refusal(), None, "failed with a version: install is enabled");
    *fake.install.lock().unwrap() = Ok(());
    fake.reports.lock().unwrap().push((10, Some(100)));
    install(&updater).unwrap();
    assert_eq!(updater.state(), UpdateState::RestartNeeded { version: "0.3.1".into() });
    assert_eq!(fake.calls(), ["check", "download", "install", "download", "install"]);
}

#[test]
fn an_install_needs_an_available_build_or_a_failed_install() {
    let (fake, updater, _) = rig(InstallKind::AppImage);
    assert_eq!(updater.begin_install().err(), Some(Refusal::NothingToInstall), "idle");
    fake.then(Ok(CheckOutcome::UpToDate));
    check(&updater, Origin::Manual, T0).unwrap();
    assert_eq!(updater.begin_install().err(), Some(Refusal::NothingToInstall), "up to date");
    fake.then(Err(UpdateCode::Offline));
    check(&updater, Origin::Manual, T0).unwrap_err();
    assert_eq!(updater.begin_install().err(), Some(Refusal::NothingToInstall), "a failed check");
    assert_eq!(updater.state(), UpdateState::Failed { code: UpdateCode::Offline, version: None, release_url: None }, "a refusal changes nothing");
    assert!(fake.calls().iter().all(|c| *c == "check"));
}

#[test]
fn progress_is_kept_and_announced_when_the_percent_moves() {
    let (fake, updater, heard_states) = rig(InstallKind::AppImage);
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    // 1000 bytes, one report per byte, the total known from the first.
    *fake.reports.lock().unwrap() = (0..=1000).map(|n| (n, Some(1000))).collect();
    install(&updater).unwrap();

    let downloading: Vec<(u64, Option<u64>)> = heard(&heard_states)
        .into_iter()
        .filter_map(|s| match s {
            UpdateState::Downloading { received, total, .. } => Some((received, total)),
            _ => None,
        })
        .collect();
    assert!(downloading.len() <= 103, "one message per percent, not per chunk: {}", downloading.len());
    assert!(downloading.len() >= 100);
    assert_eq!(downloading.last(), Some(&(1000, Some(1000))), "the end is always announced");
    assert!(downloading.windows(2).all(|w| w[0].0 <= w[1].0), "in order");
    // The state itself follows every report, announced or not.
    let seen: Vec<u64> = fake
        .seen_midway
        .lock()
        .unwrap()
        .iter()
        .filter_map(|s| if let UpdateState::Downloading { received, .. } = s { Some(*received) } else { None })
        .collect();
    assert_eq!(seen, (0..=1000).collect::<Vec<u64>>());
}

#[test]
fn progress_without_a_total_is_announced_by_steps_and_a_late_total_is_announced() {
    let (fake, updater, heard_states) = rig(InstallKind::AppImage);
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    *fake.reports.lock().unwrap() = vec![(1, None), (1000, None), (300_000, None), (300_001, Some(900_000)), (900_000, Some(900_000))];
    install(&updater).unwrap();
    let downloading: Vec<(u64, Option<u64>)> = heard(&heard_states)
        .into_iter()
        .filter_map(|s| match s {
            UpdateState::Downloading { received, total, .. } => Some((received, total)),
            _ => None,
        })
        .collect();
    assert_eq!(downloading, [(0, None), (300_000, None), (300_001, Some(900_000)), (900_000, Some(900_000))]);
}

#[test]
fn progress_that_arrives_when_no_download_runs_is_ignored() {
    let (_, updater, heard_states) = rig(InstallKind::AppImage);
    updater.progress(5, Some(10));
    assert_eq!(updater.state(), UpdateState::Idle);
    assert!(heard_states.lock().unwrap().is_empty());
}

#[test]
fn worth_sending_rules() {
    assert!(worth_sending((0, None), 0, Some(100)), "the total became known");
    assert!(!worth_sending((0, Some(100)), 0, Some(100)));
    assert!(worth_sending((0, Some(100)), 1, Some(100)), "1% of 100");
    assert!(!worth_sending((10, Some(1000)), 19, Some(1000)));
    assert!(worth_sending((10, Some(1000)), 20, Some(1000)));
    assert!(worth_sending((999, Some(1000)), 1000, Some(1000)), "the end");
    assert!(!worth_sending((0, Some(0)), 5, Some(0)), "a zero total is unsized and never divides by zero");
    assert!(!worth_sending((0, None), 100, None));
    assert!(worth_sending((0, None), 256 * 1024, None));
}

// --- the restart ------------------------------------------------------------------------------

#[test]
fn the_restart_needs_restart_needed() {
    let (fake, updater, _) = rig(InstallKind::AppImage);
    assert_eq!(updater.restart().err(), Some(Refusal::NotRestartNeeded));
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    assert_eq!(updater.restart().err(), Some(Refusal::NotRestartNeeded), "available is not installed");
    install(&updater).unwrap();
    updater.restart().unwrap();
    assert_eq!(fake.calls().last(), Some(&"restart"));
    assert_eq!(updater.state().restart_refusal(), None);
    assert_eq!(UpdateState::Idle.restart_refusal(), Some(Refusal::NotRestartNeeded));
}

#[test]
fn a_restart_whose_installer_could_not_start_is_failed_with_the_version_and_the_link_and_a_retry_downloads_again() {
    let (fake, updater, _) = rig(InstallKind::Nsis);
    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0).unwrap();
    install(&updater).unwrap();
    *fake.restart.lock().unwrap() = Err(UpdateCode::Install);
    updater.restart().unwrap();
    let failed =
        UpdateState::Failed { code: UpdateCode::Install, version: Some("0.3.1".into()), release_url: Some("https://example.test/releases/0.3.1".into()) };
    assert_eq!(updater.state(), failed);
    assert_eq!(updater.inspect("0.3.0", true)["lastError"], "install");
    assert_eq!(updater.restart().err(), Some(Refusal::NotRestartNeeded), "nothing waits for a restart any more");
    install(&updater).unwrap();
    assert_eq!(fake.calls(), ["check", "download", "restart", "download"], "the retry starts from the download");
    assert_eq!(updater.state(), UpdateState::RestartNeeded { version: "0.3.1".into() });
}

#[test]
fn the_refusals_read_as_reasons() {
    let all = [Refusal::Unavailable, Refusal::Checking, Refusal::Downloading, Refusal::RestartNeeded, Refusal::NothingToInstall, Refusal::NotRestartNeeded];
    for refusal in all {
        assert!(!refusal.to_string().is_empty());
    }
    assert_eq!(UpdateState::Idle.check_refusal(), None);
    assert_eq!(UpdateState::Checking.check_refusal(), Some(Refusal::Checking));
    assert_eq!(UpdateState::UpToDate { checked_at: 1 }.check_refusal(), None);
    assert_eq!(available("1").check_refusal(), None);
    assert_eq!(UpdateState::Failed { code: UpdateCode::Offline, version: None, release_url: None }.check_refusal(), None);
    assert_eq!(UpdateState::CannotInstall { version: "1".into(), release_url: "u".into(), reason: Reason::NotWritable }.check_refusal(), None);
}

#[test]
fn without_an_updater_everything_is_refused_and_the_state_stays_idle() {
    let updater = Updater::new(None, Manifest::Default);
    assert_eq!(updater.begin_check(Origin::Manual, T0).err(), Some(Refusal::Unavailable));
    assert_eq!(updater.begin_install().err(), Some(Refusal::Unavailable));
    assert_eq!(updater.restart().err(), Some(Refusal::Unavailable));
    assert!(updater.scheduled(Trigger::Launch, true, T0).is_none());
    assert_eq!(updater.state(), UpdateState::Idle);
    assert_eq!(updater.inspect("0.3.0", true)["kind"], "unknown");
}

// --- the schedule (P16) ---------------------------------------------------------------------

#[test]
fn due_on_a_fake_clock() {
    // Launch: always, when on.
    assert!(due(Trigger::Launch, true, None, T0));
    assert!(due(Trigger::Launch, true, Some(T0), T0 + 1), "a launch starts from nothing: the last check belongs to another run");
    // Elapsed: 24 h after the last one.
    assert!(due(Trigger::Elapsed, true, None, T0));
    assert!(!due(Trigger::Elapsed, true, Some(T0), T0));
    assert!(!due(Trigger::Elapsed, true, Some(T0), T0 + 23 * HOUR));
    assert!(!due(Trigger::Elapsed, true, Some(T0), T0 + DAY - 1));
    assert!(due(Trigger::Elapsed, true, Some(T0), T0 + DAY));
    assert!(due(Trigger::Elapsed, true, Some(T0), T0 + 3 * DAY), "a wake after three days");
    assert!(due(Trigger::Elapsed, true, Some(T0), T0 - 1), "a clock set back loses the baseline");
    // Off: never.
    for trigger in [Trigger::Launch, Trigger::Elapsed] {
        assert!(!due(trigger, false, None, T0));
        assert!(!due(trigger, false, Some(T0), T0 + 30 * DAY));
    }
    assert_eq!(CHECK_INTERVAL_MS, DAY);
    assert_eq!(TICK_MS, HOUR);
}

#[test]
fn the_schedule_checks_at_launch_then_every_24_hours_and_after_a_late_wake() {
    let (fake, updater, _) = rig(InstallKind::AppImage);

    // Launch.
    let ticket = updater.scheduled(Trigger::Launch, true, T0).expect("a check at launch");
    assert_eq!(ticket.origin(), Origin::Automatic);
    updater.run_check(ticket).unwrap();
    assert_eq!(updater.state(), UpdateState::UpToDate { checked_at: T0 });

    // Every hour until 23 h: nothing.
    for hours in 1..=23 {
        assert!(updater.scheduled(Trigger::Elapsed, true, T0 + hours * HOUR).is_none(), "{hours} h");
    }
    assert_eq!(fake.calls(), ["check"]);

    // At 24 h.
    let ticket = updater.scheduled(Trigger::Elapsed, true, T0 + 24 * HOUR).expect("a check at 24 h");
    updater.run_check(ticket).unwrap();
    assert_eq!(updater.state(), UpdateState::UpToDate { checked_at: T0 + DAY });
    // The 24 h count restarts from that one.
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + DAY + 23 * HOUR).is_none());

    // The machine sleeps three days; the wake signal uses the same rule.
    let ticket = updater.scheduled(Trigger::Elapsed, true, T0 + 4 * DAY + HOUR).expect("a check after a long sleep");
    updater.run_check(ticket).unwrap();
    // A second wake a minute later does not check again.
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + 4 * DAY + HOUR + 60_000).is_none());
    assert_eq!(fake.calls(), ["check", "check", "check"]);
}

#[test]
fn a_failed_automatic_check_counts_as_the_last_one() {
    let (fake, updater, _) = rig(InstallKind::AppImage);
    fake.then(Err(UpdateCode::Offline));
    let ticket = updater.scheduled(Trigger::Launch, true, T0).unwrap();
    updater.run_check(ticket).unwrap_err();
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + HOUR).is_none(), "the next check is the schedule's, 24 h on");
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + DAY).is_some());
}

#[test]
fn with_the_setting_off_the_app_never_checks_by_itself_but_a_manual_check_works() {
    let (fake, updater, _) = rig(InstallKind::AppImage);
    for trigger in [Trigger::Launch, Trigger::Elapsed] {
        for days in [0, 1, 3, 30] {
            assert!(updater.scheduled(trigger, false, T0 + days * DAY).is_none(), "{trigger:?} {days}");
        }
    }
    assert!(fake.calls().is_empty());
    assert_eq!(updater.state(), UpdateState::Idle);
    assert!(!updater.is_due(Trigger::Launch, false, T0));
    assert!(updater.is_due(Trigger::Launch, true, T0));

    fake.then(found("0.3.1"));
    assert_eq!(check(&updater, Origin::Manual, T0), Ok(available("0.3.1")));
    // And when it is turned on again, the next tick is due 24 h after that manual check.
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + HOUR).is_none());
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + DAY).is_some());
}

#[test]
fn a_manual_check_moves_the_schedules_baseline() {
    let (_, updater, _) = rig(InstallKind::AppImage);
    check(&updater, Origin::Manual, T0).unwrap();
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + 23 * HOUR).is_none());
    assert!(updater.scheduled(Trigger::Elapsed, true, T0 + 24 * HOUR).is_some());
}

// --- ui.inspect -------------------------------------------------------------------------------

#[test]
fn inspect_adds_the_current_version_the_kind_the_setting_the_manifest_and_the_last_check() {
    let (fake, updater, _) = rig_with(InstallKind::Rpm, Manifest::Override("https://example.test/self-check.json".into()));
    let part = updater.inspect("0.3.0", false);
    assert_eq!(part, json!({"state": "idle", "current": "0.3.0", "kind": "rpm", "checksEnabled": false, "manifest": "override"}));

    fake.then(Err(UpdateCode::NoTarget));
    check(&updater, Origin::Manual, T0 + 5).unwrap_err();
    let part = updater.inspect("0.3.0", true);
    assert_eq!(
        part,
        json!({
            "state": "failed", "code": "no_target", "current": "0.3.0", "kind": "rpm", "checksEnabled": true,
            "manifest": "override", "lastCheckAt": T0 + 5, "lastError": "no_target"
        })
    );
    assert!(!part.to_string().contains("example.test"), "the override's address is not reported");

    fake.then(found("0.3.1"));
    check(&updater, Origin::Manual, T0 + 6).unwrap();
    let part = updater.inspect("0.3.0", true);
    assert!(part.get("lastError").is_none(), "a good check clears the last error");
    assert_eq!(part["state"], "available");
    assert_eq!(part["version"], "0.3.1");
}
