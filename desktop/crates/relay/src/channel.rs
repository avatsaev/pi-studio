//! The client end of the encrypted channel of relay protocol 2 (`relay-protocol.md` § 4), byte for byte
//! what `packages/relay/src/channel.ts` does. No socket: the caller writes the frames this returns and
//! hands every frame it reads back in, so the whole channel is a pure function of its keys and frames.
//!
//! One [`Channel`] per connection. Frames are binary: `hello` (`0x01` ‖ the client's public key), the
//! daemon's `ready` (`0x01` ‖ salt ‖ box) and then bare boxes of `kind ‖ payload`, each sealed under
//! the nonce `salt ‖ direction ‖ counter` with a counter per direction that is never on the wire.
//!
//! Every frame is hostile: a frame that does not open with the next expected counter, in any way,
//! closes the channel for good ([`ChannelError::Closed`] from then on) and delivers nothing.

use std::fmt;

use crypto_box::aead::Aead;
use crypto_box::{Nonce, PublicKey, SalsaBox, SecretKey};

use crate::error::ChannelError;

/// The channel format version: the leading byte of `hello` and `ready`.
pub const CHANNEL_VERSION: u8 = 0x01;
/// The salt the daemon chooses for the connection.
pub const SALT_LENGTH: usize = 15;
/// A Curve25519 key.
pub const KEY_LENGTH: usize = 32;
/// The `hello` frame: the version and the client's public key.
pub const HELLO_LENGTH: usize = 1 + KEY_LENGTH;
/// The Poly1305 tag a box starts with.
const TAG_LENGTH: usize = 16;
/// The smallest valid box: a 1-byte record and its tag.
pub const MIN_BOX_LENGTH: usize = 1 + TAG_LENGTH;
/// The smallest valid `ready` frame: the version, the salt and the smallest box.
const MIN_READY_LENGTH: usize = 1 + SALT_LENGTH + MIN_BOX_LENGTH;
const NONCE_LENGTH: usize = 24;

/// Nonce direction bytes.
pub(crate) const CLIENT_TO_DAEMON: u8 = 0x01;
pub(crate) const DAEMON_TO_CLIENT: u8 = 0x02;

/// Record kind bytes (the first plaintext byte of a box).
pub(crate) const KIND_READY: u8 = 0x00;
pub(crate) const KIND_TEXT: u8 = 0x01;
pub(crate) const KIND_BINARY: u8 = 0x02;

/// What a client sends: the kind byte of a message record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordKind {
    /// UTF-8 text: one daemon-protocol JSON envelope.
    Text,
    /// Raw bytes: one daemon-protocol binary frame.
    Binary,
}

impl RecordKind {
    const fn byte(self) -> u8 {
        match self {
            Self::Text => KIND_TEXT,
            Self::Binary => KIND_BINARY,
        }
    }
}

/// A message the daemon sent, opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Record {
    Text(String),
    Binary(Vec<u8>),
}

/// The client's key pair for one connection. Generated fresh from the operating system's random source,
/// or built from given bytes (the tests' fixed keys). The secret is wiped when the pair is dropped.
pub struct KeyPair {
    secret: SecretKey,
}

impl KeyPair {
    /// A fresh pair from the operating system's random source.
    ///
    /// # Errors
    /// [`ChannelError::Random`] when the system gives no random bytes.
    pub fn generate() -> Result<Self, ChannelError> {
        let mut bytes = [0u8; KEY_LENGTH];
        getrandom::fill(&mut bytes).map_err(|_| ChannelError::Random)?;
        Ok(Self::from_secret(bytes))
    }

    /// The pair of a given secret key.
    #[must_use]
    pub fn from_secret(secret: [u8; KEY_LENGTH]) -> Self {
        Self { secret: SecretKey::from_bytes(secret) }
    }

    /// The public half, which `hello` carries.
    #[must_use]
    pub fn public(&self) -> [u8; KEY_LENGTH] {
        self.secret.public_key().to_bytes()
    }
}

impl fmt::Debug for KeyPair {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeyPair").finish_non_exhaustive()
    }
}

/// A counter that may use every value up to 2^64 − 1 and then refuses, so that a nonce never repeats.
#[derive(Debug, Clone, Copy)]
struct Counter {
    next: u64,
    exhausted: bool,
}

impl Counter {
    const fn new(next: u64) -> Self {
        Self { next, exhausted: false }
    }

    /// The value to use now, `None` once the last one is used.
    const fn current(self) -> Option<u64> {
        if self.exhausted { None } else { Some(self.next) }
    }

    /// Move past the value just used.
    const fn advance(&mut self) {
        match self.next.checked_add(1) {
            Some(next) => self.next = next,
            None => self.exhausted = true,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum State {
    /// `hello` is out; the `ready` box has not opened.
    AwaitingReady,
    /// The `ready` box opened: messages may flow.
    Open { salt: [u8; SALT_LENGTH] },
    /// A frame was refused: nothing more is sealed or opened.
    Failed,
}

/// The client end of one connection's channel.
pub struct Channel {
    cipher: SalsaBox,
    public: [u8; KEY_LENGTH],
    state: State,
    sent: Counter,
    received: Counter,
}

impl fmt::Debug for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Channel").field("state", &self.state).finish_non_exhaustive()
    }
}

/// The 24-byte nonce: salt ‖ direction ‖ counter (8 bytes, big-endian).
pub(crate) fn nonce(salt: &[u8; SALT_LENGTH], direction: u8, counter: u64) -> Nonce {
    let mut bytes = [0u8; NONCE_LENGTH];
    let (salt_part, rest) = bytes.split_at_mut(SALT_LENGTH);
    salt_part.copy_from_slice(salt);
    let (direction_part, counter_part) = rest.split_at_mut(1);
    direction_part.fill(direction);
    counter_part.copy_from_slice(&counter.to_be_bytes());
    Nonce::from(bytes)
}

impl Channel {
    /// A channel to the daemon whose public key is `daemon_public` (from the pairing link), with the
    /// connection's own `key_pair`. Send [`Channel::hello`] first.
    #[must_use]
    pub fn new(daemon_public: &[u8; KEY_LENGTH], key_pair: &KeyPair) -> Self {
        Self {
            cipher: SalsaBox::new(&PublicKey::from_bytes(*daemon_public), &key_pair.secret),
            public: key_pair.public(),
            state: State::AwaitingReady,
            sent: Counter::new(0),
            received: Counter::new(0),
        }
    }

    /// The first frame of the channel: `0x01` ‖ the client's public key.
    #[must_use]
    pub fn hello(&self) -> Vec<u8> {
        [&[CHANNEL_VERSION][..], &self.public[..]].concat()
    }

    /// Whether the `ready` box has opened and messages may be sealed.
    #[must_use]
    pub const fn is_open(&self) -> bool {
        matches!(self.state, State::Open { .. })
    }

    /// Take the daemon's first frame: `0x01` ‖ salt ‖ the box of a `ready` record at daemon-to-client
    /// counter 0. Opening it proves the daemon holds the secret key of the key it was dialled for.
    ///
    /// # Errors
    /// A malformed frame, a box that does not open, or a first record that is not exactly `ready`:
    /// the channel is closed (the socket closes with `channel_error` and the connect fails).
    /// [`ChannelError::AlreadyReady`] and [`ChannelError::Closed`] change nothing.
    pub fn accept_ready(&mut self, frame: &[u8]) -> Result<(), ChannelError> {
        match self.state {
            State::AwaitingReady => {}
            State::Open { .. } => return Err(ChannelError::AlreadyReady),
            State::Failed => return Err(ChannelError::Closed),
        }
        let Some((&version, rest)) = frame.split_first() else {
            return self.fail(ChannelError::MalformedReady);
        };
        if version != CHANNEL_VERSION || frame.len() < MIN_READY_LENGTH {
            return self.fail(ChannelError::MalformedReady);
        }
        let Some((salt, sealed)) = rest.split_at_checked(SALT_LENGTH) else {
            return self.fail(ChannelError::MalformedReady);
        };
        let Ok(salt) = <[u8; SALT_LENGTH]>::try_from(salt) else {
            return self.fail(ChannelError::MalformedReady);
        };
        let plain = self.open_box(&salt, sealed)?;
        if plain != [KIND_READY] {
            return self.fail(ChannelError::NotAReadyRecord);
        }
        self.state = State::Open { salt };
        Ok(())
    }

    /// Seal one message as a frame to write: the box of `kind ‖ payload` at the next client-to-daemon
    /// counter.
    ///
    /// # Errors
    /// [`ChannelError::NotReady`] before the `ready` box opened (nothing is sent before it);
    /// [`ChannelError::CounterLimit`] when the counter is used up (the channel is then closed);
    /// [`ChannelError::Closed`] after a failure.
    pub fn seal(&mut self, kind: RecordKind, payload: &[u8]) -> Result<Vec<u8>, ChannelError> {
        let salt = self.open_salt()?;
        let Some(counter) = self.sent.current() else {
            return self.fail(ChannelError::CounterLimit);
        };
        let mut plain = Vec::with_capacity(1 + payload.len());
        plain.push(kind.byte());
        plain.extend_from_slice(payload);
        let Ok(sealed) = self.cipher.encrypt(&nonce(&salt, CLIENT_TO_DAEMON, counter), plain.as_slice()) else {
            return self.fail(ChannelError::SealFailed);
        };
        self.sent.advance();
        Ok(sealed)
    }

    /// Open one frame from the daemon with the next daemon-to-client counter and deliver its record.
    ///
    /// # Errors
    /// [`ChannelError::NotReady`] before the `ready` box opened. Anything else that is wrong with the
    /// frame closes the channel: a box that is too short or does not open, an empty record, a `ready`
    /// record, an unknown kind, text that is not UTF-8, a counter used up.
    pub fn open(&mut self, frame: &[u8]) -> Result<Record, ChannelError> {
        let salt = self.open_salt()?;
        let mut plain = self.open_box(&salt, frame)?;
        let Some(&kind) = plain.first() else {
            return self.fail(ChannelError::EmptyRecord);
        };
        match kind {
            KIND_TEXT => {
                plain.drain(..1);
                match String::from_utf8(plain) {
                    Ok(text) => Ok(Record::Text(text)),
                    Err(_) => self.fail(ChannelError::NotUtf8),
                }
            }
            KIND_BINARY => {
                plain.drain(..1);
                Ok(Record::Binary(plain))
            }
            KIND_READY => self.fail(ChannelError::UnexpectedReady),
            _ => self.fail(ChannelError::UnknownKind),
        }
    }

    /// The salt of an open channel; the error of one that is not.
    const fn open_salt(&self) -> Result<[u8; SALT_LENGTH], ChannelError> {
        match self.state {
            State::Open { salt } => Ok(salt),
            State::AwaitingReady => Err(ChannelError::NotReady),
            State::Failed => Err(ChannelError::Closed),
        }
    }

    /// Open `sealed` with the next daemon-to-client counter, moving past it only when it opened.
    fn open_box(&mut self, salt: &[u8; SALT_LENGTH], sealed: &[u8]) -> Result<Vec<u8>, ChannelError> {
        let Some(counter) = self.received.current() else {
            return self.fail(ChannelError::CounterLimit);
        };
        if sealed.len() < MIN_BOX_LENGTH {
            return self.fail(ChannelError::BoxTooShort);
        }
        let Ok(plain) = self.cipher.decrypt(&nonce(salt, DAEMON_TO_CLIENT, counter), sealed) else {
            return self.fail(ChannelError::BoxDidNotOpen);
        };
        self.received.advance();
        Ok(plain)
    }

    /// Close the channel for good and report why.
    fn fail<T>(&mut self, error: ChannelError) -> Result<T, ChannelError> {
        self.state = State::Failed;
        Err(error)
    }
}

#[cfg(test)]
mod tests;
