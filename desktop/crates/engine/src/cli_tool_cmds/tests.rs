use std::sync::{Arc, Mutex};

use pistudiodesktop_model::CliToolState;
use serde_json::{Value, json};

use crate::{CliToolHost, EngineError, Session};

/// A host that answers what it was given and counts its installs.
struct Fake {
    state: CliToolState,
    install: Result<CliToolState, String>,
    installs: Mutex<usize>,
}

impl Fake {
    fn new(state: CliToolState, install: Result<CliToolState, String>) -> Arc<Self> {
        Arc::new(Self { state, install, installs: Mutex::new(0) })
    }
}

impl CliToolHost for Fake {
    fn state(&self) -> CliToolState {
        self.state.clone()
    }

    fn install(&self) -> Result<CliToolState, String> {
        *self.installs.lock().unwrap() += 1;
        self.install.clone()
    }
}

fn row(s: &mut Session, id: &str) -> Value {
    let rows = s.execute("command.list", json!({"filter": id})).unwrap();
    rows.as_array().unwrap().iter().find(|r| r["id"] == id).cloned().unwrap()
}

#[test]
fn the_two_commands_are_listed_with_no_params() {
    let mut s = Session::new();
    let rows = s.execute("command.list", json!({"filter": "cli_tool."})).unwrap();
    let ids: Vec<(&str, &str)> = rows.as_array().unwrap().iter().map(|r| (r["id"].as_str().unwrap(), r["params"].as_str().unwrap())).collect();
    assert_eq!(ids, [("cli_tool.state", "{}"), ("cli_tool.install", "{}")]);
}

#[test]
fn a_session_with_no_host_is_unavailable_and_refuses_the_install() {
    let mut s = Session::new();
    assert_eq!(s.execute("cli_tool.state", Value::Null).unwrap(), json!({"state": "unavailable"}));
    let row = row(&mut s, "cli_tool.install");
    assert_eq!((row["enabled"].as_bool(), row["reason"].as_str()), (Some(false), Some(crate::cli_tool_cmds::UNAVAILABLE)));
    assert!(matches!(s.execute("cli_tool.install", Value::Null), Err(EngineError::Disabled { .. })));
    assert_eq!(row_of(&mut s, "cli_tool.state"), (true, None));
}

fn row_of(s: &mut Session, id: &str) -> (bool, Option<String>) {
    let r = row(s, id);
    (r["enabled"].as_bool().unwrap(), r["reason"].as_str().map(str::to_owned))
}

#[test]
fn the_commands_answer_what_the_host_says() {
    let mut s = Session::new();
    let host = Fake::new(CliToolState::NotOnPath, Ok(CliToolState::Shadowed { path: "/opt/pi-studio".into() }));
    s.set_cli_tool(Some(host.clone()));
    assert_eq!(s.execute("cli_tool.state", Value::Null).unwrap(), json!({"state": "not_on_path"}));
    assert_eq!(row_of(&mut s, "cli_tool.install"), (true, None));
    assert_eq!(s.execute("cli_tool.install", Value::Null).unwrap(), json!({"state": "shadowed", "path": "/opt/pi-studio"}));
    assert_eq!(*host.installs.lock().unwrap(), 1);
}

#[test]
fn a_refused_install_is_an_error_with_the_hosts_words() {
    let mut s = Session::new();
    s.set_cli_tool(Some(Fake::new(CliToolState::Occupied, Err("a file is in the way".into()))));
    assert_eq!(s.execute("cli_tool.install", Value::Null).unwrap_err(), EngineError::Other("a file is in the way".into()));
}

#[test]
fn only_the_two_ids_run_through_the_helper() {
    let host = Fake::new(CliToolState::Absent, Ok(CliToolState::Installed));
    let as_host: &dyn CliToolHost = &*host;
    assert_eq!(crate::run_cli_tool(Some(as_host), "cli_tool.state").unwrap(), json!({"state": "absent"}));
    assert_eq!(crate::run_cli_tool(Some(as_host), "cli_tool.install").unwrap(), json!({"state": "installed"}));
    assert!(matches!(crate::run_cli_tool(Some(as_host), "settings.get"), Err(EngineError::UnknownCommand(_))));
    assert!(crate::is_cli_tool_command("cli_tool.state") && crate::is_cli_tool_command("cli_tool.install"));
    assert!(!crate::is_cli_tool_command("cli_tool.nothing"));
}
