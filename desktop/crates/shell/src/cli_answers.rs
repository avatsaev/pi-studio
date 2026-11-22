//! Reading what the `pi-studio` CLI prints: pure functions, no process in sight.
//!
//! The app drives the local daemon only through `pi-studio --json daemon ...`. The exit code is
//! never used to decide anything (`status` exits 1 while the daemon is down, `start` exits non-zero
//! with `no_keypair` while it is healthy); the answer is the last non-empty line of standard output.
//! `pairingUrl` carries a secret and is never copied out of the line.

use std::time::Duration;

use serde_json::Value;

/// Time limit of `--version`.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
/// Time limit of `daemon status`.
pub const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
/// Time limit of `daemon start`.
pub const START_TIMEOUT: Duration = Duration::from_secs(90);
/// Time limit of `daemon restart`.
pub const RESTART_TIMEOUT: Duration = Duration::from_secs(90);
/// Time limit of `daemon stop`.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(15);

/// The oldest CLI the app drives: the release that carries the daemon's upload changes (a temporary
/// file renamed at `End`, and pacing). It is also the `minDaemonVersion` the page is told.
pub const MIN_CLI_VERSION: Version = Version { major: 0, minor: 0, patch: 126 };

/// Which `daemon` command printed the answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Status,
    Start,
    Restart,
    Stop,
}

/// Why an answer is a failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// The daemon was asked to start and is not up.
    NotHealthy,
    /// The output is not an answer this app understands.
    BadOutput,
}

/// What a `daemon` command said.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    Running { host: String, port: u16 },
    Stopped,
    Failed(Failure),
}

/// The last non-empty line of `stdout`, parsed as a JSON object.
fn answer_object(stdout: &str) -> Option<serde_json::Map<String, Value>> {
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty())?;
    match serde_json::from_str::<Value>(line.trim()).ok()? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

fn running(map: &serde_json::Map<String, Value>) -> Option<Answer> {
    let host = map.get("host")?.as_str().filter(|h| !h.is_empty())?.to_owned();
    let port = u16::try_from(map.get("port")?.as_u64()?).ok()?;
    Some(Answer::Running { host, port })
}

/// What the output of `command` means.
pub fn parse_answer(command: Command, stdout: &str) -> Answer {
    let Some(map) = answer_object(stdout) else {
        return Answer::Failed(Failure::BadOutput);
    };
    let bad = Answer::Failed(Failure::BadOutput);
    if command == Command::Stop {
        return match map.get("stopped") {
            Some(Value::Bool(_)) => Answer::Stopped,
            _ => bad,
        };
    }
    match map.get("up") {
        Some(Value::Bool(true)) => running(&map).unwrap_or(bad),
        Some(Value::Bool(false)) if command == Command::Status => Answer::Stopped,
        Some(Value::Bool(false)) => Answer::Failed(Failure::NotHealthy),
        _ => bad,
    }
}

/// A semantic version (pre-release and build parts are ignored).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// Reads a version from the output of `--version`: whitespace and a leading `v` are allowed.
pub fn parse_version(stdout: &str) -> Option<Version> {
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty())?.trim();
    let line = line.strip_prefix('v').unwrap_or(line);
    let core = line.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let mut next = || {
        let p = parts.next()?;
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        p.parse::<u64>().ok()
    };
    let version = Version { major: next()?, minor: next()?, patch: next()? };
    parts.next().is_none().then_some(version)
}

/// Whether the CLI is recent enough.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VersionCheck {
    Ok,
    Outdated { version: String },
    BadOutput,
}

/// Compares the output of `--version` with [`MIN_CLI_VERSION`].
pub fn check_version(stdout: &str) -> VersionCheck {
    match parse_version(stdout) {
        None => VersionCheck::BadOutput,
        Some(v) if v < MIN_CLI_VERSION => VersionCheck::Outdated { version: v.to_string() },
        Some(_) => VersionCheck::Ok,
    }
}

/// The WebSocket address to dial for a daemon bound to `host:port`: an unspecified bind address
/// is dialled as the loopback of the same family, and an IPv6 host is bracketed.
pub fn dial_address(host: &str, port: u16) -> String {
    let bare = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
    let host = match bare {
        "0.0.0.0" => "127.0.0.1",
        "::" => "::1",
        other => other,
    };
    if host.contains(':') { format!("ws://[{host}]:{port}") } else { format!("ws://{host}:{port}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(h: &str, p: u16) -> Answer {
        Answer::Running { host: h.into(), port: p }
    }
    const BAD: Answer = Answer::Failed(Failure::BadOutput);

    #[test]
    fn last_non_empty_line_wins() {
        let out = "warning: x\n{\"up\":false}\n{\"up\":true,\"host\":\"h\",\"port\":1}\n\n  \n";
        assert_eq!(parse_answer(Command::Status, out), run("h", 1));
        assert_eq!(parse_answer(Command::Status, "{\"up\":true,\"host\":\"h\",\"port\":1}\nwarning"), BAD);
        assert_eq!(parse_answer(Command::Status, ""), BAD);
        assert_eq!(parse_answer(Command::Status, "[1]"), BAD);
    }

    #[test]
    fn status_rows() {
        assert_eq!(parse_answer(Command::Status, r#"{"up":true,"host":"127.0.0.1","port":6767}"#), run("127.0.0.1", 6767));
        assert_eq!(parse_answer(Command::Status, r#"{"up":false}"#), Answer::Stopped);
        assert_eq!(parse_answer(Command::Status, r#"{"up":true,"host":"h"}"#), BAD);
        assert_eq!(parse_answer(Command::Status, r#"{"up":true,"host":"h","port":"1"}"#), BAD);
        assert_eq!(parse_answer(Command::Status, r#"{"up":true,"host":"h","port":70000}"#), BAD);
        assert_eq!(parse_answer(Command::Status, r#"{"up":"yes"}"#), BAD);
        assert_eq!(parse_answer(Command::Status, r#"{}"#), BAD);
    }

    #[test]
    fn start_and_restart_rows() {
        for c in [Command::Start, Command::Restart] {
            assert_eq!(parse_answer(c, r#"{"up":true,"host":"h","port":2}"#), run("h", 2));
            assert_eq!(parse_answer(c, r#"{"up":true,"host":"h","port":2,"error":"no_keypair"}"#), run("h", 2));
            assert_eq!(parse_answer(c, r#"{"up":false}"#), Answer::Failed(Failure::NotHealthy));
            assert_eq!(parse_answer(c, r#"{"up":true}"#), BAD);
        }
    }

    #[test]
    fn stop_rows() {
        assert_eq!(parse_answer(Command::Stop, r#"{"stopped":true}"#), Answer::Stopped);
        assert_eq!(parse_answer(Command::Stop, r#"{"stopped":false}"#), Answer::Stopped);
        assert_eq!(parse_answer(Command::Stop, r#"{"stopped":1}"#), BAD);
        assert_eq!(parse_answer(Command::Stop, r#"{}"#), BAD);
    }

    #[test]
    fn pairing_url_is_dropped() {
        let secret = "pi://SECRET-TOKEN-123";
        let out = format!(r#"{{"up":true,"host":"h","port":3,"pairingUrl":"{secret}"}}"#);
        let a = parse_answer(Command::Start, &out);
        assert_eq!(a, run("h", 3));
        assert!(!format!("{a:?}").contains("SECRET"));
        let bad = format!(r#"{{"up":true,"pairingUrl":"{secret}"}}"#);
        assert!(!format!("{:?}", parse_answer(Command::Start, &bad)).contains("SECRET"));
    }

    #[test]
    fn versions() {
        let out = |s| check_version(s);
        assert_eq!(out("0.0.125\n"), VersionCheck::Outdated { version: "0.0.125".into() });
        for ok in ["0.0.126", " 0.0.130 \n", "0.1.0", "v1.2.3", "warn\nv0.0.126\n"] {
            assert_eq!(out(ok), VersionCheck::Ok, "{ok}");
        }
        for bad in ["banana", "", "1.2", "1.2.3.4", "1.x.3", "-1.0.0"] {
            assert_eq!(out(bad), VersionCheck::BadOutput, "{bad}");
        }
    }

    #[test]
    fn dialing() {
        assert_eq!(dial_address("0.0.0.0", 6767), "ws://127.0.0.1:6767");
        assert_eq!(dial_address("::", 6767), "ws://[::1]:6767");
        assert_eq!(dial_address("[::]", 6767), "ws://[::1]:6767");
        assert_eq!(dial_address("192.168.1.5", 6767), "ws://192.168.1.5:6767");
        assert_eq!(dial_address("fe80::1", 1), "ws://[fe80::1]:1");
        assert_eq!(dial_address("localhost", 1), "ws://localhost:1");
    }

    #[test]
    fn limits() {
        assert_eq!(START_TIMEOUT, Duration::from_secs(90));
        assert_eq!(STOP_TIMEOUT, Duration::from_secs(15));
    }
}
