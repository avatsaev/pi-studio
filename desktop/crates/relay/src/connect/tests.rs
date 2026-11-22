//! The connect against the relay stand-in: the happy path, every close the SDK names, the key exchange
//! that fails, a relay that says something it must not, a dial that fails and a relay that is silent.

use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

use super::*;
use crate::channel::{Record, RecordKind};
use crate::testing::{DaemonHalf, Seen, StandIn, Step};

const DAEMON_SECRET: [u8; KEY_LENGTH] = [9; KEY_LENGTH];
const OTHER_SECRET: [u8; KEY_LENGTH] = [5; KEY_LENGTH];
/// Long enough for loopback, so that only a relay that says nothing runs into it.
const LIMIT: Duration = Duration::from_secs(5);
/// For the tests of a silent relay.
const SHORT_LIMIT: Duration = Duration::from_millis(300);
const MAX_MESSAGE: usize = 1024 * 1024;

/// The script of a relay that pairs and a daemon that accepts the key, up to the first message.
fn open_script() -> Vec<Step> {
    vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Ready]
}

fn with(mut script: Vec<Step>, more: Vec<Step>) -> Vec<Step> {
    script.extend(more);
    script
}

async fn stand_in(script: Vec<Step>) -> StandIn {
    StandIn::start(DAEMON_SECRET, script).await.unwrap()
}

async fn connect_to(stand_in: &StandIn) -> Result<Connected, RelayError> {
    connect(&stand_in.url(), &stand_in.daemon_public(), MAX_MESSAGE, LIMIT).await
}

async fn next_seen(stand_in: &mut StandIn) -> Seen {
    tokio::time::timeout(LIMIT, stand_in.seen()).await.unwrap().unwrap()
}

/// The error of a connect to a stand-in running `script`.
async fn failure_with(script: Vec<Step>) -> RelayError {
    let stand_in = stand_in(script).await;
    connect_to(&stand_in).await.unwrap_err()
}

#[test]
fn the_connect_limit_is_fifteen_seconds() {
    assert_eq!(CONNECT_LIMIT, Duration::from_secs(15));
}

#[tokio::test]
async fn pairs_exchanges_keys_and_carries_messages_both_ways() {
    let mut stand_in = stand_in(with(open_script(), vec![Step::Echo])).await;
    let mut connected = connect_to(&stand_in).await.unwrap();
    assert!(connected.channel.is_open());

    let expected = format!(r#"{{"type":"relay_client_connect","v":2,"sessionId":"{}"}}"#, session_id(&stand_in.daemon_public()));
    assert_eq!(next_seen(&mut stand_in).await, Seen::Connect(expected));
    assert!(matches!(next_seen(&mut stand_in).await, Seen::Hello(_)));

    let frame = connected.channel.seal(RecordKind::Text, b"ping").unwrap();
    connected.socket.send(Message::binary(frame)).await.unwrap();
    assert_eq!(next_seen(&mut stand_in).await, Seen::Opened(Record::Text("ping".to_owned())));
    let Some(Ok(Message::Binary(echo))) = connected.socket.next().await else { panic!("no echo") };
    assert_eq!(connected.channel.open(&echo), Ok(Record::Text("ping".to_owned())));
}

#[tokio::test]
async fn the_daemons_first_message_arrives_after_the_connect() {
    let stand_in = stand_in(with(open_script(), vec![Step::Send(Record::Binary(vec![1, 2, 3]))])).await;
    let mut connected = connect_to(&stand_in).await.unwrap();
    let Some(Ok(Message::Binary(frame))) = connected.socket.next().await else { panic!("no frame") };
    assert_eq!(connected.channel.open(&frame), Ok(Record::Binary(vec![1, 2, 3])));
}

#[tokio::test]
async fn relay_registered_is_ignored_before_and_between() {
    let script = vec![Step::ReadConnect, Step::Registered, Step::Registered, Step::Paired, Step::Hello, Step::Ready, Step::Echo];
    let stand_in = stand_in(script).await;
    assert!(connect_to(&stand_in).await.unwrap().channel.is_open());
}

#[tokio::test]
async fn a_close_4102_to_4105_before_pairing_gives_its_reason() {
    let table = [
        (4102, "daemon_offline", RelayReason::DaemonOffline),
        (4103, "daemon_unresponsive", RelayReason::DaemonUnresponsive),
        (4104, "too_many_clients", RelayReason::TooManyClients),
        (4105, "daemon_outdated", RelayReason::DaemonOutdated),
    ];
    for (code, name, reason) in table {
        let error = failure_with(vec![Step::ReadConnect, Step::Close(code, name.to_owned())]).await;
        assert_eq!(error.reason, reason, "{name}");
        assert_eq!(error.reason.as_str(), name);
        assert_eq!(error.message, format!("{} ({name})", reason.message()));
    }
}

#[tokio::test]
async fn a_refusal_after_pairing_gives_its_reason_too() {
    let script = vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Close(4102, "daemon_offline".to_owned())];
    assert_eq!(failure_with(script).await.reason, RelayReason::DaemonOffline);
}

#[tokio::test]
async fn a_close_4200_after_pairing_is_wrong_key() {
    let script = vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Close(CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON.to_owned())];
    let error = failure_with(script).await;
    assert_eq!(error.reason, RelayReason::WrongKey);
    assert_eq!(error.message, format!("{} (channel_error)", RelayReason::WrongKey.message()));
}

#[tokio::test]
async fn a_close_4200_before_pairing_is_a_protocol_error() {
    let error = failure_with(vec![Step::ReadConnect, Step::Close(CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON.to_owned())]).await;
    assert_eq!(error.reason, RelayReason::ProtocolError);
}

#[tokio::test]
async fn another_close_code_before_pairing_is_a_protocol_error() {
    for code in [1000, 1008, 4100, 4101, 4106, 4108, 4109] {
        let error = failure_with(vec![Step::ReadConnect, Step::Close(code, "x".to_owned())]).await;
        assert_eq!(error.reason, RelayReason::ProtocolError, "{code}");
    }
}

#[tokio::test]
async fn a_ready_that_does_not_open_is_wrong_key_and_the_client_closes_4200() {
    // The link's key is not the daemon's: the stand-in's daemon half derives another shared key.
    let mut stand_in = stand_in(open_script()).await;
    let other = DaemonHalf::new(OTHER_SECRET).public();
    let error = connect(&stand_in.url(), &other, MAX_MESSAGE, LIMIT).await.unwrap_err();
    assert_eq!(error.reason, RelayReason::WrongKey);
    assert!(matches!(next_seen(&mut stand_in).await, Seen::Connect(_)));
    assert!(matches!(next_seen(&mut stand_in).await, Seen::Hello(_)));
    assert_eq!(next_seen(&mut stand_in).await, Seen::Closed(Some((CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON.to_owned()))));
}

#[tokio::test]
async fn a_malformed_or_text_ready_is_wrong_key_and_the_client_closes_4200() {
    let bad_frames = [Step::Binary(vec![1, 2, 3]), Step::Binary(Vec::new()), Step::Binary(vec![2; 64]), Step::Text("ready".to_owned())];
    for bad in bad_frames {
        let mut stand_in = stand_in(vec![Step::ReadConnect, Step::Paired, Step::Hello, bad]).await;
        let error = connect_to(&stand_in).await.unwrap_err();
        assert_eq!(error.reason, RelayReason::WrongKey);
        assert!(matches!(next_seen(&mut stand_in).await, Seen::Connect(_)));
        assert!(matches!(next_seen(&mut stand_in).await, Seen::Hello(_)));
        assert_eq!(next_seen(&mut stand_in).await, Seen::Closed(Some((CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON.to_owned()))));
    }
}

#[tokio::test]
async fn a_close_without_a_code_before_pairing_is_relay_unreachable() {
    let error = failure_with(vec![Step::ReadConnect, Step::CloseEmpty]).await;
    assert_eq!(error.reason, RelayReason::RelayUnreachable);
    assert_eq!(error.message, RelayReason::RelayUnreachable.message());
}

#[tokio::test]
async fn a_socket_that_ends_before_pairing_is_relay_unreachable() {
    assert_eq!(failure_with(vec![Step::ReadConnect, Step::Drop]).await.reason, RelayReason::RelayUnreachable);
    assert_eq!(failure_with(vec![Step::Drop]).await.reason, RelayReason::RelayUnreachable);
}

#[tokio::test]
async fn a_close_without_a_code_or_an_end_after_pairing_is_a_protocol_error() {
    assert_eq!(failure_with(vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::CloseEmpty]).await.reason, RelayReason::ProtocolError);
    assert_eq!(failure_with(vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Drop]).await.reason, RelayReason::ProtocolError);
}

#[tokio::test]
async fn a_frame_the_relay_must_not_send_before_pairing_is_a_protocol_error_and_the_client_closes_1000() {
    let paired_without_id = r#"{"type":"relay_paired"}"#.to_owned();
    let bad_id = r#"{"type":"relay_paired","connectionId":"XYZ"}"#.to_owned();
    let upper_id = format!(r#"{{"type":"relay_paired","connectionId":"{}"}}"#, "A".repeat(32));
    let hostile = [
        Step::Binary(vec![1, 2, 3]),
        Step::Binary(Vec::new()),
        Step::Text("not json".to_owned()),
        Step::Text("[]".to_owned()),
        Step::Text(r#"{"type":"relay_dial","connectionId":"0123456789abcdef0123456789abcdef"}"#.to_owned()),
        Step::Text(r#"{"type":"nope"}"#.to_owned()),
        Step::Text(paired_without_id),
        Step::Text(bad_id),
        Step::Text(upper_id),
        Step::Text(format!(
            r#"{{"type":"relay_paired","connectionId":"{CONNECTION}","pad":"{}"}}"#,
            "x".repeat(MAX_CONTROL_FRAME),
            CONNECTION = crate::testing::CONNECTION_ID
        )),
    ];
    for frame in hostile {
        let mut stand_in = stand_in(vec![Step::ReadConnect, frame.clone()]).await;
        let error = connect_to(&stand_in).await.unwrap_err();
        assert_eq!(error.reason, RelayReason::ProtocolError, "{frame:?}");
        assert!(matches!(next_seen(&mut stand_in).await, Seen::Connect(_)));
        assert_eq!(next_seen(&mut stand_in).await, Seen::Closed(Some((1000, String::new()))), "{frame:?}");
    }
}

#[tokio::test]
async fn a_silent_relay_is_a_timeout_at_the_limit_and_the_client_closes() {
    let mut stand_in = stand_in(Vec::new()).await;
    let error = connect(&stand_in.url(), &stand_in.daemon_public(), MAX_MESSAGE, SHORT_LIMIT).await.unwrap_err();
    assert_eq!(error.reason, RelayReason::Timeout);
    assert_eq!(error.message, RelayReason::Timeout.message());
    // Its script is empty, so it only recorded the connect frame and then the close.
    let connect_frame = format!(r#"{{"type":"relay_client_connect","v":2,"sessionId":"{}"}}"#, session_id(&stand_in.daemon_public()));
    assert_eq!(next_seen(&mut stand_in).await, Seen::Text(connect_frame));
    assert_eq!(next_seen(&mut stand_in).await, Seen::Closed(Some((1000, String::new()))));
}

#[tokio::test]
async fn a_relay_that_pairs_and_goes_silent_is_a_timeout() {
    let stand_in = stand_in(vec![Step::ReadConnect, Step::Paired, Step::Hello]).await;
    let error = connect(&stand_in.url(), &stand_in.daemon_public(), MAX_MESSAGE, SHORT_LIMIT).await.unwrap_err();
    assert_eq!(error.reason, RelayReason::Timeout);
}

#[tokio::test]
async fn a_relay_that_never_completes_the_upgrade_is_a_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let _held = tokio::spawn(async move {
        let connection = listener.accept().await;
        std::future::pending::<()>().await;
        drop(connection);
    });
    let error = connect(&format!("ws://127.0.0.1:{port}"), &[1; KEY_LENGTH], MAX_MESSAGE, SHORT_LIMIT).await.unwrap_err();
    assert_eq!(error.reason, RelayReason::Timeout);
}

#[tokio::test]
async fn a_dial_that_fails_is_relay_unreachable() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap().port()
    };
    let refused = connect(&format!("ws://127.0.0.1:{port}"), &[1; KEY_LENGTH], MAX_MESSAGE, LIMIT).await.unwrap_err();
    assert_eq!(refused.reason, RelayReason::RelayUnreachable);
    assert!(refused.message.starts_with(RelayReason::RelayUnreachable.message()));

    let not_websocket = connect("http://127.0.0.1:1", &[1; KEY_LENGTH], MAX_MESSAGE, LIMIT).await.unwrap_err();
    assert_eq!(not_websocket.reason, RelayReason::RelayUnreachable);
}

#[tokio::test]
async fn a_relay_that_is_not_a_websocket_server_is_relay_unreachable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt as _;
        if let Ok((mut tcp, _)) = listener.accept().await {
            let _ = tcp.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n").await;
        }
    });
    let error = connect(&format!("ws://127.0.0.1:{port}"), &[1; KEY_LENGTH], MAX_MESSAGE, LIMIT).await.unwrap_err();
    assert_eq!(error.reason, RelayReason::RelayUnreachable);
}

#[test]
fn close_reasons_follow_the_sdk_table() {
    // (code, paired) -> reason, as `closeReason` of the SDK.
    let table = [
        (Some(4102), false, RelayReason::DaemonOffline),
        (Some(4102), true, RelayReason::DaemonOffline),
        (Some(4105), false, RelayReason::DaemonOutdated),
        (Some(4200), true, RelayReason::WrongKey),
        (Some(4200), false, RelayReason::ProtocolError),
        (None, false, RelayReason::RelayUnreachable),
        (None, true, RelayReason::ProtocolError),
        (Some(1000), false, RelayReason::ProtocolError),
        (Some(1000), true, RelayReason::ProtocolError),
    ];
    for (code, paired, reason) in table {
        assert_eq!(close_reason(code, paired), reason, "{code:?} {paired}");
    }
}

#[test]
fn the_connection_id_is_32_lowercase_hex_characters() {
    assert!(is_connection_id(&"0123456789abcdef".repeat(2)));
    assert!(!is_connection_id(&"0123456789ABCDEF".repeat(2)));
    assert!(!is_connection_id(&"0".repeat(31)));
    assert!(!is_connection_id(&"0".repeat(33)));
    assert!(!is_connection_id(&"g".repeat(32)));
}
