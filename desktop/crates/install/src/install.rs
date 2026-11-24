//! Unpacking an archive into the layout and making it current (P3, P9, P12).
//!
//! The archive is untrusted input even though its hash was checked: it is unpacked entry by entry into a
//! folder of its own under `bin/tmp`, and an entry that could leave it is refused before anything is written
//! for it. Only a program that answers `--version` with the expected version is moved into `versions/`.

use std::fs;
use std::io::{self, BufReader};
use std::path::{Component, Path};
use std::time::Duration;

use flate2::read::GzDecoder;
use tar::{Archive, Entry, EntryType};

use crate::download::hex;
use crate::error::{InstallError, io_text};
use crate::layout::{BINARY, switch_current, tmp_dir, version_dir};
use crate::names::is_plain_name;
use crate::run::{VERSION_LIMIT, binary_version};

/// The most entries an archive may hold (a daemon archive has a few hundred).
const MAX_ENTRIES: u64 = 50_000;

/// The most bytes an archive may unpack to (a daemon archive unpacks to about 120 MiB).
const MAX_UNPACKED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Unpacks `archive` (a gzip tar), checks that its `pi-studio` answers `--version` with `version`, moves the folder to
/// `<bin_dir>/versions/<version>` (replacing a broken folder of that name) and switches `<bin_dir>/current` to it.
///
/// The archive may hold the program at its root or inside one top folder (`pi-studio-<version>-<target>/`). `bin/tmp`
/// is emptied before and after, which also removes what an interrupted install left (P10). On any failure `versions/`
/// and `current` are as they were, except that a failure of the very last step (the switch) leaves the new folder
/// installed beside the old `current`.
///
/// # Errors
/// See [`InstallError`]; [`InstallError::output`] has what the program printed.
pub fn install_version(archive: &Path, bin_dir: &Path, version: &str) -> Result<(), InstallError> {
    install_with_limit(archive, bin_dir, version, VERSION_LIMIT)
}

/// A closure that makes the install's `Io` error for `what`, with the underlying error's text.
fn io_failure(what: &'static str) -> impl Fn(io::Error) -> InstallError {
    move |e| InstallError::Io(io_text(what, &e))
}

pub(crate) fn install_with_limit(archive: &Path, bin_dir: &Path, version: &str, limit: Duration) -> Result<(), InstallError> {
    if !is_plain_name(version) {
        return Err(InstallError::InvalidName);
    }
    let tmp = tmp_dir(bin_dir);
    empty_dir(&tmp).map_err(|e| InstallError::Io(io_text("bin/tmp", &e)))?;
    let result = unpack_and_install(archive, bin_dir, &tmp, version, limit);
    // Best effort: the next install empties it again.
    let _ = empty_dir(&tmp);
    result
}

fn unpack_and_install(archive: &Path, bin_dir: &Path, tmp: &Path, version: &str, limit: Duration) -> Result<(), InstallError> {
    let work = tmp.join(random_name()?);
    fs::create_dir(&work).map_err(|e| InstallError::Io(io_text("the unpack folder", &e)))?;
    unpack(archive, &work)?;
    let root = program_root(&work)?;

    let found = binary_version(&root.join(BINARY), limit).map_err(InstallError::Version)?;
    if found != version {
        return Err(InstallError::WrongVersion { found: found.chars().take(512).collect() });
    }

    let target = version_dir(bin_dir, version);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(io_failure("the versions folder"))?;
    }
    // A folder of this name that is here did not pass as the current version, or the caller would not install: it is
    // replaced. `current` may point into it for the instant between the two calls.
    match fs::remove_dir_all(&target) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(io_failure("the old version folder")(e)),
    }
    fs::rename(root, &target).map_err(io_failure("the version folder"))?;
    switch_current(bin_dir, version).map_err(io_failure("the current link"))
}

/// A random folder name for one unpack.
fn random_name() -> Result<String, InstallError> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| InstallError::Io(format!("no random bytes: {e}")))?;
    Ok(hex(&bytes))
}

/// Makes `dir` an empty folder: created when missing, its contents removed otherwise.
fn empty_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        // `file_type` does not follow a link: a link is removed, never entered.
        if entry.file_type()?.is_dir() { fs::remove_dir_all(path)? } else { fs::remove_file(path)? }
    }
    Ok(())
}

/// The folder that holds `pi-studio`: `work` itself, or its one top folder.
fn program_root(work: &Path) -> Result<std::path::PathBuf, InstallError> {
    let has_program = |dir: &Path| fs::metadata(dir.join(BINARY)).is_ok_and(|m| m.is_file());
    if has_program(work) {
        return Ok(work.to_path_buf());
    }
    let io_error = |e: io::Error| InstallError::Io(io_text("the unpack folder", &e));
    let mut entries = fs::read_dir(work).map_err(io_error)?;
    if let (Some(only), None) = (entries.next(), entries.next()) {
        let path = only.map_err(io_error)?.path();
        // `symlink_metadata`: a top "folder" that is a link is not followed.
        if fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) && has_program(&path) {
            return Ok(path);
        }
    }
    Err(InstallError::NoBinary)
}

fn unpack(archive: &Path, dest: &Path) -> Result<(), InstallError> {
    let unpack_error = |e: io::Error| InstallError::Unpack(e.to_string());
    let file = fs::File::open(archive).map_err(unpack_error)?;
    let mut tar = Archive::new(GzDecoder::new(BufReader::new(file)));
    // Modes come from the archive (the program must stay executable), without setuid, setgid, sticky or group/other write.
    tar.set_preserve_permissions(true);
    tar.set_mask(0o7022);
    let mut count = 0u64;
    let mut bytes = 0u64;
    for entry in tar.entries().map_err(unpack_error)? {
        let mut entry = entry.map_err(unpack_error)?;
        count += 1;
        bytes = bytes.saturating_add(entry.size());
        if count > MAX_ENTRIES || bytes > MAX_UNPACKED_BYTES {
            return Err(InstallError::TooLarge);
        }
        check_entry(&entry)?;
        // `unpack_in` also refuses to write through a link that leaves `dest`; a refusal it reports as `false`
        // or as an error is the same refusal.
        let name = entry_name(&entry);
        match entry.unpack_in(dest) {
            Ok(true) => {}
            Ok(false) => return Err(InstallError::UnsafeEntry(name)),
            Err(e) => return Err(InstallError::Unpack(format!("{name}: {e}"))),
        }
    }
    Ok(())
}

/// The entry's path for a message, cut.
fn entry_name<R: io::Read>(entry: &Entry<'_, R>) -> String {
    entry.path().map(|p| p.to_string_lossy().chars().take(200).collect()).unwrap_or_else(|_| "(unreadable name)".to_string())
}

/// Refuses an entry that is not a regular file, a folder or a link that stays inside, or whose path leaves the folder.
fn check_entry<R: io::Read>(entry: &Entry<'_, R>) -> Result<(), InstallError> {
    let refuse = || InstallError::UnsafeEntry(entry_name(entry));
    let path = entry.path().map_err(|e| InstallError::Unpack(e.to_string()))?;
    if !path_stays_inside(&path) {
        return Err(refuse());
    }
    match entry.header().entry_type() {
        EntryType::Regular | EntryType::Continuous | EntryType::Directory => Ok(()),
        EntryType::Symlink => {
            let target = entry.link_name().map_err(|e| InstallError::Unpack(e.to_string()))?;
            match target {
                Some(target) if link_stays_inside(&path, &target) => Ok(()),
                _ => Err(refuse()),
            }
        }
        // Hard links, devices, FIFOs and anything else: a release archive holds none of them.
        _ => Err(refuse()),
    }
}

/// An entry path is relative and has no `..`: it names a place under the unpack folder.
fn path_stays_inside(path: &Path) -> bool {
    path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

/// A link's target stays inside the unpack folder when it is relative and goes up only at its start, no more levels than
/// the link's own folder is deep: `../lib/x` from `bin/tool` is fine, `a/../../x` and `/etc` and `../../x` from `bin/tool`
/// are not.
///
/// `..` after a name is refused even when it would stay inside, because the name may be another link: `a/b/s -> ../..`
/// is inside, but `t -> a/b/s/..` would then leave. With ups only first, every link resolves from the real folder it is
/// in, so no chain of links leaves the root.
fn link_stays_inside(link: &Path, target: &Path) -> bool {
    let depth = link.components().filter(|c| matches!(c, Component::Normal(_))).count().saturating_sub(1);
    let mut ups = 0usize;
    let mut named = false;
    for component in target.components() {
        match component {
            Component::ParentDir if named => return false,
            Component::ParentDir => ups += 1,
            Component::Normal(_) => named = true,
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    (named || ups > 0) && ups <= depth
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> &Path {
        Path::new(s)
    }

    #[test]
    fn entry_paths() {
        for ok in ["pi-studio", "a/b/c", "./a", "dir/"] {
            assert!(path_stays_inside(p(ok)), "{ok}");
        }
        for bad in ["../x", "a/../../x", "/etc/passwd", "a/..", ".."] {
            assert!(!path_stays_inside(p(bad)), "{bad}");
        }
    }

    #[test]
    fn link_targets() {
        // (link entry, target, stays inside)
        for (link, target, ok) in [
            ("a", "b", true),
            ("a", "./b/c", true),
            ("d/a", "../b", true),
            ("d/e/a", "../../b", true),
            ("d/a", "..", true),
            ("a", "..", false),
            ("a", "../b", false),
            ("d/a", "../../b", false),
            ("a", "/etc/passwd", false),
            ("a", "", false),
            ("a/b/t", "s/..", false),
            ("a", "b/../c", false),
        ] {
            assert_eq!(link_stays_inside(p(link), p(target)), ok, "{link} -> {target}");
        }
    }
}
