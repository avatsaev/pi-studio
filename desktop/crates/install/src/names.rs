//! What counts as one plain file name for a version or a target, so that neither can walk out of a folder.

/// True for a non-empty name of ASCII letters, digits, `.`, `-`, `_` and `+` that is not `.` or `..`: a version
/// (`0.0.130`, `1.2.3-rc.1+build`) or a target (`linux-x64`), never a path.
pub(crate) fn is_plain_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 64
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'+'))
}

#[cfg(test)]
mod tests {
    use super::is_plain_name;

    #[test]
    fn plain_names() {
        for ok in ["0.0.130", "linux-x64", "1.2.3-rc.1+b5", "a_b"] {
            assert!(is_plain_name(ok), "{ok}");
        }
        for bad in ["", ".", "..", "a/b", "a\\b", "a b", "é", "../x", "a\0b"] {
            assert!(!is_plain_name(bad), "{bad:?}");
        }
        assert!(!is_plain_name(&"a".repeat(65)));
    }
}
