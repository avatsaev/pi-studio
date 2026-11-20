//! The navigation rule: the main frame may load only the app's own origin.
//!
//! The origin's form differs per platform: `tauri://localhost` on macOS and Linux,
//! `http://tauri.localhost` (or `https://`, when the window is set to use it) on Windows. In a
//! development build the dev server's origin is allowed too. Everything else (another site, a
//! `file:` URL, `about:blank`, a look-alike host) is refused. Frames are not covered.

/// The parts of a URL the rule looks at.
struct Origin<'a> {
    scheme: &'a str,
    host: &'a str,
    port: Option<&'a str>,
}

/// Split `scheme://host[:port]` off a URL. `None` when it has no authority or has user info.
fn origin(url: &str) -> Option<Origin<'_>> {
    let (scheme, rest) = url.split_once("://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if scheme.is_empty() || authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = match authority.rsplit_once(':') {
        // A bracketed IPv6 literal ends in `]`; its colons are not a port separator.
        Some((host, port)) if !port.contains(']') => (host, Some(port)),
        _ => (authority, None),
    };
    Some(Origin { scheme, host, port })
}

/// Whether the main frame may load `url`. `dev_origin` is the dev server's URL in a development
/// build and `None` otherwise.
pub fn allows(url: &str, dev_origin: Option<&str>) -> bool {
    let Some(target) = origin(url) else { return false };
    let own = target.port.is_none()
        && matches!(
            (target.scheme.to_ascii_lowercase().as_str(), target.host.to_ascii_lowercase().as_str()),
            ("tauri", "localhost") | ("http" | "https", "tauri.localhost")
        );
    own || dev_origin
        .and_then(origin)
        .is_some_and(|dev| dev.scheme.eq_ignore_ascii_case(target.scheme) && dev.host.eq_ignore_ascii_case(target.host) && dev.port == target.port)
}

/// What a log line may say about a refused URL: scheme and host, never the path or query.
pub fn describe(url: &str) -> String {
    match origin(url) {
        Some(o) => format!("{}://{}", o.scheme, o.host),
        None => url.split_once(':').map_or("unparsed", |(scheme, _)| scheme).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_app_origin_on_each_platform() {
        for url in ["tauri://localhost", "tauri://localhost/", "tauri://localhost/index.html?x=1#y", "http://tauri.localhost/", "https://tauri.localhost/a"] {
            assert!(allows(url, None), "{url}");
        }
    }

    #[test]
    fn accepts_the_dev_origin_only_when_given() {
        assert!(!allows("http://localhost:5173/", None));
        assert!(allows("http://localhost:5173/x", Some("http://localhost:5173/")));
        assert!(!allows("http://localhost:5174/", Some("http://localhost:5173/")));
        assert!(!allows("http://localhost/", Some("http://localhost:5173/")));
        assert!(!allows("https://localhost:5173/", Some("http://localhost:5173/")));
    }

    #[test]
    fn refuses_everything_else() {
        let dev = Some("http://localhost:5173/");
        for url in [
            "https://example.com",
            "file:///etc/passwd",
            "about:blank",
            "data:text/html,hi",
            "javascript:alert(1)",
            "http://tauri.localhost.evil.test/",
            "https://evil.test/tauri.localhost",
            "http://tauri.localhost@evil.test/",
            "http://evil.test@tauri.localhost/",
            "http://tauri.localhost:8080/",
            "tauri://localhost:1/",
            "tauri://localhost.evil.test",
            "",
        ] {
            assert!(!allows(url, dev), "{url}");
        }
    }

    #[test]
    fn describes_scheme_and_host_only() {
        assert_eq!(describe("https://example.com:8443/secret?token=1#f"), "https://example.com");
        assert_eq!(describe("file:///etc/passwd"), "file");
        assert_eq!(describe("about:blank"), "about");
        assert_eq!(describe("https://u:p@example.com/"), "https");
    }
}
