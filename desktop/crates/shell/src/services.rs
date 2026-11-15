//! Platform services, injected by each app binary. The shell asks for what it needs through
//! these hooks, so this crate has no file dialogs, clipboard or OS code of its own, and the
//! same shell runs in the desktop app and in headless tests.

use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickKind {
    Open,
    Save,
}

/// Ask the user for a file. `None` when they cancel.
pub type PickFileFn = Box<dyn FnMut(PickKind) -> Option<PathBuf>>;

/// Every hook is optional: where one is missing (tests, a platform without it), the menu items
/// that need it are disabled instead of failing.
#[derive(Default)]
pub struct Services {
    pub pick_file: Option<PickFileFn>,
}
