use std::time::Duration;

use russh::keys::PrivateKey;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

use crate::config::Target;
use crate::fixtures::{Fixture, HOST, limits, server, target, target_with_keys};
use crate::known_hosts::trust;
use crate::testing::{Behavior, Server, Wire, ed25519};
use crate::{Error, Limits, Secrets, Session, connect};

async fn go(fixture: &Fixture, target: &Target, secrets: &Secrets, limits: &Limits) -> Result<Session, Error> {
    connect(target, secrets, &fixture.env(), &fixture.known_hosts(), limits).await
}

fn accepting(key: &PrivateKey) -> impl FnOnce(&mut Behavior) + use<> {
    let public = key.public_key().clone();
    move |behavior| behavior.keys.push(public)
}

fn with_password(behavior: &mut Behavior) {
    behavior.password = Some("hunter2".to_owned());
}

fn password(text: &str) -> Secrets {
    Secrets { password: Some(text.to_owned()), passphrase: None }
}

#[tokio::test]
async fn a_session_opens_a_channel_to_a_port_on_the_host() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, with_password).await;
    let (other, _) = server_other(&fixture).await;
    let session = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect("connect");
    assert_eq!(session.hops(), 0);
    let mut stream = session.open_tcpip(HOST, other.port()).await.expect("channel");
    let mut banner = [0_u8; 8];
    stream.read_exact(&mut banner).await.expect("the other server's banner");
    assert_eq!(&banner, b"SSH-2.0-");
    assert_eq!(server.seen().forwards, [(HOST.to_owned(), other.port())]);
}

async fn server_other(fixture: &Fixture) -> (Server, PrivateKey) {
    server(fixture, 101, |_| {}).await
}

#[tokio::test]
async fn forwarding_that_the_server_forbids_is_forwarding_refused() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |behavior| {
        with_password(behavior);
        behavior.forwarding = false;
    })
    .await;
    let session = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect("connect");
    let error = session.open_tcpip(HOST, 9).await.err().expect("prohibited");
    assert_eq!(error.code(), "forwarding_refused");
}

#[tokio::test]
async fn a_closed_port_on_the_host_is_a_refused_port() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, with_password).await;
    let closed = TcpListener::bind((HOST, 0)).await.expect("bind").local_addr().expect("addr").port();
    let session = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect("connect");
    let error = session.open_tcpip(HOST, closed).await.err().expect("refused");
    assert_eq!(error.code(), "daemon_not_running");
    assert!(matches!(error, Error::PortRefused { hop: 0 }));
}

#[tokio::test]
async fn an_unknown_host_key_fails_at_once_and_carries_the_key() {
    let fixture = Fixture::new();
    let host_key = ed25519(100);
    let server =
        Server::start(Behavior { password: Some("hunter2".to_owned()), ..Behavior::new(host_key.clone(), crate::fixtures::USER) }).await.expect("start");
    let error = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect_err("unknown");
    assert_eq!(error.code(), "host_key_unknown");
    let Error::HostKeyUnknown { hop: 0, host, port, key } = error else { panic!("not an unknown key") };
    assert_eq!((host.as_str(), port), (HOST, server.port()));
    assert_eq!(key.key_data(), host_key.public_key().key_data());
    assert_eq!(server.seen().passwords, 0, "nothing is offered to a host that is not trusted");
    assert!(!fixture.app_known_hosts().exists(), "a connect never writes known hosts");
    // Once trusted, the same connect goes through.
    trust(HOST, server.port(), host_key.public_key(), &fixture.app_known_hosts()).expect("trust");
    go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect("trusted");
}

#[tokio::test]
async fn a_changed_host_key_is_refused() {
    let fixture = Fixture::new();
    let server = Server::start(Behavior::new(ed25519(100), crate::fixtures::USER)).await.expect("start");
    trust(HOST, server.port(), ed25519(101).public_key(), &fixture.app_known_hosts()).expect("trust the old key");
    let error = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect_err("changed");
    assert_eq!(error.code(), "host_key_changed");
    assert!(matches!(&error, Error::HostKeyChanged { hop: 0, port, .. } if *port == server.port()));
}

#[tokio::test]
async fn a_key_known_in_the_users_file_is_trusted() {
    let fixture = Fixture::new();
    let host_key = ed25519(100);
    let mut behavior = Behavior::new(host_key.clone(), crate::fixtures::USER);
    with_password(&mut behavior);
    let server = Server::start(behavior).await.expect("start");
    trust(HOST, server.port(), host_key.public_key(), &fixture.user_known_hosts()).expect("trust");
    go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect("known in ~/.ssh/known_hosts");
}

#[tokio::test]
async fn an_unreadable_known_hosts_file_is_not_a_trust_question() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, with_password).await;
    // A directory where the file should be: reading it fails.
    std::fs::create_dir(fixture.user_known_hosts()).expect("directory");
    let error = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect_err("unreadable");
    assert_eq!(error.code(), "known_hosts");
}

#[tokio::test]
async fn two_hops_and_the_password_goes_to_the_final_host_only() {
    let fixture = Fixture::new();
    let key = ed25519(7);
    let (first, _) = server(&fixture, 110, |behavior| {
        accepting(&key)(behavior);
        with_password(behavior);
    })
    .await;
    let (second, _) = server(&fixture, 111, |behavior| {
        accepting(&key)(behavior);
        with_password(behavior);
    })
    .await;
    let (last, _) = server(&fixture, 112, with_password).await;
    let file = fixture.key_file("id_hops", &key);
    let target = Target { hops: vec![target_with_keys(&first, &[&file]), target_with_keys(&second, &[&file])], ..target(last.port()) };
    let session = go(&fixture, &target, &password("hunter2"), &limits()).await.expect("connect through two hops");
    assert_eq!(session.hops(), 2);
    assert_eq!((first.seen().passwords, second.seen().passwords, last.seen().passwords), (0, 0, 1));
    assert_eq!(first.seen().forwards, [(HOST.to_owned(), second.port())]);
    assert_eq!(second.seen().forwards, [(HOST.to_owned(), last.port())]);
    assert!(last.seen().forwards.is_empty());
    let mut stream = session.open_tcpip(HOST, first.port()).await.expect("a channel through the chain");
    let mut banner = [0_u8; 8];
    stream.read_exact(&mut banner).await.expect("banner");
    assert_eq!(&banner, b"SSH-2.0-");
}

#[tokio::test]
async fn a_password_is_never_offered_to_a_hop_that_wants_one() {
    let fixture = Fixture::new();
    let (first, _) = server(&fixture, 110, with_password).await;
    let (last, _) = server(&fixture, 112, with_password).await;
    let target = Target { hops: vec![target(first.port())], ..target(last.port()) };
    let error = go(&fixture, &target, &password("hunter2"), &limits()).await.expect_err("the hop has nothing to log in with");
    assert!(matches!(&error, Error::AuthFailed { hop: 0, .. }), "{error:?}");
    assert_eq!((first.seen().passwords, last.seen().connections), (0, 0));
}

#[tokio::test]
async fn failures_at_a_hop_name_the_hop() {
    let fixture = Fixture::new();
    let key = ed25519(7);
    let file = fixture.key_file("id_hops", &key);
    let (first, _) = server(&fixture, 110, accepting(&key)).await;
    let closed = TcpListener::bind((HOST, 0)).await.expect("bind").local_addr().expect("addr").port();

    // The first hop cannot reach the second host.
    let target_unreachable = Target { hops: vec![target_with_keys(&first, &[&file]), target(closed)], ..target(closed) };
    let error = go(&fixture, &target_unreachable, &Secrets::default(), &limits()).await.expect_err("unreachable");
    assert!(matches!(error, Error::Unreachable { hop: 1 }), "{error:?}");

    // A host key the user never trusted, on the second hop.
    let untrusted =
        Server::start(Behavior { keys: vec![key.public_key().clone()], ..Behavior::new(ed25519(113), crate::fixtures::USER) }).await.expect("start");
    let target_unknown = Target { hops: vec![target_with_keys(&first, &[&file]), target_with_keys(&untrusted, &[&file])], ..target(closed) };
    let error = go(&fixture, &target_unknown, &Secrets::default(), &limits()).await.expect_err("unknown");
    assert!(matches!(error, Error::HostKeyUnknown { hop: 1, .. }), "{error:?}");

    // A first hop whose rules forbid forwarding.
    let (strict, _) = server(&fixture, 114, |behavior| {
        accepting(&key)(behavior);
        behavior.forwarding = false;
    })
    .await;
    let target_refused = Target { hops: vec![target_with_keys(&strict, &[&file])], ..target(first.port()) };
    let error = go(&fixture, &target_refused, &Secrets::default(), &limits()).await.expect_err("refused");
    assert!(matches!(error, Error::ForwardingRefused { hop: 0 }), "{error:?}");
}

#[tokio::test]
async fn a_host_that_is_not_listening_is_unreachable() {
    let fixture = Fixture::new();
    let closed = TcpListener::bind((HOST, 0)).await.expect("bind").local_addr().expect("addr").port();
    let error = go(&fixture, &target(closed), &Secrets::default(), &limits()).await.expect_err("refused");
    assert_eq!(error.code(), "unreachable");
}

#[tokio::test]
async fn a_peer_that_does_not_speak_ssh_is_a_failed_handshake() {
    let fixture = Fixture::new();
    let listener = TcpListener::bind((HOST, 0)).await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let _ = tokio::io::AsyncWriteExt::write_all(&mut socket, b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        }
    });
    let error = go(&fixture, &target(port), &Secrets::default(), &limits()).await.expect_err("not ssh");
    assert_eq!(error.code(), "handshake");
}

#[tokio::test]
async fn a_silent_peer_times_out_after_one_step() {
    let fixture = Fixture::new();
    let listener = TcpListener::bind((HOST, 0)).await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        let _held = listener.accept().await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let limits = Limits { step: Duration::from_millis(150), ..limits() };
    let error = go(&fixture, &target(port), &Secrets::default(), &limits).await.expect_err("silent");
    assert!(matches!(error, Error::Timeout { hop: 0 }), "{error:?}");
}

#[tokio::test]
async fn the_whole_connect_is_limited_too() {
    let fixture = Fixture::new();
    let listener = TcpListener::bind((HOST, 0)).await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        let _held = listener.accept().await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let limits = Limits { total: Duration::from_millis(150), ..limits() };
    let error = go(&fixture, &target(port), &Secrets::default(), &limits).await.expect_err("out of time");
    assert_eq!(error.code(), "timeout");
}

#[tokio::test]
async fn a_connection_that_stops_answering_is_closed_after_three_missed_keepalives() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, with_password).await;
    let wire = Wire::start(server.addr()).await.expect("wire");
    // The relay's port is the one the host key is trusted for.
    trust(HOST, wire.addr().port(), ed25519(100).public_key(), &fixture.app_known_hosts()).expect("trust");
    let limits = Limits { keepalive_interval: Duration::from_millis(40), keepalive_max: 3, ..limits() };
    let session = go(&fixture, &target(wire.addr().port()), &password("hunter2"), &limits).await.expect("connect");

    tokio::time::sleep(Duration::from_millis(400)).await;
    assert!(!session.is_closed(), "an answering server keeps the connection open");

    wire.cut();
    tokio::time::timeout(Duration::from_secs(5), session.closed()).await.expect("the keepalive closes the connection");
    assert!(session.is_closed());
    let error = session.open_tcpip(HOST, 9).await.err().expect("a closed connection opens no channel");
    assert_eq!(error.code(), "ssh_lost");
}

#[tokio::test]
async fn a_server_that_goes_away_wakes_closed() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, with_password).await;
    let session = go(&fixture, &target(server.port()), &password("hunter2"), &limits()).await.expect("connect");
    assert!(!session.is_closed());
    drop(server);
    tokio::time::timeout(Duration::from_secs(5), session.closed()).await.expect("the dropped connection wakes closed");
    assert!(session.is_closed());
}

#[tokio::test]
async fn closing_a_session_disconnects_every_hop() {
    let fixture = Fixture::new();
    let key = ed25519(7);
    let (first, _) = server(&fixture, 110, accepting(&key)).await;
    let (last, _) = server(&fixture, 112, with_password).await;
    let file = fixture.key_file("id_hops", &key);
    let target = Target { hops: vec![target_with_keys(&first, &[&file])], ..target(last.port()) };
    let session = go(&fixture, &target, &password("hunter2"), &limits()).await.expect("connect");
    // A stream through the chain ends when the session is closed.
    let mut stream = session.open_tcpip(HOST, first.port()).await.expect("channel");
    session.close().await;
    let mut rest = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut rest)).await.expect("the stream ends").ok();
}
