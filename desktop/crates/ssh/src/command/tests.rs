use super::{MARKER_BYTES, Markers, Missing, Output, STDOUT_LIMIT, Scanner, unwrap};

fn markers() -> Markers {
    Markers::from_bytes(&[0xab; MARKER_BYTES], &[0x01; MARKER_BYTES])
}

/// Everything `scanner` is fed, in `size` bytes at a time; whether it said done, and what it made of it.
fn run(mut scanner: Scanner, stdout: &[u8], size: usize) -> (bool, Result<Output, Missing>) {
    let mut done = false;
    for chunk in stdout.chunks(size) {
        done = scanner.feed(chunk);
    }
    (done, scanner.finish())
}

fn script(output: &[u8], status: &str) -> Vec<u8> {
    let marks = markers();
    let mut stdout = b"welcome ".to_vec();
    stdout.extend_from_slice(format!("{}\n", marks.begin).as_bytes());
    stdout.extend_from_slice(output);
    stdout.extend_from_slice(format!("{}:{status}\n", marks.end).as_bytes());
    stdout
}

#[test]
fn markers_are_hex_and_differ_every_time() {
    let (first, second) = (Markers::random().expect("random"), Markers::random().expect("random"));
    assert_ne!(first.begin, second.begin);
    assert_ne!(first.end, second.end);
    assert_ne!(first.begin, first.end);
    assert_eq!(first.begin.len(), "pistudio-begin-".len() + 2 * MARKER_BYTES);
    assert!(first.end.strip_prefix("pistudio-end-").is_some_and(|hex| hex.bytes().all(|byte| byte.is_ascii_hexdigit())));
}

#[test]
fn a_command_is_sent_to_the_login_shell_between_the_markers() {
    let line = markers().wrap("pi-studio --version");
    assert_eq!(
        line,
        "\"$SHELL\" -lic 'echo pistudio-begin-abababababababababababababababab; pi-studio --version; echo pistudio-end-01010101010101010101010101010101:$?'"
    );
}

#[test]
fn a_single_quote_in_the_command_is_escaped_and_read_back() {
    let command = "echo 'it'\\''s' && printf \"%s\" '$HOME'";
    let line = markers().wrap(command);
    assert!(line.contains("'\\''"));
    let parsed = unwrap(&line).expect("a marked command line");
    assert_eq!(parsed.command, command);
    assert_eq!((parsed.begin, parsed.end), (markers().begin, markers().end));
    assert!(unwrap("pi-studio --version").is_none());
}

#[test]
fn the_output_between_the_markers_and_the_status_are_the_answer_whatever_the_chunking() {
    let stdout = script(b"0.0.130\nsecond line\n", "7");
    for size in [1, 2, 3, 7, 16, stdout.len()] {
        let (done, output) = run(markers().scanner(), &stdout, size);
        assert!(done, "chunks of {size}");
        assert_eq!(output, Ok(Output { status: 7, stdout: b"0.0.130\nsecond line\n".to_vec() }), "chunks of {size}");
    }
}

#[test]
fn output_without_a_final_newline_ends_where_the_end_marker_starts() {
    let marks = markers();
    let stdout = format!("{}\nabc{}:0\n", marks.begin, marks.end);
    assert_eq!(run(marks.scanner(), stdout.as_bytes(), 5).1, Ok(Output { status: 0, stdout: b"abc".to_vec() }));
}

#[test]
fn a_status_at_the_end_of_the_stream_counts_without_a_newline() {
    let marks = markers();
    let stdout = format!("{}\nx\n{}:12", marks.begin, marks.end);
    let (done, output) = run(marks.scanner(), stdout.as_bytes(), 4);
    assert!(!done);
    assert_eq!(output, Ok(Output { status: 12, stdout: b"x\n".to_vec() }));
}

#[test]
fn what_precedes_the_begin_marker_is_dropped_and_what_follows_the_end_is_ignored() {
    let mut stdout = script(b"out\n", "0");
    stdout.extend_from_slice(b"epilogue\n");
    assert_eq!(run(markers().scanner(), &stdout, 6).1, Ok(Output { status: 0, stdout: b"out\n".to_vec() }));
}

#[test]
fn the_output_is_cut_at_64_kib_and_the_status_is_still_read() {
    let big = vec![b'x'; 3 * STDOUT_LIMIT + 5];
    let stdout = script(&big, "3");
    for size in [4096, 10_000, 1] {
        let (_, output) = run(markers().scanner(), &stdout, size);
        let output = output.expect("answer");
        assert_eq!(output.status, 3);
        assert_eq!(output.stdout.len(), STDOUT_LIMIT);
        assert!(output.stdout.iter().all(|&byte| byte == b'x'));
    }
}

#[test]
fn what_the_scanner_holds_stays_small_however_much_arrives() {
    let mut scanner = markers().scanner();
    let junk = vec![b'z'; 64 * 1024];
    for _ in 0..64 {
        assert!(!scanner.feed(&junk));
        assert!(scanner.window.len() < 2 * junk.len(), "before the begin marker");
    }
    assert!(!scanner.feed(format!("{}\n", markers().begin).as_bytes()));
    for _ in 0..64 {
        assert!(!scanner.feed(&junk));
        assert!(scanner.window.len() < 2 * junk.len(), "after it");
        assert!(scanner.stdout.len() <= STDOUT_LIMIT);
    }
    assert!(scanner.feed(format!("{}:0\n", markers().end).as_bytes()));
    assert_eq!(scanner.finish().expect("answer").stdout.len(), STDOUT_LIMIT);
}

#[test]
fn no_begin_marker_is_a_shell_that_did_not_run_the_script() {
    assert_eq!(run(markers().scanner(), b"hello\nworld\n", 3).1, Err(Missing::Begin));
    assert_eq!(run(markers().scanner(), b"", 1).1, Err(Missing::Begin));
    // The marker without its newline is not the marker line yet.
    let marks = markers();
    assert_eq!(run(marks.scanner(), marks.begin.as_bytes(), 8).1, Err(Missing::Begin));
}

#[test]
fn no_end_marker_is_a_shell_that_ended_inside_the_command() {
    let marks = markers();
    let stdout = format!("{}\npartial", marks.begin);
    assert_eq!(run(marks.scanner(), stdout.as_bytes(), 4).1, Err(Missing::End));
}

#[test]
fn a_status_that_is_not_a_number_is_not_an_answer() {
    for status in ["", "x", "99999999999", "4294967296"] {
        let (_, output) = run(markers().scanner(), &script(b"out\n", status), 5);
        assert_eq!(output, Err(Missing::End), "status {status:?}");
    }
    assert_eq!(run(markers().scanner(), &script(b"", "4294967295"), 5).1, Ok(Output { status: u32::MAX, stdout: Vec::new() }));
}

#[test]
fn markers_in_the_output_that_are_not_ours_mean_nothing() {
    let other = Markers::from_bytes(&[0xcd; MARKER_BYTES], &[0x02; MARKER_BYTES]);
    let mut stdout = format!("{}\n{}:0\n", other.begin, other.end).into_bytes();
    stdout.extend_from_slice(&script(b"real\n", "0"));
    assert_eq!(run(markers().scanner(), &stdout, 9).1, Ok(Output { status: 0, stdout: b"real\n".to_vec() }));
}
