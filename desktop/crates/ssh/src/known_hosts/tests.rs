use std::fs;
use std::path::{Path, PathBuf};

use ring::hmac;
use russh::keys::ssh_encoding::base64::{Base64, Encoding};
use tempfile::TempDir;

use super::*;

const ED_A: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ";
const ED_B: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILIG2T/B0l0gaqj3puu510tu9N1OkQ4znY3LYuEm5zCF";
const ECDSA: &str = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBAU6iYlCHpg4lTj2ib/nVJ3lWL77kp5HTp18vK2F3ZNjiwcli/gEt71QNKasDHNhKJU14Fd9RaQ+DFCynWT1zao=";
/// `example.com` hashed by OpenSSH, holding `ED_B`.
const HASHED_EXAMPLE_COM: &str = "|1|O33ESRMWPVkMYIwJ1Uw+n877jTo=|nuuC5vEqXlEZ/8BXQR7m619W6Ak=";

fn key(text: &str) -> PublicKey {
    PublicKey::from_openssh(text).expect("test key parses")
}

fn dir() -> TempDir {
    tempfile::tempdir().expect("temp dir")
}

fn write_file(dir: &TempDir, name: &str, text: &str) -> PathBuf {
    let path = dir.path().join(name);
    fs::write(&path, text).expect("write file");
    path
}

fn status(host: &str, port: u16, k: &str, files: &[&Path]) -> HostKeyStatus {
    check(host, port, &key(k), files).expect("check")
}

fn hashed(name: &str) -> String {
    let salt = [7u8; 20];
    let hmac_key = hmac::Key::new(hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, &salt);
    let tag = hmac::sign(&hmac_key, name.as_bytes());
    format!("|1|{}|{}", Base64::encode_string(&salt), Base64::encode_string(tag.as_ref()))
}

#[test]
fn a_key_is_described_by_its_type_and_sha256_fingerprint() {
    let described = describe(&key(ED_A));
    assert_eq!(described.algorithm, "ssh-ed25519");
    assert!(described.fingerprint.starts_with("SHA256:"), "{}", described.fingerprint);
    assert_ne!(described, describe(&key(ED_B)));
    assert_eq!(describe(&key(ECDSA)).algorithm, "ecdsa-sha2-nistp256");
}

#[test]
fn plain_entry_is_known() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("example.com {ED_A}\n"));
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Known);
}

#[test]
fn other_host_is_unknown() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("example.com {ED_A}\n"));
    assert_eq!(status("other.com", 22, ED_A, &[&f]), HostKeyStatus::Unknown);
}

#[test]
fn host_name_is_case_insensitive_and_list_entries_match() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("foo.org,Example.COM,10.0.0.1 {ED_A} a comment\n"));
    assert_eq!(status("EXAMPLE.com", 22, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("10.0.0.1", 22, ED_A, &[&f]), HostKeyStatus::Known);
}

#[test]
fn bracketed_port_entry_matches_only_its_port() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("[example.com]:2222 {ED_A}\n"));
    assert_eq!(status("example.com", 2222, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Unknown);
    assert_eq!(status("example.com", 2223, ED_A, &[&f]), HostKeyStatus::Unknown);
}

#[test]
fn default_port_entry_is_not_bracketed() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("[example.com]:22 {ED_A}\nexample.com {ED_B}\n"));
    assert_eq!(status("example.com", 22, ED_B, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Changed);
}

#[test]
fn hashed_entry_from_openssh_is_known() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("{HASHED_EXAMPLE_COM} {ED_B}\n"));
    assert_eq!(status("example.com", 22, ED_B, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("example.org", 22, ED_B, &[&f]), HostKeyStatus::Unknown);
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Changed);
}

#[test]
fn hashed_port_entry_is_known() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("{} {ED_A}\n", hashed("[example.com]:2222")));
    assert_eq!(status("example.com", 2222, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Unknown);
}

#[test]
fn changed_key_is_changed() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("example.com {ED_A}\n"));
    assert_eq!(status("example.com", 22, ED_B, &[&f]), HostKeyStatus::Changed);
}

#[test]
fn second_key_type_for_the_same_host_is_unknown() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("example.com {ED_A}\n"));
    assert_eq!(status("example.com", 22, ECDSA, &[&f]), HostKeyStatus::Unknown);
}

#[test]
fn any_matching_entry_makes_the_key_known() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("example.com {ED_A}\nexample.com {ED_B}\n"));
    assert_eq!(status("example.com", 22, ED_B, &[&f]), HostKeyStatus::Known);
}

#[test]
fn files_are_read_in_order_and_a_missing_one_is_skipped() {
    let d = dir();
    let user = write_file(&d, "user", &format!("example.com {ED_A}\n"));
    let app = write_file(&d, "app", &format!("other.com {ED_B}\n"));
    let missing = d.path().join("absent");
    let files = [missing.as_path(), user.as_path(), app.as_path()];
    assert_eq!(status("example.com", 22, ED_A, &files), HostKeyStatus::Known);
    assert_eq!(status("other.com", 22, ED_B, &files), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_B, &files), HostKeyStatus::Changed);
    assert_eq!(status("example.com", 22, ED_A, &[&missing]), HostKeyStatus::Unknown);
}

#[test]
fn wildcard_and_negation_patterns() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("*.example.com,!bad.example.com,[*.lab]:2200,10.0.?.1 {ED_A}\n"));
    assert_eq!(status("a.example.com", 22, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("bad.example.com", 22, ED_A, &[&f]), HostKeyStatus::Unknown);
    assert_eq!(status("x.lab", 2200, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("10.0.3.1", 22, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("10.0.33.1", 22, ED_A, &[&f]), HostKeyStatus::Unknown);
}

#[test]
fn revoked_key_is_refused_and_cert_authority_is_ignored() {
    let d = dir();
    let f = write_file(&d, "kh", &format!("example.com {ED_A}\n@revoked example.com {ED_A}\n"));
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Changed);
    let ca = write_file(&d, "ca", &format!("@cert-authority example.com {ED_B}\n"));
    assert_eq!(status("example.com", 22, ED_B, &[&ca]), HostKeyStatus::Unknown);
}

#[test]
fn malformed_lines_are_skipped_not_fatal() {
    let d = dir();
    let long = "a".repeat(MAX_LINE_BYTES + 1);
    let text = format!(
        "# example.com {ED_B}\n\ngarbage\n@bogus example.com {ED_B}\n|1|notbase64|alsonot {ED_B}\n\
         example.com ssh-ed25519 AAAA\n{long} {ED_B}\nexample.com\t{ED_B}\n\u{0}\u{1}\n  example.com {ED_A}\n"
    );
    let f = write_file(&d, "kh", &text);
    assert_eq!(status("example.com", 22, ED_A, &[&f]), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_B, &[&f]), HostKeyStatus::Changed);
}

#[test]
fn invalid_utf8_does_not_fail_the_check() {
    let d = dir();
    let path = d.path().join("kh");
    let mut bytes = vec![0xff, 0xfe, b'\n'];
    bytes.extend_from_slice(format!("example.com {ED_A}\n").as_bytes());
    fs::write(&path, bytes).expect("write");
    assert_eq!(status("example.com", 22, ED_A, &[&path]), HostKeyStatus::Known);
}

#[test]
fn unreadable_path_is_an_io_error() {
    let d = dir();
    // A directory is not a readable file.
    let result = check("example.com", 22, &key(ED_A), &[d.path()]);
    assert!(matches!(result, Err(KnownHostsError::Io(_))));
}

#[test]
fn glob_does_not_blow_up() {
    let text = "a".repeat(2000);
    let pattern = "*a".repeat(500) + "b";
    assert!(!glob(pattern.as_bytes(), text.as_bytes()));
    assert!(glob(b"*", b""));
    assert!(glob(b"a*b*c", b"aXXbYYc"));
    assert!(!glob(b"a?c", b"ac"));
}

#[test]
fn trust_creates_the_file_and_the_key_is_then_known() {
    let d = dir();
    let app = d.path().join("config").join("known_hosts");
    trust("example.com", 22, &key(ED_A), &app).expect("trust");
    assert_eq!(fs::read_to_string(&app).expect("read"), format!("example.com {ED_A}\n"));
    assert_eq!(status("example.com", 22, ED_A, &[&app]), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_B, &[&app]), HostKeyStatus::Changed);
    assert_eq!(status("example.com", 22, ECDSA, &[&app]), HostKeyStatus::Unknown);
}

#[cfg(unix)]
#[test]
fn trust_creates_the_file_with_mode_0600() {
    use std::os::unix::fs::PermissionsExt;

    let d = dir();
    let app = d.path().join("known_hosts");
    trust("example.com", 22, &key(ED_A), &app).expect("trust");
    let mode = fs::metadata(&app).expect("meta").permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
}

#[test]
fn trust_writes_a_bracketed_host_for_a_non_default_port_and_drops_the_comment() {
    let d = dir();
    let app = d.path().join("known_hosts");
    trust("Example.com", 2222, &key(&format!("{ED_A} someone@laptop")), &app).expect("trust");
    assert_eq!(fs::read_to_string(&app).expect("read"), format!("[example.com]:2222 {ED_A}\n"));
    assert_eq!(status("example.com", 2222, ED_A, &[&app]), HostKeyStatus::Known);
}

#[test]
fn trust_appends_after_existing_lines_with_or_without_a_final_newline() {
    let d = dir();
    let app = write_file(&d, "known_hosts", &format!("one.com {ED_A}"));
    trust("two.com", 22, &key(ED_B), &app).expect("trust");
    trust("three.com", 22, &key(ECDSA), &app).expect("trust");
    let text = fs::read_to_string(&app).expect("read");
    assert_eq!(text.lines().count(), 3);
    assert_eq!(status("one.com", 22, ED_A, &[&app]), HostKeyStatus::Known);
    assert_eq!(status("two.com", 22, ED_B, &[&app]), HostKeyStatus::Known);
    assert_eq!(status("three.com", 22, ECDSA, &[&app]), HostKeyStatus::Known);
}

#[test]
fn trust_refuses_hosts_that_would_corrupt_the_file() {
    let d = dir();
    let app = d.path().join("known_hosts");
    for host in ["", "a b", "a\nb", "a,b", "*.com", "!a", "#a", "[a]", "|1|x", "@revoked", "a\u{0}"] {
        assert!(matches!(trust(host, 22, &key(ED_A), &app), Err(KnownHostsError::InvalidHost)));
    }
    assert!(!app.exists());
}

#[test]
fn trusting_never_touches_the_users_file() {
    let d = dir();
    let user_text = format!("example.com {ED_A}\n");
    let user = write_file(&d, "user_known_hosts", &user_text);
    let before = fs::metadata(&user).expect("meta").modified().expect("mtime");
    let app = d.path().join("app_known_hosts");
    trust("other.com", 22, &key(ED_B), &app).expect("trust");
    assert_eq!(fs::read_to_string(&user).expect("read"), user_text);
    assert_eq!(fs::metadata(&user).expect("meta").modified().expect("mtime"), before);
    let files = [user.as_path(), app.as_path()];
    assert_eq!(status("other.com", 22, ED_B, &files), HostKeyStatus::Known);
    assert_eq!(status("example.com", 22, ED_A, &files), HostKeyStatus::Known);
}
