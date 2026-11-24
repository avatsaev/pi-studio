//! The daemon installer of the local entry and the SSH install (`swe/features/single-binary-daemon.md` S8, S9, P3, P9, P10):
//! download an archive with progress and a stall limit, check its SHA-256, keep it in the archive cache, unpack it safely
//! into `bin/versions/<version>`, check `--version`, switch `current` and remove old versions.
//!
//! It knows nothing of the registry, the shell or the page. It uses no socket of `net`: the download is `reqwest` over
//! `rustls` with `ring` and the operating system's certificate verifier.
//!
//! * [`download`]: one archive to a file, `<dest>.part` then a rename, the hash on the way ([`Asset`], [`DownloadError`]).
//! * [`ArchiveCache`]: `<dir>/<version>/<target>.tar.gz`; [`ArchiveCache::get_or_download`] uses a cached archive that
//!   still matches the pin; [`ArchiveCache::retain_only`] keeps the pinned version's folder alone.
//! * [`install_version`]: unpack into `bin/tmp/<random>/` (an entry or a link outside it is refused), run
//!   `pi-studio --version`, move the folder to `versions/<version>`, switch `current` by renaming a new link over it,
//!   empty `bin/tmp` ([`InstallError`]).
//! * [`current_version`], [`prune`], [`binary_version`]: read what is installed, remove old versions, ask a program its version.
//! * [`switch_current`]: point `current` at a version folder that is already installed.
//!
//! The download is `async`; the file-system steps are blocking and belong on a blocking thread.
#![cfg(not(target_arch = "wasm32"))]

mod cache;
mod download;
mod error;
mod install;
mod layout;
mod names;
mod run;
#[cfg(all(test, unix))]
mod tests;

pub use cache::ArchiveCache;
pub use download::{Asset, download};
pub use error::{DownloadError, InstallError, VersionError};
pub use install::install_version;
pub use layout::{BINARY, current_version, prune, switch_current, version_dir};
pub use run::{VERSION_LIMIT, binary_version};
