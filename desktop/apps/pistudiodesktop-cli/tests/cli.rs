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
    assert_eq!(ids, ["daemon.list", "daemon.switch", "daemon.add", "daemon.update", "daemon.remove", "command.list", "settings.get", "settings.set"]);
    let (ok, out, _) = cli(&["commands", "--filter", "settings.set"]);
    assert!(ok);
    let entry: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    assert_eq!(entry["id"], "settings.set");
    assert_eq!(entry["enabled"], true);
}

#[test]
fn daemon_commands_work_from_the_cli_and_the_answers_hold_no_secret() {
    const PASSWORD: &str = "S3CRET-PASSWORD-7f3a91";
    const LINK: &str = "pi://S3CRET-PAIRING-LINK-b04c52";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let add_direct = format!(r#"daemon.add {{"kind":"direct","name":"Work","address":"10.0.0.9:8080","password":"{PASSWORD}"}}"#);
    let add_relay = format!(r#"daemon.add {{"kind":"relay","name":"Home","pairingLink":"{LINK}"}}"#);
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", &add_direct, "--cmd", &add_relay, "--cmd", "daemon.list", "--cmd", "settings.get"]);
    assert!(ok, "{err}");
    let lines: Vec<Value> = out.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0]["result"]["name"], "Work");
    assert_eq!(lines[0]["result"]["hasPassword"], true);
    let entries = lines[2]["result"]["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 3, "{out}");
    assert!(entries.iter().any(|e| e["name"] == "Home" && e["kind"] == "relay"));
    assert_eq!(lines[2]["result"]["currentId"], "local");
    assert!(!out.contains(PASSWORD) && !out.contains(LINK), "an answer leaked a secret: {out}");
    assert!(!err.contains(PASSWORD) && !err.contains(LINK), "a diagnostic leaked a secret: {err}");
    let stored = std::fs::read_to_string(dir.path().join("daemons.json")).unwrap();
    assert!(stored.contains("Work") && stored.contains("Home"), "the file holds the entries: {stored}");
    // A refused command reports its code and no secret.
    let relay_id = entries.iter().find(|e| e["kind"] == "relay").unwrap()["id"].as_str().unwrap();
    let update = format!(r#"daemon.update {{"id":"{relay_id}","password":"{PASSWORD}"}}"#);
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", &update]);
    assert!(!ok && out.is_empty() && err.contains("wrong_kind"), "{out}{err}");
    assert!(!err.contains(PASSWORD), "{err}");
}
