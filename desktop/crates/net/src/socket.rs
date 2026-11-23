//! The daemon's socket as the rest of the app sees it: a stream and a sink of WebSocket messages,
//! whatever carries them (TCP, TLS, an SSH channel, a relay channel).

use std::pin::Pin;
use std::task::{Context, Poll};

use futures_util::future::BoxFuture;
use futures_util::{Sink, Stream};
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWrite};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

/// Bytes read per call while a socket's remainder is discarded.
const DISCARD_CHUNK: usize = 8192;

/// A WebSocket end the proxy can pump and close: messages in, messages out.
pub trait Wire: Stream<Item = Result<Message, WsError>> + Sink<Message, Error = WsError> + Send + Unpin {
    /// Reads and drops the bytes of the socket itself until it ends: for a leg whose frames can no
    /// longer be parsed (it sent a frame above the limit and the rest of it is still coming), so that
    /// closing the socket does not reset it before its close frame has been read.
    fn discard(&mut self) -> BoxFuture<'_, ()>;
}

impl<T> Wire for WebSocketStream<T>
where
    T: AsyncRead + AsyncWrite + Send + Unpin + 'static,
{
    fn discard(&mut self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let socket = self.get_mut();
            let mut scratch = [0u8; DISCARD_CHUNK];
            while let Ok(read) = socket.read(&mut scratch).await {
                if read == 0 {
                    break;
                }
            }
        })
    }
}

/// An open WebSocket to the daemon over any transport.
///
/// It refuses a message above [`max_message_bytes`](Self::max_message_bytes) as it reads, which is
/// what the proxy and the transfer engine rely on.
pub struct DaemonSocket {
    inner: Box<dyn Wire>,
    max_message_bytes: usize,
}

impl DaemonSocket {
    /// Wraps a WebSocket over `T`. Its limit is the larger of the library's message and frame
    /// limits, `usize::MAX` when either is unset.
    pub fn new<T>(socket: WebSocketStream<T>) -> Self
    where
        T: AsyncRead + AsyncWrite + Send + Unpin + 'static,
    {
        let config = socket.get_config();
        let max_message_bytes = config.max_message_size.unwrap_or(usize::MAX).max(config.max_frame_size.unwrap_or(usize::MAX));
        Self { inner: Box::new(socket), max_message_bytes }
    }

    /// Wraps any [`Wire`] (a relay channel, say) that refuses a message above `max_message_bytes` as it reads.
    #[must_use]
    pub fn from_wire(wire: impl Wire + 'static, max_message_bytes: usize) -> Self {
        Self { inner: Box::new(wire), max_message_bytes }
    }

    /// The largest message the socket accepts while it reads: `usize::MAX` when it has no limit.
    #[must_use]
    pub fn max_message_bytes(&self) -> usize {
        self.max_message_bytes
    }
}

impl std::fmt::Debug for DaemonSocket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DaemonSocket").field("max_message_bytes", &self.max_message_bytes).finish_non_exhaustive()
    }
}

impl Stream for DaemonSocket {
    type Item = Result<Message, WsError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut *self.inner).poll_next(cx)
    }
}

impl Sink<Message> for DaemonSocket {
    type Error = WsError;

    fn poll_ready(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut *self.inner).poll_ready(cx)
    }

    fn start_send(mut self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
        Pin::new(&mut *self.inner).start_send(item)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut *self.inner).poll_flush(cx)
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut *self.inner).poll_close(cx)
    }
}

impl Wire for DaemonSocket {
    fn discard(&mut self) -> BoxFuture<'_, ()> {
        self.inner.discard()
    }
}
