//! The daemon's socket: TCP, then TLS for `wss`.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use socket2::{SockRef, TcpKeepalive};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpStream, lookup_host};
use tokio_rustls::client::TlsStream;

/// Idle time before the first keepalive probe.
pub const KEEPALIVE_IDLE: Duration = Duration::from_secs(30);
/// Time between probes.
pub const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
/// Unanswered probes before the connection is dropped. A dead peer is found after about a minute.
pub const KEEPALIVE_PROBES: u32 = 3;

/// A connection to the daemon: plain for `ws`, TLS for `wss`.
#[derive(Debug)]
pub enum Stream {
    Plain(TcpStream),
    // Boxed: a TLS session is much larger than a socket.
    Tls(Box<TlsStream<TcpStream>>),
}

impl AsyncRead for Stream {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(s) => Pin::new(s).poll_read(cx, buf),
            Self::Tls(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for Stream {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            Self::Plain(s) => Pin::new(s).poll_write(cx, buf),
            Self::Tls(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(s) => Pin::new(s).poll_flush(cx),
            Self::Tls(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(s) => Pin::new(s).poll_shutdown(cx),
            Self::Tls(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }

    fn poll_write_vectored(self: Pin<&mut Self>, cx: &mut Context<'_>, bufs: &[io::IoSlice<'_>]) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            Self::Plain(s) => Pin::new(s).poll_write_vectored(cx, bufs),
            Self::Tls(s) => Pin::new(s.as_mut()).poll_write_vectored(cx, bufs),
        }
    }

    fn is_write_vectored(&self) -> bool {
        match self {
            Self::Plain(s) => s.is_write_vectored(),
            Self::Tls(s) => s.is_write_vectored(),
        }
    }
}

/// Why a TCP connection could not be made.
#[derive(Debug)]
pub(crate) enum ConnectError {
    /// The name did not resolve, or resolved to nothing.
    Resolve,
    /// Every address was tried; this is the last one's error.
    Connect(io::Error),
}

/// Resolves `host` and connects to the first address that answers, in the resolver's order. The
/// caller bounds the time (the whole dial has one limit). The socket gets its options before it
/// is returned.
pub(crate) async fn connect_tcp(host: &str, port: u16) -> Result<TcpStream, ConnectError> {
    let addrs = lookup_host((host, port)).await.map_err(|_| ConnectError::Resolve)?;
    let mut last = None;
    for addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(stream) => {
                tune(&stream);
                return Ok(stream);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(match last {
        Some(e) => ConnectError::Connect(e),
        None => ConnectError::Resolve,
    })
}

/// `TCP_NODELAY` and keepalive (30 s idle, 10 s between probes, 3 probes where the platform lets
/// each be set; Windows takes the first two and uses its own count).
///
/// A failure is ignored: the socket works without either option, and the workbench's own ping
/// still finds a dead connection, only later.
fn tune(stream: &TcpStream) {
    let _ = stream.set_nodelay(true);
    let _ = SockRef::from(stream).set_tcp_keepalive(&keepalive());
}

fn keepalive() -> TcpKeepalive {
    let keepalive = TcpKeepalive::new().with_time(KEEPALIVE_IDLE);
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    let keepalive = keepalive.with_interval(KEEPALIVE_INTERVAL).with_retries(KEEPALIVE_PROBES);
    keepalive
}

#[cfg(test)]
mod tests {
    use tokio::net::TcpListener;

    use super::*;

    #[tokio::test]
    async fn socket_has_nodelay_and_keepalive() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let stream = connect_tcp("127.0.0.1", port).await.unwrap();
        assert!(stream.nodelay().unwrap());
        let sock = SockRef::from(&stream);
        assert!(sock.keepalive().unwrap());
        assert_eq!(sock.tcp_keepalive_time().unwrap(), KEEPALIVE_IDLE);
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            assert_eq!(sock.tcp_keepalive_interval().unwrap(), KEEPALIVE_INTERVAL);
            assert_eq!(sock.tcp_keepalive_retries().unwrap(), KEEPALIVE_PROBES);
        }
    }

    #[tokio::test]
    async fn closed_port_is_a_connect_error() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            listener.local_addr().unwrap().port()
        };
        match connect_tcp("127.0.0.1", port).await {
            Err(ConnectError::Connect(e)) => assert_eq!(e.kind(), io::ErrorKind::ConnectionRefused),
            other => panic!("expected a refused connection, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn unresolvable_name_is_a_resolve_error() {
        // `.invalid` never resolves (RFC 6761).
        match connect_tcp("daemon.invalid", 1).await {
            Err(ConnectError::Resolve) => {}
            other => panic!("expected a resolve error, got {other:?}"),
        }
    }
}
