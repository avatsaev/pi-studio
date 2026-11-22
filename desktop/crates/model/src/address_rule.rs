//! The address rule: how a stored daemon address becomes the URL the workbench opens.
//!
//! The workbench turns what the user typed into a `ws://` or `wss://` URL
//! (`normalizeDaemonUrl` in `packages/workbench/src/lib/connection/normalize-url.ts`) and the page
//! hands that URL to Rust. Rust dials only the current entry's stored address, so it applies the same
//! rule to the stored address and requires the two to be equal ([`address_matches`]). The two
//! implementations share their cases in `normalize-url.vectors.json`, beside the workbench's function:
//! each side's test runs the whole file.

/// What JavaScript's `String.prototype.trim` strips: the Unicode `Zs` category, tab, line feed,
/// vertical tab, form feed, carriage return, the line and paragraph separators and the byte order
/// mark. Rust's `char::is_whitespace` differs (it strips U+0085 and not U+FEFF), so it is not used.
const fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// The scheme at the start of `raw` (`[a-z][a-z0-9+.-]*` ignoring ASCII case) when `://` follows
/// it, and what comes after the `://`.
fn split_scheme(raw: &str) -> Option<(&str, &str)> {
    let mut chars = raw.char_indices();
    match chars.next() {
        Some((_, c)) if c.is_ascii_alphabetic() => {}
        _ => return None,
    }
    let end = chars.find(|&(_, c)| !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))).map_or(raw.len(), |(i, _)| i);
    let rest = raw.get(end..)?.strip_prefix("://")?;
    Some((raw.get(..end)?, rest))
}

/// The `ws://` or `wss://` URL for what a user typed, exactly as the workbench's
/// `normalizeDaemonUrl` computes it: surrounding whitespace and trailing slashes are trimmed,
/// `http` becomes `ws`, `https` becomes `wss`, a scheme in any letter case is lower-cased when it is
/// `ws` or `wss`, a bare host or `host:port` gets `ws://`, and a path and a query are kept. An
/// unknown scheme leaves the trimmed input as it is: only `ws:` and `wss:` are dialled, and the
/// caller refuses the rest. Never panics, whatever the input.
#[must_use]
pub fn normalize_daemon_url(input: &str) -> String {
    let raw = input.trim_matches(is_js_space);
    if raw.is_empty() {
        return String::new();
    }
    let Some((scheme, rest)) = split_scheme(raw) else {
        return format!("ws://{}", raw.trim_end_matches('/'));
    };
    let rest = rest.trim_end_matches('/');
    if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("ws") {
        format!("ws://{rest}")
    } else if scheme.eq_ignore_ascii_case("https") || scheme.eq_ignore_ascii_case("wss") {
        format!("wss://{rest}")
    } else {
        raw.to_owned()
    }
}

/// Whether `page_url`, the URL the page asks Rust to dial, is the rule applied to `stored`, the
/// current entry's address. The comparison is exact: the page applies the rule itself, so a URL
/// that only becomes equal after normalising is somebody else's. A stored address that normalises
/// to nothing never matches, so an empty URL cannot stand for an entry with no usable address.
/// Whether the scheme may be dialled is a separate question: this says only that the page did not
/// choose the address.
#[must_use]
pub fn address_matches(page_url: &str, stored: &str) -> bool {
    let expected = normalize_daemon_url(stored);
    !expected.is_empty() && page_url == expected
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct Vector {
        input: String,
        expected: String,
    }

    /// The vectors the workbench's `normalize-url.test.ts` runs too.
    fn vectors() -> Vec<Vector> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/workbench/src/lib/connection/normalize-url.vectors.json");
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read the shared vectors at {path}: {e}"));
        serde_json::from_str(&text).unwrap_or_else(|e| panic!("the shared vectors are not valid: {e}"))
    }

    #[test]
    fn matches_every_shared_vector() {
        let all = vectors();
        assert!(all.len() > 40, "the shared file looks truncated: {} vectors", all.len());
        for v in &all {
            assert_eq!(normalize_daemon_url(&v.input), v.expected, "input {:?}", v.input);
        }
    }

    #[test]
    fn the_shared_vectors_cover_each_branch() {
        let all = vectors();
        let has = |f: &dyn Fn(&Vector) -> bool| all.iter().any(f);
        assert!(has(&|v| v.input.is_empty()));
        assert!(has(&|v| v.input.starts_with("http://") && v.expected.starts_with("ws://")));
        assert!(has(&|v| v.input.starts_with("https://") && v.expected.starts_with("wss://")));
        assert!(has(&|v| v.input.starts_with("ws://") && v.expected == v.input));
        assert!(has(&|v| v.input.starts_with("wss://") && v.expected == v.input));
        assert!(has(&|v| !v.input.contains("://") && v.expected.starts_with("ws://") && v.input.contains(':')));
        assert!(has(&|v| !v.input.contains("://") && v.expected.starts_with("ws://") && !v.input.contains(':')));
        assert!(has(&|v| v.input.starts_with("ftp://") && v.expected.starts_with("ftp://")));
        assert!(has(&|v| v.input.contains('?')));
        assert!(has(&|v| v.input.starts_with("HTTP://")));
    }

    #[test]
    fn address_matches_the_rule_applied_to_the_stored_address() {
        assert!(address_matches("ws://127.0.0.1:6767", "127.0.0.1:6767"));
        assert!(address_matches("ws://127.0.0.1:6767", "  http://127.0.0.1:6767/ "));
        assert!(address_matches("wss://daemon.example.com", "HTTPS://daemon.example.com//"));
        assert!(address_matches("ws://h:1", "ws://h:1"));
        // The page chose another host, scheme or port: refused.
        assert!(!address_matches("ws://evil.example:6767", "127.0.0.1:6767"));
        assert!(!address_matches("wss://127.0.0.1:6767", "127.0.0.1:6767"));
        assert!(!address_matches("ws://127.0.0.1:6768", "127.0.0.1:6767"));
        // The comparison is exact: the page's URL is not normalised again.
        assert!(!address_matches("http://127.0.0.1:6767", "127.0.0.1:6767"));
        assert!(!address_matches("ws://127.0.0.1:6767/", "127.0.0.1:6767"));
        assert!(!address_matches(" ws://127.0.0.1:6767", "127.0.0.1:6767"));
        // No usable address matches nothing, not even the empty URL.
        assert!(!address_matches("", ""));
        assert!(!address_matches("", "   "));
        assert!(!address_matches("ws://", " "));
    }

    #[test]
    fn address_matches_every_normalised_vector() {
        for v in vectors().iter().filter(|v| !v.expected.is_empty()) {
            assert!(address_matches(&v.expected, &v.input), "input {:?}", v.input);
        }
    }

    /// A small deterministic generator: the crate has no randomness and no dev-dependency for it.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }
    }

    #[test]
    fn never_panics_on_generated_input() {
        const PIECES: &[&str] = &[
            "http",
            "https",
            "ws",
            "wss",
            "HTTP",
            "Ws",
            "ftp",
            "://",
            ":",
            "/",
            "//",
            "?",
            "#",
            ".",
            "-",
            "+",
            "@",
            "[",
            "]",
            "::1",
            "host",
            "127.0.0.1",
            ":6767",
            " ",
            "\t",
            "\n",
            "\u{85}",
            "\u{a0}",
            "\u{feff}",
            "\u{2028}",
            "\u{3000}",
            "\u{212a}",
            "\u{17f}",
            "é",
            "日本",
            "😀",
            "\u{0}",
            "\u{7f}",
            "\u{ffff}",
            "%",
            "\\",
        ];
        let mut rng = Lcg(0x5eed);
        for _ in 0..20_000 {
            let mut s = String::new();
            let parts = rng.next() % 12;
            for _ in 0..parts {
                if rng.next().is_multiple_of(4) {
                    // An arbitrary scalar value, including ones not in the list.
                    let raw = u32::try_from(rng.next() % 0x11_0000).unwrap_or(0);
                    s.push(char::from_u32(raw).unwrap_or('\u{fffd}'));
                } else {
                    s.push_str(PIECES[usize::try_from(rng.next()).unwrap_or(0) % PIECES.len()]);
                }
            }
            let n = normalize_daemon_url(&s);
            let _ = address_matches(&s, &s);
            let _ = address_matches(&n, &s);
        }
    }

    #[test]
    fn never_panics_on_arbitrary_bytes_and_long_input() {
        let mut rng = Lcg(7);
        for _ in 0..2_000 {
            let len = usize::try_from(rng.next() % 64).unwrap_or(0);
            let bytes: Vec<u8> = (0..len).map(|_| u8::try_from(rng.next() & 0xff).unwrap_or(0)).collect();
            let s = String::from_utf8_lossy(&bytes);
            let _ = normalize_daemon_url(&s);
            let _ = address_matches(&s, &s);
        }
        let long = format!("http://{}{}", "a".repeat(1 << 20), "/".repeat(1 << 16));
        assert_eq!(normalize_daemon_url(&long).len(), "ws://".len() + (1 << 20));
        let slashes = "/".repeat(1 << 20);
        assert_eq!(normalize_daemon_url(&slashes), "ws://");
    }
}
