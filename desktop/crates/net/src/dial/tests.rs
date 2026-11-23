//! The dial against local servers: plain, answering with an error status, silent, closed, and TLS
//! servers whose certificates the tests make.

use std::sync::Arc;
use std::time::Instant;

use futures_util::StreamExt;
use rcgen::{BasicConstraints, CertificateParams, CertifiedIssuer, DnType, IsCa, KeyPair, KeyUsagePurpose, date_time_ymd};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::{self, ServerConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::{accept_async, accept_hdr_async};

use super::*;
use crate::error::TlsReason;
use crate::limits::MAX_MESSAGE_BYTES;

/// A password nobody would pick: if it appears anywhere it leaked.
const MARKER: &str = "MARKER-pw-7f3a9c1e";
const LIMIT: Duration = Duration::from_secs(5);

/// What a test server saw in the upgrade.
#[derive(Debug)]
struct Seen {
    host: Option<String>,
    path: String,
    protocol: Option<String>,
}

async fn listener() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

/// A WebSocket server: answers one upgrade, echoing the offered subprotocol as the daemon does,
/// sends `hi` and reports what it saw.
async fn ws_server() -> (u16, oneshot::Receiver<Seen>) {
    let (listener, port) = listener().await;
    let (tx, rx) = oneshot::channel();
    tokio::spawn(async move {
        let Ok((tcp, _)) = listener.accept().await else { return };
        serve_ws(tcp, tx).await;
    });
    (port, rx)
}

// The library fixes the callback's error type, which is large.
#[allow(clippy::result_large_err)]
async fn serve_ws<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(stream: S, tx: oneshot::Sender<Seen>) {
    let mut tx = Some(tx);
    let callback = move |req: &Request, mut resp: Response| -> Result<Response, ErrorResponse> {
        let protocol = req.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).map(str::to_owned);
        if let Some(p) = &protocol
            && let Ok(v) = HeaderValue::from_str(p)
        {
            resp.headers_mut().insert("sec-websocket-protocol", v);
        }
        if let Some(tx) = tx.take() {
            let _ = tx.send(Seen { host: req.headers().get("host").and_then(|v| v.to_str().ok()).map(str::to_owned), path: req.uri().to_string(), protocol });
        }
        Ok(resp)
    };
    if let Ok(mut ws) = accept_hdr_async(stream, callback).await {
        use futures_util::SinkExt;
        let _ = ws.send(Message::text("hi")).await;
        // Hold the socket open until the client goes.
        while ws.next().await.is_some() {}
    }
}

/// Answers every upgrade with `HTTP/1.1 <status>` and nothing else, as the daemon does for 401
/// and 403.
async fn status_server(status: &'static str) -> u16 {
    let (listener, port) = listener().await;
    tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let mut buf = vec![0u8; 4096];
            let _ = tcp.read(&mut buf).await;
            let _ = tcp.write_all(format!("HTTP/1.1 {status}\r\n\r\n").as_bytes()).await;
        }
    });
    port
}

/// Accepts connections and never answers.
async fn silent_server() -> u16 {
    let (listener, port) = listener().await;
    tokio::spawn(async move {
        let mut held: Vec<TcpStream> = Vec::new();
        while let Ok((tcp, _)) = listener.accept().await {
            held.push(tcp);
        }
    });
    port
}

async fn closed_port() -> u16 {
    listener().await.1
}

fn url(scheme: &str, port: u16) -> String {
    format!("{scheme}://127.0.0.1:{port}")
}

/// Nothing in `error` may repeat the password: not the message, not `Display`, not `Debug`.
fn assert_no_secret(error: &DialError) {
    for text in [error.message.clone(), error.to_string(), format!("{error:?}")] {
        assert!(!text.contains(MARKER), "the password leaked: {text}");
    }
}

// ---- plain servers

/// The message limit of the bulk connection (the transfer engine's value).
const SIXTEEN_MIB: usize = 16 * 1024 * 1024;

/// Accepts one upgrade, sends one binary message of `len` bytes and then waits for the client.
async fn big_message_server(len: usize) -> u16 {
    let (listener, port) = listener().await;
    tokio::spawn(async move {
        use futures_util::SinkExt;
        let Ok((tcp, _)) = listener.accept().await else { return };
        let Ok(mut ws) = accept_async(tcp).await else { return };
        let _ = ws.send(Message::binary(vec![7u8; len])).await;
        while ws.next().await.is_some() {}
    });
    port
}

#[tokio::test]
async fn a_socket_dialled_with_16_mib_refuses_a_larger_message_and_takes_one_of_that_size() {
    let port = big_message_server(SIXTEEN_MIB).await;
    let mut socket = dial(&url("ws", port), None, LIMIT, SIXTEEN_MIB).await.unwrap();
    let Message::Binary(body) = socket.next().await.unwrap().unwrap() else { panic!("not a binary message") };
    assert_eq!(body.len(), SIXTEEN_MIB);

    let port = big_message_server(SIXTEEN_MIB + 1).await;
    let mut socket = dial(&url("ws", port), None, LIMIT, SIXTEEN_MIB).await.unwrap();
    let error = socket.next().await.unwrap().unwrap_err();
    assert!(matches!(error, tungstenite::Error::Capacity(_)), "{error:?}");
}

#[tokio::test]
async fn a_plain_server_connects_and_the_socket_carries_frames() {
    let (port, seen) = ws_server().await;
    let mut socket = dial(&format!("ws://127.0.0.1:{port}/daemon?x=1"), None, LIMIT, MAX_MESSAGE_BYTES).await.unwrap();
    assert_eq!(socket.next().await.unwrap().unwrap(), Message::text("hi"));
    let seen = seen.await.unwrap();
    assert_eq!(seen.host.as_deref(), Some(format!("127.0.0.1:{port}").as_str()), "Host is the URL's, as a browser sends it");
    assert!(seen.path.ends_with("/daemon?x=1"), "{}", seen.path);
}

#[tokio::test]
async fn without_a_password_no_subprotocol_is_offered() {
    let (port, seen) = ws_server().await;
    let _socket = dial(&url("ws", port), None, LIMIT, MAX_MESSAGE_BYTES).await.unwrap();
    assert_eq!(seen.await.unwrap().protocol, None);
}

#[tokio::test]
async fn an_empty_password_is_no_password() {
    let (port, seen) = ws_server().await;
    let _socket = dial(&url("ws", port), Some(""), LIMIT, MAX_MESSAGE_BYTES).await.unwrap();
    assert_eq!(seen.await.unwrap().protocol, None);
}

#[tokio::test]
async fn a_password_is_offered_as_the_bearer_subprotocol() {
    let (port, seen) = ws_server().await;
    let _socket = dial(&url("ws", port), Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap();
    assert_eq!(seen.await.unwrap().protocol, Some(format!("pi-studio.bearer.{MARKER}")));
}

#[tokio::test]
async fn a_password_with_spaces_and_symbols_reaches_the_daemon_whole() {
    let (port, seen) = ws_server().await;
    let password = "p@ss word!#$%&'*+-.^_`|~:;=?/";
    let _socket = dial(&url("ws", port), Some(password), LIMIT, MAX_MESSAGE_BYTES).await.unwrap();
    assert_eq!(seen.await.unwrap().protocol, Some(format!("pi-studio.bearer.{password}")));
}

#[tokio::test]
async fn a_password_a_subprotocol_cannot_carry_is_refused_before_any_connection_and_not_repeated() {
    let (listener, port) = listener().await;
    for password in [format!("{MARKER},extra"), format!("{MARKER}\r\nX: y"), format!("{MARKER}é")] {
        let e = dial(&url("ws", port), Some(&password), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
        assert_eq!(e.code, ErrorCode::Handshake);
        assert_no_secret(&e);
    }
    assert_no_connection(&listener).await;
}

#[tokio::test]
async fn answers_401_403_and_500_give_their_three_codes() {
    for (status, code) in [
        ("401 Unauthorized", ErrorCode::Unauthorized),
        ("403 Host not allowed", ErrorCode::HostNotAllowed),
        ("500 Internal Server Error", ErrorCode::Handshake),
    ] {
        let port = status_server(status).await;
        let e = dial(&url("ws", port), Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
        assert_eq!(e.code, code, "{status}: {e}");
        assert!(e.message.contains(&format!("127.0.0.1:{port}")), "the message names host and port: {}", e.message);
        assert_no_secret(&e);
    }
}

#[tokio::test]
async fn a_401_says_whether_a_password_was_sent() {
    let port = status_server("401 Unauthorized").await;
    let without = dial(&url("ws", port), None, LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    let with = dial(&url("ws", port), Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert!(without.message.contains("needs a password"), "{}", without.message);
    assert!(with.message.contains("refused the password"), "{}", with.message);
}

#[tokio::test]
async fn something_that_is_not_a_websocket_server_is_a_handshake_error() {
    let (listener, port) = listener().await;
    tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let mut buf = vec![0u8; 4096];
            let _ = tcp.read(&mut buf).await;
            // 101 without the accept key.
            let _ = tcp.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").await;
        }
    });
    let e = dial(&url("ws", port), Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Handshake, "{e}");
    assert_no_secret(&e);
}

#[tokio::test]
async fn a_server_that_hangs_up_during_the_upgrade_is_a_handshake_error() {
    let (listener, port) = listener().await;
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            drop(tcp);
        }
    });
    let e = dial(&url("ws", port), None, LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Handshake, "{e}");
}

#[tokio::test]
async fn a_server_that_never_answers_gives_timeout_at_the_limit() {
    let port = silent_server().await;
    let limit = Duration::from_millis(400);
    let started = Instant::now();
    let e = dial(&url("ws", port), Some(MARKER), limit, MAX_MESSAGE_BYTES).await.unwrap_err();
    let elapsed = started.elapsed();
    assert_eq!(e.code, ErrorCode::Timeout, "{e}");
    assert!(elapsed >= limit, "returned early: {elapsed:?}");
    assert!(elapsed < limit + Duration::from_secs(3), "returned late: {elapsed:?}");
    assert!(e.message.contains(&format!("127.0.0.1:{port}")), "{}", e.message);
    assert_no_secret(&e);
}

#[tokio::test]
async fn a_closed_port_is_unreachable() {
    let port = closed_port().await;
    let e = dial(&url("ws", port), Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Unreachable, "{e}");
    assert!(e.message.contains(&format!("127.0.0.1:{port}")), "{}", e.message);
    assert_no_secret(&e);
}

#[tokio::test]
async fn a_name_that_does_not_resolve_is_unreachable() {
    let e = dial("ws://daemon.invalid:6767", Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Unreachable, "{e}");
    assert!(e.message.contains("daemon.invalid:6767"), "{}", e.message);
    assert_no_secret(&e);
}

// ---- refused before any network use

/// Nothing is waiting in the listener's backlog: a connection attempt would be.
async fn assert_no_connection(listener: &TcpListener) {
    assert!(timeout(Duration::from_millis(150), listener.accept()).await.is_err(), "a connection was attempted");
}

#[tokio::test]
async fn user_information_and_other_schemes_are_refused_without_a_connection_attempt() {
    let (listener, port) = listener().await;
    let refused = [
        format!("ws://user@127.0.0.1:{port}"),
        format!("ws://user:{MARKER}@127.0.0.1:{port}/x"),
        format!("wss://:{MARKER}@127.0.0.1:{port}"),
        format!("http://127.0.0.1:{port}"),
        format!("https://127.0.0.1:{port}"),
        format!("ftp://127.0.0.1:{port}"),
        format!("127.0.0.1:{port}"),
    ];
    for url in refused {
        let e = dial(&url, Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidAddress, "{url}");
        assert_no_secret(&e);
        assert!(!e.message.contains(&url), "the message repeats the address: {}", e.message);
        let checked = check_address(&url).unwrap_err();
        assert_eq!((checked.code, checked.message.contains(&url)), (ErrorCode::InvalidAddress, false), "{url}");
    }
    assert!(check_address(&format!("ws://127.0.0.1:{port}")).is_ok());
    assert!(check_address("wss://daemon.example.com").is_ok());
    assert_no_connection(&listener).await;
}

// ---- TLS

struct Ca {
    issuer: CertifiedIssuer<'static, KeyPair>,
}

fn ca(name: &str) -> Ca {
    let mut params = CertificateParams::new(Vec::<String>::new()).unwrap();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.distinguished_name.push(DnType::CommonName, name);
    Ca { issuer: CertifiedIssuer::self_signed(params, KeyPair::generate().unwrap()).unwrap() }
}

struct Leaf {
    cert: CertificateDer<'static>,
    key: PrivateKeyDer<'static>,
}

/// A certificate for `san` (a name or an IP address), valid from `from` to `to` (years), signed
/// by `ca`.
fn leaf(ca: &Ca, san: &str, from: i32, to: i32) -> Leaf {
    let mut params = CertificateParams::new(vec![san.to_owned()]).unwrap();
    params.not_before = date_time_ymd(from, 1, 1);
    params.not_after = date_time_ymd(to, 1, 1);
    let key = KeyPair::generate().unwrap();
    let cert = params.signed_by(&key, &ca.issuer).unwrap();
    Leaf { cert: cert.der().clone(), key: PrivateKeyDer::Pkcs8(key.serialize_der().into()) }
}

/// A WSS server with `leaf`'s certificate. Returns its port and what the upgrade carried.
async fn wss_server(leaf: Leaf) -> (u16, oneshot::Receiver<Seen>) {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![leaf.cert], leaf.key)
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let (listener, port) = listener().await;
    let (tx, rx) = oneshot::channel();
    tokio::spawn(async move {
        let mut tx = Some(tx);
        while let Ok((tcp, _)) = listener.accept().await {
            let Ok(tls) = acceptor.accept(tcp).await else { continue };
            if let Some(tx) = tx.take() {
                serve_ws(tls, tx).await;
            } else {
                let _ = accept_async(tls).await;
            }
        }
    });
    (port, rx)
}

async fn dial_trusting(url: &str, password: Option<&str>, ca: &Ca) -> Result<DaemonSocket, DialError> {
    dial_with_roots(url, password, LIMIT, MAX_MESSAGE_BYTES, vec![ca.issuer.der().clone()]).await
}

#[tokio::test]
async fn a_certificate_from_a_trusted_authority_connects_over_wss_with_the_bearer_subprotocol() {
    let ca = ca("test CA");
    let (port, seen) = wss_server(leaf(&ca, "127.0.0.1", 2020, 2090)).await;
    let mut socket = dial_trusting(&url("wss", port), Some(MARKER), &ca).await.unwrap();
    assert_eq!(socket.next().await.unwrap().unwrap(), Message::text("hi"));
    assert_eq!(seen.await.unwrap().protocol, Some(format!("pi-studio.bearer.{MARKER}")));
}

#[tokio::test]
async fn an_unknown_issuer_is_a_tls_error_with_that_reason() {
    let ca = ca("test CA");
    let (port, _seen) = wss_server(leaf(&ca, "127.0.0.1", 2020, 2090)).await;
    // The shipped dial: the system's store does not hold the test authority.
    let e = dial(&url("wss", port), Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Tls, "{e}");
    assert_eq!(e.tls_reason, Some(TlsReason::UnknownIssuer), "{e}");
    assert!(e.message.contains(&format!("127.0.0.1:{port}")) && e.message.contains("does not trust"), "{}", e.message);
    assert_no_secret(&e);
}

#[tokio::test]
async fn an_expired_certificate_is_a_tls_error_with_that_reason() {
    let ca = ca("test CA");
    let (port, _seen) = wss_server(leaf(&ca, "127.0.0.1", 2020, 2021)).await;
    let e = dial_trusting(&url("wss", port), Some(MARKER), &ca).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Tls, "{e}");
    // macOS's verifier may not name the expiry: TODO(verify) on the runner.
    if cfg!(not(target_vendor = "apple")) {
        assert_eq!(e.tls_reason, Some(TlsReason::Expired), "{e}");
        assert!(e.message.contains("expired"), "{}", e.message);
    }
    assert_no_secret(&e);
}

#[tokio::test]
async fn a_certificate_for_another_name_is_a_tls_error_with_that_reason() {
    let ca = ca("test CA");
    let (port, _seen) = wss_server(leaf(&ca, "other.example", 2020, 2090)).await;
    let e = dial_trusting(&url("wss", port), Some(MARKER), &ca).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Tls, "{e}");
    assert_eq!(e.tls_reason, Some(TlsReason::WrongName), "{e}");
    assert!(e.message.contains("not valid for this host"), "{}", e.message);
    assert_no_secret(&e);
}

#[tokio::test]
async fn a_certificate_from_a_second_unknown_authority_is_refused_even_when_another_is_trusted() {
    let trusted = ca("trusted test CA");
    let other = ca("another test CA");
    let (port, _seen) = wss_server(leaf(&other, "127.0.0.1", 2020, 2090)).await;
    let e = dial_trusting(&url("wss", port), None, &trusted).await.unwrap_err();
    assert_eq!(e.tls_reason, Some(TlsReason::UnknownIssuer), "{e}");
}

#[tokio::test]
async fn a_plain_server_on_a_wss_address_is_a_tls_error() {
    let (port, _seen) = ws_server().await;
    let e = dial(&url("wss", port), Some(MARKER), Duration::from_secs(3), MAX_MESSAGE_BYTES).await.unwrap_err();
    assert!(matches!(e.code, ErrorCode::Tls | ErrorCode::Timeout), "{e}");
    assert_no_secret(&e);
}

#[tokio::test]
async fn the_upgrade_over_tls_reports_401_like_over_tcp() {
    let ca = ca("test CA");
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let l = leaf(&ca, "127.0.0.1", 2020, 2090);
    let config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![l.cert], l.key)
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let (listener, port) = listener().await;
    tokio::spawn(async move {
        while let Ok((tcp, _)) = listener.accept().await {
            let Ok(mut tls) = acceptor.accept(tcp).await else { continue };
            let mut buf = vec![0u8; 4096];
            let _ = tls.read(&mut buf).await;
            let _ = tls.write_all(b"HTTP/1.1 401 Unauthorized\r\n\r\n").await;
            let _ = tls.shutdown().await;
        }
    });
    let e = dial_trusting(&url("wss", port), Some(MARKER), &ca).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Unauthorized, "{e}");
    assert_no_secret(&e);
}

#[tokio::test]
async fn dial_over_upgrades_on_the_stream_it_is_given_with_the_url_host_and_the_bearer_subprotocol() {
    let (near, far) = tokio::io::duplex(64 * 1024);
    let (tx, seen) = oneshot::channel();
    tokio::spawn(serve_ws(far, tx));
    let mut socket = dial_over(near, "ws://daemon.test:4321/x", Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap();
    assert_eq!(socket.max_message_bytes(), MAX_MESSAGE_BYTES);
    assert_eq!(socket.next().await.unwrap().unwrap(), Message::text("hi"));
    let seen = seen.await.unwrap();
    assert_eq!(seen.host.as_deref(), Some("daemon.test:4321"));
    assert_eq!(seen.protocol, Some(format!("pi-studio.bearer.{MARKER}")));
}

#[tokio::test]
async fn dial_over_maps_a_refused_upgrade_like_dial_does() {
    let (near, mut far) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        let _ = far.read(&mut buf).await;
        let _ = far.write_all(b"HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n").await;
    });
    let e = dial_over(near, "ws://daemon.test:4321", Some(MARKER), LIMIT, MAX_MESSAGE_BYTES).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Unauthorized, "{e}");
    assert_no_secret(&e);
}
