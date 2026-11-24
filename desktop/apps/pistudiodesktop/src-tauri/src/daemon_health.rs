//! The version a running local daemon reports: `GET /api/health` answers `{"status": "ok", "version": "<x.y.z>"}` without
//! authentication. The supervisor asks it of a daemon it found running, to tell an old one (an npm daemon from before
//! `minDaemonVersion`) from a current one: `pi-studio daemon status` carries no version.
//!
//! One plain HTTP/1.0 request to the daemon's own address (the loopback, or what the daemon says it listens on), a few
//! seconds at most, a few kilobytes at most. HTTP/1.0 so that the answer is never chunked.

use std::io::{Read as _, Write as _};
use std::net::{TcpStream, ToSocketAddrs as _};
use std::time::Duration;

use serde_json::Value;

/// How long the connect, the write and each read may take.
const LIMIT: Duration = Duration::from_secs(2);

/// The most bytes of an answer that are read: a health body is about 40.
const MAX_BYTES: u64 = 16 * 1024;

/// The version the daemon at `host:port` reports, or `None` when it does not answer, answers anything but 200, or has no
/// version in its answer.
pub fn version(host: &str, port: u16) -> Option<String> {
    let address = (host, port).to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&address, LIMIT).ok()?;
    stream.set_read_timeout(Some(LIMIT)).ok()?;
    stream.set_write_timeout(Some(LIMIT)).ok()?;
    stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n").ok()?;
    let mut answer = Vec::new();
    // A read that times out after some bytes still leaves what arrived: the body is short and the daemon closes after it.
    let _ = stream.take(MAX_BYTES).read_to_end(&mut answer);
    parse(&String::from_utf8_lossy(&answer))
}

/// The `version` of a `200` answer whose body is a JSON object (the local read above, and the SSH session's over a channel).
pub(crate) fn parse(answer: &str) -> Option<String> {
    let (head, body) = answer.split_once("\r\n\r\n")?;
    let status = head.lines().next()?.split_whitespace().nth(1)?;
    if status != "200" {
        return None;
    }
    match serde_json::from_str::<Value>(body.trim()).ok()? {
        Value::Object(map) => map.get("version")?.as_str().map(str::to_owned),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn the_version_of_a_200_answer_is_read() {
        let ok = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\",\"version\":\"0.0.131\"}";
        assert_eq!(parse(ok).as_deref(), Some("0.0.131"));
        assert_eq!(parse("HTTP/1.0 200 OK\r\n\r\n {\"version\":\"1.2.3\"}\n").as_deref(), Some("1.2.3"));
    }

    #[test]
    fn anything_else_is_no_version() {
        for answer in [
            "",
            "HTTP/1.1 200 OK\r\n\r\n{\"status\":\"ok\"}",
            "HTTP/1.1 200 OK\r\n\r\n{\"version\":7}",
            "HTTP/1.1 200 OK\r\n\r\n[\"0.0.1\"]",
            "HTTP/1.1 200 OK\r\n\r\nnot json",
            "HTTP/1.1 503 Unavailable\r\n\r\n{\"version\":\"0.0.131\"}",
            "HTTP/1.1 200 OK",
        ] {
            assert_eq!(parse(answer), None, "{answer:?}");
        }
    }

    fn serve(answer: &'static str) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0u8; 1024];
                let n = stream.read(&mut request).unwrap_or(0);
                // The request names the endpoint and asks for no chunking.
                assert!(String::from_utf8_lossy(&request[..n]).starts_with("GET /api/health HTTP/1.0\r\n"));
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        port
    }

    #[test]
    fn a_daemon_on_the_loopback_is_asked_and_answers() {
        let port = serve("HTTP/1.1 200 OK\r\nContent-Length: 38\r\n\r\n{\"status\":\"ok\",\"version\":\"0.0.126\"}");
        assert_eq!(version("127.0.0.1", port).as_deref(), Some("0.0.126"));
    }

    #[test]
    fn nothing_listening_is_no_version() {
        // Bind and drop: the port is free and refuses.
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert_eq!(version("127.0.0.1", port), None);
    }
}
