use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

use crate::command::unwrap;
use crate::fixtures::{Fixture, HOST, server, target};
use crate::testing::{Behavior, Exec, ExecScript, Server, shell};
use crate::{DaemonError, Error, Limits, RunError, STDOUT_LIMIT, Secrets, Session, connect};

/// Long enough for a slow machine, short enough for a failed test to end.
const PATIENCE: Duration = Duration::from_secs(20);
const MAX_MESSAGE: usize = 1 << 20;
/// What a test asks the stand-in shell to run so that the command never finishes.
const HANG: &str = "sleep 1000";

/// What the stand-in daemon saw of an upgrade: the `Host` header and the subprotocol offered.
type Hello = (String, String);

/// A daemon stand-in: a WebSocket server that echoes text and binary messages. Returns its port and what each upgrade
/// carried.
async fn daemon() -> (u16, mpsc::UnboundedReceiver<Hello>) {
    let listener = TcpListener::bind((HOST, 0)).await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (hellos, seen) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let hellos = hellos.clone();
            tokio::spawn(async move {
                // The error type of the library's callback is large; the closure has no say in it.
                #[allow(clippy::result_large_err)]
                let upgrade = move |request: &Request, mut response: Response| {
                    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).unwrap_or_default().to_owned();
                    let _ = hellos.send((header("Host"), header("Sec-WebSocket-Protocol")));
                    // The daemon selects the subprotocol that was offered, as the client requires.
                    if let Some(offered) = request.headers().get("Sec-WebSocket-Protocol") {
                        response.headers_mut().insert("Sec-WebSocket-Protocol", offered.clone());
                    }
                    Ok(response)
                };
                let Ok(mut socket) = accept_hdr_async(tcp, upgrade).await else { return };
                while let Some(Ok(message)) = socket.next().await {
                    if (message.is_text() || message.is_binary()) && socket.send(message).await.is_err() {
                        return;
                    }
                }
            });
        }
    });
    (port, seen)
}

/// A server that accepts the password, with `configure`, and a session open on it.
async fn session(configure: impl FnOnce(&mut Behavior)) -> (Fixture, Server, Session) {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |behavior| {
        behavior.password = Some("hunter2".to_owned());
        configure(behavior);
    })
    .await;
    let secrets = Secrets { password: Some("hunter2".to_owned()), passphrase: None };
    let session = connect(&target(server.port()), &secrets, &fixture.env(), &fixture.known_hosts(), &Limits::default()).await.expect("connect");
    (fixture, server, session)
}

/// A server whose shell answers `HANG` never, and any other command with its own text and status 0.
fn echoing_shell() -> ExecScript {
    let inner = shell(|command| (command.as_bytes().to_vec(), 0));
    Arc::new(move |line| if unwrap(line).is_some_and(|marked| marked.command == HANG) { Exec::Hang } else { inner(line) })
}

fn with_shell(behavior: &mut Behavior) {
    behavior.exec = Some(echoing_shell());
}

#[tokio::test]
async fn a_websocket_passes_through_the_server_to_the_daemon() {
    let (_fixture, server, session) = session(|_| {}).await;
    let (port, mut hellos) = daemon().await;
    let mut socket = session.open_daemon(port, Some("secret"), MAX_MESSAGE).await.expect("daemon socket");
    assert_eq!(socket.max_message_bytes(), MAX_MESSAGE);
    socket.send(Message::text("hello")).await.expect("send");
    assert_eq!(timeout(PATIENCE, socket.next()).await.expect("in time").expect("a message").expect("ok"), Message::text("hello"));
    socket.send(Message::binary(vec![0_u8, 1, 2, 255])).await.expect("send");
    assert_eq!(timeout(PATIENCE, socket.next()).await.expect("in time").expect("a message").expect("ok"), Message::binary(vec![0_u8, 1, 2, 255]));
    assert_eq!(hellos.recv().await, Some((format!("{HOST}:{port}"), "pi-studio.bearer.secret".to_owned())));
    assert_eq!(server.seen().forwards, [(HOST.to_owned(), port)]);
}

#[tokio::test]
async fn no_password_offers_no_subprotocol() {
    let (_fixture, _server, session) = session(|_| {}).await;
    let (port, mut hellos) = daemon().await;
    let _socket = session.open_daemon(port, None, MAX_MESSAGE).await.expect("daemon socket");
    assert_eq!(hellos.recv().await, Some((format!("{HOST}:{port}"), String::new())));
}

#[tokio::test]
async fn a_port_nothing_listens_on_is_a_daemon_that_is_not_running() {
    let (_fixture, _server, session) = session(|_| {}).await;
    let closed = TcpListener::bind((HOST, 0)).await.expect("bind").local_addr().expect("addr").port();
    let error = session.open_daemon(closed, None, MAX_MESSAGE).await.expect_err("refused");
    assert_eq!(error.code(), "daemon_not_running");
    assert!(matches!(error, DaemonError::Channel(Error::PortRefused { hop: 0 })));
}

#[tokio::test]
async fn a_server_that_forbids_forwarding_is_not_a_daemon_that_is_not_running() {
    let (_fixture, server, session) = session(|behavior| behavior.forwarding = false).await;
    let (port, _hellos) = daemon().await;
    let error = session.open_daemon(port, None, MAX_MESSAGE).await.expect_err("prohibited");
    assert_eq!(error.code(), "forwarding_refused");
    assert!(matches!(error, DaemonError::Channel(Error::ForwardingRefused { hop: 0 })));
    assert_eq!(server.seen().forwards.len(), 1);
}

#[tokio::test]
async fn a_port_that_is_not_a_daemon_fails_the_upgrade() {
    let (_fixture, _server, session) = session(|_| {}).await;
    let listener = TcpListener::bind((HOST, 0)).await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            drop(tcp)
        }
    });
    let error = timeout(PATIENCE, session.open_daemon(port, None, MAX_MESSAGE)).await.expect("in time").expect_err("no upgrade");
    assert!(matches!(error, DaemonError::Dial(_)), "{error}");
}

#[tokio::test]
async fn several_channels_share_one_session_at_once() {
    let (_fixture, server, session) = session(with_shell).await;
    let (port, mut hellos) = daemon().await;
    let (first, second) = tokio::join!(session.open_daemon(port, None, MAX_MESSAGE), session.open_daemon(port, None, MAX_MESSAGE));
    let (mut first, mut second) = (first.expect("first socket"), second.expect("second socket"));
    // Both are open while a command runs and while each gets its own messages back.
    first.send(Message::text("one")).await.expect("send");
    second.send(Message::text("two")).await.expect("send");
    let (ran, a, b) = tokio::join!(session.run("echo both", PATIENCE), timeout(PATIENCE, first.next()), timeout(PATIENCE, second.next()));
    assert_eq!(a.expect("in time").expect("a message").expect("ok"), Message::text("one"));
    assert_eq!(b.expect("in time").expect("a message").expect("ok"), Message::text("two"));
    assert_eq!(ran.expect("the command").stdout, b"echo both");
    assert!(hellos.recv().await.is_some() && hellos.recv().await.is_some());
    assert_eq!(server.seen().connections, 1);
    assert_eq!(server.seen().forwards.len(), 2);
}

#[tokio::test]
async fn a_command_gives_its_status_and_what_it_wrote_between_the_markers() {
    let (_fixture, server, session) = session(|behavior| behavior.exec = Some(shell(|command| (format!("[{command}]\n").into_bytes(), 3)))).await;
    let output = session.run("pi-studio --version", PATIENCE).await.expect("the command");
    assert_eq!((output.status, output.stdout.as_slice()), (3, b"[pi-studio --version]\n".as_slice()));
    let output = session.run("echo 'quoted'", PATIENCE).await.expect("the command");
    assert_eq!(output.stdout, b"[echo 'quoted']\n");
    let commands = server.seen().commands;
    assert_eq!(commands.len(), 2);
    assert!(commands[0].starts_with("\"$SHELL\" -lic 'echo pistudio-begin-"), "{}", commands[0]);
    assert!(commands[0].contains("; pi-studio --version; echo pistudio-end-"));
    assert!(commands[0].ends_with(":$?'"));
    // Every run has markers of its own.
    let (first, second) = (unwrap(&commands[0]).expect("marked"), unwrap(&commands[1]).expect("marked"));
    assert_ne!((first.begin, first.end), (second.begin, second.end));
}

#[tokio::test]
async fn the_output_is_cut_at_64_kib_and_the_status_is_still_the_commands() {
    let (_fixture, _server, session) = session(|behavior| behavior.exec = Some(shell(|_| (vec![b'a'; 3 * STDOUT_LIMIT + 1], 9)))).await;
    let output = session.run("yes", PATIENCE).await.expect("the command");
    assert_eq!(output.status, 9);
    assert_eq!(output.stdout.len(), STDOUT_LIMIT);
    assert!(output.stdout.iter().all(|&byte| byte == b'a'));
}

#[tokio::test]
async fn a_command_that_does_not_finish_stops_at_its_limit_and_the_session_goes_on() {
    let (_fixture, server, session) = session(with_shell).await;
    let (hung, ran) = tokio::join!(session.run(HANG, Duration::from_millis(200)), session.run("echo next", PATIENCE));
    assert_eq!(hung, Err(RunError::Timeout));
    assert_eq!(hung.err().map(RunError::code), Some("timeout"));
    assert_eq!(ran.expect("the other command").stdout, b"echo next");
    let again = session.run("echo again", PATIENCE).await.expect("the session still runs commands");
    assert_eq!(again.stdout, b"echo again");
    assert!(!session.is_closed());
    assert_eq!(server.seen().commands.len(), 3);
}

#[tokio::test]
async fn an_account_that_runs_no_command_is_no_shell() {
    let (_fixture, _server, session) = session(|behavior| behavior.exec = None).await;
    let error = session.run("pi-studio --version", PATIENCE).await.expect_err("refused");
    assert_eq!(error, RunError::NoShell);
    assert_eq!(error.code(), "no_shell");
}

#[tokio::test]
async fn a_shell_that_prints_no_marker_is_no_shell() {
    let silent: ExecScript = Arc::new(|_| Exec::Done { stdout: b"Welcome to a restricted shell\n".to_vec(), status: 0 });
    let (_fixture, _server, session) = session(move |behavior| behavior.exec = Some(silent)).await;
    assert_eq!(session.run("pi-studio --version", PATIENCE).await.err(), Some(RunError::NoShell));
}

#[tokio::test]
async fn a_shell_that_ends_inside_the_command_is_exec_failed() {
    let cut: ExecScript = Arc::new(|line| {
        let begin = unwrap(line).map(|marked| marked.begin).unwrap_or_default();
        Exec::Done { stdout: format!("{begin}\npartial output").into_bytes(), status: 1 }
    });
    let (_fixture, _server, session) = session(move |behavior| behavior.exec = Some(cut)).await;
    let error = session.run("exit 1", PATIENCE).await.expect_err("no end marker");
    assert_eq!(error, RunError::ExecFailed);
    assert_eq!(error.code(), "exec_failed");
}

#[tokio::test]
async fn a_session_whose_connection_ended_cannot_run_a_command() {
    let (_fixture, server, session) = session(with_shell).await;
    drop(server);
    timeout(PATIENCE, session.closed()).await.expect("the server's end is noticed");
    assert_eq!(session.run("echo x", PATIENCE).await.err(), Some(RunError::ExecFailed));
    assert!(matches!(session.open_daemon(1, None, MAX_MESSAGE).await, Err(DaemonError::Channel(_))));
}
