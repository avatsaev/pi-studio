//! A remote command between two marker lines (`swe/features/desktop-relay-ssh.md` § 8, S7).
//!
//! The server runs an exec request in the user's login shell as `"$SHELL" -c`, and an interactive shell (`-i`) is what
//! reads `.bashrc` on Debian and Ubuntu, so the command is sent as `"$SHELL" -lic '<script>'`. A shell that starts
//! like that may print anything before the command (a banner, a message of its own, a line without its newline), so the
//! script is `echo <begin>; <command>; echo <end>:$?` with two random markers, and the answer is what lies between them.
//!
//! What the shell prints is hostile: [`Scanner`] holds a bounded amount however much arrives, keeps at most
//! [`STDOUT_LIMIT`] bytes of the command's output, and keeps looking for the end marker after that so the status is
//! still the command's.

use ring::rand::{SecureRandom, SystemRandom};

/// The most of a command's standard output that is kept.
pub const STDOUT_LIMIT: usize = 64 * 1024;
/// The random bytes of one marker: 128 bits, so no output has it by chance.
const MARKER_BYTES: usize = 16;
/// The digits of the status that are read: `u32::MAX` has ten.
const STATUS_DIGITS: usize = 10;
/// What the command line starts with, up to the script's opening quote.
const SHELL_PREFIX: &str = "\"$SHELL\" -lic '";
/// A single quote inside a single-quoted word: close it, an escaped quote, open it again. POSIX shells and fish read it
/// alike.
const QUOTE_ESCAPE: &str = "'\\''";
const BEGIN_PREFIX: &str = "pistudio-begin-";
const END_PREFIX: &str = "pistudio-end-";

/// What a command printed between its markers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    /// The command's exit status as the shell reported it (`$?`).
    pub status: u32,
    /// What it wrote to standard output: at most 64 KiB, as bytes because the host decides what they are. Standard
    /// error is not kept.
    pub stdout: Vec<u8>,
}

/// Which marker never came.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Missing {
    /// The begin marker: the shell printed none, so it did not run the script.
    Begin,
    /// The end marker, or its status: the shell ended inside the command.
    End,
}

/// The two markers of one command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Markers {
    begin: String,
    end: String,
}

impl Markers {
    /// New random markers; `None` when the system has no random bytes.
    #[must_use]
    pub fn random() -> Option<Self> {
        let random = SystemRandom::new();
        let (mut begin, mut end) = ([0_u8; MARKER_BYTES], [0_u8; MARKER_BYTES]);
        random.fill(&mut begin).ok()?;
        random.fill(&mut end).ok()?;
        Some(Self::from_bytes(&begin, &end))
    }

    fn from_bytes(begin: &[u8; MARKER_BYTES], end: &[u8; MARKER_BYTES]) -> Self {
        Self { begin: format!("{BEGIN_PREFIX}{}", hex(begin)), end: format!("{END_PREFIX}{}", hex(end)) }
    }

    /// The exec request's command line for `command`.
    #[must_use]
    pub fn wrap(&self, command: &str) -> String {
        let script = format!("echo {}; {command}; echo {}:$?", self.begin, self.end);
        format!("{SHELL_PREFIX}{}'", script.replace('\'', QUOTE_ESCAPE))
    }

    /// A reader for what the shell prints.
    #[must_use]
    pub fn scanner(&self) -> Scanner {
        Scanner::new(format!("{}\n", self.begin).into_bytes(), format!("{}:", self.end).into_bytes())
    }
}

/// `bytes` as lowercase hex.
fn hex(bytes: &[u8]) -> String {
    let digit = |nibble: u8| char::from_digit(u32::from(nibble), 16).unwrap_or('0');
    bytes.iter().flat_map(|byte| [digit(byte >> 4), digit(byte & 0xf)]).collect()
}

/// Where [`Scanner`] is in the shell's output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    /// Looking for the begin marker's line.
    Begin,
    /// Between the markers.
    Body,
    /// After the end marker, reading the status.
    Status,
    /// The status is complete.
    Done,
}

/// Reads the shell's standard output as it arrives and keeps what lies between the markers.
#[derive(Debug)]
pub struct Scanner {
    begin: Vec<u8>,
    end: Vec<u8>,
    phase: Phase,
    /// Bytes not yet decided: shorter than the marker looked for, plus the chunk being read.
    window: Vec<u8>,
    stdout: Vec<u8>,
    digits: Vec<u8>,
}

impl Scanner {
    fn new(begin: Vec<u8>, end: Vec<u8>) -> Self {
        Self { begin, end, phase: Phase::Begin, window: Vec::new(), stdout: Vec::new(), digits: Vec::new() }
    }

    /// Reads the next bytes of standard output; true once the status is complete and nothing more is needed.
    pub fn feed(&mut self, chunk: &[u8]) -> bool {
        self.window.extend_from_slice(chunk);
        loop {
            match self.phase {
                Phase::Begin => match find(&self.window, &self.begin) {
                    Some(at) => {
                        self.window.drain(..at + self.begin.len());
                        self.phase = Phase::Body;
                    }
                    None => {
                        let drop = self.window.len().saturating_sub(self.begin.len().saturating_sub(1));
                        self.window.drain(..drop);
                        return false;
                    }
                },
                Phase::Body => match find(&self.window, &self.end) {
                    Some(at) => {
                        self.keep(at);
                        self.window.drain(..at + self.end.len());
                        self.phase = Phase::Status;
                    }
                    None => {
                        // What cannot start the end marker is output.
                        let safe = self.window.len().saturating_sub(self.end.len().saturating_sub(1));
                        self.keep(safe);
                        self.window.drain(..safe);
                        return false;
                    }
                },
                Phase::Status => {
                    self.read_status();
                    if self.phase != Phase::Done {
                        return false;
                    }
                }
                Phase::Done => {
                    self.window.clear();
                    return true;
                }
            }
        }
    }

    /// Moves the first `upto` bytes of the window into the output, up to [`STDOUT_LIMIT`]; the rest is dropped.
    fn keep(&mut self, upto: usize) {
        let room = STDOUT_LIMIT.saturating_sub(self.stdout.len());
        let take = upto.min(room);
        if let Some(bytes) = self.window.get(..take) {
            self.stdout.extend_from_slice(bytes);
        }
    }

    /// Takes the status digits from the window; the first byte that is not one ends the status.
    fn read_status(&mut self) {
        for &byte in &self.window {
            if byte.is_ascii_digit() && self.digits.len() < STATUS_DIGITS {
                self.digits.push(byte);
            } else {
                self.phase = Phase::Done;
                break;
            }
        }
        self.window.clear();
    }

    fn status(&self) -> Option<u32> {
        std::str::from_utf8(&self.digits).ok()?.parse().ok()
    }

    /// The output once the shell's standard output has ended.
    ///
    /// # Errors
    /// [`Missing::Begin`] when the begin marker never came; [`Missing::End`] when the end marker or a valid status did not.
    pub fn finish(self) -> Result<Output, Missing> {
        match self.phase {
            Phase::Begin => Err(Missing::Begin),
            Phase::Body => Err(Missing::End),
            Phase::Status | Phase::Done => self.status().map(|status| Output { status, stdout: self.stdout }).ok_or(Missing::End),
        }
    }
}

/// The first place `needle` (not empty) occurs in `haystack`.
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// What a wrapped command line holds, for the in-process server's shell.
#[cfg(any(test, feature = "testing"))]
pub struct Unwrapped {
    pub begin: String,
    pub command: String,
    pub end: String,
}

/// Reads a command line made by [`Markers::wrap`]; `None` when it is not one.
#[cfg(any(test, feature = "testing"))]
#[must_use]
pub fn unwrap(wrapped: &str) -> Option<Unwrapped> {
    let script = wrapped.strip_prefix(SHELL_PREFIX)?.strip_suffix('\'')?.replace(QUOTE_ESCAPE, "'");
    let (begin, rest) = script.strip_prefix("echo ")?.split_once("; ")?;
    let (command, end) = rest.rsplit_once("; echo ")?;
    Some(Unwrapped { begin: begin.to_owned(), command: command.to_owned(), end: end.strip_suffix(":$?")?.to_owned() })
}

#[cfg(test)]
mod tests;
