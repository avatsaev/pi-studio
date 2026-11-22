//! What the connect and login tests share: a scratch home, targets for the in-process servers, and the known-hosts
//! files that trust them.

use std::path::{Path, PathBuf};

use russh::keys::PrivateKey;

use crate::config::{Agent, Target};
use crate::known_hosts::trust;
use crate::testing::{Behavior, Server, ed25519};
use crate::{Environment, Limits};

/// The user every test server accepts.
pub const USER: &str = "tester";
/// The address every test server listens on.
pub const HOST: &str = "127.0.0.1";

/// A scratch home with an app known-hosts file that is not yet there.
pub struct Fixture {
    _dir: tempfile::TempDir,
    pub home: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("scratch directory");
        let home = dir.path().join("home");
        std::fs::create_dir_all(home.join(".ssh")).expect("scratch .ssh");
        Self { _dir: dir, home }
    }

    /// `~/.ssh/known_hosts`.
    pub fn user_known_hosts(&self) -> PathBuf {
        self.home.join(".ssh").join("known_hosts")
    }

    /// The app's own file.
    pub fn app_known_hosts(&self) -> PathBuf {
        self.home.join("app_known_hosts")
    }

    /// The files a connect reads, in order.
    pub fn known_hosts(&self) -> Vec<PathBuf> {
        vec![self.user_known_hosts(), self.app_known_hosts()]
    }

    pub fn env(&self) -> Environment {
        Environment { home: self.home.clone(), vars: Default::default() }
    }

    /// A key file under `~/.ssh`, named `name`.
    pub fn key_file(&self, name: &str, key: &PrivateKey) -> PathBuf {
        let path = self.home.join(".ssh").join(name);
        crate::testing::write_key(&path, key).expect("write key");
        path
    }

    /// Trusts `server`'s host key in the app's file.
    pub fn trust(&self, server: &Server, host_key: &PrivateKey) {
        trust(HOST, server.port(), host_key.public_key(), &self.app_known_hosts()).expect("trust host key");
    }
}

/// The host key `seed` gives, and a server that logs [`USER`] in with `keys`, password `password`, and the options of
/// `configure`; it is trusted in `fixture`.
pub async fn server(fixture: &Fixture, seed: u8, configure: impl FnOnce(&mut Behavior)) -> (Server, PrivateKey) {
    let host_key = ed25519(seed);
    let mut behavior = Behavior::new(host_key.clone(), USER);
    configure(&mut behavior);
    let server = Server::start(behavior).await.expect("start server");
    fixture.trust(&server, &host_key);
    (server, host_key)
}

/// A target for `port` with no key file, no agent and no hop.
pub fn target(port: u16) -> Target {
    Target { host: HOST.to_owned(), port, user: USER.to_owned(), identity_files: Vec::new(), identities_only: false, agent: Agent::Disabled, hops: Vec::new() }
}

/// A target for `server` that tries `files`.
pub fn target_with_keys(server: &Server, files: &[&Path]) -> Target {
    Target { identity_files: files.iter().map(|path| path.to_path_buf()).collect(), ..target(server.port()) }
}

/// The limits of the tests that do not test a limit: the defaults.
pub fn limits() -> Limits {
    Limits::default()
}
