//! One archive download: streamed to `<dest>.part`, hashed on the way, renamed to `dest` only when the size and the
//! SHA-256 are the pinned ones. The memory held is one chunk, whatever the file's size (S8).

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use rustls::ClientConfig;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::time::timeout;

use crate::error::DownloadError;

/// The file to fetch, as the pin states it.
#[derive(Debug, Clone, Copy)]
pub struct Asset<'a> {
    /// Where to GET it. Never logged: it can carry a query.
    pub url: &'a str,
    /// The archive's SHA-256, 64 hex digits (any case).
    pub sha256: &'a str,
    /// The archive's size in bytes: the progress total, and a cap on what is read.
    pub size: u64,
}

const USER_AGENT: &str = concat!("pistudiodesktop-install/", env!("CARGO_PKG_VERSION"));

/// The name `dest` is written under until it is complete.
pub(crate) fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".part");
    dest.with_file_name(name)
}

/// Removes its file when dropped, whether the download failed or its future was dropped (a quit, a cancel), unless
/// disarmed by the rename that completes it.
struct PartGuard {
    path: PathBuf,
    armed: bool,
}

impl Drop for PartGuard {
    fn drop(&mut self) {
        if self.armed {
            // Best effort: a file that is already gone is the goal.
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
        // Writing to a `String` cannot fail.
        let _ = write!(out, "{b:02x}");
        out
    })
}

fn io_error(e: &std::io::Error) -> DownloadError {
    DownloadError::Io(e.to_string())
}

/// `rustls` with `ring`, the operating system's verifier, HTTP/1.1. The system's roots are read here, so this runs
/// on a blocking thread. No process-wide provider is installed: the app's other TLS users are not affected.
fn build_client(stall: Duration) -> Result<Client, DownloadError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = rustls_platform_verifier::Verifier::new(provider.clone())
        .map_err(|e| DownloadError::Request(format!("this system's certificate store could not be used: {e}")))?;
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| DownloadError::Request(format!("TLS could not be set up: {e}")))?
        // `dangerous()` is rustls's name for a verifier of one's own: this is the platform's, which checks the chain,
        // the validity period and the name.
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Client::builder()
        .tls_backend_preconfigured(config)
        .connect_timeout(stall)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| DownloadError::Request(e.without_url().to_string()))
}

async fn client(stall: Duration) -> Result<Client, DownloadError> {
    tokio::task::spawn_blocking(move || build_client(stall)).await.map_err(|_| DownloadError::Request("the HTTP client could not be set up".to_string()))?
}

fn request_error(e: reqwest::Error) -> DownloadError {
    DownloadError::Request(e.without_url().to_string())
}

/// Downloads `asset` to `dest`, calling `progress(received, total)` after every piece that arrived (the caller
/// rate-limits what it shows).
///
/// The bytes go to `<dest>.part` (an older one is replaced) and are hashed on the way; `dest` appears by a rename once
/// the size and the SHA-256 are right, and is never touched on a failure, which also removes the partial file, as does
/// dropping the future. `stall` bounds the wait for the answer and for each piece of the body; there is no limit on the
/// whole, so a slow link is not cut off.
///
/// # Errors
/// See [`DownloadError`].
pub async fn download(asset: &Asset<'_>, dest: &Path, stall: Duration, mut progress: impl FnMut(u64, u64)) -> Result<(), DownloadError> {
    let part = part_path(dest);
    if let Some(dir) = part.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| io_error(&e))?;
    }
    let mut guard = PartGuard { path: part.clone(), armed: true };
    fetch(asset, &part, stall, &mut progress).await?;
    tokio::fs::rename(&part, dest).await.map_err(|e| io_error(&e))?;
    guard.armed = false;
    Ok(())
}

async fn fetch(asset: &Asset<'_>, part: &Path, stall: Duration, progress: &mut impl FnMut(u64, u64)) -> Result<(), DownloadError> {
    let client = client(stall).await?;
    let mut response = timeout(stall, client.get(asset.url).send()).await.map_err(|_| DownloadError::Stalled)?.map_err(request_error)?;
    if !response.status().is_success() {
        return Err(DownloadError::Status(response.status().as_u16()));
    }
    if let Some(announced) = response.content_length()
        && announced != asset.size
    {
        return Err(DownloadError::WrongSize { expected: asset.size, received: announced });
    }
    let mut file = tokio::fs::File::create(part).await.map_err(|e| io_error(&e))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    while let Some(chunk) = timeout(stall, response.chunk()).await.map_err(|_| DownloadError::Stalled)?.map_err(request_error)? {
        received += chunk.len() as u64;
        // Never read past the pinned size: a server cannot fill the disk.
        if received > asset.size {
            return Err(DownloadError::WrongSize { expected: asset.size, received });
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| io_error(&e))?;
        progress(received, asset.size);
    }
    file.flush().await.map_err(|e| io_error(&e))?;
    drop(file);
    if received != asset.size {
        return Err(DownloadError::WrongSize { expected: asset.size, received });
    }
    if !hex(&hasher.finalize()).eq_ignore_ascii_case(asset.sha256) {
        return Err(DownloadError::ChecksumMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part_path_appends_to_the_file_name() {
        assert_eq!(part_path(Path::new("/a/b/x.tar.gz")), PathBuf::from("/a/b/x.tar.gz.part"));
    }

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(hex(&[0, 1, 0xab, 0xff]), "0001abff");
    }
}
