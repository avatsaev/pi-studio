//! The crate's behaviour end to end: downloads against a small HTTP server on a loopback port, archives built here
//! (a shell script named `pi-studio` that prints a version, never a real binary), installs into a temporary folder.

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use flate2::Compression;
use flate2::write::GzEncoder;
use sha2::{Digest, Sha256};
use tar::{EntryType, Header};

use crate::download::{hex, part_path};
use crate::{ArchiveCache, Asset, DownloadError, InstallError, VersionError, binary_version, current_version, download, install_version, prune, version_dir};

const STALL: Duration = Duration::from_millis(300);

// ---------------------------------------------------------------- the HTTP server

struct Server {
    addr: SocketAddr,
    hits: Arc<AtomicUsize>,
}

impl Server {
    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

/// A server whose every connection is handed to `handler` with the request's path. It runs until the test process ends.
fn serve(handler: impl Fn(&str, TcpStream) + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let handler = Arc::new(handler);
    let counter = hits.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            counter.fetch_add(1, Ordering::SeqCst);
            let handler = handler.clone();
            std::thread::spawn(move || {
                let mut stream = stream;
                if let Some(path) = read_request_path(&mut stream) {
                    handler(&path, stream);
                }
            });
        }
    });
    Server { addr, hits }
}

fn read_request_path(stream: &mut TcpStream) -> Option<String> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut first = String::new();
    reader.read_line(&mut first).ok()?;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
    }
    first.split_whitespace().nth(1).map(str::to_string)
}

fn respond(mut stream: TcpStream, status: &str, headers: &str, body: &[u8]) {
    let head = format!("HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// Sends the head and the first half of `body`, then holds the connection open without a byte.
fn respond_then_stall(mut stream: TcpStream, body: &[u8]) {
    let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body[..body.len() / 2]);
    let _ = stream.flush();
    std::thread::sleep(Duration::from_secs(4));
}

fn sha256_of(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// A body of `len` bytes that is not all one value.
fn body_of(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 251) as u8).collect()
}

fn leftovers(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
}

// ---------------------------------------------------------------- downloads

#[tokio::test]
async fn download_writes_the_file_and_reports_progress() {
    let body = body_of(300_000);
    let served = body.clone();
    let server = serve(move |_, s| respond(s, "200 OK", "", &served));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("a").join("x.tar.gz");
    let url = server.url("/x.tar.gz");
    let asset = Asset { url: &url, sha256: &sha256_of(&body).to_uppercase(), size: body.len() as u64 };

    let mut seen: Vec<(u64, u64)> = Vec::new();
    download(&asset, &dest, STALL, |received, total| seen.push((received, total))).await.unwrap();

    assert_eq!(fs::read(&dest).unwrap(), body);
    assert!(!part_path(&dest).exists());
    assert_eq!(seen.last(), Some(&(body.len() as u64, body.len() as u64)));
    assert!(seen.windows(2).all(|w| w[0].0 < w[1].0), "progress only grows");
    assert!(seen.iter().all(|&(_, total)| total == body.len() as u64));
}

#[tokio::test]
async fn download_follows_a_redirect() {
    let body = body_of(1000);
    let served = body.clone();
    let server = Arc::new(serve(move |path, s| match path {
        "/real" => respond(s, "200 OK", "", &served),
        _ => respond(s, "302 Found", "Location: /real\r\n", b""),
    }));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("x");
    let url = server.url("/start");
    download(&Asset { url: &url, sha256: &sha256_of(&body), size: 1000 }, &dest, STALL, |_, _| {}).await.unwrap();
    assert_eq!(fs::read(&dest).unwrap(), body);
}

#[tokio::test]
async fn a_checksum_mismatch_removes_everything_and_leaves_an_older_file_alone() {
    let body = body_of(5000);
    let served = body.clone();
    let server = serve(move |_, s| respond(s, "200 OK", "", &served));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("x.tar.gz");
    fs::write(&dest, b"older").unwrap();
    let url = server.url("/x");
    let wrong = sha256_of(b"something else");

    let e = download(&Asset { url: &url, sha256: &wrong, size: 5000 }, &dest, STALL, |_, _| {}).await.unwrap_err();

    assert!(matches!(e, DownloadError::ChecksumMismatch), "{e:?}");
    assert!(e.is_integrity_failure());
    assert_eq!(fs::read(&dest).unwrap(), b"older");
    assert_eq!(leftovers(dir.path()), ["x.tar.gz"]);
}

#[tokio::test]
async fn a_checksum_mismatch_without_a_file_before_leaves_none() {
    let body = body_of(5000);
    let server = serve(move |_, s| respond(s, "200 OK", "", &body));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("x.tar.gz");
    let url = server.url("/x");
    let e = download(&Asset { url: &url, sha256: &sha256_of(b"no"), size: 5000 }, &dest, STALL, |_, _| {}).await.unwrap_err();
    assert!(matches!(e, DownloadError::ChecksumMismatch), "{e:?}");
    assert!(leftovers(dir.path()).is_empty());
}

#[tokio::test]
async fn a_body_of_another_size_than_the_pin_is_refused() {
    let body = body_of(5000);
    let served = body.clone();
    let server = serve(move |_, s| respond(s, "200 OK", "", &served));
    let dir = tempfile::tempdir().unwrap();
    let url = server.url("/x");
    for size in [4000u64, 6000] {
        let dest = dir.path().join("x");
        let e = download(&Asset { url: &url, sha256: &sha256_of(&body), size }, &dest, STALL, |_, _| {}).await.unwrap_err();
        assert!(matches!(e, DownloadError::WrongSize { .. }), "{size}: {e:?}");
        assert!(e.is_integrity_failure());
        assert!(leftovers(dir.path()).is_empty(), "{size}");
    }
}

#[tokio::test]
async fn a_server_that_sends_more_than_it_announced_is_cut_at_the_pinned_size() {
    // Chunked, so no Content-Length: the cap is the only guard.
    let server = serve(|_, mut s| {
        let _ = s.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
        for _ in 0..10 {
            let _ = s.write_all(b"400\r\n");
            let _ = s.write_all(&[7u8; 1024]);
            let _ = s.write_all(b"\r\n");
        }
        let _ = s.write_all(b"0\r\n\r\n");
    });
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("x");
    let url = server.url("/x");
    let e = download(&Asset { url: &url, sha256: &sha256_of(b""), size: 2048 }, &dest, STALL, |_, _| {}).await.unwrap_err();
    assert!(matches!(e, DownloadError::WrongSize { received, .. } if received > 2048), "{e:?}");
    assert!(leftovers(dir.path()).is_empty());
}

#[tokio::test]
async fn a_stall_in_the_body_fails_and_removes_the_partial_file() {
    let body = body_of(100_000);
    let served = body.clone();
    let server = serve(move |_, s| respond_then_stall(s, &served));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("x.tar.gz");
    let url = server.url("/x");
    let started = Instant::now();

    let e = download(&Asset { url: &url, sha256: &sha256_of(&body), size: 100_000 }, &dest, STALL, |_, _| {}).await.unwrap_err();

    assert!(matches!(e, DownloadError::Stalled), "{e:?}");
    assert!(!e.is_integrity_failure());
    assert!(started.elapsed() < Duration::from_secs(3), "gave up at the stall limit, not the server's");
    assert!(leftovers(dir.path()).is_empty());
}

#[tokio::test]
async fn a_server_that_never_answers_is_a_stall() {
    let server = serve(|_, _stream| std::thread::sleep(Duration::from_secs(4)));
    let dir = tempfile::tempdir().unwrap();
    let url = server.url("/x");
    let e = download(&Asset { url: &url, sha256: &sha256_of(b""), size: 1 }, &dir.path().join("x"), STALL, |_, _| {}).await.unwrap_err();
    assert!(matches!(e, DownloadError::Stalled | DownloadError::Request(_)), "{e:?}");
    assert!(leftovers(dir.path()).is_empty());
}

#[tokio::test]
async fn dropping_the_download_removes_the_partial_file() {
    let body = body_of(100_000);
    let served = body.clone();
    let server = serve(move |_, s| respond_then_stall(s, &served));
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("x.tar.gz");
    let url = server.url("/x");
    let asset = Asset { url: &url, sha256: &sha256_of(&body), size: 100_000 };

    // The app quitting: the future is dropped while the body is half here.
    let outcome = tokio::time::timeout(Duration::from_millis(1500), download(&asset, &dest, Duration::from_secs(30), |_, _| {})).await;

    assert!(outcome.is_err(), "still downloading when dropped");
    assert!(leftovers(dir.path()).is_empty());
}

#[tokio::test]
async fn a_server_error_is_a_status() {
    let server = serve(|path, s| match path {
        "/missing" => respond(s, "404 Not Found", "", b"no"),
        _ => respond(s, "500 Internal Server Error", "", b"boom"),
    });
    let dir = tempfile::tempdir().unwrap();
    for (path, status) in [("/x", 500u16), ("/missing", 404)] {
        let url = server.url(path);
        let e = download(&Asset { url: &url, sha256: &sha256_of(b"boom"), size: 4 }, &dir.path().join("x"), STALL, |_, _| {}).await.unwrap_err();
        assert!(matches!(e, DownloadError::Status(s) if s == status), "{path}: {e:?}");
        assert!(!e.is_integrity_failure());
    }
    assert!(leftovers(dir.path()).is_empty());
}

#[tokio::test]
async fn a_refused_connection_is_a_request_error_without_the_address() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    let dir = tempfile::tempdir().unwrap();
    let url = format!("http://127.0.0.1:{port}/secret-path?token=hunter2");
    let e = download(&Asset { url: &url, sha256: &sha256_of(b""), size: 1 }, &dir.path().join("x"), Duration::from_secs(5), |_, _| {}).await.unwrap_err();
    assert!(matches!(e, DownloadError::Request(_)), "{e:?}");
    let text = e.to_string();
    assert!(!text.contains("hunter2") && !text.contains("secret-path") && !text.contains("127.0.0.1"), "{text}");
    assert!(leftovers(dir.path()).is_empty());
}

// ---------------------------------------------------------------- the cache

#[tokio::test]
async fn the_cache_downloads_once_and_replaces_a_wrong_file() {
    let body = body_of(20_000);
    let served = body.clone();
    let server = serve(move |_, s| respond(s, "200 OK", "", &served));
    let dir = tempfile::tempdir().unwrap();
    let cache = ArchiveCache::new(dir.path().join("daemon-archives"));
    let url = server.url("/x");
    let sha = sha256_of(&body);
    let asset = Asset { url: &url, sha256: &sha, size: 20_000 };

    let first = cache.get_or_download("0.0.130", "linux-x64", &asset, STALL, |_, _| {}).await.unwrap();
    assert_eq!(first, dir.path().join("daemon-archives/0.0.130/linux-x64.tar.gz"));
    assert_eq!(fs::read(&first).unwrap(), body);
    assert_eq!(server.hits(), 1);

    // A second call, with a stale partial file beside it, uses the cached file.
    fs::write(dir.path().join("daemon-archives/0.0.130/darwin-arm64.tar.gz.part"), b"half").unwrap();
    let mut progress_calls = 0;
    let second = cache.get_or_download("0.0.130", "linux-x64", &asset, STALL, |_, _| progress_calls += 1).await.unwrap();
    assert_eq!(second, first);
    assert_eq!(server.hits(), 1, "no second download");
    assert_eq!(progress_calls, 0);
    assert_eq!(leftovers(&dir.path().join("daemon-archives/0.0.130")), ["linux-x64.tar.gz"]);

    // The same size, other bytes: not the pin, fetched again.
    let mut corrupt = body.clone();
    corrupt[10] ^= 0xff;
    fs::write(&first, &corrupt).unwrap();
    cache.get_or_download("0.0.130", "linux-x64", &asset, STALL, |_, _| {}).await.unwrap();
    assert_eq!(server.hits(), 2);
    assert_eq!(fs::read(&first).unwrap(), body);

    // A truncated file too.
    fs::write(&first, &body[..100]).unwrap();
    cache.get_or_download("0.0.130", "linux-x64", &asset, STALL, |_, _| {}).await.unwrap();
    assert_eq!(server.hits(), 3);
}

#[tokio::test]
async fn the_cache_refuses_names_that_are_not_plain_and_downloads_nothing() {
    let server = serve(|_, s| respond(s, "200 OK", "", b"x"));
    let dir = tempfile::tempdir().unwrap();
    let cache = ArchiveCache::new(dir.path());
    let url = server.url("/x");
    let asset = Asset { url: &url, sha256: &sha256_of(b"x"), size: 1 };
    let e = cache.get_or_download("../x", "linux-x64", &asset, STALL, |_, _| {}).await.unwrap_err();
    assert!(matches!(e, DownloadError::InvalidName), "{e:?}");
    assert_eq!(server.hits(), 0);
}

#[tokio::test]
async fn a_failed_download_leaves_the_cache_empty_of_that_file() {
    let server = serve(|_, s| respond(s, "500 Internal Server Error", "", b""));
    let dir = tempfile::tempdir().unwrap();
    let cache = ArchiveCache::new(dir.path());
    let url = server.url("/x");
    let asset = Asset { url: &url, sha256: &sha256_of(b"x"), size: 1 };
    assert!(cache.get_or_download("1.0.0", "linux-x64", &asset, STALL, |_, _| {}).await.is_err());
    assert!(leftovers(&dir.path().join("1.0.0")).is_empty());
}

// ---------------------------------------------------------------- archives

/// One entry of a test archive, written as given (names may hold `..`: the tar crate's own builder refuses them).
enum Spec<'a> {
    File { path: &'a str, body: &'a [u8], mode: u32 },
    Dir(&'a str),
    Symlink { path: &'a str, target: &'a str },
    Hardlink { path: &'a str, target: &'a str },
    Fifo(&'a str),
}

fn header(path: &str, kind: EntryType, mode: u32, size: u64, link: Option<&str>) -> Header {
    let mut header = Header::new_gnu();
    let old = header.as_old_mut();
    old.name[..path.len()].copy_from_slice(path.as_bytes());
    if let Some(link) = link {
        old.linkname[..link.len()].copy_from_slice(link.as_bytes());
    }
    header.set_entry_type(kind);
    header.set_mode(mode);
    header.set_size(size);
    header.set_mtime(1_700_000_000);
    header.set_cksum();
    header
}

fn tar_gz(specs: &[Spec<'_>]) -> Vec<u8> {
    let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
    for spec in specs {
        match spec {
            Spec::File { path, body, mode } => builder.append(&header(path, EntryType::Regular, *mode, body.len() as u64, None), *body).unwrap(),
            Spec::Dir(path) => builder.append(&header(path, EntryType::Directory, 0o755, 0, None), std::io::empty()).unwrap(),
            Spec::Symlink { path, target } => builder.append(&header(path, EntryType::Symlink, 0o777, 0, Some(target)), std::io::empty()).unwrap(),
            Spec::Hardlink { path, target } => builder.append(&header(path, EntryType::Link, 0o644, 0, Some(target)), std::io::empty()).unwrap(),
            Spec::Fifo(path) => builder.append(&header(path, EntryType::Fifo, 0o644, 0, None), std::io::empty()).unwrap(),
        }
    }
    builder.into_inner().unwrap().finish().unwrap()
}

fn script(body: &str) -> Vec<u8> {
    format!("#!/bin/sh\n{body}\n").into_bytes()
}

/// An archive as the release builds it: one top folder holding `pi-studio` (a script answering `version`) and other files.
fn release_archive(version: &str) -> Vec<u8> {
    let program = script(&format!("echo {version}"));
    tar_gz(&[
        Spec::Dir("pi-studio-top/"),
        Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 },
        Spec::Dir("pi-studio-top/web/"),
        Spec::File { path: "pi-studio-top/web/index.html", body: b"<html>", mode: 0o664 },
        Spec::Symlink { path: "pi-studio-top/bun", target: "pi-studio" },
    ])
}

struct Machine {
    _dir: tempfile::TempDir,
    archives: PathBuf,
    bin: PathBuf,
}

impl Machine {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let archives = dir.path().join("archives");
        let bin = dir.path().join("home").join("bin");
        fs::create_dir_all(&archives).unwrap();
        Self { _dir: dir, archives, bin }
    }

    fn archive(&self, bytes: &[u8]) -> PathBuf {
        let path = self.archives.join(format!("a{}.tar.gz", fs::read_dir(&self.archives).unwrap().count()));
        fs::write(&path, bytes).unwrap();
        path
    }

    fn install(&self, bytes: &[u8], version: &str) -> Result<(), InstallError> {
        install_version(&self.archive(bytes), &self.bin, version)
    }

    /// Nothing the install made is left outside `versions/` and `current`.
    fn assert_no_traces(&self) {
        assert!(self.bin.join("tmp").read_dir().is_ok_and(|mut d| d.next().is_none()), "bin/tmp is empty");
        assert!(!self.bin.join("current.new").exists());
    }
}

// ---------------------------------------------------------------- install

#[test]
fn install_unpacks_checks_moves_and_switches() {
    let m = Machine::new();
    m.install(&release_archive("0.0.130"), "0.0.130").unwrap();

    let dir = version_dir(&m.bin, "0.0.130");
    assert_eq!(dir, m.bin.join("versions/0.0.130"));
    assert_eq!(binary_version(&dir.join("pi-studio"), Duration::from_secs(10)).unwrap(), "0.0.130");
    assert_eq!(fs::read(dir.join("web/index.html")).unwrap(), b"<html>");
    assert_eq!(fs::read_link(dir.join("bun")).unwrap(), PathBuf::from("pi-studio"));
    assert_eq!(fs::metadata(dir.join("pi-studio")).unwrap().permissions().mode() & 0o777, 0o755);
    assert_eq!(fs::metadata(dir.join("web/index.html")).unwrap().permissions().mode() & 0o777, 0o644, "group write is dropped");
    assert_eq!(current_version(&m.bin).as_deref(), Some("0.0.130"));
    assert_eq!(fs::read_link(m.bin.join("current")).unwrap(), PathBuf::from("versions/0.0.130"));
    assert_eq!(binary_version(&m.bin.join("current/pi-studio"), Duration::from_secs(10)).unwrap(), "0.0.130");
    assert_eq!(leftovers(&m.bin.join("versions")), ["0.0.130"]);
    m.assert_no_traces();
}

#[test]
fn install_accepts_a_program_at_the_archive_root() {
    let m = Machine::new();
    let program = script("echo 1.0.0");
    m.install(&tar_gz(&[Spec::File { path: "./pi-studio", body: &program, mode: 0o755 }]), "1.0.0").unwrap();
    assert_eq!(current_version(&m.bin).as_deref(), Some("1.0.0"));
    m.assert_no_traces();
}

#[test]
fn a_second_install_switches_current_and_keeps_the_first() {
    let m = Machine::new();
    m.install(&release_archive("1.0.0"), "1.0.0").unwrap();
    m.install(&release_archive("2.0.0"), "2.0.0").unwrap();
    assert_eq!(current_version(&m.bin).as_deref(), Some("2.0.0"));
    assert_eq!(leftovers(&m.bin.join("versions")), ["1.0.0", "2.0.0"]);

    prune(&m.bin, &["1.0.0"]).unwrap();
    assert_eq!(leftovers(&m.bin.join("versions")), ["1.0.0", "2.0.0"], "current is never pruned");
    m.install(&release_archive("3.0.0"), "3.0.0").unwrap();
    prune(&m.bin, &["2.0.0"]).unwrap();
    assert_eq!(leftovers(&m.bin.join("versions")), ["2.0.0", "3.0.0"]);
    assert_eq!(current_version(&m.bin).as_deref(), Some("3.0.0"));
}

#[test]
fn reinstalling_replaces_a_broken_folder_and_removes_what_an_interrupted_install_left() {
    let m = Machine::new();
    fs::create_dir_all(m.bin.join("versions/1.0.0")).unwrap();
    fs::write(m.bin.join("versions/1.0.0/pi-studio"), b"not a program").unwrap();
    fs::create_dir_all(m.bin.join("tmp/dead/inner")).unwrap();
    fs::write(m.bin.join("tmp/dead/inner/file"), b"x").unwrap();
    fs::write(m.bin.join("tmp/stray.part"), b"x").unwrap();

    m.install(&release_archive("1.0.0"), "1.0.0").unwrap();

    assert_eq!(binary_version(&m.bin.join("current/pi-studio"), Duration::from_secs(10)).unwrap(), "1.0.0");
    assert_eq!(fs::read(m.bin.join("versions/1.0.0/web/index.html")).unwrap(), b"<html>", "the broken folder was replaced whole");
    m.assert_no_traces();
}

#[test]
fn an_entry_with_dotdot_is_refused_and_nothing_leaves_the_folder() {
    let m = Machine::new();
    let program = script("echo 1.0.0");
    let archive = tar_gz(&[
        Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 },
        Spec::File { path: "pi-studio-top/../../evil", body: b"pwned", mode: 0o644 },
    ]);
    let e = m.install(&archive, "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::UnsafeEntry(_)), "{e:?}");
    assert!(!m.bin.join("evil").exists() && !m.bin.join("tmp/evil").exists());
    assert!(!m.bin.join("versions").exists());
    assert_eq!(current_version(&m.bin), None);
    m.assert_no_traces();
}

#[test]
fn an_absolute_entry_is_refused() {
    let m = Machine::new();
    let target = m._dir.path().join("abs-target");
    let path = target.to_str().unwrap();
    let e = m.install(&tar_gz(&[Spec::File { path, body: b"x", mode: 0o644 }]), "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::UnsafeEntry(_)), "{e:?}");
    assert!(!target.exists());
}

#[test]
fn a_symlink_that_leaves_the_folder_is_refused() {
    let m = Machine::new();
    let program = script("echo 1.0.0");
    let outside = m._dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let absolute = outside.to_str().unwrap().to_string();
    let cases: [(&str, &str); 5] = [
        ("pi-studio-top/escape", "../../../outside"),
        ("pi-studio-top/web/escape", "../../../../outside"),
        ("pi-studio-top/escape", absolute.as_str()),
        ("pi-studio-top/escape", "/etc/passwd"),
        // Inside by its count of `..`, outside through the link `up` that the archive made first.
        ("pi-studio-top/web/deep/via", "up/.."),
    ];
    for (path, target) in cases {
        let archive = tar_gz(&[
            Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 },
            Spec::Symlink { path: "pi-studio-top/web/deep/up", target: "../.." },
            Spec::Symlink { path, target },
        ]);
        let e = m.install(&archive, "1.0.0").unwrap_err();
        assert!(matches!(e, InstallError::UnsafeEntry(_)), "{path} -> {target}: {e:?}");
        assert!(!m.bin.join("versions").exists(), "{path} -> {target}");
        m.assert_no_traces();
    }
    assert!(leftovers(&outside).is_empty());
}

#[test]
fn a_write_through_a_link_that_points_out_is_refused() {
    // The link itself is refused first; this pins that a file named below it cannot be reached either.
    let m = Machine::new();
    let program = script("echo 1.0.0");
    let outside = m._dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let archive = tar_gz(&[
        Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 },
        Spec::Symlink { path: "pi-studio-top/link", target: "../../../outside" },
        Spec::File { path: "pi-studio-top/link/payload", body: b"pwned", mode: 0o644 },
    ]);
    assert!(m.install(&archive, "1.0.0").is_err());
    assert!(leftovers(&outside).is_empty());
}

#[test]
fn hard_links_and_special_files_are_refused() {
    let m = Machine::new();
    let program = script("echo 1.0.0");
    for spec in [Spec::Hardlink { path: "pi-studio-top/h", target: "pi-studio-top/pi-studio" }, Spec::Fifo("pi-studio-top/f")] {
        let archive = tar_gz(&[Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 }, spec]);
        let e = m.install(&archive, "1.0.0").unwrap_err();
        assert!(matches!(e, InstallError::UnsafeEntry(_)), "{e:?}");
        m.assert_no_traces();
    }
}

#[test]
fn setuid_and_world_writable_bits_are_dropped() {
    let m = Machine::new();
    let program = script("echo 1.0.0");
    let archive = tar_gz(&[
        Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o4777 },
        Spec::File { path: "pi-studio-top/other", body: b"x", mode: 0o666 },
    ]);
    m.install(&archive, "1.0.0").unwrap();
    let mode = |name: &str| fs::metadata(m.bin.join("versions/1.0.0").join(name)).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode("pi-studio"), 0o755);
    assert_eq!(mode("other"), 0o644);
}

#[test]
fn a_binary_answering_another_version_is_not_installed() {
    let m = Machine::new();
    m.install(&release_archive("1.0.0"), "1.0.0").unwrap();

    let e = m.install(&release_archive("9.9.9"), "2.0.0").unwrap_err();

    assert!(matches!(&e, InstallError::WrongVersion { found } if found == "9.9.9"), "{e:?}");
    assert_eq!(e.output(), Some("9.9.9"));
    assert_eq!(leftovers(&m.bin.join("versions")), ["1.0.0"], "the failed folder is gone");
    assert_eq!(current_version(&m.bin).as_deref(), Some("1.0.0"), "current did not move");
    m.assert_no_traces();
}

#[test]
fn a_binary_that_does_not_run_fails_with_its_output() {
    let m = Machine::new();
    let program = script("echo 'GLIBC_2.99 not found' >&2; exit 1");
    let archive = tar_gz(&[Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 }]);
    let e = m.install(&archive, "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::Version(VersionError::Failed { code: Some(1), .. })), "{e:?}");
    assert_eq!(e.output(), Some("GLIBC_2.99 not found"));
    assert!(!m.bin.join("versions").exists());
    m.assert_no_traces();
}

#[test]
fn a_binary_that_cannot_be_started_is_a_version_error() {
    let m = Machine::new();
    let archive = tar_gz(&[Spec::File { path: "pi-studio-top/pi-studio", body: b"#!/bin/sh\n", mode: 0o644 }]);
    let e = m.install(&archive, "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::Version(VersionError::Spawn(_))), "{e:?}");
    m.assert_no_traces();
}

#[test]
fn a_binary_that_hangs_is_killed_and_not_installed() {
    let m = Machine::new();
    let program = script("exec sleep 30");
    let archive = m.archive(&tar_gz(&[Spec::File { path: "pi-studio-top/pi-studio", body: &program, mode: 0o755 }]));
    let started = Instant::now();
    let e = crate::install::install_with_limit(&archive, &m.bin, "1.0.0", Duration::from_millis(300)).unwrap_err();
    assert!(matches!(e, InstallError::Version(VersionError::TimedOut { .. })), "{e:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!m.bin.join("versions").exists());
    m.assert_no_traces();
}

#[test]
fn an_archive_without_the_program_or_that_is_not_an_archive_fails() {
    let m = Machine::new();
    let e = m.install(&tar_gz(&[Spec::File { path: "pi-studio-top/readme", body: b"x", mode: 0o644 }]), "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::NoBinary), "{e:?}");

    // Two top folders: which one is the program's is not guessed.
    let program = script("echo 1.0.0");
    let two = tar_gz(&[Spec::File { path: "a/pi-studio", body: &program, mode: 0o755 }, Spec::File { path: "b/x", body: b"x", mode: 0o644 }]);
    assert!(matches!(m.install(&two, "1.0.0").unwrap_err(), InstallError::NoBinary));

    let e = m.install(b"this is not a gzip file at all", "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::Unpack(_)), "{e:?}");

    let good = release_archive("1.0.0");
    let e = m.install(&good[..good.len() / 2], "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::Unpack(_)), "{e:?}");

    let e = install_version(&m.archives.join("absent.tar.gz"), &m.bin, "1.0.0").unwrap_err();
    assert!(matches!(e, InstallError::Unpack(_)), "{e:?}");
    assert!(!m.bin.join("versions").exists());
    m.assert_no_traces();
}

#[test]
fn a_version_that_is_not_a_plain_name_is_refused() {
    let m = Machine::new();
    for version in ["../x", "", "a/b", ".."] {
        let e = m.install(&release_archive("1.0.0"), version).unwrap_err();
        assert!(matches!(e, InstallError::InvalidName), "{version}: {e:?}");
    }
    assert!(!m.bin.exists());
}
