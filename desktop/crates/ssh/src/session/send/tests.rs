use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::time::timeout;

use super::command;
use crate::fixtures::{Fixture, server, target};
use crate::testing::{Behavior, Exec, ExecScript, Server};
use crate::{Limits, Secrets, SendError, Session, connect};

/// Long enough for a slow machine, short enough for a failed test to end.
const PATIENCE: Duration = Duration::from_secs(60);
const TEN_MIB: usize = 10 * 1024 * 1024;
const PATH: &str = "/home/tester/.pi-studio/bin/tmp/ab12.tar.gz";

/// A server that accepts the password and answers every command with `exec`, and a session open on it.
async fn session(exec: Option<Exec>) -> (Fixture, Server, Session) {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |behavior: &mut Behavior| {
        behavior.password = Some("hunter2".to_owned());
        behavior.exec = exec.map(|exec| -> ExecScript { Arc::new(move |_| exec.clone()) });
    })
    .await;
    let secrets = Secrets { password: Some("hunter2".to_owned()), passphrase: None };
    let session = connect(&target(server.port()), &secrets, &fixture.env(), &fixture.known_hosts(), &Limits::default()).await.expect("connect");
    (fixture, server, session)
}

/// Bytes that differ from one position to the next and from one 32 KiB packet to the next.
fn pattern(len: usize) -> Vec<u8> {
    (0..len).map(|at| u8::try_from((at * 31 + at / 32749) % 251).unwrap_or_default()).collect()
}

#[test]
fn the_command_runs_cat_under_bin_sh_with_the_path_quoted_for_both_shells() {
    assert_eq!(command("/a/b.tar.gz"), "/bin/sh -c 'cat > '\\''/a/b.tar.gz'\\'''");
    assert_eq!(command("/a/it's"), "/bin/sh -c 'cat > '\\''/a/it'\\''\\'\\'''\\''s'\\'''");
}

#[cfg(unix)]
#[test]
fn a_path_with_quotes_and_spaces_is_written_by_a_real_shell_exactly_there() {
    use std::io::Write as _;
    use std::process::{Command, Stdio};

    let dir = tempfile::tempdir().expect("scratch directory");
    for name in ["it's here.tar.gz", "a'b'c", "$HOME `id` \"x\" ; echo no", "-dash"] {
        let path = dir.path().join(name);
        // The account's shell reads the whole line, as sshd runs it with `-c`.
        let mut shell = Command::new("/bin/sh").arg("-c").arg(command(path.to_str().expect("utf-8 path"))).stdin(Stdio::piped()).spawn().expect("spawn sh");
        shell.stdin.take().expect("stdin").write_all(b"payload").expect("write");
        assert!(shell.wait().expect("wait").success());
        assert_eq!(std::fs::read(&path).expect("the file is where the path says"), b"payload");
    }
    assert_eq!(std::fs::read_dir(dir.path()).expect("list").count(), 4, "nothing else was written");
}

#[tokio::test]
async fn ten_mebibytes_arrive_identical_and_progress_counts_what_the_channel_accepted() {
    let (_fixture, server, session) = session(Some(Exec::Receive { status: 0 })).await;
    let data = pattern(TEN_MIB);
    let mut reports: Vec<u64> = Vec::new();
    let sent = session.send(PATH, data.as_slice(), TEN_MIB as u64, PATIENCE, |bytes| reports.push(bytes)).await;
    assert_eq!(sent, Ok(()));
    let seen = server.seen();
    assert_eq!(seen.commands, vec![command(PATH)]);
    assert_eq!(seen.received.len(), 1);
    // Not `assert_eq!`: a failure would print ten mebibytes.
    assert!(seen.received.first().is_some_and(|received| *received == data), "the host got other bytes than were sent");
    assert_eq!(reports.last().copied(), Some(TEN_MIB as u64));
    assert!(reports.len() > 1, "progress is reported as the file goes");
    assert!(reports.windows(2).all(|pair| pair[0] < pair[1]), "progress only grows");
}

#[tokio::test]
async fn an_empty_file_is_sent_and_ends_with_the_status() {
    let (_fixture, server, session) = session(Some(Exec::Receive { status: 0 })).await;
    assert_eq!(session.send(PATH, &b""[..], 0, PATIENCE, |_| {}).await, Ok(()));
    assert_eq!(server.seen().received, vec![Vec::<u8>::new()]);
}

#[tokio::test]
async fn a_path_with_a_single_quote_reaches_the_host_quoted() {
    let (_fixture, server, session) = session(Some(Exec::Receive { status: 0 })).await;
    let path = "/home/o'brien/.pi-studio/bin/tmp/it's.tar.gz";
    assert_eq!(session.send(path, &b"abc"[..], 3, PATIENCE, |_| {}).await, Ok(()));
    assert_eq!(server.seen().commands, vec![command(path)]);
    assert!(command(path).contains("'\\''"));
}

#[tokio::test]
async fn a_reader_the_host_stops_draining_is_stalled_at_the_limit_with_the_file_not_sent() {
    let (_fixture, server, session) = session(Some(Exec::Stall)).await;
    let data = pattern(TEN_MIB);
    let mut last = 0;
    let started = Instant::now();
    let sent = session.send(PATH, data.as_slice(), TEN_MIB as u64, Duration::from_millis(300), |bytes| last = bytes).await;
    assert_eq!(sent, Err(SendError::Stalled));
    assert_eq!(sent.err().map(SendError::code), Some("stalled"));
    assert!(started.elapsed() < PATIENCE);
    assert!(last < TEN_MIB as u64, "the window ran out before the end");
    assert!(server.seen().received.is_empty());
}

#[tokio::test]
async fn a_failed_cat_after_the_last_byte_is_rejected_with_its_status() {
    let (_fixture, _server, session) = session(Some(Exec::Receive { status: 1 })).await;
    let sent = session.send(PATH, &b"abc"[..], 3, PATIENCE, |_| {}).await;
    assert_eq!(sent, Err(SendError::Rejected { status: 1 }));
    assert_eq!(sent.err().map(SendError::code), Some("rejected"));
}

#[tokio::test]
async fn a_cat_that_fails_in_the_middle_is_rejected_at_once_not_after_the_whole_file() {
    let (_fixture, _server, session) = session(Some(Exec::Done { stdout: Vec::new(), status: 1 })).await;
    let data = pattern(TEN_MIB);
    let sent = timeout(PATIENCE, session.send(PATH, data.as_slice(), TEN_MIB as u64, PATIENCE, |_| {})).await.expect("ends");
    assert_eq!(sent, Err(SendError::Rejected { status: 1 }));
}

#[tokio::test]
async fn a_lost_connection_is_closed() {
    let (_fixture, _server, session) = session(Some(Exec::Disconnect)).await;
    let data = pattern(TEN_MIB);
    let sent = timeout(PATIENCE, session.send(PATH, data.as_slice(), TEN_MIB as u64, PATIENCE, |_| {})).await.expect("ends");
    assert_eq!(sent, Err(SendError::Closed));
    assert_eq!(sent.err().map(SendError::code), Some("closed"));
}

#[tokio::test]
async fn a_host_that_refuses_the_command_is_open() {
    let (_fixture, _server, session) = session(None).await;
    let sent = session.send(PATH, &b"abc"[..], 3, PATIENCE, |_| {}).await;
    assert_eq!(sent, Err(SendError::Open));
    assert_eq!(sent.err().map(SendError::code), Some("open"));
}

#[tokio::test]
async fn a_session_whose_connection_ended_cannot_open_a_channel() {
    let (_fixture, server, session) = session(Some(Exec::Receive { status: 0 })).await;
    drop(server);
    timeout(PATIENCE, session.closed()).await.expect("the server's end is noticed");
    assert_eq!(session.send(PATH, &b"abc"[..], 3, PATIENCE, |_| {}).await, Err(SendError::Open));
}

#[tokio::test]
async fn a_reader_that_fails_or_ends_early_is_source() {
    let (_fixture, _server, session) = session(Some(Exec::Receive { status: 0 })).await;
    assert_eq!(session.send(PATH, &b"abc"[..], 10, PATIENCE, |_| {}).await, Err(SendError::Source));
    assert_eq!(SendError::Source.code(), "source");
}
