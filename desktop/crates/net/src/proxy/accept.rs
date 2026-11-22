//! The page's leg, until the upgrade: one listener, at most [`Limits::max_upgrades`] requests being
//! read at once, each given [`Limits::upgrade_wait`], and the first that passes the [`Gate`] wins.
//!
//! The listener belongs to [`accept_page`]'s future: when it returns, or is dropped (the page's
//! time is up, or the connection is shut down), the port is closed and every request still being
//! read is dropped with it.

use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{WebSocketStream, accept_hdr_async_with_config};

use super::conn::Conn;
use super::gate::{Gate, Refusal, forbidden};
use crate::limits::Limits;

/// The page's WebSocket.
pub(super) type PageSocket = WebSocketStream<TcpStream>;

/// How long to wait after a failed `accept` (out of descriptors, say) before trying again.
const ACCEPT_RETRY: Duration = Duration::from_millis(10);

/// The page's configuration: the same message limit as the daemon's leg.
fn page_config(limits: &Limits) -> WebSocketConfig {
    WebSocketConfig::default().max_message_size(Some(limits.max_message_bytes)).max_frame_size(Some(limits.max_message_bytes))
}

/// Reads one upgrade request and answers it: the page's socket, or the reason it was not accepted.
/// A refusal is a bare 403. If this request had claimed the token and then did not become a
/// WebSocket (the client left, or was too slow), the token is given back.
async fn upgrade(tcp: TcpStream, gate: &Gate, config: WebSocketConfig, wait: Duration) -> Result<PageSocket, Refusal> {
    // Best effort: a socket without it still works.
    let _ = tcp.set_nodelay(true);
    let why = Mutex::new(None);
    let claimed = AtomicBool::new(false);
    // The library fixes the callback's error type: a whole HTTP response.
    #[allow(clippy::result_large_err)]
    let callback = |request: &Request, response: Response| -> Result<Response, ErrorResponse> {
        match gate.check(request) {
            Ok(()) => {
                claimed.store(true, SeqCst);
                Ok(response)
            }
            Err(refusal) => {
                *why.lock().unwrap_or_else(PoisonError::into_inner) = Some(refusal);
                Err(forbidden())
            }
        }
    };
    let outcome = tokio::time::timeout(wait, accept_hdr_async_with_config(tcp, callback, Some(config))).await;
    if let Ok(Ok(page)) = outcome {
        return Ok(page);
    }
    if claimed.load(SeqCst) {
        gate.release();
    }
    let refusal = why.lock().unwrap_or_else(PoisonError::into_inner).take();
    Err(refusal.unwrap_or(if outcome.is_err() { Refusal::Slow } else { Refusal::Failed }))
}

/// Accepts connections on `listener` until one becomes the page's WebSocket. Every refusal is
/// counted on `conn` and reported to `refused`, which is given a line without the token or anything
/// the client sent. Cancel it by dropping the future (the caller bounds the time).
pub(super) async fn accept_page(listener: TcpListener, gate: Arc<Gate>, conn: &Conn, limits: &Limits, refused: &(dyn Fn(Refusal) + Sync)) -> PageSocket {
    let slots = Arc::new(Semaphore::new(limits.max_upgrades));
    let config = page_config(limits);
    // Every request in progress is a task of this set: dropping the set (on return) drops them.
    let mut attempts: JoinSet<Result<(), Refusal>> = JoinSet::new();
    let (winner, mut page) = mpsc::channel::<PageSocket>(1);
    loop {
        tokio::select! {
            Some(socket) = page.recv() => return socket,
            Some(finished) = attempts.join_next(), if !attempts.is_empty() => {
                if let Ok(Err(refusal)) = finished {
                    // A client that only connected and left says nothing about the page.
                    if refusal.is_gate() {
                        conn.refused();
                    }
                    refused(refusal);
                }
            }
            accepted = listener.accept() => match accepted {
                // More than the limit are dropped unanswered.
                Ok((tcp, _)) => match slots.clone().try_acquire_owned() {
                    Ok(slot) => {
                        let (gate, config, wait, winner) = (gate.clone(), config, limits.upgrade_wait, winner.clone());
                        attempts.spawn(async move {
                            let _slot = slot;
                            match upgrade(tcp, &gate, config, wait).await {
                                Ok(socket) => {
                                    let _ = winner.send(socket).await;
                                    Ok(())
                                }
                                Err(refusal) => Err(refusal),
                            }
                        });
                    }
                    Err(_) => drop(tcp),
                },
                Err(_) => tokio::time::sleep(ACCEPT_RETRY).await,
            },
        }
    }
}
