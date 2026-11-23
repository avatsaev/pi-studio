//! The SSH client: `~/.ssh/config`, known hosts, login through jump hosts, the daemon's `direct-tcpip`
//! channel and remote commands (`swe/features/desktop-relay-ssh.md` § 7).
//!
//! It opens a daemon socket through `pistudiodesktop_net::dial_over` and knows nothing of the registry or
//! the page.
//!
//! * [`config`]: `~/.ssh/config` resolved to a [`config::Target`] with its jump hosts, and the host list.
//! * [`known_hosts`]: classing a server key against `~/.ssh/known_hosts` and the app's own file; trusting a key.
//! * [`connect`]: the connection through the hops, with the login order of D11 ([`login`]), the host-key check, the
//!   15 s per step and 45 s in all, and russh's keepalive (15 s, three unanswered); the [`Session`] it opens.
//! * [`Session::open_daemon`]: the daemon's WebSocket over a `direct-tcpip` channel (`net::dial_over`); a closed port is
//!   `daemon_not_running`, the server's rules `forwarding_refused` ([`DaemonError`]).
//! * [`Session::run`]: one command in the login shell (`"$SHELL" -lic`) between random marker lines, 64 KiB of output,
//!   killed at its limit ([`Output`], [`RunError`]: `timeout`, `exec_failed`, `no_shell`).
//! * [`Error`]: the codes (`auth_failed`, `passphrase_needed`, `key_unreadable`, `host_key_unknown`, ...).
#![cfg(not(target_arch = "wasm32"))]

mod agent;
mod command;
pub mod config;
mod error;
#[cfg(test)]
mod fixtures;
pub mod known_hosts;
mod login;
mod session;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use command::{Output, STDOUT_LIMIT};
pub use error::{DaemonError, Error, RunError, Tried};
pub use login::{MAX_ATTEMPTS, Secrets};
pub use session::{Environment, KEEPALIVE_INTERVAL, KEEPALIVE_MAX, Limits, STEP_LIMIT, Session, TOTAL_LIMIT, connect};

#[cfg(test)]
mod tests {
    #[test]
    fn dependencies_resolve() {
        let _ = russh::client::Config::default();
        let _ = ssh2_config::SshConfig::default();
    }
}
