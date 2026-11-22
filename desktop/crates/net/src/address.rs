//! The address a dial opens, checked before any network use.

use tokio_tungstenite::tungstenite::http::Uri;

use crate::error::{DialError, ErrorCode};

const DEFAULT_WS_PORT: u16 = 80;
const DEFAULT_WSS_PORT: u16 = 443;

/// A `ws` or `wss` address taken apart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Target {
    /// `wss`: the socket carries TLS.
    pub secure: bool,
    /// The host without the brackets of an IPv6 literal: what is resolved and what the
    /// certificate is checked against.
    pub host: String,
    /// The port, the scheme's default when the address names none.
    pub port: u16,
    /// What a browser would send as `Host`: the port is left out when it is the scheme's default.
    pub host_header: String,
    /// The request target: path and query, at least `/`.
    pub path_and_query: String,
}

impl Target {
    /// `host:port` as a message names it (an IPv6 literal keeps its brackets).
    pub(crate) fn display(&self) -> String {
        if self.host.contains(':') { format!("[{}]:{}", self.host, self.port) } else { format!("{}:{}", self.host, self.port) }
    }
}

fn invalid(message: &str) -> DialError {
    DialError::new(ErrorCode::InvalidAddress, message)
}

/// Takes `url` apart. A scheme other than `ws` or `wss`, user information, a missing host and
/// anything that is not a URL are `invalid_address`. No message repeats `url`: a caller may have
/// put a password in it.
pub(crate) fn parse(url: &str) -> Result<Target, DialError> {
    // A browser refuses an address with a fragment; `Uri` would drop it silently.
    if url.contains('#') {
        return Err(invalid("The daemon's address must not contain a fragment (#)."));
    }
    let uri: Uri = url.parse().map_err(|_| invalid("The daemon's address is not a valid WebSocket address (ws://host:port or wss://host:port)."))?;
    let secure = match uri.scheme_str() {
        Some(s) if s.eq_ignore_ascii_case("ws") => false,
        Some(s) if s.eq_ignore_ascii_case("wss") => true,
        _ => return Err(invalid("Only ws: and wss: addresses can be opened.")),
    };
    let authority = uri.authority().ok_or_else(|| invalid("The daemon's address names no host."))?;
    // `Uri` accepts `user:secret@host`; a daemon's address carries no credential, the password is
    // offered in the upgrade.
    if authority.as_str().contains('@') {
        return Err(invalid(
            "The daemon's address must not contain a user name or a password: the password is kept in the secret store and sent in the upgrade.",
        ));
    }
    let raw_host = authority.host();
    let host = raw_host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(raw_host);
    if host.is_empty() {
        return Err(invalid("The daemon's address names no host."));
    }
    // `Uri` lets `host:notaport` through with no port; a browser refuses it. An empty port (`host:`)
    // means the default.
    let tail = authority.as_str().strip_prefix(raw_host).unwrap_or("");
    if authority.port_u16().is_none() && !(tail.is_empty() || tail == ":") {
        return Err(invalid("The daemon's address has a port that is not a number from 0 to 65535."));
    }
    let default_port = if secure { DEFAULT_WSS_PORT } else { DEFAULT_WS_PORT };
    let host_header = match authority.port_u16() {
        Some(p) if p != default_port => format!("{raw_host}:{p}"),
        _ => raw_host.to_owned(),
    };
    let path_and_query = uri.path_and_query().map_or("", |p| p.as_str());
    Ok(Target {
        secure,
        host: host.to_owned(),
        port: authority.port_u16().unwrap_or(default_port),
        host_header,
        path_and_query: if path_and_query.is_empty() || path_and_query.starts_with('?') { format!("/{path_and_query}") } else { path_and_query.to_owned() },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_address_with_port() {
        let t = parse("ws://192.168.1.5:6767").unwrap();
        assert_eq!(t, Target { secure: false, host: "192.168.1.5".into(), port: 6767, host_header: "192.168.1.5:6767".into(), path_and_query: "/".into() });
        assert_eq!(t.display(), "192.168.1.5:6767");
    }

    #[test]
    fn default_ports_are_the_schemes_and_leave_the_host_header() {
        let ws = parse("ws://daemon.example").unwrap();
        assert_eq!((ws.port, ws.host_header.as_str()), (80, "daemon.example"));
        let wss = parse("wss://daemon.example").unwrap();
        assert!(wss.secure);
        assert_eq!((wss.port, wss.host_header.as_str()), (443, "daemon.example"));
        // A browser omits the port when it is the scheme's default, even if the address spells it.
        assert_eq!(parse("ws://daemon.example:80").unwrap().host_header, "daemon.example");
        assert_eq!(parse("wss://daemon.example:443").unwrap().host_header, "daemon.example");
        // But not another scheme's default.
        assert_eq!(parse("ws://daemon.example:443").unwrap().host_header, "daemon.example:443");
    }

    #[test]
    fn ipv6_literal_loses_its_brackets_for_resolution_and_keeps_them_in_messages() {
        let t = parse("wss://[::1]:7000/x").unwrap();
        assert_eq!(t.host, "::1");
        assert_eq!(t.host_header, "[::1]:7000");
        assert_eq!(t.display(), "[::1]:7000");
    }

    #[test]
    fn path_and_query_are_kept_and_the_empty_path_is_a_slash() {
        assert_eq!(parse("ws://h:1/a/b?c=d").unwrap().path_and_query, "/a/b?c=d");
        assert_eq!(parse("ws://h:1").unwrap().path_and_query, "/");
        assert_eq!(parse("ws://h:1?c=d").unwrap().path_and_query, "/?c=d");
    }

    #[test]
    fn an_empty_port_is_the_default() {
        assert_eq!(parse("ws://h:/x").unwrap().port, 80);
    }

    #[test]
    fn scheme_is_case_insensitive() {
        assert!(!parse("WS://h:1").unwrap().secure);
        assert!(parse("WSS://h:1").unwrap().secure);
    }

    #[test]
    fn other_schemes_are_refused() {
        for url in ["http://h:1", "https://h:1", "ftp://h:1", "tcp://h:1", "h:1", "//h:1", "/path", ""] {
            let e = parse(url).unwrap_err();
            assert_eq!(e.code, ErrorCode::InvalidAddress, "{url}");
        }
    }

    #[test]
    fn user_information_is_refused_and_never_repeated() {
        for url in ["ws://user@h:1", "ws://user:MARKER-secret@h:1/x", "wss://:MARKER-secret@h", "wss://a:b@[::1]:2"] {
            let e = parse(url).unwrap_err();
            assert_eq!(e.code, ErrorCode::InvalidAddress, "{url}");
            assert!(!e.message.contains("MARKER") && !e.message.contains(url), "{}", e.message);
        }
    }

    #[test]
    fn nonsense_is_refused_without_echoing_it() {
        for url in ["ws://", "ws://h:notaport", "ws://h:99999", "ws://h :1", "ws://h/\u{0}", "ws://h/#frag", "ws://h:1x"] {
            assert_eq!(parse(url).unwrap_err().code, ErrorCode::InvalidAddress, "{url:?}");
        }
    }
}
