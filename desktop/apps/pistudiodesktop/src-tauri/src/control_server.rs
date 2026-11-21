//! Loopback JSON-lines control server: one request per line, one reply per line.
//!
//! ```text
//! {"id": 1, "method": "auth", "params": {"token": "<64 hex>"}}
//! {"id": 1, "ok": true, "result": {"authenticated": true}}
//! {"id": 2, "method": "engine.execute", "params": {"command": "settings.get"}}
//! {"id": 2, "ok": true, "result": {"autoStartLocalDaemon": true, "cliPath": null}}
//! ```
//!
//! Socket threads only parse and forward: each request crosses a channel to the thread that
//! owns the shell, the same channel the webview's requests take.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::mpsc::Sender;
use std::time::Duration;

use pistudiodesktop_shell::{Envelope, Request};
use serde_json::{Value, json};

/// Longest request line accepted. A longer one is an error, not an allocation.
pub const MAX_REQUEST_BYTES: usize = 1 << 20;
const REPLY_DEADLINE: Duration = Duration::from_secs(60);

/// Bind the listener and settle the token. Loopback only: never bind another interface.
pub fn bind(port: u16, token_file: Option<&Path>) -> Result<(TcpListener, String), String> {
    let token = match token_file {
        Some(path) => read_or_create_token(path)?,
        None => {
            let token = fresh_token()?;
            eprintln!("pistudiodesktop: control token for this launch: {token}");
            token
        }
    };
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|e| format!("cannot listen on 127.0.0.1:{port}: {e}"))?;
    Ok((listener, token))
}

/// Serve `listener`, forwarding each authenticated request on `tx`.
pub fn start(listener: TcpListener, token: String, tx: Sender<Envelope>) {
    if let Ok(addr) = listener.local_addr() {
        eprintln!("pistudiodesktop: control server listening on {addr}");
    }
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (tx, token) = (tx.clone(), token.clone());
            std::thread::spawn(move || serve(stream, &token, &tx));
        }
    });
}

fn serve(stream: TcpStream, token: &str, tx: &Sender<Envelope>) {
    let Ok(read) = stream.try_clone() else { return };
    let mut reader = BufReader::new(read);
    let mut out = stream;
    let mut authenticated = false;
    loop {
        let line = match read_line(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                let _ = write_reply(&mut out, &json!({"id": null, "ok": false, "error": error}));
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        if !authenticated {
            // The first frame must authenticate; nothing is dispatched before it does.
            authenticated = method == "auth" && params.get("token").and_then(Value::as_str).is_some_and(|given| same(given, token));
            let reply = if authenticated {
                json!({"id": id, "ok": true, "result": {"authenticated": true}})
            } else {
                json!({"id": id, "ok": false, "error": "authentication required"})
            };
            if write_reply(&mut out, &reply).is_err() || !authenticated {
                break;
            }
            continue;
        }
        let (envelope, reply) = Envelope::new(Request::Control { method: method.to_string(), params });
        if tx.send(envelope).is_err() {
            break;
        }
        let mut reply = reply.recv_timeout(REPLY_DEADLINE).unwrap_or_else(|_| json!({"ok": false, "error": "timeout: no reply in 60s"}));
        if let Some(fields) = reply.as_object_mut() {
            fields.insert("id".into(), id);
        }
        if write_reply(&mut out, &reply).is_err() {
            break;
        }
    }
}

fn write_reply(out: &mut impl Write, reply: &Value) -> std::io::Result<()> {
    writeln!(out, "{reply}")?;
    out.flush()
}

/// The next line, `None` at end of stream.
fn read_line(reader: &mut impl BufRead) -> Result<Option<String>, String> {
    let mut buf = Vec::new();
    let read = reader.by_ref().take(MAX_REQUEST_BYTES as u64 + 1).read_until(b'\n', &mut buf).map_err(|e| e.to_string())?;
    if read == 0 {
        return Ok(None);
    }
    if buf.len() > MAX_REQUEST_BYTES {
        return Err(format!("request exceeds {MAX_REQUEST_BYTES} bytes"));
    }
    String::from_utf8(buf).map(Some).map_err(|_| "request is not UTF-8".to_string())
}

/// Compare every byte, so the time taken does not say where two tokens differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

fn fresh_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("no random source for the control token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn read_or_create_token(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => {
            let token = text.trim();
            if token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()) {
                Ok(token.to_ascii_lowercase())
            } else {
                Err(format!("{}: expected 64 hexadecimal characters", path.display()))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let token = fresh_token()?;
            write_private(path, &token).map_err(|e| format!("{}: {e}", path.display()))?;
            Ok(token)
        }
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// A new file only the user can read (0600 on Unix; on Windows keep it in a private folder).
fn write_private(path: &Path, token: &str) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    options.open(path)?.write_all(token.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in for the owner thread: answers every request with its method name.
    fn serve_echo() -> (std::net::SocketAddr, String) {
        let (listener, token) = bind(0, None).unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        start(listener, token.clone(), tx);
        std::thread::spawn(move || {
            for envelope in rx {
                let Request::Control { method, .. } = envelope.request else { continue };
                let _ = envelope.reply.send(json!({"ok": true, "result": method}));
            }
        });
        (addr, token)
    }

    /// One request and its reply; `None` once the server has closed the connection.
    fn call(stream: &mut TcpStream, reader: &mut impl BufRead, request: Value) -> Option<Value> {
        writeln!(stream, "{request}").ok()?;
        let mut line = String::new();
        let read = reader.read_line(&mut line).unwrap_or(0);
        (read > 0).then(|| serde_json::from_str(&line).unwrap())
    }

    #[test]
    fn nothing_is_dispatched_before_auth_and_a_wrong_token_closes_the_connection() {
        let (addr, _token) = serve_echo();
        let mut stream = TcpStream::connect(addr).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let refused = call(&mut stream, &mut reader, json!({"id": 1, "method": "ui.inspect"})).unwrap();
        assert_eq!(refused, json!({"id": 1, "ok": false, "error": "authentication required"}));
        assert_eq!(call(&mut stream, &mut reader, json!({"id": 2, "method": "ui.inspect"})), None, "the connection is closed");
    }

    #[test]
    fn an_authenticated_connection_gets_one_reply_per_request_with_its_id() {
        let (addr, token) = serve_echo();
        let mut stream = TcpStream::connect(addr).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let ok = call(&mut stream, &mut reader, json!({"id": "a", "method": "auth", "params": {"token": token}})).unwrap();
        assert_eq!(ok["result"]["authenticated"], true);
        let reply = call(&mut stream, &mut reader, json!({"id": 7, "method": "ui.inspect"})).unwrap();
        assert_eq!(reply, json!({"id": 7, "ok": true, "result": "ui.inspect"}));
    }

    #[test]
    fn a_token_file_is_created_once_and_reused() {
        let path = std::env::temp_dir().join(format!("pistudiodesktop-token-test-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let first = read_or_create_token(&path).unwrap();
        assert_eq!(first.len(), 64);
        assert_eq!(read_or_create_token(&path).unwrap(), first);
        std::fs::write(&path, "short").unwrap();
        assert!(read_or_create_token(&path).is_err());
        std::fs::remove_file(&path).unwrap();
    }
}
