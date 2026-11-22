//! The SSH client: `~/.ssh/config`, known hosts, login through jump hosts, the daemon's `direct-tcpip`
//! channel and remote commands (`swe/features/desktop-relay-ssh.md` § 7).
//!
//! It opens a daemon socket through `pistudiodesktop_net::dial_over` and knows nothing of the registry or
//! the page.
#![cfg(not(target_arch = "wasm32"))]

#[cfg(test)]
mod tests {
    #[test]
    fn dependencies_resolve() {
        let _ = russh::client::Config::default();
        let _ = ssh2_config::SshConfig::default();
    }
}
