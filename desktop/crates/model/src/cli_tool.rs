//! Whether the `pi-studio` command-line tool is on this machine and a new terminal finds it (D11, P5 of
//! `swe/features/single-binary-daemon.md`). Pure data: the rules that choose a state are the shell's.

use serde::{Deserialize, Serialize};

/// The state of the link `~/.local/bin/pi-studio` and of the `PATH` a new terminal has. JSON form:
/// `{ "state": "...", ... }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum CliToolState {
    /// Nothing is at `~/.local/bin/pi-studio`.
    Absent,
    /// Our link is there, and `pi-studio` in the login shell is it.
    Installed,
    /// Our link is there, but `~/.local/bin` is not on the login shell's `PATH`.
    NotOnPath,
    /// Our link is there, but another `pi-studio` comes first on `PATH`: its path.
    Shadowed { path: String },
    /// Something that is not our link is at `~/.local/bin/pi-studio`.
    Occupied,
    /// No binary is installed yet, or this is Windows.
    Unavailable,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn cli_tool_state_json() {
        let cases = [
            (CliToolState::Absent, json!({"state":"absent"})),
            (CliToolState::Installed, json!({"state":"installed"})),
            (CliToolState::NotOnPath, json!({"state":"not_on_path"})),
            (CliToolState::Shadowed { path: "/usr/local/bin/pi-studio".into() }, json!({"state":"shadowed","path":"/usr/local/bin/pi-studio"})),
            (CliToolState::Occupied, json!({"state":"occupied"})),
            (CliToolState::Unavailable, json!({"state":"unavailable"})),
        ];
        for (state, value) in cases {
            assert_eq!(serde_json::to_value(&state).unwrap(), value);
            assert_eq!(serde_json::from_value::<CliToolState>(value).unwrap(), state);
        }
    }

    #[test]
    fn an_unknown_state_is_refused() {
        assert!(serde_json::from_value::<CliToolState>(json!({"state":"cli_missing"})).is_err());
        assert!(serde_json::from_value::<CliToolState>(json!({"state":"shadowed"})).is_err());
    }
}
