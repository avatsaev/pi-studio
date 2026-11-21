//! Links that may leave the app. A link in a message is written by an agent, so what the page
//! hands over is untrusted: only `http`, `https` and `mailto` URLs of reasonable length reach the
//! system's default application, and a refusal says why without repeating the URL.

use std::fmt;

use crate::Services;

/// The longest URL, in characters, that is handed to the system.
pub const MAX_URL_CHARS: usize = 8192;

/// The schemes that may leave the app. Compared without case.
const SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// The longest scheme a refusal names. A longer one is reported as no scheme: a log line is not a
/// place to echo what an attacker chose.
const MAX_LOGGED_SCHEME: usize = 32;

/// Why a URL is not handed to the system. Its text is safe to log: it holds the scheme at most,
/// never the rest of the URL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// More than [`MAX_URL_CHARS`] characters.
    TooLong,
    /// Whitespace at either end, or a control character anywhere. Neither belongs in a URL, and
    /// a system opener may read them differently than this check does.
    Malformed,
    /// No scheme, or one that is not a plain scheme name (see [`MAX_LOGGED_SCHEME`]).
    NoScheme,
    /// A scheme that may not leave the app, as written (`file`, `javascript`, a custom one).
    Scheme(String),
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLong => write!(f, "refused a link longer than {MAX_URL_CHARS} characters"),
            Self::Malformed => f.write_str("refused a link with surrounding whitespace or a control character"),
            Self::NoScheme => f.write_str("refused a link without a plain scheme"),
            Self::Scheme(scheme) => write!(f, "refused a link with the scheme `{scheme}`"),
        }
    }
}

/// The scheme of `url` as RFC 3986 spells it (a letter, then letters, digits, `+`, `-` or `.`),
/// up to the first colon. `None` when there is no colon or the text before it is not a scheme.
fn scheme(url: &str) -> Option<&str> {
    let (scheme, _) = url.split_once(':')?;
    let mut chars = scheme.chars();
    let plain = chars.next().is_some_and(|c| c.is_ascii_alphabetic()) && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    (plain && scheme.len() <= MAX_LOGGED_SCHEME).then_some(scheme)
}

/// Whether `url` may be handed to the system: at most [`MAX_URL_CHARS`] characters, no
/// whitespace at either end, no control character, and a scheme of `http`, `https` or `mailto`.
pub fn check(url: &str) -> Result<(), Refusal> {
    // Counting stops one past the cap, so an enormous URL costs no more than a long one.
    if url.chars().nth(MAX_URL_CHARS).is_some() {
        return Err(Refusal::TooLong);
    }
    let edge_space = url.chars().next().is_some_and(char::is_whitespace) || url.chars().next_back().is_some_and(char::is_whitespace);
    if edge_space || url.chars().any(char::is_control) {
        return Err(Refusal::Malformed);
    }
    match scheme(url) {
        Some(scheme) if SCHEMES.iter().any(|allowed| scheme.eq_ignore_ascii_case(allowed)) => Ok(()),
        Some(scheme) => Err(Refusal::Scheme(scheme.to_string())),
        None => Err(Refusal::NoScheme),
    }
}

/// Why a link was not opened. Its text is safe to log (see [`Refusal`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NotOpened {
    Refused(Refusal),
    /// The app has no way to open a link (no hook).
    Unavailable,
    /// The system could not open it; carries the hook's reason.
    Failed(String),
}

impl fmt::Display for NotOpened {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(refusal) => refusal.fmt(f),
            Self::Unavailable => f.write_str("no way to open a link on this platform"),
            Self::Failed(reason) => write!(f, "the system could not open the link: {reason}"),
        }
    }
}

/// Open `url` in the system's default application, after [`check`]. A refused URL never reaches
/// the hook; an accepted one reaches it once, unchanged. The hook may block, so call this off the
/// thread that owns the session and off the UI thread.
pub fn open(services: &Services, url: &str) -> Result<(), NotOpened> {
    check(url).map_err(NotOpened::Refused)?;
    let hook = services.open_url.as_ref().ok_or(NotOpened::Unavailable)?;
    hook(url).map_err(NotOpened::Failed)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn accepts_http_https_and_mailto_whatever_their_case() {
        for url in
            ["https://example.com/a?b#c", "HTTP://EXAMPLE.COM", "mailto:a@b.c", "MailTo:a@b.c?subject=hi", "http://localhost:5173/", "https://example.com/a b"]
        {
            assert_eq!(check(url), Ok(()), "{url}");
        }
    }

    #[test]
    fn refuses_every_other_scheme() {
        assert_eq!(check("file:///etc/passwd"), Err(Refusal::Scheme("file".into())));
        assert_eq!(check("javascript:alert(1)"), Err(Refusal::Scheme("javascript".into())));
        assert_eq!(check("data:text/html,x"), Err(Refusal::Scheme("data".into())));
        assert_eq!(check("tauri://localhost"), Err(Refusal::Scheme("tauri".into())));
        for url in
            ["ftp://example.com", "tel:+123", "ssh://host", "about:blank", "vscode://open", "httpx://example.com", "ahttp://example.com", "mailto2:a@b.c"]
        {
            assert!(matches!(check(url), Err(Refusal::Scheme(_))), "{url}");
        }
    }

    #[test]
    fn refuses_what_has_no_plain_scheme() {
        for url in [
            "",
            "example.com",
            "//example.com",
            "/etc/passwd",
            "https",
            ":https",
            "1http://x",
            "ht tp://x",
            "h\u{fb01}ps://x",
            &format!("{}:x", "a".repeat(33)),
        ] {
            assert_eq!(check(url), Err(Refusal::NoScheme), "{url}");
        }
    }

    #[test]
    fn refuses_whitespace_at_either_end_and_control_characters_anywhere() {
        for url in [
            " https://example.com",
            "https://example.com ",
            "\thttps://example.com",
            "https://example.com\n",
            "\u{a0}https://example.com",
            "https://example.com\u{2028}",
        ] {
            assert_eq!(check(url), Err(Refusal::Malformed), "{url:?}");
        }
        for url in [
            "https://exa\nmple.com",
            "https://exa\tmple.com",
            "https://example.com/\u{0}",
            "https://example.com/\u{7f}",
            "https://example.com/\u{85}",
            "ja\nvascript:alert(1)",
            "https://example.com/\u{1b}[31m",
        ] {
            assert_eq!(check(url), Err(Refusal::Malformed), "{url:?}");
        }
    }

    #[test]
    fn the_cap_is_in_characters() {
        let base = "https://example.com/";
        let at_cap = format!("{base}{}", "a".repeat(MAX_URL_CHARS - base.len()));
        assert_eq!(at_cap.chars().count(), MAX_URL_CHARS);
        assert_eq!(check(&at_cap), Ok(()));
        assert_eq!(check(&format!("{at_cap}a")), Err(Refusal::TooLong), "8,193 characters");
        // Multi-byte characters count once: 8,192 of them are far more than 8,192 bytes.
        let wide = format!("{base}{}", "é".repeat(MAX_URL_CHARS - base.len()));
        assert!(wide.len() > MAX_URL_CHARS);
        assert_eq!(check(&wide), Ok(()));
        assert_eq!(check(&format!("{wide}é")), Err(Refusal::TooLong));
        assert_eq!(check(&"a".repeat(10 * 1024 * 1024)), Err(Refusal::TooLong));
    }

    #[test]
    fn a_refusal_names_the_scheme_and_never_the_rest_of_the_url() {
        let secret = "s3cr3t-token";
        let texts = [
            check(&format!("file:///home/me/{secret}")).unwrap_err().to_string(),
            check(&format!("{secret}-no-scheme")).unwrap_err().to_string(),
            check(&format!(" https://example.com/{secret}")).unwrap_err().to_string(),
            check(&format!("https://example.com/{secret}{}", "a".repeat(MAX_URL_CHARS))).unwrap_err().to_string(),
            check(&format!("{}:{secret}", "x".repeat(40))).unwrap_err().to_string(),
        ];
        for text in &texts {
            assert!(!text.contains(secret), "{text}");
            assert!(!text.contains("/home/me"), "{text}");
            assert!(!text.contains(&"x".repeat(40)), "{text}");
        }
        assert_eq!(texts[0], "refused a link with the scheme `file`");
    }

    /// A service whose open hook records every URL it is given.
    fn recording(result: Result<(), String>) -> (Services, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let hook = move |url: &str| {
            if let Ok(mut urls) = log.lock() {
                urls.push(url.to_string());
            }
            result.clone()
        };
        (Services { open_url: Some(Arc::new(hook)), ..Services::default() }, seen)
    }

    fn opened(seen: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        seen.lock().map(|urls| urls.clone()).unwrap_or_default()
    }

    #[test]
    fn an_accepted_url_reaches_the_hook_once_unchanged() {
        let (services, seen) = recording(Ok(()));
        let url = "HTTPS://Example.com/a%20b?x=1&y=2#frag";
        assert_eq!(open(&services, url), Ok(()));
        assert_eq!(opened(&seen), [url]);
    }

    #[test]
    fn a_refused_url_never_reaches_the_hook() {
        let (services, seen) = recording(Ok(()));
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "tauri://localhost",
            " https://example.com",
            "",
            &format!("https://example.com/{}", "a".repeat(MAX_URL_CHARS)),
        ] {
            assert!(matches!(open(&services, url), Err(NotOpened::Refused(_))), "{url}");
        }
        assert_eq!(opened(&seen), Vec::<String>::new());
    }

    #[test]
    fn a_missing_hook_drops_the_link_and_a_failing_one_says_why() {
        assert_eq!(open(&Services::default(), "https://example.com"), Err(NotOpened::Unavailable));
        let (services, seen) = recording(Err("no browser".into()));
        let failed = open(&services, "https://example.com").unwrap_err();
        assert_eq!(failed, NotOpened::Failed("no browser".into()));
        assert_eq!(failed.to_string(), "the system could not open the link: no browser");
        assert_eq!(opened(&seen), ["https://example.com"], "the hook was asked once");
    }
}
