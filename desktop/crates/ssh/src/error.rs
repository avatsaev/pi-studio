//! Why a connect, or a channel on an open connection, failed: a code the connection bar can branch on and a message a
//! person can read (`swe/features/desktop-relay-ssh.md` § Error handling).
//!
//! Nothing here holds a host name, user, key path or secret in its message: `hop` says which host of the chain failed
//! (0 is the first connection, the last is the final host) and the caller, which knows the targets, names it. The two
//! host-key errors carry the host and port because the dialog and the trust step need them.

use std::fmt;

use russh::keys::PublicKey;

/// What a login tried, in order, for the message of [`Error::AuthFailed`]. Never a secret.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Tried {
    /// The agent's identities (however many it held).
    Agent,
    /// A key file, by its file name only.
    KeyFile(String),
    /// The stored password.
    Password,
}

impl fmt::Display for Tried {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Agent => f.write_str("agent"),
            Self::KeyFile(name) => write!(f, "key file {name}"),
            Self::Password => f.write_str("password"),
        }
    }
}

/// The tried methods as text: `agent, key file id_ed25519, password`.
fn tried_list(tried: &[Tried]) -> String {
    if tried.is_empty() {
        return "nothing to try: no agent identity, no readable key file and no password for this host".to_owned();
    }
    tried.iter().map(ToString::to_string).collect::<Vec<_>>().join(", ")
}

/// Why an SSH connect or channel open failed.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The host could not be dialled: the name did not resolve, the connection was refused, or there is no route; or a
    /// jump host could not reach the next host.
    #[error("the host could not be reached")]
    Unreachable { hop: usize },
    /// A step did not finish in its 15 s, or the 45 s for the whole connect passed.
    #[error("the host did not answer in time")]
    Timeout { hop: usize },
    /// The connection was made but the SSH handshake did not complete.
    #[error("the SSH handshake failed")]
    Handshake { hop: usize },
    /// No known-hosts entry holds this host's key. The caller asks the user and then trusts the key.
    #[error("the host key is not known")]
    HostKeyUnknown { hop: usize, host: String, port: u16, key: Box<PublicKey> },
    /// A known-hosts entry holds another key of the same type for this host, or marks this one revoked.
    #[error("the host key has changed")]
    HostKeyChanged { hop: usize, host: String, port: u16 },
    /// A known-hosts file could not be read, so the host key could not be judged.
    #[error("the known hosts file cannot be read")]
    KnownHosts { hop: usize },
    /// Every login was refused.
    #[error("every login was refused (tried: {})", tried_list(.tried))]
    AuthFailed { hop: usize, tried: Vec<Tried> },
    /// A key is encrypted and its passphrase is not stored, or the stored one is wrong, and nothing else logged in.
    #[error("the key file {file} needs a passphrase that is not stored, or the stored one is wrong")]
    PassphraseNeeded { hop: usize, file: String },
    /// A key file the entry or the config names is missing or in a format the library does not read.
    #[error("the key file {file} is missing or in a format that is not read")]
    KeyUnreadable { hop: usize, file: String },
    /// The server does not allow the channel (`AllowTcpForwarding`, `PermitOpen`).
    #[error("the server does not allow forwarding")]
    ForwardingRefused { hop: usize },
    /// The host refused the connection to the port the channel asked for.
    #[error("the host refused the connection to the port")]
    PortRefused { hop: usize },
    /// The SSH connection ended while a channel was being opened.
    #[error("the SSH connection ended")]
    Lost { hop: usize },
}

impl Error {
    /// The code as the page reads it; it never changes once released.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Unreachable { .. } => "unreachable",
            Self::Timeout { .. } => "timeout",
            Self::Handshake { .. } => "handshake",
            Self::HostKeyUnknown { .. } => "host_key_unknown",
            Self::HostKeyChanged { .. } => "host_key_changed",
            Self::KnownHosts { .. } => "known_hosts",
            Self::AuthFailed { .. } => "auth_failed",
            Self::PassphraseNeeded { .. } => "passphrase_needed",
            Self::KeyUnreadable { .. } => "key_unreadable",
            Self::ForwardingRefused { .. } => "forwarding_refused",
            Self::PortRefused { .. } => "daemon_not_running",
            Self::Lost { .. } => "ssh_lost",
        }
    }

    /// Which host of the chain failed: 0 is the first connection, the last index is the final host.
    #[must_use]
    pub const fn hop(&self) -> usize {
        match self {
            Self::Unreachable { hop }
            | Self::Timeout { hop }
            | Self::Handshake { hop }
            | Self::HostKeyUnknown { hop, .. }
            | Self::HostKeyChanged { hop, .. }
            | Self::KnownHosts { hop }
            | Self::AuthFailed { hop, .. }
            | Self::PassphraseNeeded { hop, .. }
            | Self::KeyUnreadable { hop, .. }
            | Self::ForwardingRefused { hop }
            | Self::PortRefused { hop }
            | Self::Lost { hop } => *hop,
        }
    }
}

/// Why [`Session::open_daemon`](crate::Session::open_daemon) gave no socket: the channel to the daemon's port was not
/// opened, or the WebSocket upgrade over it failed.
#[derive(Debug, thiserror::Error)]
pub enum DaemonError {
    /// The `direct-tcpip` channel failed: [`Error::ForwardingRefused`] when the server's rules forbid it,
    /// [`Error::PortRefused`] (`daemon_not_running`) when nothing listens on the daemon's port.
    #[error(transparent)]
    Channel(#[from] Error),
    /// The channel opened and the daemon did not accept the upgrade (a wrong password, a refused `Host`, silence).
    #[error(transparent)]
    Dial(#[from] pistudiodesktop_net::DialError),
}

impl DaemonError {
    /// The code as the page reads it: the SSH code, or the dial's.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Channel(error) => error.code(),
            Self::Dial(error) => error.code.as_str(),
        }
    }
}

/// Why [`Session::run`](crate::Session::run) gave no output. The page reads these as the `reason` of a failed command.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RunError {
    /// The command did not finish within its limit; it was told to stop and its channel was closed.
    #[error("the command did not finish in time")]
    Timeout,
    /// The command could not be run: no channel could be opened, the connection ended, or the shell ended before the
    /// command printed its end marker.
    #[error("the command could not be run")]
    ExecFailed,
    /// The account runs no command, or its shell printed no begin marker.
    #[error("the account runs no commands, or its shell printed no marker")]
    NoShell,
}

impl RunError {
    /// The reason as the page reads it; it never changes once released.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Timeout => "timeout",
            Self::ExecFailed => "exec_failed",
            Self::NoShell => "no_shell",
        }
    }
}

/// Why [`Session::send`](crate::Session::send) did not leave the file on the host. The page reads these as the reason of a
/// failed install.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SendError {
    /// No channel could be opened, or the host refused to run the command.
    #[error("the channel to the host could not be opened")]
    Open,
    /// The reader failed or ended before the byte count it was given.
    #[error("the file could not be read")]
    Source,
    /// The host accepted no data for the stall limit, or did not end the command in that time after the last byte.
    #[error("the host stopped accepting data")]
    Stalled,
    /// The command ended with a non-zero status: `cat` failed (no space left, no permission, no such folder).
    #[error("the host could not write the file (status {status})")]
    Rejected { status: u32 },
    /// The connection or the channel ended before the command reported a status.
    #[error("the connection ended while the file was sent")]
    Closed,
}

impl SendError {
    /// The reason as the page reads it; it never changes once released.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Source => "source",
            Self::Stalled => "stalled",
            Self::Rejected { .. } => "rejected",
            Self::Closed => "closed",
        }
    }
}
