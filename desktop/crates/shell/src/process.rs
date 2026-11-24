//! The native implementation of the process hooks of [`crate::Services`], standard library only.
//! The desktop app and the app's CLI fill the hooks from here.
//!
//! A program runs in a process group of its own (Unix), so a program that passes its limit is
//! killed together with everything it started, and nothing is left holding the output pipe.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{RecvTimeoutError, channel};
use std::thread;
use std::time::{Duration, Instant};

use crate::services::{CheckedOutput, RunFailure, RunSpec};

/// How often the limit is checked.
const POLL: Duration = Duration::from_millis(10);
/// After the program has exited, how long the output may stay quiet before it counts as complete:
/// a child the program left running may still hold the pipe, and must not hold the answer back.
const OUTPUT_GRACE: Duration = Duration::from_millis(200);

/// Run `spec` and return its standard output. Standard input and error are closed.
pub fn run(spec: &RunSpec) -> Result<String, RunFailure> {
    run_with(spec, false).map(|checked| checked.output)
}

/// Run `spec` and return whether it exited with success and its standard output and error
/// together, in the order they arrived. Standard input is closed.
pub fn run_checked(spec: &RunSpec) -> Result<CheckedOutput, RunFailure> {
    run_with(spec, true)
}

fn pump(mut source: impl Read + Send + 'static, chunks: std::sync::mpsc::Sender<Vec<u8>>) {
    // Detached: it ends when every holder of the pipe is gone, which may be later than the program.
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while let Ok(n) = source.read(&mut buffer) {
            if n == 0 || chunks.send(buffer[..n].to_vec()).is_err() {
                break;
            }
        }
    });
}

fn run_with(spec: &RunSpec, with_stderr: bool) -> Result<CheckedOutput, RunFailure> {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args).env_clear().envs(spec.env.iter().map(|(k, v)| (k, v))).stdin(Stdio::null()).stdout(Stdio::piped());
    command.stderr(if with_stderr { Stdio::piped() } else { Stdio::null() });
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| RunFailure::CouldNotStart)?;
    let stdout = child.stdout.take().ok_or(RunFailure::CouldNotStart)?;
    let (chunks, received) = channel::<Vec<u8>>();
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, chunks.clone());
    }
    pump(stdout, chunks);

    let deadline = Instant::now() + spec.limit;
    let mut output = Vec::new();
    loop {
        match received.recv_timeout(POLL) {
            Ok(chunk) => output.extend(chunk),
            Err(RecvTimeoutError::Disconnected) => {
                // The pipe is closed: wait for the program itself, within the limit.
                if wait_until(&mut child, deadline) {
                    break;
                }
                kill_tree(&mut child);
                return Err(RunFailure::TimedOut);
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            while let Ok(chunk) = received.recv_timeout(OUTPUT_GRACE) {
                output.extend(chunk);
            }
            break;
        }
        if Instant::now() >= deadline {
            kill_tree(&mut child);
            return Err(RunFailure::TimedOut);
        }
    }
    let success = child.wait().is_ok_and(|status| status.success());
    Ok(CheckedOutput { success, output: String::from_utf8_lossy(&output).into_owned() })
}

fn wait_until(child: &mut std::process::Child, deadline: Instant) -> bool {
    loop {
        if !matches!(child.try_wait(), Ok(None)) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(POLL);
    }
}

/// Kill the program and its group, then reap it.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        // No `unsafe` in this workspace, so no `killpg`: the system's `kill` does it.
        let group = format!("-{}", child.id());
        let _ = Command::new("kill").args(["-KILL", "--", &group]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Every process hook filled from this module; the dialog and link hooks are the app's own.
pub fn native_services() -> crate::Services {
    use std::sync::Arc;
    crate::Services {
        run: Some(Arc::new(run)),
        run_checked: Some(Arc::new(run_checked)),
        is_executable: Some(Arc::new(is_executable)),
        env: Some(Arc::new(process_env)),
        home_dir: Some(Arc::new(home_dir)),
        list_dir: Some(Arc::new(list_dir)),
        ..crate::Services::default()
    }
}

/// A regular file with an execute bit (Unix), or a file (elsewhere).
pub fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The environment of this process; names or values that are not UTF-8 are dropped.
pub fn process_env() -> Vec<(String, String)> {
    std::env::vars_os().filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?))).collect()
}

/// `HOME` (or `USERPROFILE`), when set and not empty.
pub fn home_dir() -> Option<PathBuf> {
    ["HOME", "USERPROFILE"].iter().find_map(|name| std::env::var_os(name).filter(|v| !v.is_empty())).map(PathBuf::from)
}

/// The entries of a directory, full paths; empty when it cannot be read.
pub fn list_dir(path: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(path).map(|entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default()
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::*;

    #[allow(clippy::expect_used)]
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    fn spec(program: PathBuf, limit: Duration) -> RunSpec {
        RunSpec { program, args: vec![], env: vec![("PATH".into(), "/usr/bin:/bin".into())], limit }
    }

    fn alive(pid: &str) -> bool {
        Command::new("kill").args(["-0", pid]).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
    }

    #[test]
    fn output_is_returned_and_environment_is_not_inherited() {
        let dir = tempfile::tempdir().expect("dir");
        let path = script(dir.path(), "echo.sh", "echo hello; echo \"${HOME:-unset}\"");
        assert_eq!(run(&spec(path, Duration::from_secs(5))).as_deref(), Ok("hello\nunset\n"));
    }

    #[test]
    fn missing_program_could_not_start() {
        let spec = spec(PathBuf::from("/nonexistent/prog"), Duration::from_secs(1));
        assert_eq!(run(&spec), Err(RunFailure::CouldNotStart));
    }

    #[test]
    fn a_program_past_its_limit_is_killed_with_its_children() {
        let dir = tempfile::tempdir().expect("dir");
        let pids = dir.path().join("pids");
        let body = format!("sleep 30 &\necho $! > {p}\necho $$ >> {p}\nsleep 30", p = pids.display());
        let path = script(dir.path(), "slow.sh", &body);
        let started = Instant::now();
        assert_eq!(run(&spec(path, Duration::from_millis(500))), Err(RunFailure::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(5));
        thread::sleep(Duration::from_millis(200));
        let text = std::fs::read_to_string(&pids).expect("pids");
        for pid in text.split_whitespace() {
            assert!(!alive(pid), "process {pid} still running");
        }
    }

    #[test]
    fn a_child_holding_the_pipe_does_not_hold_the_answer_back() {
        let dir = tempfile::tempdir().expect("dir");
        let path = script(dir.path(), "leaves.sh", "echo answer\nsleep 3 &");
        let started = Instant::now();
        assert_eq!(run(&spec(path, Duration::from_secs(10))).as_deref(), Ok("answer\n"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
