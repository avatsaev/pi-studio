//! What the webview asks of the shell besides the control protocol: the boot snapshot, one stored
//! key, and "write everything now" (the app asks that on exit). The page never names a file or
//! a setting here; the control protocol stays the only way in for commands.

use pistudiodesktop_engine::Notice;
use serde_json::{Value, json};

use crate::{AppShell, daemons, preview};

/// The platform the page is told it runs on.
pub const PLATFORM: &str = "desktop";

/// Who the app is, as the boot snapshot says. The app binary sets it from its configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppInfo {
    pub title: String,
    pub version: String,
}

impl Default for AppInfo {
    /// What headless runs (tests, the `view` example) report. The shell crate shares the
    /// workspace version with the app.
    fn default() -> Self {
        Self { title: "Pi Studio".into(), version: env!("CARGO_PKG_VERSION").into() }
    }
}

/// The one value the page needs before the workbench first renders:
///
/// ```text
/// { app: { title, version, platform: "desktop", minDaemonVersion },
///   daemons: { currentId, entries, local, settings },  the registry view: no password, no pairing link
///   storage: { [key]: string },                       the global keys and the current entry's
///   notices: [ { kind: "file_reset", file, keptAs } ],
///   preview: "origin" | "inert" }                     whether a previewed document's scripts can run
/// ```
///
/// The notices are handed out once: this call clears them, so a page reload does not show them
/// again.
pub fn boot(app: &mut AppShell) -> Value {
    app.awaiting_boot = false;
    let notices: Vec<Value> = std::mem::take(&mut app.notices).iter().map(Notice::to_json).collect();
    json!({
        "app": { "title": app.info.title, "version": app.info.version, "platform": PLATFORM, "minDaemonVersion": daemons::min_daemon_version() },
        "daemons": daemons::view(app),
        "storage": app.session.storage_snapshot(),
        "notices": notices,
        "preview": preview::kind().as_str(),
    })
}

/// What closing the window does, given the page's count of file transfers still running.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CloseDecision {
    /// Nothing is running: close.
    Close,
    /// Transfers are running: ask first, with this text. "No" keeps the window open.
    Ask(String),
}

/// The close decision for `transfers` running file transfers. The count is the page's hint, not a
/// security boundary: a wrong number can only cause or skip a question.
pub fn close_decision(transfers: usize) -> CloseDecision {
    match transfers {
        0 => CloseDecision::Close,
        1 => CloseDecision::Ask("1 file transfer is still running. Quit anyway?".into()),
        n => CloseDecision::Ask(format!("{n} file transfers are still running. Quit anyway?")),
    }
}

/// What switching to another daemon entry does first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SwitchDecision {
    /// The id names no entry: an error, nothing happens.
    NotFound,
    /// Nothing is running: switch.
    Switch,
    /// Transfers are running: ask first, with this text. "No" ends the switch.
    Ask(String),
}

/// The switch decision for an entry that is (`known`) or is not in the registry, given the page's
/// count of running file transfers (a hint, like [`close_decision`]'s).
pub fn switch_decision(known: bool, transfers: usize) -> SwitchDecision {
    match (known, transfers) {
        (false, _) => SwitchDecision::NotFound,
        (true, 0) => SwitchDecision::Switch,
        (true, 1) => SwitchDecision::Ask("1 file transfer is still running. Switch anyway?".into()),
        (true, n) => SwitchDecision::Ask(format!("{n} file transfers are still running. Switch anyway?")),
    }
}

/// Store one workbench key in memory (none between a switch and the next `boot`: they are the old page's); the owner loop writes it soon (`owner::serve`). A key or
/// value over the model's caps is refused, and the error says which cap (never the value).
pub fn storage_set(app: &mut AppShell, key: &str, value: &str) -> Result<Value, String> {
    if app.awaiting_boot {
        return Ok(Value::Null);
    }
    app.session.storage_set(key, value).map(|()| Value::Null).map_err(|e| e.to_string())
}

/// Write every unwritten key now.
pub fn flush(app: &mut AppShell) -> Result<Value, String> {
    app.session.storage_flush().map(|()| Value::Null).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_engine::Session;
    use pistudiodesktop_model::{MAX_KEY_BYTES, MAX_VALUE_BYTES};

    use super::*;
    use crate::Services;

    fn app() -> AppShell {
        AppShell::new(Session::new(), Services::default())
    }

    #[test]
    fn closing_asks_with_the_count_only_while_transfers_run() {
        assert_eq!(close_decision(0), CloseDecision::Close);
        assert_eq!(close_decision(1), CloseDecision::Ask("1 file transfer is still running. Quit anyway?".into()));
        assert_eq!(close_decision(3), CloseDecision::Ask("3 file transfers are still running. Quit anyway?".into()));
    }

    #[test]
    fn switching_needs_a_known_entry_and_asks_with_the_count_only_while_transfers_run() {
        assert_eq!(switch_decision(false, 5), SwitchDecision::NotFound);
        assert_eq!(switch_decision(true, 0), SwitchDecision::Switch);
        assert_eq!(switch_decision(true, 1), SwitchDecision::Ask("1 file transfer is still running. Switch anyway?".into()));
        assert_eq!(switch_decision(true, 2), SwitchDecision::Ask("2 file transfers are still running. Switch anyway?".into()));
    }

    #[test]
    fn boot_names_the_app_and_the_platform_and_starts_with_nothing_stored() {
        let mut app = app();
        app.info = AppInfo { title: "Pi Studio".into(), version: "1.2.3".into() };
        let expected_preview = preview::kind().as_str();
        let snapshot = boot(&mut app);
        assert_eq!(snapshot["app"], json!({"title": "Pi Studio", "version": "1.2.3", "platform": "desktop", "minDaemonVersion": "0.0.119"}));
        assert_eq!((&snapshot["storage"], &snapshot["notices"], &snapshot["preview"]), (&json!({}), &json!([]), &json!(expected_preview)));
        assert_eq!(snapshot["daemons"], daemons::view(&mut app), "the boot snapshot and ui.inspect hold one view");
    }

    #[test]
    fn boot_returns_the_keys_of_both_scopes_merged() {
        let mut app = app();
        storage_set(&mut app, "pi-studio-appearance", "dark").unwrap();
        storage_set(&mut app, "pi-studio-pane-layout", "{}").unwrap();
        storage_set(&mut app, "pi-studio-agent-todos-ui", "x").unwrap();
        let snapshot = boot(&mut app);
        assert_eq!(snapshot["storage"], json!({"pi-studio-appearance": "dark", "pi-studio-pane-layout": "{}", "pi-studio-agent-todos-ui": "x"}));
    }

    #[test]
    fn the_notices_are_handed_out_once() {
        let mut app = app();
        app.notices = vec![Notice::FileReset { file: "settings.json".into(), kept_as: Some("settings.json.corrupt-1".into()) }];
        let first = boot(&mut app);
        assert_eq!(first["notices"], json!([{"kind": "file_reset", "file": "settings.json", "keptAs": "settings.json.corrupt-1"}]));
        assert_eq!(boot(&mut app)["notices"], json!([]), "a reload does not show them again");
    }

    #[test]
    fn a_key_or_value_over_the_caps_is_refused_and_the_old_value_stays() {
        let mut app = app();
        storage_set(&mut app, "pi-studio-pane-layout", "old").unwrap();
        let too_big = "a".repeat(MAX_VALUE_BYTES + 1);
        let error = storage_set(&mut app, "pi-studio-pane-layout", &too_big).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
        assert!(storage_set(&mut app, &"k".repeat(MAX_KEY_BYTES + 1), "v").is_err());
        assert!(storage_set(&mut app, "", "v").is_err());
        assert_eq!(boot(&mut app)["storage"], json!({"pi-studio-pane-layout": "old"}));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn a_reset_file_gives_one_notice_through_a_real_open_and_a_refused_write_leaves_the_files_alone() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), b"{ not json").unwrap();
        let (session, notices) = Session::with_config_dir(dir.path());
        let mut app = AppShell::new(session, Services::default());
        app.notices = notices;

        let first = boot(&mut app);
        let notice = &first["notices"][0];
        assert_eq!((notice["kind"].as_str(), notice["file"].as_str()), (Some("file_reset"), Some("settings.json")));
        assert!(notice["keptAs"].as_str().is_some_and(|kept| kept.starts_with("settings.json.corrupt-")));
        assert_eq!(first["notices"].as_array().map(Vec::len), Some(1));
        assert_eq!(boot(&mut app)["notices"], json!([]));

        assert!(storage_set(&mut app, "pi-studio-appearance", &"a".repeat(MAX_VALUE_BYTES + 1)).is_err());
        assert!(!app.session.storage_unwritten(), "a refused write marks nothing for the next flush");
        flush(&mut app).unwrap();
        assert!(!dir.path().join("settings.json").exists(), "and the file is not touched");
    }
}
