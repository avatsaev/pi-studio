//! An SSH server in this process, for the tests of this crate and (with the `testing` feature) of the crates that use it
//! (`swe/features/desktop-relay-ssh.md` S16). It is russh's server half on a loopback port, with:
//!
//! * logins by public key and by password, each scripted in a [`Behavior`], and a record of every offer ([`Seen`]);
//! * `direct-tcpip` channels that really connect to the host and port asked for (so a jump host's next hop is another
//!   [`Server`] of the test), with a switch that refuses them as the server's rules would;
//! * `exec` requests answered by a script, refused when there is none (an account that runs no command), or never
//!   answered ([`Exec::Hang`]); [`shell`] is a script that prints the markers of a [`Session::run`](crate::Session::run);
//! * a [`Wire`] that sits in front of a server and can go silent without closing, to lose keepalives;
//! * on Unix, an [`AgentSocket`] serving the agent protocol on a Unix socket, holding the keys a test gives it.
//!
//! Keys are made from fixed seeds so a run is the same every time. Nothing here is for a shipped build: the module is
//! compiled only for tests and with the feature.

use std::io;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use russh::keys::ssh_key::LineEnding;
use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::{PrivateKey, PublicKey, decode_secret_key};
use russh::server::{Auth, Handler, Msg, PublicKeyOffer, Session, VerifiedPublicKey, run_stream};
use russh::{Channel, ChannelId, ChannelOpenFailure, Disconnect};
use tokio::io::{AsyncReadExt, AsyncWriteExt, copy_bidirectional};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::{JoinHandle, JoinSet};

/// An OpenSSH key file encrypted with [`ENCRYPTED_KEY_PASSPHRASE`] (ed25519, made with `ssh-keygen -a 2`).
pub const ENCRYPTED_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABAsH4OCLq
1rtbfz6VOIzShqAAAAAgAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAILYwQqhG+YfZ/M7G
InzlQLlbq/mSDZ10EpfFC2jxbAYZAAAAkK1VmmjWMvIWlmj6v7j8XXELUEQPuwAcVdUsPx
3Jhn0l/tXbcqrKa5tS3XA7CGCuxjZYyZRPzUU1USyAKy5ZTwQBQAlrzZCNqTrizlUvr3Z3
J8xu5SMHleQzN6FDPOZ3126ZG+bzHh0mOMokyJarYxJ312CJCR9vhlwiBOaczfjlfNxPbG
/VUcItSwB8vuVhhA==
-----END OPENSSH PRIVATE KEY-----
";
/// The passphrase of [`ENCRYPTED_KEY`].
pub const ENCRYPTED_KEY_PASSPHRASE: &str = "swordfish";

/// The mode of a key file: only the user reads it.
#[cfg(unix)]
const KEY_FILE_MODE: u32 = 0o600;
/// What a rejected login takes on the server (russh makes a rejection constant-time; the default is a second).
const REJECTION_TIME: Duration = Duration::from_millis(1);
/// The size of a chunk the wire copies.
const WIRE_CHUNK: usize = 16 * 1024;

/// An ed25519 key made from `seed`: the same seed gives the same key.
#[must_use]
pub fn ed25519(seed: u8) -> PrivateKey {
    PrivateKey::from(Ed25519Keypair::from_seed(&[seed; 32]))
}

/// The private key inside [`ENCRYPTED_KEY`].
///
/// # Panics
/// Never: the constant and its passphrase are fixed and tested.
#[must_use]
pub fn encrypted_key() -> PrivateKey {
    decode_secret_key(ENCRYPTED_KEY, Some(ENCRYPTED_KEY_PASSPHRASE)).unwrap_or_else(|_| ed25519(0))
}

/// Writes `key` as an unencrypted OpenSSH key file (mode 0600 on Unix).
///
/// # Errors
/// The key could not be encoded or the file could not be written.
pub fn write_key(path: &Path, key: &PrivateKey) -> io::Result<()> {
    let text = key.to_openssh(LineEnding::LF).map_err(io::Error::other)?;
    write_private(path, text.as_bytes())
}

/// Writes `contents` as a file only the user can read.
///
/// # Errors
/// The file could not be written.
pub fn write_private(path: &Path, contents: &[u8]) -> io::Result<()> {
    std::fs::write(path, contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(KEY_FILE_MODE))?;
    }
    Ok(())
}

/// What a command run on the server does.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Exec {
    /// Write `stdout` and exit with `status`.
    Done { stdout: Vec<u8>, status: u32 },
    /// Accept the command and never answer.
    Hang,
}

/// The script of an `exec` request: the command text to its outcome.
pub type ExecScript = Arc<dyn Fn(&str) -> Exec + Send + Sync>;

/// What a login shell prints before the script runs, with no newline: the begin marker lands on the same line.
const BANNER: &[u8] = b"banner without a newline ";

/// An `exec` script that behaves as the user's login shell does for [`Session::run`](crate::Session::run): it reads the
/// markers out of the command line, prints a banner, the begin marker, what `command` gives for the command inside, and
/// the end marker with its status. `command` gets the inner command (without the markers) and returns its standard
/// output and exit status. A command line that is not a marked one gets no marker at all, as a shell that ignores it.
#[must_use]
pub fn shell(command: impl Fn(&str) -> (Vec<u8>, u32) + Send + Sync + 'static) -> ExecScript {
    Arc::new(move |line| {
        let Some(marked) = crate::command::unwrap(line) else {
            return Exec::Done { stdout: Vec::new(), status: 0 };
        };
        let (output, status) = command(&marked.command);
        let mut stdout = BANNER.to_vec();
        stdout.extend_from_slice(format!("{}\n", marked.begin).as_bytes());
        stdout.extend_from_slice(&output);
        stdout.extend_from_slice(format!("{}:{status}\n", marked.end).as_bytes());
        Exec::Done { stdout, status: 0 }
    })
}

/// How a [`Server`] behaves.
#[derive(Clone)]
pub struct Behavior {
    /// The server's host key.
    pub host_key: PrivateKey,
    /// The one user that may log in.
    pub user: String,
    /// The public keys that log in.
    pub keys: Vec<PublicKey>,
    /// The password that logs in, when there is one.
    pub password: Option<String>,
    /// Whether `direct-tcpip` channels are allowed; off refuses them as `AllowTcpForwarding no` does.
    pub forwarding: bool,
    /// What `exec` does; `None` refuses it as an account that runs no command does.
    pub exec: Option<ExecScript>,
}

impl Behavior {
    /// A server for `user` that accepts no login yet, allows forwarding and runs no command.
    #[must_use]
    pub fn new(host_key: PrivateKey, user: &str) -> Self {
        Self { host_key, user: user.to_owned(), keys: Vec::new(), password: None, forwarding: true, exec: None }
    }
}

/// What a server was asked, in order.
#[derive(Clone, Debug, Default)]
pub struct Seen {
    /// Connections accepted.
    pub connections: usize,
    /// Every public key offered (a key an agent signs for is offered twice: the probe and the signed request).
    pub offered: Vec<PublicKey>,
    /// Password attempts, right or wrong.
    pub passwords: usize,
    /// The `host:port` of every `direct-tcpip` request.
    pub forwards: Vec<(String, u16)>,
    /// Every command of an `exec` request.
    pub commands: Vec<String>,
}

impl Seen {
    /// Logins attempted: the keys offered (a repeat right after itself counts once) and the passwords.
    #[must_use]
    pub fn attempts(&self) -> usize {
        let mut keys = 0;
        let mut last: Option<&PublicKey> = None;
        for key in &self.offered {
            if last.is_none_or(|previous| previous.key_data() != key.key_data()) {
                keys += 1;
            }
            last = Some(key);
        }
        keys + self.passwords
    }

    /// Whether `key` was offered at all.
    #[must_use]
    pub fn offered_key(&self, key: &PublicKey) -> bool {
        self.offered.iter().any(|offered| offered.key_data() == key.key_data())
    }
}

/// The part of a server its connections share.
struct Shared {
    behavior: Behavior,
    seen: Mutex<Seen>,
}

impl Shared {
    fn record(&self, change: impl FnOnce(&mut Seen)) {
        change(&mut self.seen.lock().unwrap_or_else(PoisonError::into_inner));
    }

    fn accepts(&self, user: &str, key: &PublicKey) -> bool {
        user == self.behavior.user && self.behavior.keys.iter().any(|accepted| accepted.key_data() == key.key_data())
    }
}

/// One client's handler.
struct Connection {
    shared: Arc<Shared>,
}

impl Handler for Connection {
    type Error = russh::Error;

    async fn auth_publickey_offered(&mut self, user: &str, offer: PublicKeyOffer<'_>) -> Result<Auth, Self::Error> {
        self.shared.record(|seen| seen.offered.push(offer.public_key.clone()));
        Ok(if self.shared.accepts(user, offer.public_key) { Auth::Accept } else { Auth::reject() })
    }

    async fn auth_publickey(&mut self, user: &str, key: VerifiedPublicKey<'_>) -> Result<Auth, Self::Error> {
        Ok(if self.shared.accepts(user, key.public_key) { Auth::Accept } else { Auth::reject() })
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        self.shared.record(|seen| seen.passwords += 1);
        let right = user == self.shared.behavior.user && self.shared.behavior.password.as_deref() == Some(password);
        Ok(if right { Auth::Accept } else { Auth::reject() })
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host: &str,
        port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let port = u16::try_from(port).unwrap_or(0);
        self.shared.record(|seen| seen.forwards.push((host.to_owned(), port)));
        if !self.shared.behavior.forwarding {
            reply.reject(ChannelOpenFailure::AdministrativelyProhibited).await;
            return Ok(());
        }
        let host = host.to_owned();
        tokio::spawn(async move {
            match TcpStream::connect((host.as_str(), port)).await {
                Ok(mut tcp) => {
                    reply.accept().await;
                    let mut stream = channel.into_stream();
                    let _ = copy_bidirectional(&mut stream, &mut tcp).await;
                }
                Err(_) => reply.reject(ChannelOpenFailure::ConnectFailed).await,
            }
        });
        Ok(())
    }

    async fn exec_request(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> Result<(), Self::Error> {
        let command = String::from_utf8_lossy(data).into_owned();
        let outcome = self.shared.behavior.exec.as_ref().map(|script| script(&command));
        self.shared.record(|seen| seen.commands.push(command));
        match outcome {
            None => session.channel_failure(channel)?,
            Some(Exec::Hang) => session.channel_success(channel)?,
            Some(Exec::Done { stdout, status }) => {
                session.channel_success(channel)?;
                session.data(channel, stdout)?;
                session.exit_status_request(channel, status)?;
                session.eof(channel)?;
                session.close(channel)?;
            }
        }
        Ok(())
    }
}

/// A running in-process SSH server. Dropping it stops listening and disconnects its connections.
pub struct Server {
    addr: SocketAddr,
    shared: Arc<Shared>,
    shutdown: watch::Sender<bool>,
}

impl Server {
    /// Starts a server on a free loopback port.
    ///
    /// # Errors
    /// The port could not be bound.
    pub async fn start(behavior: Behavior) -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let config = Arc::new(russh::server::Config {
            keys: vec![behavior.host_key.clone()],
            auth_rejection_time: REJECTION_TIME,
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..russh::server::Config::default()
        });
        let shared = Arc::new(Shared { behavior, seen: Mutex::new(Seen::default()) });
        let (shutdown, mut stop) = watch::channel(false);
        let accepting = Arc::clone(&shared);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((socket, _)) = accepted else { break };
                        accepting.record(|seen| seen.connections += 1);
                        let handler = Connection { shared: Arc::clone(&accepting) };
                        tokio::spawn(serve_connection(Arc::clone(&config), socket, handler, stop.clone()));
                    }
                    _ = stop.changed() => break,
                }
            }
        });
        Ok(Self { addr, shared, shutdown })
    }

    /// The address the server listens on.
    #[must_use]
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// The port the server listens on.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    /// What the server has been asked so far.
    #[must_use]
    pub fn seen(&self) -> Seen {
        self.shared.seen.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

/// Runs one client's session until it ends or the server stops, in which case it disconnects the client.
async fn serve_connection(config: Arc<russh::server::Config>, socket: TcpStream, handler: Connection, mut stop: watch::Receiver<bool>) {
    let Ok(mut session) = run_stream(config, socket, handler).await else {
        return;
    };
    let handle = session.handle();
    tokio::select! {
        _ = &mut session => {}
        _ = stop.changed() => {
            let _ = handle.disconnect(Disconnect::ByApplication, String::new(), String::new()).await;
        }
    }
}

/// A TCP relay in front of a server that can be made silent: while [`cut`](Wire::cut), bytes in both directions are
/// read and dropped and the sockets stay open, which is a network that stopped answering, not one that refused.
pub struct Wire {
    addr: SocketAddr,
    cut: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

impl Wire {
    /// Starts a relay to `target` on a free loopback port.
    ///
    /// # Errors
    /// The port could not be bound.
    pub async fn start(target: SocketAddr) -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let cut = Arc::new(AtomicBool::new(false));
        let relayed = Arc::clone(&cut);
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            while let Ok((client, _)) = listener.accept().await {
                let cut = Arc::clone(&relayed);
                connections.spawn(async move {
                    if let Ok(server) = TcpStream::connect(target).await {
                        let ((from_client, to_client), (from_server, to_server)) = (client.into_split(), server.into_split());
                        tokio::join!(pump(from_client, to_server, Arc::clone(&cut)), pump(from_server, to_client, cut));
                    }
                });
                while connections.try_join_next().is_some() {}
            }
        });
        Ok(Self { addr, cut, task })
    }

    /// The address clients connect to.
    #[must_use]
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Makes the wire silent from now on.
    pub fn cut(&self) {
        self.cut.store(true, Ordering::Release);
    }
}

impl Drop for Wire {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Copies `from` to `to` until either ends, dropping what is read while `cut` is set.
async fn pump(mut from: OwnedReadHalf, mut to: OwnedWriteHalf, cut: Arc<AtomicBool>) {
    let mut buffer = vec![0_u8; WIRE_CHUNK];
    while let Ok(read) = from.read(&mut buffer).await {
        if read == 0 || (!cut.load(Ordering::Acquire) && to.write_all(&buffer[..read]).await.is_err()) {
            break;
        }
    }
    let _ = to.shutdown().await;
}

#[cfg(unix)]
pub use agent_socket::AgentSocket;

#[cfg(unix)]
mod agent_socket {
    use std::io;
    use std::path::{Path, PathBuf};
    use std::pin::Pin;
    use std::task::{Context, Poll};

    use futures_util::stream::Stream;
    use russh::keys::PrivateKey;
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::server::{Agent, serve};
    use tokio::net::{UnixListener, UnixStream};
    use tokio::task::JoinHandle;

    /// The sockets a listener accepts, as the agent server wants them.
    struct Accepts(UnixListener);

    impl Stream for Accepts {
        type Item = io::Result<UnixStream>;

        fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            self.0.poll_accept(cx).map(|accepted| Some(accepted.map(|(stream, _)| stream)))
        }
    }

    /// An agent that signs for every key it holds, without asking.
    #[derive(Clone)]
    struct Allow;

    impl Agent for Allow {}

    /// An SSH agent on a Unix socket, holding the keys it was started with. Dropping it stops it.
    pub struct AgentSocket {
        path: PathBuf,
        task: JoinHandle<()>,
    }

    impl AgentSocket {
        /// Starts an agent at `path` that holds `keys`.
        ///
        /// # Errors
        /// The socket could not be bound or a key could not be added.
        pub async fn start(path: &Path, keys: &[PrivateKey]) -> Result<Self, russh::keys::Error> {
            let listener = UnixListener::bind(path)?;
            let task = tokio::spawn(async move {
                let _ = serve(Accepts(listener), Allow).await;
            });
            let agent = Self { path: path.to_path_buf(), task };
            let mut client = AgentClient::connect_uds(path).await?;
            for key in keys {
                client.add_identity(key, &[]).await?;
            }
            Ok(agent)
        }

        /// The socket's path: what `SSH_AUTH_SOCK` names.
        #[must_use]
        pub fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for AgentSocket {
        fn drop(&mut self) {
            self.task.abort();
        }
    }
}
