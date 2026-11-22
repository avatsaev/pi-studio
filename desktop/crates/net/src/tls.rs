//! TLS to the daemon, trusting the operating system's certificate store and nothing else.
//!
//! The verifier is `rustls-platform-verifier`: the system's own on macOS and Windows, the system's
//! root files with webpki on Linux. There is no option to accept a certificate the system does not
//! trust, and no way to skip the name check.

use std::io;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName};
use tokio_rustls::rustls::{self, CertificateError, ClientConfig};

use crate::error::{DialError, TlsReason};

/// Extra trust anchors. The shipped dial passes none; the crate's tests pass the root of a
/// certificate authority they made, so that a certificate can fail for one reason at a time.
pub(crate) type ExtraRoots = Vec<CertificateDer<'static>>;

/// The client configuration: `ring`'s provider, the system's verifier, no ALPN (the daemon speaks
/// HTTP/1.1 for the upgrade), no client certificate.
fn client_config(extra_roots: ExtraRoots) -> Result<ClientConfig, rustls::Error> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = if extra_roots.is_empty() {
        rustls_platform_verifier::Verifier::new(provider.clone())?
    } else {
        rustls_platform_verifier::Verifier::new_with_extra_roots(extra_roots, provider.clone())?
    };
    // `dangerous()` is rustls's name for installing a verifier of one's own. This one is the
    // platform's, and it checks the chain, the validity period and the name.
    Ok(ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth())
}

/// Runs the TLS handshake over `tcp`. `host` is the name the certificate must be valid for: a
/// host name or an IP address. `target` is `host:port` for messages.
pub(crate) async fn connect(tcp: TcpStream, host: &str, target: &str, extra_roots: ExtraRoots) -> Result<TlsStream<TcpStream>, DialError> {
    let name = ServerName::try_from(host.to_owned())
        .map_err(|_| DialError::tls(TlsReason::WrongName, format!("{host} is not a valid name for a certificate check.")))?;
    // The Linux verifier reads the system's root files, the others call the system: neither
    // belongs on the async threads. Building one per dial also picks up a changed store.
    let config = tokio::task::spawn_blocking(move || client_config(extra_roots))
        .await
        .map_err(|_| DialError::tls(TlsReason::Other, "The TLS setup did not finish."))?
        .map_err(|e| DialError::tls(TlsReason::Other, format!("This system's certificate store could not be used: {e}.")))?;
    TlsConnector::from(Arc::new(config)).connect(name, tcp).await.map_err(|e| classify(&e, target))
}

/// Turns a failed TLS handshake into the dial error that says why.
fn classify(error: &io::Error, target: &str) -> DialError {
    let inner = error.get_ref().and_then(|e| e.downcast_ref::<rustls::Error>());
    match inner {
        Some(rustls::Error::InvalidCertificate(cert)) => {
            let reason = reason_of(cert);
            DialError::tls(
                reason,
                format!(
                    "The certificate of {target} {}. Check the daemon's certificate; a certificate this system does not trust is never accepted.",
                    reason.phrase()
                ),
            )
        }
        Some(other) => DialError::tls(TlsReason::Other, format!("The TLS handshake with {target} failed: {other}.")),
        None => DialError::tls(
            TlsReason::Other,
            format!("The TLS handshake with {target} did not complete ({}). Is the daemon serving wss: on this port?", error.kind()),
        ),
    }
}

fn reason_of(error: &CertificateError) -> TlsReason {
    match error {
        CertificateError::Expired | CertificateError::ExpiredContext { .. } => TlsReason::Expired,
        CertificateError::NotValidYet | CertificateError::NotValidYetContext { .. } => TlsReason::NotYetValid,
        CertificateError::UnknownIssuer => TlsReason::UnknownIssuer,
        CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. } => TlsReason::WrongName,
        CertificateError::Revoked => TlsReason::Revoked,
        _ => TlsReason::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn certificate_errors_map_to_reasons() {
        assert_eq!(reason_of(&CertificateError::Expired), TlsReason::Expired);
        assert_eq!(reason_of(&CertificateError::NotValidYet), TlsReason::NotYetValid);
        assert_eq!(reason_of(&CertificateError::UnknownIssuer), TlsReason::UnknownIssuer);
        assert_eq!(reason_of(&CertificateError::NotValidForName), TlsReason::WrongName);
        assert_eq!(reason_of(&CertificateError::Revoked), TlsReason::Revoked);
        assert_eq!(reason_of(&CertificateError::BadSignature), TlsReason::Other);
    }

    #[test]
    fn a_non_tls_failure_names_the_target_and_the_likely_cause() {
        let e = classify(&io::Error::from(io::ErrorKind::UnexpectedEof), "127.0.0.1:9");
        assert_eq!(e.code, crate::error::ErrorCode::Tls);
        assert!(e.message.contains("127.0.0.1:9") && e.message.contains("wss:"), "{}", e.message);
    }

    #[test]
    fn the_system_config_builds() {
        client_config(Vec::new()).unwrap();
    }
}
