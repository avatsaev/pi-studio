use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeKind {
    #[default]
    Dark,
    Light,
}

impl ThemeKind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "dark" => Some(ThemeKind::Dark),
            "light" => Some(ThemeKind::Light),
            _ => None,
        }
    }
}

/// Everything the shell remembers that is not the document. Plain data: `ui.inspect` returns
/// it, `ui.set` changes it, the frontend draws it and tests compare it. What a widget needs only
/// while it is on screen (the text being typed, an open menu) stays in the frontend.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UiState {
    /// The frontend maps this onto its design tokens (`src/tokens.css`).
    pub theme: ThemeKind,
    /// View › Hide Completed.
    pub hide_done: bool,
    /// The last command's error, shown in the status bar. Empty after a success.
    pub status: String,
}
