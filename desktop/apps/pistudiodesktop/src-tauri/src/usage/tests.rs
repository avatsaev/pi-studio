//! The sender against a local server: how a response is classified (§ 2), the headers and body that
//! reach it, and the moments over a stand-in owner thread.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pistudiodesktop_engine::Session;
use pistudiodesktop_secrets::MemoryStore;
use pistudiodesktop_shell::usage::{Counts, EventInputs, EventName, build_request};
use pistudiodesktop_shell::{AppShell, Services};
use serde_json::{Value, json};

use super::*;

const TEST_TOKEN: &str = "phc_test_token";
const EVENT_UUID: &str = "11111111-1111-4111-8111-111111111111";
const LIMIT: Duration = Duration::from_secs(5);

fn facts() -> Facts {
    Facts { os: "linux".into(), arch: "x86_64".into(), version: "1.2.3".into(), install_kind: "appimage".into(), locale: Some("en-US".into()) }
}

fn request(name: EventName) -> UsageRequest {
    build_request(&EventInputs {
        name,
        id: "22222222-2222-4222-8222-222222222222",
        session: "33333333-3333-4333-8333-333333333333",
        facts: &facts(),
        counts: Counts::default(),
        duration_s: None,
        now_ms: 1_800_000_000_000,
        event_uuid: EVENT_UUID,
        request_id: "44444444-4444-4444-8444-444444444444",
    })
}

/// One request read from a socket: the head and the body, as text.
fn read_request(stream: &mut TcpStream) -> String {
    let mut data = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream.read(&mut chunk).unwrap_or(0);
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
        let text = String::from_utf8_lossy(&data).into_owned();
        if let Some((head, body)) = text.split_once("\r\n\r\n") {
            let length = head
                .lines()
                .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok()))
                .unwrap_or(0);
            if body.len() >= length {
                break;
            }
        }
    }
    String::from_utf8_lossy(&data).into_owned()
}

/// A server that answers its first request with `status` and `body` (after `delay`), and tells the
/// test what it received. `None` for a status makes it close without a word.
fn serve(status: u16, body: String, delay: Duration) -> (String, Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/i/v1/analytics/events", listener.local_addr().unwrap());
    let (seen, received) = channel();
    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else { return };
        let _ = seen.send(read_request(&mut stream));
        std::thread::sleep(delay);
        let reply = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        // The client may have given up already.
        let _ = stream.write_all(reply.as_bytes());
    });
    (url, received)
}

fn results(result: &str) -> String {
    json!({ "results": { EVENT_UUID: { "result": result } } }).to_string()
}

fn sender_to(url: String) -> Sender {
    Sender::new(url, TEST_TOKEN.to_owned())
}

#[test]
fn a_200_with_an_ok_or_warning_result_is_a_success() {
    for result in ["ok", "warning"] {
        let (url, _) = serve(200, results(result), Duration::ZERO);
        assert_eq!(sender_to(url).send(&request(EventName::Started), LIMIT), Ok(()), "{result}");
    }
}

#[test]
fn a_200_with_a_drop_or_retry_result_is_dropped() {
    for result in ["drop", "retry", "other"] {
        let (url, _) = serve(200, results(result), Duration::ZERO);
        assert_eq!(sender_to(url).send(&request(EventName::Started), LIMIT), Err("dropped".into()), "{result}");
    }
}

#[test]
fn a_200_without_a_result_for_the_event_or_without_json_is_dropped() {
    for body in [json!({ "results": {} }).to_string(), json!({ "results": { "other": { "result": "ok" } } }).to_string(), "not json".to_owned(), String::new()]
    {
        let (url, _) = serve(200, body.clone(), Duration::ZERO);
        assert_eq!(sender_to(url).send(&request(EventName::Daily), LIMIT), Err("dropped".into()), "{body:?}");
    }
}

#[test]
fn another_status_is_named_by_its_number() {
    for (status, body) in
        [(401, json!({ "error": "invalid_api_token" }).to_string()), (400, String::new()), (402, String::new()), (500, "oops".to_owned()), (503, String::new())]
    {
        let (url, _) = serve(status, body, Duration::ZERO);
        assert_eq!(sender_to(url).send(&request(EventName::Started), LIMIT), Err(format!("status_{status}")));
    }
}

#[test]
fn a_refused_connection_is_offline() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/i/v1/analytics/events", listener.local_addr().unwrap());
    drop(listener);
    assert_eq!(sender_to(url).send(&request(EventName::Started), LIMIT), Err("offline".into()));
}

#[test]
fn a_server_that_does_not_answer_in_time_is_a_timeout_within_the_limit() {
    let (url, _) = serve(200, results("ok"), Duration::from_secs(10));
    let began = std::time::Instant::now();
    assert_eq!(sender_to(url).send(&request(EventName::Closed), Duration::from_millis(300)), Err("timeout".into()));
    assert!(began.elapsed() < Duration::from_secs(3), "took {:?}", began.elapsed());
}

#[test]
fn the_request_carries_the_bearer_token_the_headers_and_the_body() {
    let (url, received) = serve(200, results("ok"), Duration::ZERO);
    let event = request(EventName::Started);
    assert_eq!(sender_to(url).send(&event, LIMIT), Ok(()));
    let text = received.recv_timeout(LIMIT).unwrap();
    let (head, body) = text.split_once("\r\n\r\n").unwrap();
    let head = head.to_ascii_lowercase();
    assert!(head.starts_with("post /i/v1/analytics/events http/1.1"), "{head}");
    assert!(head.contains(&format!("authorization: bearer {}", TEST_TOKEN.to_ascii_lowercase())), "{head}");
    for (name, value) in &event.headers {
        assert!(head.contains(&format!("{}: {}", name.to_ascii_lowercase(), value.to_ascii_lowercase())), "{name} in {head}");
    }
    assert_eq!(body, event.body);
}

#[test]
fn a_debug_print_of_a_sender_does_not_hold_the_token_or_the_address() {
    let printed = format!("{:?}", Sender::new("https://example.test/secret-path".into(), TEST_TOKEN.into()));
    assert!(!printed.contains(TEST_TOKEN) && !printed.contains("secret-path"), "{printed}");
}

#[test]
fn a_build_has_a_sender_only_with_a_non_empty_token() {
    // The tests are compiled without the token, as a source build is: no sender.
    assert_eq!(sender().is_some(), TOKEN.is_some_and(|token| !token.is_empty()));
}

// --- the moments, over a stand-in owner thread ---------------------------------------------------

/// What a recording hook was asked to send, with the limit.
type Sent = Arc<Mutex<Vec<(UsageRequest, Duration)>>>;

/// A hook that keeps what it is asked to send, with the limit.
fn recording() -> (UsageHook, Sent) {
    let sent = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&sent);
    let hook: UsageHook = Arc::new(move |request: &UsageRequest, limit: Duration| {
        kept.lock().unwrap().push((request.clone(), limit));
        Ok(())
    });
    (hook, sent)
}

/// The owner thread: a shell on a folder that answers the requests of the channel until it is gone.
fn owner(dir: &std::path::Path, hook: Option<UsageHook>) -> Channel<Envelope> {
    let (session, _) = Session::with_config_dir(dir, Arc::new(MemoryStore::new()));
    let mut app = AppShell::new(session, Services { usage: hook, ..Services::default() });
    let (requests, inbox) = channel::<Envelope>();
    std::thread::spawn(move || {
        for envelope in inbox {
            let reply = app.answer(&envelope.request);
            // The asker may have gone.
            let _ = envelope.reply.send(reply);
        }
    });
    requests
}

fn launch(scripted: bool) -> Launch {
    Launch { test_build: true, scripted, facts: facts(), ..Launch::default() }
}

fn wait_for(sent: &Sent, count: usize) -> Vec<(UsageRequest, Duration)> {
    for _ in 0..200 {
        if sent.lock().unwrap().len() >= count {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    sent.lock().unwrap().clone()
}

fn names(sent: &[(UsageRequest, Duration)]) -> Vec<String> {
    sent.iter().map(|(request, _)| request.event.clone()).collect()
}

#[test]
fn launch_sends_started_off_the_caller_and_close_sends_closed_once_within_two_seconds() {
    let dir = tempfile::tempdir().unwrap();
    let (hook, sent) = recording();
    let usage = Arc::new(Usage::with_launch(owner(dir.path(), Some(Arc::clone(&hook))), Some(hook), launch(false)));
    usage.launch();
    assert_eq!(names(&wait_for(&sent, 1)), ["app_started"]);
    // The run has an attempt: the tick, an hour later or after a wake, sends nothing yet.
    usage.tick();
    usage.close();
    usage.close();
    let all = wait_for(&sent, 2);
    assert_eq!(names(&all), ["app_started", "app_closed"]);
    let (closed, limit) = &all[1];
    assert!(*limit <= CLOSE_LIMIT, "{limit:?}");
    let body: Value = serde_json::from_str(&closed.body).unwrap();
    assert!(body["batch"][0]["properties"]["duration_s"].is_u64());
}

#[test]
fn a_scripted_run_sends_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (hook, sent) = recording();
    let usage = Arc::new(Usage::with_launch(owner(dir.path(), Some(Arc::clone(&hook))), Some(hook), Launch { test_build: false, ..launch(true) }));
    usage.launch();
    usage.tick();
    usage.close();
    std::thread::sleep(Duration::from_millis(300));
    assert!(sent.lock().unwrap().is_empty());
}

#[test]
fn a_build_without_a_hook_does_nothing_and_asks_the_owner_nothing() {
    let (requests, inbox) = channel::<Envelope>();
    let usage = Arc::new(Usage::with_launch(requests, None, launch(false)));
    usage.launch();
    usage.tick();
    usage.close();
    std::thread::sleep(Duration::from_millis(100));
    assert!(inbox.try_recv().is_err());
}

#[test]
fn a_failed_send_is_dropped_and_not_tried_again() {
    let dir = tempfile::tempdir().unwrap();
    let attempts = Arc::new(Mutex::new(0usize));
    let counted = Arc::clone(&attempts);
    let hook: UsageHook = Arc::new(move |_: &UsageRequest, _: Duration| {
        *counted.lock().unwrap() += 1;
        Err("offline".to_owned())
    });
    let usage = Arc::new(Usage::with_launch(owner(dir.path(), Some(Arc::clone(&hook))), Some(hook), launch(false)));
    usage.launch();
    for _ in 0..200 {
        if *attempts.lock().unwrap() > 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    // The attempt counts (U9): the next tick, minutes later, sends no second one.
    usage.tick();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(*attempts.lock().unwrap(), 1);
}
