//! Runs the built binary: what a script or an agent sees.
use std::process::Command;

use serde_json::Value;

/// Runs the CLI; a run on a configuration directory keeps its secrets in the file, so that no test
/// writes to a person's keychain.
fn cli(args: &[&str]) -> (bool, String, String) {
    let mut all: Vec<&str> = args.to_vec();
    if args.contains(&"--config-dir") {
        all.extend(["--secret-store", "file"]);
    }
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli")).args(all).output().unwrap();
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
    let (ok, out, err) = cli(&["run", "--cmd", r#"settings.set {"key":"checkForUpdates","value":false}"#, "--cmd", "settings.get"]);
    assert!(ok, "{err}");
    assert_eq!(out.lines().count(), 2);
    let (ok, out, _) = cli(&["run", "--cmd", "settings.get"]);
    assert!(ok && out.contains(r#""checkForUpdates":true"#), "a new run starts from defaults: {out}");
}

#[test]
fn a_failing_command_exits_1_and_a_bad_step_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let (ok, out, err) = cli(&[
        "run",
        "--config-dir",
        path,
        "--cmd",
        r#"settings.set {"key":"checkForUpdates","value":false}"#,
        "--cmd",
        r#"settings.set {"key":"nope","value":1}"#,
    ]);
    assert!(!ok);
    assert_eq!(out.lines().count(), 1, "the step before the failure reported");
    assert!(err.contains("settings.set: "), "{err}");
    let (ok, out, err) =
        cli(&["run", "--config-dir", path, "--cmd", r#"settings.set {"key":"checkForUpdates","value":true}"#, "--cmd", "settings.get {not json"]);
    assert!(!ok && out.is_empty() && err.contains("params are not JSON"), "{out}{err}");
    let saved: Value = serde_json::from_slice(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(saved["checkForUpdates"], false, "the step after a typo never ran");
}

#[test]
fn commands_lists_the_registry() {
    let (ok, out, _) = cli(&["commands"]);
    assert!(ok);
    let ids: Vec<String> = out.lines().map(|l| serde_json::from_str::<Value>(l).unwrap()["id"].as_str().unwrap().to_owned()).collect();
    assert_eq!(
        ids,
        [
            "daemon.list",
            "daemon.switch",
            "daemon.add",
            "daemon.update",
            "daemon.remove",
            "daemon.local.start",
            "daemon.local.stop",
            "daemon.local.restart",
            "daemon.local.refresh",
            "daemon.local.update",
            "daemon.remote.start",
            "daemon.remote.refresh",
            "daemon.remote.update",
            "command.list",
            "settings.get",
            "settings.set",
            "update.check",
            "update.install",
            "update.restart",
        ]
    );
    let (ok, out, _) = cli(&["commands", "--filter", "settings.set"]);
    assert!(ok);
    let entry: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    assert_eq!(entry["id"], "settings.set");
    assert_eq!(entry["enabled"], true);
}

#[test]
fn daemon_commands_work_from_the_cli_and_the_answers_hold_no_secret() {
    const PASSWORD: &str = "S3CRET-PASSWORD-7f3a91";
    const LINK: &str = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=S3CRET-PAIRING-LINK-b04c52";
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

#[cfg(unix)]
#[test]
fn local_daemon_commands_run_the_binary_in_pi_studio_home() {
    use std::os::unix::fs::PermissionsExt as _;
    let dir = tempfile::tempdir().unwrap();
    let write_exec = |path: std::path::PathBuf, body: &str| {
        std::fs::write(&path, body).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    };
    // The binary is where the app installs it: `$PI_STUDIO_HOME/bin/current/pi-studio`, and the home is read from
    // the environment the shell prints, as a terminal has it.
    let home = dir.path().join("home");
    let version = home.join("bin").join("versions").join("fake");
    std::fs::create_dir_all(&version).unwrap();
    write_exec(version.join("pi-studio"), include_str!("../../../crates/shell/tests/fixtures/fake-pi-studio.sh"));
    std::os::unix::fs::symlink("versions/fake", home.join("bin").join("current")).unwrap();
    // A shell that prints the environment the way the app asks for it, without start-up files.
    let shell = write_exec(dir.path().join("shell"), "#!/bin/sh\neval \"$4\"\n");
    let state = dir.path().join("state");
    std::fs::create_dir(&state).unwrap();
    let config = dir.path().join("config");
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("PI_STUDIO_HOME", &home)
        .env("SHELL", &shell)
        .env("FAKE_PI_DIR", &state)
        .args(["run", "--config-dir", config.to_str().unwrap(), "--secret-store", "file", "--cmd", "daemon.local.start", "--cmd", "daemon.list"])
        .output()
        .unwrap();
    let (stdout, stderr) = (String::from_utf8(out.stdout).unwrap(), String::from_utf8(out.stderr).unwrap());
    assert!(out.status.success(), "{stderr}");
    let lines: Vec<Value> = stdout.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0]["result"], serde_json::json!({"accepted": true}));
    assert_eq!(lines[1]["result"]["local"], serde_json::json!({"state": "running", "host": "127.0.0.1", "port": 6767}), "{stdout}");
    assert!(!stdout.contains("S3CRET") && !stderr.contains("S3CRET"));
}

/// The headless CLI never downloads: with no binary in `PI_STUDIO_HOME` the local daemon cannot be run.
#[cfg(unix)]
#[test]
fn local_daemon_commands_without_a_binary_in_place_fail_and_download_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let config = dir.path().join("config");
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("PI_STUDIO_HOME", &home)
        .env("SHELL", "/bin/sh")
        .args(["run", "--config-dir", config.to_str().unwrap(), "--secret-store", "file", "--cmd", "daemon.local.start", "--cmd", "daemon.list"])
        .output()
        .unwrap();
    let (stdout, stderr) = (String::from_utf8(out.stdout).unwrap(), String::from_utf8(out.stderr).unwrap());
    assert!(out.status.success(), "{stderr}");
    let lines: Vec<Value> = stdout.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[1]["result"]["local"], serde_json::json!({"state": "failed", "reason": "spawn_failed"}), "{stdout}");
    assert!(!home.join("bin").exists(), "nothing was installed");
}

#[test]
fn the_file_backend_keeps_secrets_in_secrets_json_and_out_of_the_registry() {
    const PASSWORD: &str = "S3CRET-PASSWORD-7f3a91";
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let (ok, _, err) = cli(&["run", "--config-dir", path, "--cmd", "settings.get"]);
    assert!(ok, "{err}");
    assert!(!dir.path().join("secrets.json").exists(), "no secret saved yet, no file");
    let add = format!(r#"daemon.add {{"kind":"direct","name":"Work","address":"10.0.0.9:8080","password":"{PASSWORD}"}}"#);
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", &add]);
    assert!(ok, "{err}");
    assert!(!out.contains(PASSWORD) && !err.contains(PASSWORD), "{out}{err}");
    let secrets = std::fs::read_to_string(dir.path().join("secrets.json")).unwrap();
    assert!(secrets.contains(PASSWORD), "the file backend keeps the secret: {secrets}");
    let registry = std::fs::read_to_string(dir.path().join("daemons.json")).unwrap();
    assert!(!registry.contains(PASSWORD) && registry.contains("\"hasPassword\": true"), "{registry}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(dir.path().join("secrets.json")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "secrets.json is readable by this user only");
    }
    // A later run still knows the entry has its secret.
    let (ok, out, err) = cli(&["run", "--config-dir", path, "--cmd", "daemon.list"]);
    assert!(ok && out.contains("\"hasPassword\":true"), "{out}{err}");
}

#[test]
fn a_bad_secret_store_option_is_a_usage_error() {
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli")).args(["run", "--secret-store", "file", "--cmd", "settings.get"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("--config-dir"), "without a directory the session keeps no secret: {err}");
    let dir = tempfile::tempdir().unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_pistudiodesktop-cli"))
        .args(["run", "--config-dir", dir.path().to_str().unwrap(), "--secret-store", "memory", "--cmd", "settings.get"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("keychain") && err.contains("file"), "{err}");
}
