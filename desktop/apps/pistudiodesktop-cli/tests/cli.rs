//! Runs the built binary: what a script or an agent sees.
use std::process::Command;

use serde_json::Value;

fn cli(args: &[&str]) -> (bool, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli")).args(args).output().unwrap();
    (out.status.success(), String::from_utf8(out.stdout).unwrap(), String::from_utf8(out.stderr).unwrap())
}

#[test]
fn run_edits_a_file_and_info_reads_it_back() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("list.pistudiodesktop");
    let file = file.to_str().unwrap();
    let (ok, out, err) = cli(&["run", "--new", "Groceries", "--cmd", r#"item.add {"text":"milk"}"#, "--cmd", "item.add {\"text\":\"eggs\"}", "--out", file]);
    assert!(ok, "{err}");
    assert_eq!(out.lines().count(), 2, "one JSON line per command: {out}");
    let (ok, _, err) = cli(&["run", file, "--cmd", r#"item.setDone {"id":1}"#, "--out", file]);
    assert!(ok, "{err}");
    let (ok, out, _) = cli(&["info", file]);
    assert!(ok);
    let info: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(info["title"], "Groceries");
    assert_eq!(info["items"][0]["done"], true);
    assert_eq!(info["items"][1]["text"], "eggs");
}

#[test]
fn a_failing_command_exits_1_and_saves_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("never.pistudiodesktop");
    let (ok, out, err) = cli(&["run", "--new", "x", "--cmd", r#"item.add {"text":"a"}"#, "--cmd", "item.delete {\"id\":42}", "--out", file.to_str().unwrap()]);
    assert!(!ok);
    assert_eq!(out.lines().count(), 1, "the step before the failure reported");
    assert!(err.contains("item.delete: bad params: no item with id 42"), "{err}");
    assert!(!file.exists());
    let (ok, out, err) = cli(&["run", "--new", "x", "--cmd", r#"item.add {"text":"a"}"#, "--cmd", "item.add {not json"]);
    assert!(!ok && out.is_empty() && err.contains("params are not JSON"), "{out}{err}");
}

#[test]
fn commands_lists_the_registry() {
    let (ok, out, _) = cli(&["commands", "--filter", "undo"]);
    assert!(ok);
    let entry: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    assert_eq!(entry["id"], "edit.undo");
    assert_eq!(entry["enabled"], false);
    assert_eq!(entry["reason"], "no document open");
}
