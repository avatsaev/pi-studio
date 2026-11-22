//! Who may upgrade: the one token, the page's origin, this host, once.

use std::sync::atomic::{AtomicBool, Ordering::SeqCst};

use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request};
use tokio_tungstenite::tungstenite::http::StatusCode;

use crate::error::{ErrorCode, ProxyError};
use crate::limits::TOKEN_BYTES;

/// Why an upgrade was not accepted. The page is told only "403"; the reason is for the log and, when
/// the page never gets in, for `lastError`. It never holds the token, the origin or the host the
/// client sent: they are the client's words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Refusal {
    Token,
    Origin,
    Host,
    Used,
    /// Not an upgrade request, or the connection broke in the middle of it.
    Failed,
    /// The request took longer than the upgrade limit.
    Slow,
}

impl Refusal {
    /// Whether the gate said no (as against a connection that never made a request).
    pub(super) const fn is_gate(self) -> bool {
        matches!(self, Self::Token | Self::Origin | Self::Host | Self::Used)
    }

    pub(super) const fn why(self) -> &'static str {
        match self {
            Self::Token => "the path is not the token",
            Self::Origin => "the origin is not the page's",
            Self::Host => "the host is not the loopback address",
            Self::Used => "the token was already used",
            Self::Failed => "the request is not a valid WebSocket upgrade",
            Self::Slow => "the upgrade took too long",
        }
    }
}

/// The three checks of § 3, and the single use.
pub(super) struct Gate {
    token: String,
    origin: String,
    host: String,
    claimed: AtomicBool,
}

/// The same bytes, compared without stopping at the first difference.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let difference = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(difference) == 0
}

/// A bare 403: it does not say which check failed.
pub(super) fn forbidden() -> ErrorResponse {
    let mut refused = ErrorResponse::new(None);
    *refused.status_mut() = StatusCode::FORBIDDEN;
    refused
}

impl Gate {
    pub(super) fn new(token: String, origin: &str, port: u16) -> Self {
        Self { token, origin: origin.to_owned(), host: format!("127.0.0.1:{port}"), claimed: AtomicBool::new(false) }
    }

    /// `Ok` when the request is the page's. All three checks are made before any decides, so that
    /// the time taken says nothing about which failed; the token is claimed only by a request that
    /// passes all three (a wrong guess does not use it up), and only once ([`Gate::release`] gives
    /// it back when the claimant's upgrade then fails).
    pub(super) fn check(&self, request: &Request) -> Result<(), Refusal> {
        let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok());
        let token = request.uri().path().strip_prefix('/').is_some_and(|path| constant_time_eq(path.as_bytes(), self.token.as_bytes()));
        let origin = header("origin") == Some(self.origin.as_str());
        let host = header("host") == Some(self.host.as_str());
        let refusal = match (token, origin, host) {
            (false, _, _) => Refusal::Token,
            (_, false, _) => Refusal::Origin,
            (_, _, false) => Refusal::Host,
            _ if self.claimed.swap(true, SeqCst) => Refusal::Used,
            _ => return Ok(()),
        };
        Err(refusal)
    }

    /// Gives the token back: the request that claimed it did not become a WebSocket.
    pub(super) fn release(&self) {
        self.claimed.store(false, SeqCst);
    }
}

/// A fresh token: 256 random bits as 64 hexadecimal digits.
pub(super) fn mint_token() -> Result<String, ProxyError> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| ProxyError::new(ErrorCode::ProxyFailed, "The system gave no random bytes for the local connection's token."))?;
    Ok(hex(&bytes))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 15)]));
    }
    out
}

#[cfg(test)]
mod tests {
    use tokio_tungstenite::tungstenite::http::Request as HttpRequest;

    use super::*;

    fn request(path: &str, origin: Option<&str>, host: Option<&str>) -> Request {
        let mut builder = HttpRequest::builder().uri(path);
        if let Some(origin) = origin {
            builder = builder.header("Origin", origin);
        }
        if let Some(host) = host {
            builder = builder.header("Host", host);
        }
        builder.body(()).unwrap()
    }

    fn gate() -> Gate {
        Gate::new("ab".repeat(32), "tauri://localhost", 4000)
    }

    #[test]
    fn tokens_are_long_random_and_compared_whole() {
        let (a, b) = (mint_token().unwrap(), mint_token().unwrap());
        assert_eq!((a.len(), b.len()), (64, 64));
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(a, b);
        assert!(constant_time_eq(a.as_bytes(), a.as_bytes()));
        assert!(!constant_time_eq(a.as_bytes(), b.as_bytes()));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert_eq!(hex(&[0, 15, 16, 255]), "000f10ff");
    }

    #[test]
    fn each_check_refuses_on_its_own_and_the_token_is_claimed_by_a_full_pass_only() {
        let g = gate();
        let path = format!("/{}", "ab".repeat(32));
        let origin = Some("tauri://localhost");
        let host = Some("127.0.0.1:4000");
        assert_eq!(g.check(&request(&format!("/{}", "0".repeat(64)), origin, host)), Err(Refusal::Token));
        assert_eq!(g.check(&request(&format!("/{}", "ab".repeat(31)), origin, host)), Err(Refusal::Token), "a token one byte short");
        assert_eq!(g.check(&request("/", origin, host)), Err(Refusal::Token));
        assert_eq!(g.check(&request(&path, Some("http://evil.example"), host)), Err(Refusal::Origin));
        assert_eq!(g.check(&request(&path, Some("tauri://localhost.evil.example"), host)), Err(Refusal::Origin), "a longer origin");
        assert_eq!(g.check(&request(&path, None, host)), Err(Refusal::Origin));
        assert_eq!(g.check(&request(&path, origin, Some("127.0.0.1:4001"))), Err(Refusal::Host));
        assert_eq!(g.check(&request(&path, origin, Some("localhost:4000"))), Err(Refusal::Host));
        assert_eq!(g.check(&request(&path, origin, None)), Err(Refusal::Host));
        // None of that used the token.
        assert_eq!(g.check(&request(&path, origin, host)), Ok(()));
        assert_eq!(g.check(&request(&path, origin, host)), Err(Refusal::Used));
        g.release();
        assert_eq!(g.check(&request(&path, origin, host)), Ok(()), "a released token works again");
    }

    #[test]
    fn a_refusal_is_a_bare_403() {
        let refused = forbidden();
        assert_eq!(refused.status(), StatusCode::FORBIDDEN);
        assert!(refused.body().is_none());
    }
}
