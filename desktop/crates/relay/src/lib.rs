//! The client side of relay protocol 2 (`swe/architecture/relay-protocol.md`).
//!
//! The pure parts (the session id and the encrypted channel) have no socket and are tested against the
//! published relay fixtures; the connect state machine dials through `pistudiodesktop_net` and answers a
//! daemon socket the loopback proxy and the transfer engine take like any other.
#![cfg(not(target_arch = "wasm32"))]

#[cfg(test)]
mod tests {
    #[test]
    fn dependencies_resolve() {
        let _ = crypto_box::SalsaBox::new;
        let _ = <sha2::Sha512 as sha2::Digest>::new;
    }
}
