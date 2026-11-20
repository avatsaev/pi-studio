use serde::{Deserialize, Serialize};

/// Everything the shell remembers. Plain data: `ui.inspect` returns it and tests compare it. What
/// a widget needs only while it is on screen (the text being typed, an open menu) stays in the
/// frontend.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UiState {
    /// The last command's error, shown in the status bar. Empty after a success.
    pub status: String,
}
