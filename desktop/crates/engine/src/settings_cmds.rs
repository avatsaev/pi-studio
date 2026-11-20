//! The app's settings: read them, change one. A change is written to `settings.json` before the
//! command answers.

use serde_json::{Value, json};

use crate::commands::{CommandSpec, always};
use crate::{EngineError, Result, Session, params};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "settings.get", label: "Get Settings", menu: &[], shortcut: None, params: "{}", enabled: always, run: get },
        CommandSpec {
            id: "settings.set",
            label: "Change Setting",
            menu: &[],
            shortcut: None,
            params: r#"{"key": "autoStartLocalDaemon" | "cliPath", "value": boolean | string | null}"#,
            enabled: always,
            run: set,
        },
    ]
}

fn current(s: &Session) -> Value {
    let settings = s.settings();
    json!({"autoStartLocalDaemon": settings.auto_start_local_daemon, "cliPath": settings.cli_path})
}

fn get(s: &mut Session, _: &Value) -> Result<Value> {
    Ok(current(s))
}

fn set(s: &mut Session, p: &Value) -> Result<Value> {
    let key = params::req_str(p, "key")?;
    let value = p.get("value").ok_or_else(|| EngineError::BadParams("`value` is required".into()))?;
    s.set_setting(key, value)?;
    Ok(current(s))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{EngineError, Session};

    #[test]
    fn odd_params_are_errors_never_panics() {
        let mut s = Session::new();
        let long = "x".repeat(1 << 20);
        let values = [json!(null), json!(true), json!(0), json!(1e300), json!(""), json!([]), json!({"a": 1}), json!(long), json!("\u{0}\u{202e}")];
        let keys = [json!("cliPath"), json!("autoStartLocalDaemon"), json!(""), json!(long), json!(7), json!(null), json!("\u{0}")];
        for key in &keys {
            for value in &values {
                let _ = s.execute("settings.set", json!({"key": key, "value": value}));
            }
        }
        assert!(matches!(s.execute("settings.set", json!({})), Err(EngineError::BadParams(_))));
        assert!(s.execute("settings.get", json!([1])).is_err());
        assert!(s.execute("settings.get", json!({"extra": 1})).is_ok());
    }

    #[test]
    fn the_commands_are_listed() {
        let mut s = Session::new();
        let rows = s.execute("command.list", json!({"filter": "settings."})).unwrap();
        let ids: Vec<&str> = rows.as_array().unwrap().iter().filter_map(|r| r["id"].as_str()).collect();
        assert_eq!(ids, ["settings.get", "settings.set"]);
    }

    #[test]
    fn null_clears_the_cli_path() {
        let mut s = Session::new();
        s.execute("settings.set", json!({"key": "cliPath", "value": "/x"})).unwrap();
        let answer = s.execute("settings.set", json!({"key": "cliPath", "value": null})).unwrap();
        assert_eq!(answer, json!({"autoStartLocalDaemon": true, "cliPath": null}));
    }
}
