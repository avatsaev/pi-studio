//! The channel against the published relay fixtures (`packages/protocol/fixtures/external-clients/relay/`,
//! read from the repository) and against hostile frames from a daemon this file plays.
//!
//! The fixtures use fixed keys and a fixed salt, which the channel takes as inputs. Every frame the
//! channel builds must equal its fixture byte for byte, and every daemon frame of the fixtures must open
//! to what the fixture says. The shared key itself is not readable from `crypto_box` (`SalsaBox` keeps
//! it inside), so `sharedKey` is proved by those bytes: a box is sealed under it, byte for byte.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use crypto_box::aead::Aead;
use crypto_box::{PublicKey, SalsaBox, SecretKey};
use serde_json::{Value, json};

use super::{
    CHANNEL_VERSION, CLIENT_TO_DAEMON, Channel, ChannelError, Counter, DAEMON_TO_CLIENT, HELLO_LENGTH, KEY_LENGTH, KIND_READY, KeyPair, Record, RecordKind,
    SALT_LENGTH, nonce,
};
use crate::session_id;

/// The only `formatVersion` of `manifest.json` this code reads.
const SUPPORTED_FORMAT_VERSION: u64 = 1;
const GROUPS: [&str; 4] = ["keys", "control", "close_codes", "channel"];

fn fixture_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/protocol/fixtures/external-clients/relay"))
}

/// The manifest's verdict on the files of a directory: its `formatVersion` is the supported one, every
/// entry names a file and a known group, and the listed files are exactly the files there are.
fn check_listing(manifest: &Value, on_disk: &BTreeSet<String>) -> Result<Vec<String>, String> {
    let version = manifest.get("formatVersion").and_then(Value::as_u64);
    if version != Some(SUPPORTED_FORMAT_VERSION) {
        return Err(format!("formatVersion {version:?} is not {SUPPORTED_FORMAT_VERSION}"));
    }
    let entries = manifest.get("files").and_then(Value::as_array).ok_or("the manifest lists no files")?;
    let mut listed = BTreeSet::new();
    for entry in entries {
        let file = entry.get("file").and_then(Value::as_str).ok_or("an entry has no file")?;
        let group = entry.get("group").and_then(Value::as_str).ok_or("an entry has no group")?;
        if !GROUPS.contains(&group) {
            return Err(format!("{file} has the unknown group {group}"));
        }
        if !listed.insert(file.to_owned()) {
            return Err(format!("{file} is listed twice"));
        }
    }
    if let Some(missing) = listed.difference(on_disk).next() {
        return Err(format!("{missing} is listed but missing"));
    }
    if let Some(unlisted) = on_disk.difference(&listed).next() {
        return Err(format!("{unlisted} is not listed"));
    }
    Ok(listed.into_iter().collect())
}

/// Every listed fixture file, parsed, after the manifest accepted the directory.
struct Fixtures(BTreeMap<String, Value>);

impl Fixtures {
    fn load() -> Self {
        let dir = fixture_dir();
        let read = |path: PathBuf| -> Value {
            let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
        };
        let manifest = read(dir.join("manifest.json"));
        let on_disk: BTreeSet<String> = std::fs::read_dir(&dir)
            .expect("the fixture directory reads")
            .map(|entry| entry.expect("an entry reads").file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".json") && name != "manifest.json")
            .collect();
        let files = check_listing(&manifest, &on_disk).unwrap_or_else(|reason| panic!("the relay fixtures: {reason}"));
        Self(files.into_iter().map(|file| (file.clone(), read(dir.join(&file)))).collect())
    }

    fn get(&self, file: &str) -> &Value {
        self.0.get(file).unwrap_or_else(|| panic!("{file} is not listed"))
    }

    fn key(&self, name: &str) -> [u8; KEY_LENGTH] {
        hex_of(self.get("keys.json"), name).try_into().expect("a key is 32 bytes")
    }

    fn salt(&self) -> [u8; SALT_LENGTH] {
        hex_of(self.get("keys.json"), "salt").try_into().expect("the salt is 15 bytes")
    }
}

/// The bytes of a space-separated hex string.
fn parse_hex(text: &str) -> Vec<u8> {
    text.split_whitespace().map(|pair| u8::from_str_radix(pair, 16).expect("two hex digits")).collect()
}

fn hex_of(value: &Value, name: &str) -> Vec<u8> {
    parse_hex(value.get(name).and_then(Value::as_str).unwrap_or_else(|| panic!("no {name}")))
}

/// The daemon end, as far as the tests need: it seals under its own secret key and the client's public key.
struct Daemon {
    cipher: SalsaBox,
    salt: [u8; SALT_LENGTH],
}

impl Daemon {
    fn new(fixtures: &Fixtures) -> Self {
        Self::with_secret(fixtures, fixtures.key("daemonSecretKey"))
    }

    fn with_secret(fixtures: &Fixtures, secret: [u8; KEY_LENGTH]) -> Self {
        let client = PublicKey::from_bytes(fixtures.key("clientPublicKey"));
        Self { cipher: SalsaBox::new(&client, &SecretKey::from_bytes(secret)), salt: fixtures.salt() }
    }

    fn seal(&self, direction: u8, counter: u64, plain: &[u8]) -> Vec<u8> {
        self.cipher.encrypt(&nonce(&self.salt, direction, counter), plain).expect("the daemon seals")
    }

    /// A box to the client at the daemon-to-client `counter`.
    fn to_client(&self, counter: u64, plain: &[u8]) -> Vec<u8> {
        self.seal(DAEMON_TO_CLIENT, counter, plain)
    }

    /// A `ready` frame whose box holds `plain`, at counter 0.
    fn ready_with(&self, plain: &[u8]) -> Vec<u8> {
        [&[CHANNEL_VERSION][..], &self.salt, &self.to_client(0, plain)].concat()
    }

    fn ready(&self) -> Vec<u8> {
        self.ready_with(&[KIND_READY])
    }
}

fn new_channel(fixtures: &Fixtures) -> Channel {
    Channel::new(&fixtures.key("daemonPublicKey"), &KeyPair::from_secret(fixtures.key("clientSecretKey")))
}

/// A channel whose `ready` box has opened, and the daemon that sent it (its next counter is 1).
fn open_channel() -> (Channel, Daemon) {
    let fixtures = Fixtures::load();
    let daemon = Daemon::new(&fixtures);
    let mut channel = new_channel(&fixtures);
    channel.accept_ready(&daemon.ready()).expect("the ready box opens");
    (channel, daemon)
}

// ---- the fixtures ----

#[test]
fn the_manifest_lists_exactly_the_files_there_are() {
    let fixtures = Fixtures::load();
    assert_eq!(fixtures.0.len(), 15);
}

#[test]
fn the_manifest_refuses_an_unlisted_or_missing_file_and_any_other_version() {
    let manifest = json!({ "formatVersion": 1, "files": [{ "file": "a.json", "group": "keys" }, { "file": "b.json", "group": "channel" }] });
    let both: BTreeSet<String> = ["a.json", "b.json"].map(String::from).into();
    assert_eq!(check_listing(&manifest, &both), Ok(vec!["a.json".to_owned(), "b.json".to_owned()]));

    let only_a: BTreeSet<String> = ["a.json"].map(String::from).into();
    assert_eq!(check_listing(&manifest, &only_a), Err("b.json is listed but missing".to_owned()));

    let extra: BTreeSet<String> = ["a.json", "b.json", "c.json"].map(String::from).into();
    assert_eq!(check_listing(&manifest, &extra), Err("c.json is not listed".to_owned()));

    for version in [json!(0), json!(2), json!("1"), Value::Null] {
        let other = json!({ "formatVersion": version, "files": [] });
        assert!(check_listing(&other, &BTreeSet::new()).is_err(), "formatVersion {version} was accepted");
    }
    let no_version = json!({ "files": [] });
    assert!(check_listing(&no_version, &BTreeSet::new()).is_err());

    let unknown_group = json!({ "formatVersion": 1, "files": [{ "file": "a.json", "group": "other" }] });
    assert!(check_listing(&unknown_group, &only_a).is_err());
    let twice = json!({ "formatVersion": 1, "files": [{ "file": "a.json", "group": "keys" }, { "file": "a.json", "group": "keys" }] });
    assert!(check_listing(&twice, &only_a).is_err());
}

#[test]
fn the_keys_derive_the_session_id_and_the_public_keys() {
    let fixtures = Fixtures::load();
    let keys = fixtures.get("keys.json");
    assert_eq!(session_id(&fixtures.key("daemonPublicKey")), keys["sessionId"].as_str().expect("a session id"));
    assert_eq!(KeyPair::from_secret(fixtures.key("clientSecretKey")).public(), fixtures.key("clientPublicKey"));
    assert_eq!(SecretKey::from_bytes(fixtures.key("daemonSecretKey")).public_key().to_bytes(), fixtures.key("daemonPublicKey"));
}

#[test]
fn the_session_id_is_32_lowercase_hex_characters() {
    for key in [[0u8; KEY_LENGTH], [0xff; KEY_LENGTH]] {
        let id = session_id(&key);
        assert_eq!(id.len(), 32);
        assert!(id.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)), "{id}");
    }
    assert_ne!(session_id(&[0; KEY_LENGTH]), session_id(&[1; KEY_LENGTH]));
}

#[test]
fn hello_ready_and_both_client_frames_are_rebuilt_byte_for_byte() {
    let fixtures = Fixtures::load();
    let mut channel = new_channel(&fixtures);

    let hello = channel.hello();
    assert_eq!(hello.len(), HELLO_LENGTH);
    assert_eq!(hello, hex_of(fixtures.get("channel.hello.json"), "hex"));

    // The daemon side rebuilt from the fixtures' keys and salt makes the very frame of `ready`.
    let daemon = Daemon::new(&fixtures);
    let ready = hex_of(fixtures.get("channel.ready.json"), "hex");
    assert_eq!(daemon.ready(), ready);
    assert!(!channel.is_open());
    channel.accept_ready(&ready).expect("the fixture's ready opens");
    assert!(channel.is_open());

    let text = fixtures.get("channel.client_to_daemon.text.json");
    let payload = text["decoded"]["payload"].as_str().expect("a text payload");
    assert_eq!(channel.seal(RecordKind::Text, payload.as_bytes()).expect("seals"), hex_of(text, "hex"));

    let binary = fixtures.get("channel.client_to_daemon.binary.json");
    let payload = hex_of(&binary["decoded"], "payloadHex");
    assert_eq!(channel.seal(RecordKind::Binary, &payload).expect("seals"), hex_of(binary, "hex"));
}

#[test]
fn the_nonce_is_the_fixtures_nonce() {
    let fixtures = Fixtures::load();
    let ready = fixtures.get("channel.ready.json");
    assert_eq!(nonce(&fixtures.salt(), DAEMON_TO_CLIENT, 0).as_slice(), hex_of(&ready["decoded"], "nonce"));
    let binary = fixtures.get("channel.daemon_to_client.binary.json");
    assert_eq!(nonce(&fixtures.salt(), DAEMON_TO_CLIENT, 2).as_slice(), hex_of(&binary["decoded"], "nonce"));
    let text = fixtures.get("channel.client_to_daemon.text.json");
    assert_eq!(nonce(&fixtures.salt(), CLIENT_TO_DAEMON, 0).as_slice(), hex_of(&text["decoded"], "nonce"));
}

#[test]
fn the_two_daemon_frames_open_to_what_the_fixtures_say() {
    let fixtures = Fixtures::load();
    let mut channel = new_channel(&fixtures);
    channel.accept_ready(&hex_of(fixtures.get("channel.ready.json"), "hex")).expect("the fixture's ready opens");

    let text = fixtures.get("channel.daemon_to_client.text.json");
    let expected = text["decoded"]["payload"].as_str().expect("a text payload");
    assert_eq!(channel.open(&hex_of(text, "hex")), Ok(Record::Text(expected.to_owned())));

    let binary = fixtures.get("channel.daemon_to_client.binary.json");
    assert_eq!(channel.open(&hex_of(binary, "hex")), Ok(Record::Binary(hex_of(&binary["decoded"], "payloadHex"))));
}

#[test]
fn the_daemon_opens_what_the_client_seals() {
    let fixtures = Fixtures::load();
    let (mut channel, daemon) = open_channel();
    let frame = channel.seal(RecordKind::Text, b"hi").expect("seals");
    let plain = daemon.cipher.decrypt(&nonce(&daemon.salt, CLIENT_TO_DAEMON, 0), frame.as_slice()).expect("the daemon opens it");
    assert_eq!(plain, [&[1u8][..], b"hi"].concat());
    assert_eq!(fixtures.salt(), daemon.salt);
}

// ---- records ----

#[test]
fn text_and_binary_records_open_in_order_and_may_be_empty() {
    let (mut channel, daemon) = open_channel();
    assert_eq!(channel.open(&daemon.to_client(1, &[1, b'o', b'k'])), Ok(Record::Text("ok".to_owned())));
    assert_eq!(channel.open(&daemon.to_client(2, &[2, 0, 255])), Ok(Record::Binary(vec![0, 255])));
    assert_eq!(channel.open(&daemon.to_client(3, &[1])), Ok(Record::Text(String::new())));
    assert_eq!(channel.open(&daemon.to_client(4, &[2])), Ok(Record::Binary(Vec::new())));
}

#[test]
fn a_client_counts_each_direction_apart() {
    let (mut channel, daemon) = open_channel();
    let first = channel.seal(RecordKind::Binary, &[1]).expect("seals");
    let second = channel.seal(RecordKind::Binary, &[1]).expect("seals");
    assert_ne!(first, second);
    channel.open(&daemon.to_client(1, &[2])).expect("opens");
    let third = channel.seal(RecordKind::Binary, &[1]).expect("seals");
    let plain = daemon.cipher.decrypt(&nonce(&daemon.salt, CLIENT_TO_DAEMON, 2), third.as_slice()).expect("the third box is at counter 2");
    assert_eq!(plain, [2, 1]);
}

// ---- refusals: the ready frame ----

#[test]
fn a_malformed_ready_closes_the_channel() {
    let fixtures = Fixtures::load();
    let daemon = Daemon::new(&fixtures);
    let good = daemon.ready();
    let mut wrong_version = good.clone();
    wrong_version[0] = 0x02;
    let cases: [(&str, Vec<u8>); 5] = [
        ("empty", Vec::new()),
        ("only the version", vec![CHANNEL_VERSION]),
        ("one byte short of the smallest ready", good[..1 + SALT_LENGTH + 16].to_vec()),
        ("a box that is only a tag", [&[CHANNEL_VERSION][..], &daemon.salt, &daemon.to_client(0, &[])].concat()),
        ("another version", wrong_version),
    ];
    for (name, frame) in cases {
        let mut channel = new_channel(&fixtures);
        assert_eq!(channel.accept_ready(&frame), Err(ChannelError::MalformedReady), "{name}");
        assert_eq!(channel.accept_ready(&good), Err(ChannelError::Closed), "{name}: the channel is closed for good");
        assert!(!channel.is_open(), "{name}");
    }
}

#[test]
fn a_ready_box_that_does_not_open_closes_the_channel() {
    let fixtures = Fixtures::load();
    let mut channel = new_channel(&fixtures);
    // A daemon that does not hold the secret key of the key the client dialled.
    let impostor = Daemon::with_secret(&fixtures, [9; KEY_LENGTH]);
    assert_eq!(channel.accept_ready(&impostor.ready()), Err(ChannelError::BoxDidNotOpen));
    assert_eq!(channel.seal(RecordKind::Text, b"x"), Err(ChannelError::Closed));

    let daemon = Daemon::new(&fixtures);
    for index in [0, 1 + SALT_LENGTH, daemon.ready().len() - 1] {
        let mut tampered = daemon.ready();
        tampered[index] ^= 0x01;
        let mut channel = new_channel(&fixtures);
        let expected = if index == 0 { ChannelError::MalformedReady } else { ChannelError::BoxDidNotOpen };
        assert_eq!(channel.accept_ready(&tampered), Err(expected), "byte {index}");
    }
}

#[test]
fn a_ready_box_of_another_record_closes_the_channel() {
    let fixtures = Fixtures::load();
    let daemon = Daemon::new(&fixtures);
    for (name, plain) in [("text", vec![1, b'x']), ("binary", vec![2, 0]), ("ready with a payload", vec![0, 0]), ("unknown", vec![7])] {
        let mut channel = new_channel(&fixtures);
        assert_eq!(channel.accept_ready(&daemon.ready_with(&plain)), Err(ChannelError::NotAReadyRecord), "{name}");
        assert_eq!(channel.open(&daemon.to_client(1, &[1])), Err(ChannelError::Closed), "{name}");
    }
}

#[test]
fn a_second_ready_changes_nothing() {
    let (mut channel, daemon) = open_channel();
    assert_eq!(channel.accept_ready(&daemon.ready()), Err(ChannelError::AlreadyReady));
    assert!(channel.is_open());
    assert_eq!(channel.open(&daemon.to_client(1, &[1, b'a'])), Ok(Record::Text("a".to_owned())));
}

#[test]
fn nothing_is_sealed_or_opened_before_the_ready_box_opened() {
    let fixtures = Fixtures::load();
    let daemon = Daemon::new(&fixtures);
    let mut channel = new_channel(&fixtures);
    assert_eq!(channel.seal(RecordKind::Text, b"x"), Err(ChannelError::NotReady));
    assert_eq!(channel.open(&daemon.to_client(1, &[1])), Err(ChannelError::NotReady));
    // A mistake of the caller, not a bad frame: the handshake can still finish.
    assert_eq!(channel.accept_ready(&daemon.ready()), Ok(()));
}

// ---- refusals: messages ----

/// Every bad frame closes the channel and the channel then takes nothing.
fn assert_closed_after(channel: &mut Channel, daemon: &Daemon, error: ChannelError, frame: &[u8]) {
    assert_eq!(channel.open(frame), Err(error));
    assert!(!channel.is_open());
    assert_eq!(channel.open(&daemon.to_client(1, &[1, b'a'])), Err(ChannelError::Closed));
    assert_eq!(channel.seal(RecordKind::Text, b"x"), Err(ChannelError::Closed));
    assert_eq!(channel.accept_ready(&daemon.ready()), Err(ChannelError::Closed));
}

#[test]
fn a_box_below_17_bytes_is_refused() {
    for length in [0, 1, 15, 16] {
        let (mut channel, daemon) = open_channel();
        assert_closed_after(&mut channel, &daemon, ChannelError::BoxTooShort, &vec![0u8; length]);
    }
}

#[test]
fn an_empty_record_is_refused() {
    // A record of no bytes seals to a bare 16-byte tag, which is below the smallest box.
    let (mut channel, daemon) = open_channel();
    let frame = daemon.to_client(1, &[]);
    assert_eq!(frame.len(), 16);
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxTooShort, &frame);
}

#[test]
fn an_unknown_record_kind_is_refused() {
    for kind in [0x03, 0x7f, 0xff] {
        let (mut channel, daemon) = open_channel();
        assert_closed_after(&mut channel, &daemon, ChannelError::UnknownKind, &daemon.to_client(1, &[kind, 1, 2]));
    }
}

#[test]
fn a_ready_record_after_ready_is_refused() {
    for plain in [vec![0x00], vec![0x00, 1, 2]] {
        let (mut channel, daemon) = open_channel();
        assert_closed_after(&mut channel, &daemon, ChannelError::UnexpectedReady, &daemon.to_client(1, &plain));
    }
}

#[test]
fn a_text_record_that_is_not_utf8_is_refused() {
    let (mut channel, daemon) = open_channel();
    assert_closed_after(&mut channel, &daemon, ChannelError::NotUtf8, &daemon.to_client(1, &[1, 0xff, 0xfe]));
}

#[test]
fn a_box_that_does_not_open_is_refused() {
    let (mut channel, daemon) = open_channel();
    let mut tampered = daemon.to_client(1, &[1, b'a']);
    if let Some(last) = tampered.last_mut() {
        *last ^= 0x80;
    }
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxDidNotOpen, &tampered);
}

#[test]
fn a_dropped_reordered_or_replayed_box_is_refused() {
    // Dropped: the daemon's counter 1 never arrives and counter 2 does.
    let (mut channel, daemon) = open_channel();
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxDidNotOpen, &daemon.to_client(2, &[1, b'a']));

    // Replayed: counter 1 is accepted once and then again.
    let (mut channel, daemon) = open_channel();
    let first = daemon.to_client(1, &[1, b'a']);
    assert_eq!(channel.open(&first), Ok(Record::Text("a".to_owned())));
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxDidNotOpen, &first);

    // Ready replayed as a message.
    let (mut channel, daemon) = open_channel();
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxDidNotOpen, &daemon.to_client(0, &[KIND_READY]));
}

#[test]
fn a_box_sent_back_to_its_sender_is_refused() {
    let (mut channel, daemon) = open_channel();
    let own = channel.seal(RecordKind::Text, b"echo").expect("seals");
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxDidNotOpen, &own);
}

#[test]
fn a_box_sealed_under_another_connections_salt_is_refused() {
    let (mut channel, mut daemon) = open_channel();
    daemon.salt = [0; SALT_LENGTH];
    let frame = daemon.to_client(1, &[1, b'a']);
    assert_closed_after(&mut channel, &daemon, ChannelError::BoxDidNotOpen, &frame);
}

// ---- counters ----

#[test]
fn the_send_counter_refuses_to_pass_2_to_the_64_minus_1() {
    let (mut channel, daemon) = open_channel();
    channel.sent = Counter::new(u64::MAX);
    let last = channel.seal(RecordKind::Binary, &[1]).expect("the last counter is usable");
    let plain = daemon.cipher.decrypt(&nonce(&daemon.salt, CLIENT_TO_DAEMON, u64::MAX), last.as_slice()).expect("opens at the last counter");
    assert_eq!(plain, [2, 1]);
    assert_eq!(channel.seal(RecordKind::Binary, &[1]), Err(ChannelError::CounterLimit));
    assert_eq!(channel.seal(RecordKind::Binary, &[1]), Err(ChannelError::Closed));
    assert!(!channel.is_open());
}

#[test]
fn the_receive_counter_refuses_to_pass_2_to_the_64_minus_1() {
    let (mut channel, daemon) = open_channel();
    channel.received = Counter::new(u64::MAX);
    assert_eq!(channel.open(&daemon.to_client(u64::MAX, &[1, b'z'])), Ok(Record::Text("z".to_owned())));
    // A wrapped counter would reuse nonce 0; the box is not even tried.
    assert_closed_after(&mut channel, &daemon, ChannelError::CounterLimit, &daemon.to_client(0, &[1, b'a']));
}

// ---- keys ----

#[test]
fn a_generated_key_pair_is_fresh_and_its_public_key_is_the_one_hello_carries() {
    let first = KeyPair::generate().expect("random bytes");
    let second = KeyPair::generate().expect("random bytes");
    assert_ne!(first.public(), second.public());
    let channel = Channel::new(&[7; KEY_LENGTH], &first);
    assert_eq!(&channel.hello()[1..], first.public().as_slice());
    assert_eq!(channel.hello()[0], CHANNEL_VERSION);
}

#[test]
fn a_key_pair_does_not_print_its_secret() {
    let pair = KeyPair::from_secret([0xab; KEY_LENGTH]);
    let printed = format!("{pair:?} {:?}", Channel::new(&[7; KEY_LENGTH], &pair));
    assert!(!printed.contains("171") && !printed.contains("ab, ab") && !printed.contains("abab"), "{printed}");
}
