//! Writing a file on the host over the connection: an exec channel running `/bin/sh -c 'cat > <path>'`
//! (`swe/features/desktop-ssh-daemon-install.md` R3). No SFTP subsystem is needed, and `/bin/sh` rather than the login
//! shell's own parse of the line keeps a start-up file from standing between the data and `cat`.

use std::time::Duration;

use russh::{Channel, ChannelMsg, Sig, client};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::time::{Instant, sleep_until, timeout};

use super::Session;
use crate::command::quote;
use crate::error::SendError;

/// How much is read from the source at a time, and how often `progress` is called at the most.
const CHUNK: usize = 256 * 1024;

impl Session {
    /// Writes the `size` bytes of `source` to `path` on the host (an absolute path; the file is created or truncated)
    /// and returns once the command ended with status 0. `progress` gets the total of bytes the channel has accepted,
    /// after each chunk; the channel accepts no more than the host's receive window allows, so it follows the link.
    ///
    /// Time is not limited as a whole: only `stall` without one accepted byte (or, after the last byte, without the
    /// end of the command) stops the send, and then the command is sent a kill signal and the channel is closed. A send
    /// that stopped or failed can leave a partial file on the host. Neither the command line nor the data is logged.
    ///
    /// # Errors
    /// [`SendError::Open`] when no channel could be opened or the host refused the command,
    /// [`SendError::Source`] when `source` failed or ended before `size` bytes, [`SendError::Stalled`] at the limit,
    /// [`SendError::Rejected`] with the status of a failed `cat`, [`SendError::Closed`] when the connection or the
    /// channel ended with no status.
    pub async fn send<R>(&self, path: &str, mut source: R, size: u64, stall: Duration, mut progress: impl FnMut(u64)) -> Result<(), SendError>
    where
        R: AsyncRead + Unpin,
    {
        let open = timeout(self.limits.step, self.host.channel_open_session());
        let mut channel = open.await.map_err(|_| SendError::Open)?.map_err(|_| SendError::Open)?;
        let outcome = push(&mut channel, &command(path), &mut source, size, stall, &mut progress).await;
        if outcome == Err(SendError::Stalled) {
            let _ = channel.signal(Sig::KILL).await;
        }
        let _ = channel.close().await;
        outcome
    }
}

/// The command line the host's account shell is given: `/bin/sh` runs `cat`, so the account's own shell only has to
/// start `/bin/sh` and `path` is quoted twice, for the account's shell and for `/bin/sh`.
fn command(path: &str) -> String {
    format!("/bin/sh -c {}", quote(&format!("cat > {}", quote(path))))
}

/// Runs the command, feeds it `size` bytes and waits for its status.
async fn push<R>(
    channel: &mut Channel<client::Msg>,
    command: &str,
    source: &mut R,
    size: u64,
    stall: Duration,
    progress: &mut impl FnMut(u64),
) -> Result<(), SendError>
where
    R: AsyncRead + Unpin,
{
    channel.exec(true, command).await.map_err(|_| SendError::Open)?;
    let mut writer = channel.make_writer();
    let mut buffer = vec![0_u8; CHUNK];
    let mut sent: u64 = 0;
    while sent < size {
        let want = usize::try_from(size - sent).map_or(CHUNK, |left| left.min(CHUNK));
        let chunk = buffer.get_mut(..want).ok_or(SendError::Source)?;
        let read = source.read(chunk).await.map_err(|_| SendError::Source)?;
        if read == 0 {
            return Err(SendError::Source);
        }
        write_chunk(channel, &mut writer, chunk.get(..read).ok_or(SendError::Source)?, stall).await?;
        sent += u64::try_from(read).map_err(|_| SendError::Source)?;
        progress(sent);
    }
    match timeout(stall, writer.shutdown()).await {
        Ok(Ok(())) => status(channel, stall).await,
        Ok(Err(_)) => Err(ended(channel, stall).await),
        Err(_) => Err(SendError::Stalled),
    }
}

/// Writes `chunk` in the pieces the channel accepts, while reading what the channel reports: the status of a command that
/// ended early shows at once, not after the rest of the file. The stall timer restarts with every piece accepted.
async fn write_chunk(channel: &mut Channel<client::Msg>, writer: &mut (impl AsyncWrite + Unpin), chunk: &[u8], stall: Duration) -> Result<(), SendError> {
    let mut rest = chunk;
    let mut deadline = Instant::now() + stall;
    while !rest.is_empty() {
        tokio::select! {
            written = writer.write(rest) => match written {
                Ok(count) => {
                    rest = rest.get(count..).unwrap_or_default();
                    deadline = Instant::now() + stall;
                }
                Err(_) => return Err(ended(channel, stall).await),
            },
            message = channel.wait() => {
                if let Some(error) = interrupt(message) {
                    return Err(error);
                }
            }
            () = sleep_until(deadline) => return Err(SendError::Stalled),
        }
    }
    Ok(())
}

/// What a message of the channel says about a send that is not finished, when it says anything.
fn interrupt(message: Option<ChannelMsg>) -> Option<SendError> {
    match message {
        None | Some(ChannelMsg::Close) => Some(SendError::Closed),
        Some(ChannelMsg::ExitStatus { exit_status }) => Some(rejected(exit_status)),
        Some(ChannelMsg::Failure) => Some(SendError::Open),
        // Success of the request, output, window updates, EOF (the status can still follow it).
        Some(_) => None,
    }
}

/// A command that ended before all data was accepted: a failed `cat`, or, with status 0, one that quit early.
const fn rejected(status: u32) -> SendError {
    if status == 0 { SendError::Closed } else { SendError::Rejected { status } }
}

/// After the end of the data: reads the channel until the command's status. `Ok` only for status 0.
async fn status(channel: &mut Channel<client::Msg>, stall: Duration) -> Result<(), SendError> {
    loop {
        match timeout(stall, channel.wait()).await {
            Err(_) => return Err(SendError::Stalled),
            Ok(Some(ChannelMsg::ExitStatus { exit_status: 0 })) => return Ok(()),
            Ok(message) => {
                if let Some(error) = interrupt(message) {
                    return Err(error);
                }
            }
        }
    }
}

/// After a write failed: the channel is gone or going; its status, when it still comes, says why.
async fn ended(channel: &mut Channel<client::Msg>, stall: Duration) -> SendError {
    status(channel, stall).await.err().unwrap_or(SendError::Closed)
}

#[cfg(test)]
mod tests;
