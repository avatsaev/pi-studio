//! Runs the built binary: what a script or an agent sees.
use std::process::Command;

use serde_json::Value;

fn cli(args: &[&str]) -> (bool, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli")).args(args).output().unwrap();
    (out.status.success(), String::from_utf8(out.stdout).unwrap(), String::from_utf8(out.stderr).unwrap())
}

#[test]
fn run_changes_a_setting_in_a_config_dir_and_reads_it_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", r#"settings.set {"key":"autoStartLocalDaemon","value":false}"#, "--cmd", "settings.get"]);
    assert!(ok, "{err}");
    let lines: Vec<Value> = out.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines.len(), 2, "one JSON line per command: {out}");
    assert_eq!(lines[1]["command"], "settings.get");
    assert_eq!(lines[1]["result"]["autoStartLocalDaemon"], false);
    let saved: Value = serde_json::from_slice(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(saved["autoStartLocalDaemon"], false);
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", "settings.get"]);
    assert!(ok, "{err}");
    assert!(out.contains(r#""autoStartLocalDaemon":false"#), "a later run reads the saved file: {out}");
}

#[test]
fn without_a_config_dir_nothing_is_written() {
    let (ok, out, err) = cli(&["run", "--cmd", r#"settings.set {"key":"cliPath","value":"/x"}"#, "--cmd", "settings.get"]);
    assert!(ok, "{err}");
    assert_eq!(out.lines().count(), 2);
    let (ok, out, _) = cli(&["run", "--cmd", "settings.get"]);
    assert!(ok && out.contains(r#""cliPath":null"#), "a new run starts from defaults: {out}");
}

#[test]
fn a_failing_command_exits_1_and_a_bad_step_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let (ok, out, err) =
        cli(&["run", "--config-dir", path, "--cmd", r#"settings.set {"key":"cliPath","value":"/a"}"#, "--cmd", r#"settings.set {"key":"nope","value":1}"#]);
    assert!(!ok);
    assert_eq!(out.lines().count(), 1, "the step before the failure reported");
    assert!(err.contains("settings.set: "), "{err}");
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", r#"settings.set {"key":"cliPath","value":"/b"}"#, "--cmd", "settings.get {not json"]);
    assert!(!ok && out.is_empty() && err.contains("params are not JSON"), "{out}{err}");
    let saved: Value = serde_json::from_slice(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(saved["cliPath"], "/a", "the step after a typo never ran");
}

#[test]
fn commands_lists_the_registry() {
    let (ok, out, _) = cli(&["commands"]);
    assert!(ok);
    let ids: Vec<String> = out.lines().map(|l| serde_json::from_str::<Value>(l).unwrap()["id"].as_str().unwrap().to_owned()).collect();
    assert_eq!(ids, ["command.list", "settings.get", "settings.set"]);
    let (ok, out, _) = cli(&["commands", "--filter", "settings.set"]);
    assert!(ok);
    let entry: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    assert_eq!(entry["id"], "settings.set");
    assert_eq!(entry["enabled"], true);
}
