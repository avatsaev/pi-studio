//! What a session does with channels besides forwarding: the daemon's WebSocket over `direct-tcpip` and a command
//! between markers (`swe/features/desktop-relay-ssh.md` § 7, § 8). Any number of them share the one connection.

use std::time::Duration;

use pistudiodesktop_net::{DaemonSocket, dial_over};
use russh::{Channel, ChannelMsg, Sig, client};
use tokio::time::timeout;

use super::Session;
use crate::command::{Markers, Missing, Output};
use crate::error::{DaemonError, RunError};

/// Where the daemon listens, as the host sees it: the tunnel ends on the host's own loopback.
const DAEMON_HOST: &str = "127.0.0.1";

impl Session {
    /// Opens the daemon's WebSocket: a `direct-tcpip` channel to `127.0.0.1:port` on the host and the upgrade over it
    /// to `ws://127.0.0.1:<port>`, the second within one step. A non-empty `password` goes as the bearer subprotocol;
    /// `max_message_bytes` is the largest message the socket accepts.
    ///
    /// # Errors
    /// [`DaemonError::Channel`] with `daemon_not_running` when nothing listens on `port` and `forwarding_refused` when
    /// the server's rules forbid the channel; [`DaemonError::Dial`] when the daemon refuses or does not answer the upgrade.
    pub async fn open_daemon(&self, port: u16, password: Option<&str>, max_message_bytes: usize) -> Result<DaemonSocket, DaemonError> {
        let stream = self.open_tcpip(DAEMON_HOST, port).await?;
        let url = format!("ws://{DAEMON_HOST}:{port}");
        Ok(dial_over(stream, &url, password, self.limits.step, max_message_bytes).await?)
    }

    /// Runs `command` in the user's login shell (`"$SHELL" -lic`) on its own channel and returns its status and the
    /// first 64 KiB of its standard output, read between two random marker lines. Standard error is dropped.
    ///
    /// The channel is closed when the command is done, and at `limit` the command is sent a kill signal first. Neither
    /// the command line nor its output is logged.
    ///
    /// # Errors
    /// [`RunError::NoShell`] when the account runs no command or the shell printed no begin marker,
    /// [`RunError::Timeout`] at `limit`, [`RunError::ExecFailed`] when no channel could be opened or the shell ended
    /// before the end marker.
    pub async fn run(&self, command: &str, limit: Duration) -> Result<Output, RunError> {
        let markers = Markers::random().ok_or(RunError::ExecFailed)?;
        let open = timeout(self.limits.step, self.host.channel_open_session());
        let mut channel = open.await.map_err(|_| RunError::ExecFailed)?.map_err(|_| RunError::ExecFailed)?;
        let outcome = timeout(limit, collect(&mut channel, &markers, command)).await;
        if outcome.is_err() {
            let _ = channel.signal(Sig::KILL).await;
        }
        let _ = channel.close().await;
        outcome.map_err(|_| RunError::Timeout)?
    }
}

/// Sends the command and reads standard output until its status is in, or the channel ends.
async fn collect(channel: &mut Channel<client::Msg>, markers: &Markers, command: &str) -> Result<Output, RunError> {
    channel.exec(true, markers.wrap(command)).await.map_err(|_| RunError::ExecFailed)?;
    let mut scanner = markers.scanner();
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Failure => return Err(RunError::NoShell),
            ChannelMsg::Data { data } => {
                if scanner.feed(&data) {
                    break;
                }
            }
            ChannelMsg::Eof | ChannelMsg::Close => break,
            // Success of the request, standard error, the exit status, window updates: none is the answer.
            _ => {}
        }
    }
    scanner.finish().map_err(|missing| match missing {
        Missing::Begin => RunError::NoShell,
        Missing::End => RunError::ExecFailed,
    })
}

#[cfg(test)]
mod tests;
