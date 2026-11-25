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
            params: r#"{"key": "autoStartLocalDaemon" | "checkForUpdates" | "shareUsageData", "value": boolean}"#,
            enabled: always,
            run: set,
        },
    ]
}

fn current(s: &Session) -> Value {
    let settings = s.settings();
    json!({"autoStartLocalDaemon": settings.auto_start_local_daemon, "checkForUpdates": settings.check_for_updates, "shareUsageData": settings.share_usage_data})
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
        let keys = [
            json!("cliPath"),
            json!("usageId"),
            json!("autoStartLocalDaemon"),
            json!("checkForUpdates"),
            json!("shareUsageData"),
            json!(""),
            json!(long),
            json!(7),
            json!(null),
            json!("\u{0}"),
        ];
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
    fn cli_path_is_no_setting() {
        let mut s = Session::new();
        for value in [json!("/x"), json!(null)] {
            assert!(matches!(s.execute("settings.set", json!({"key": "cliPath", "value": value})), Err(EngineError::BadParams(_))));
        }
        assert_eq!(s.execute("settings.get", json!({})).unwrap(), json!({"autoStartLocalDaemon": true, "checkForUpdates": true, "shareUsageData": true}));
    }

    #[test]
    fn check_for_updates_is_a_boolean_setting() {
        let mut s = Session::new();
        let answer = s.execute("settings.set", json!({"key": "checkForUpdates", "value": false})).unwrap();
        assert_eq!(answer["checkForUpdates"], false);
        assert!(!s.settings().check_for_updates);
        assert!(matches!(s.execute("settings.set", json!({"key": "checkForUpdates", "value": "no"})), Err(EngineError::BadParams(_))));
        assert!(!s.settings().check_for_updates);
    }

    #[test]
    fn share_usage_data_is_a_boolean_setting_and_usage_id_is_none() {
        let mut s = Session::new();
        let answer = s.execute("settings.set", json!({"key": "shareUsageData", "value": false})).unwrap();
        assert_eq!(answer["shareUsageData"], false);
        assert!(!s.settings().share_usage_data);
        assert!(matches!(s.execute("settings.set", json!({"key": "shareUsageData", "value": 1})), Err(EngineError::BadParams(_))));
        assert!(!s.settings().share_usage_data);
        assert!(matches!(
            s.execute("settings.set", json!({"key": "usageId", "value": "123e4567-e89b-42d3-a456-426614174000"})),
            Err(EngineError::BadParams(_))
        ));
        assert!(s.settings().usage_id.is_none());
        assert!(s.execute("settings.get", json!({})).unwrap().get("usageId").is_none());
    }
}
