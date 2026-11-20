//! Platform services, injected by each app binary. The shell asks for what it needs through
//! these hooks, so this crate has no dialogs, clipboard or OS code of its own, and the same shell
//! runs in the desktop app and in headless tests.

use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Show a native confirmation with `message` and wait for the answer: `true` only for the
/// affirmative button, `false` for the other button and for closing the dialog.
/// A hook may block until the dialog is closed, so whoever calls it ([`crate::dialogs::confirm`])
/// must not be the thread that owns the session or the UI thread.
pub type ConfirmHook = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// Show a native message with `message` and wait until it is closed. Blocks like [`ConfirmHook`].
pub type AlertHook = Arc<dyn Fn(&str) + Send + Sync>;

/// Hand `url` to the system's default application. The shell has checked it already
/// ([`crate::links::check`]); the error says why the system could not open it, without the URL.
pub type OpenUrlHook = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// Show a native save dialog suggesting the file name given (already reduced to a bare name by
/// [`crate::saves::file_name`]), starting in the folder given when there is one, and wait for the
/// user. The path the user chose, or `None` when the dialog was cancelled or could not be shown.
/// Blocks like [`ConfirmHook`].
pub type PickSavePathHook = Arc<dyn Fn(&str, Option<&Path>) -> Option<PathBuf> + Send + Sync>;

/// Every hook is optional: where one is missing (tests, a platform without it), what needs it is
/// disabled instead of failing: a confirmation is declined, a message and a link are dropped, and saving to disk is refused.
///
/// Cheap to clone (the hooks are shared), so the thread that owns the session and the page's
/// commands each hold one.
#[derive(Clone, Default)]
pub struct Services {
    pub confirm: Option<ConfirmHook>,
    pub alert: Option<AlertHook>,
    pub open_url: Option<OpenUrlHook>,
    pub pick_save_path: Option<PickSavePathHook>,
}
