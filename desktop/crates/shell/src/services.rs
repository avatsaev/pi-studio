//! Platform services, injected by each app binary. The shell asks for what it needs through
//! these hooks, so this crate has no dialogs, clipboard or OS code of its own, and the same shell
//! runs in the desktop app and in headless tests.

/// Every hook is optional: where one is missing (tests, a platform without it), what needs it is
/// disabled instead of failing. There are no hooks yet.
#[derive(Default)]
pub struct Services {}
