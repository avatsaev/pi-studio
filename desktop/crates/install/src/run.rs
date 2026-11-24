//! `<program> --version`, with a time limit: how the installer (and the supervisor) learns which version a binary is.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::error::VersionError;

/// How long `--version` may take (a cold start of a 100 MiB executable on a slow disk is the slow case).
pub const VERSION_LIMIT: Duration = Duration::from_secs(15);

/// How much of a program's output is kept for a message: the tail.
const OUTPUT_LIMIT: u64 = 4096;

/// How often the wait for the program looks at it.
const POLL: Duration = Duration::from_millis(10);

/// Starting a file that was just written can fail with "text file busy" while another thread's fork still holds the
/// write descriptor; it passes in milliseconds.
const BUSY_RETRIES: u32 = 20;

/// Runs `program --version` and answers its standard output, trimmed. Standard input is closed; the output goes to
/// anonymous files, so a program that leaves a child holding a pipe cannot hang the wait. A program that has not
/// finished after `limit` is killed.
///
/// # Errors
/// See [`VersionError`].
pub fn binary_version(program: &Path, limit: Duration) -> Result<String, VersionError> {
    let spawn_error = |e: io::Error| VersionError::Spawn(e.to_string());
    let mut out = tempfile::tempfile().map_err(spawn_error)?;
    let mut err = tempfile::tempfile().map_err(spawn_error)?;
    let mut child = spawn(program, &out, &err)?;
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                // The program may already be gone; the wait below reaps it either way.
                let _ = child.kill();
                let _ = child.wait();
                return Err(VersionError::TimedOut { output: tail_of(&mut out, &mut err) });
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(e) => return Err(spawn_error(e)),
        }
    };
    if !status.success() {
        return Err(VersionError::Failed { code: status.code(), output: tail_of(&mut out, &mut err) });
    }
    Ok(read_tail(&mut out).trim().to_string())
}

fn spawn(program: &Path, out: &File, err: &File) -> Result<std::process::Child, VersionError> {
    let mut attempts = 0;
    loop {
        let stdout = out.try_clone().map_err(|e| VersionError::Spawn(e.to_string()))?;
        let stderr = err.try_clone().map_err(|e| VersionError::Spawn(e.to_string()))?;
        match Command::new(program).arg("--version").stdin(Stdio::null()).stdout(stdout).stderr(stderr).spawn() {
            Ok(child) => return Ok(child),
            Err(e) if e.kind() == io::ErrorKind::ExecutableFileBusy && attempts < BUSY_RETRIES => {
                attempts += 1;
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(VersionError::Spawn(e.to_string())),
        }
    }
}

/// The last [`OUTPUT_LIMIT`] bytes of a file, as text.
fn read_tail(file: &mut File) -> String {
    let len = file.seek(SeekFrom::End(0)).unwrap_or(0);
    if file.seek(SeekFrom::Start(len.saturating_sub(OUTPUT_LIMIT))).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.take(OUTPUT_LIMIT).read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Standard output then standard error, each cut to its tail.
fn tail_of(out: &mut File, err: &mut File) -> String {
    let (o, e) = (read_tail(out), read_tail(err));
    match (o.trim().is_empty(), e.trim().is_empty()) {
        (_, true) => o.trim().to_string(),
        (true, false) => e.trim().to_string(),
        (false, false) => format!("{}\n{}", o.trim(), e.trim()),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn script(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn answers_the_trimmed_standard_output() {
        let dir = tempfile::tempdir().unwrap();
        let program = script(dir.path(), "p", "echo '1.2.3'; echo noise >&2");
        assert_eq!(binary_version(&program, VERSION_LIMIT).unwrap(), "1.2.3");
    }

    #[test]
    fn a_failure_carries_the_output() {
        let dir = tempfile::tempdir().unwrap();
        let program = script(dir.path(), "p", "echo 'GLIBC_2.99 not found' >&2; exit 3");
        let e = binary_version(&program, VERSION_LIMIT).unwrap_err();
        assert!(matches!(e, VersionError::Failed { code: Some(3), .. }), "{e:?}");
        assert_eq!(e.output(), Some("GLIBC_2.99 not found"));
    }

    #[test]
    fn a_program_that_hangs_is_killed_at_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        // `exec`: the kill reaches the sleeper itself, no orphan outlives the test.
        let program = script(dir.path(), "p", "echo starting; exec sleep 30");
        let started = Instant::now();
        let e = binary_version(&program, Duration::from_millis(300)).unwrap_err();
        assert!(matches!(e, VersionError::TimedOut { .. }), "{e:?}");
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(e.output(), Some("starting"));
    }

    #[test]
    fn a_missing_program_is_a_spawn_error() {
        let dir = tempfile::tempdir().unwrap();
        let e = binary_version(&dir.path().join("absent"), VERSION_LIMIT).unwrap_err();
        assert!(matches!(e, VersionError::Spawn(_)), "{e:?}");
    }
}
