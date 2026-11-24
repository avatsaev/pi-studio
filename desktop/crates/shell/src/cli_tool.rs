//! The `pi-studio` command-line tool (D11, P5, S11 of `swe/features/single-binary-daemon.md`): a link
//! `~/.local/bin/pi-studio` to `$PI_STUDIO_HOME/bin/current/pi-studio`, and whether a new terminal finds it.
//!
//! [`state`] and [`install`] are pure rules over a [`Files`] seam and the login shell's environment (what the
//! supervisor captured: `PATH` there is what `command -v pi-studio` searches), so every state is tested with a
//! fake file system. The link points at `current`, so it follows every update. The app never edits a shell
//! start-up file, and never replaces a file it did not make: a link that is not ours, a file, a folder or a
//! dangling link at that place is `occupied`, and the install refuses.
//!
//! Windows has no link of the kind (and no binary): `unavailable`.

use std::io;
use std::path::{Component, Path, PathBuf};

use pistudiodesktop_model::CliToolState;

use crate::shell_env::{self, lookup};

/// The tool's name, in the version folder and on the user's `PATH`.
const PROGRAM: &str = "pi-studio";

/// Whether this system links the tool at all.
const SUPPORTED: bool = cfg!(unix);

/// What is at a path, looked at without following a link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Entry {
    Missing,
    /// A symbolic link, and what it says (not resolved).
    Symlink(PathBuf),
    /// A file, a folder or anything else.
    Other,
}

/// The file system as the rules need it; [`StdFiles`] is the real one.
pub trait Files: Send + Sync {
    /// What is at `path`. `Err` when that cannot be told (a part of the path is not a folder, no access).
    fn entry(&self, path: &Path) -> io::Result<Entry>;
    /// Whether `path`, following links, is a file that may be run.
    fn is_executable_file(&self, path: &Path) -> bool;
    /// `path` with every link followed; `None` when it does not lead to anything.
    fn real_path(&self, path: &Path) -> Option<PathBuf>;
    /// Create `path` and the folders above it that are missing.
    fn create_dir_all(&self, path: &Path) -> io::Result<()>;
    /// Create a symbolic link at `link` that says `target`; fails with `AlreadyExists` and changes nothing when
    /// anything is at `link`.
    fn symlink(&self, target: &Path, link: &Path) -> io::Result<()>;
}

/// The real file system.
#[derive(Clone, Copy, Debug, Default)]
pub struct StdFiles;

impl Files for StdFiles {
    fn entry(&self, path: &Path) -> io::Result<Entry> {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => Ok(Entry::Symlink(std::fs::read_link(path)?)),
            Ok(_) => Ok(Entry::Other),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Entry::Missing),
            Err(e) => Err(e),
        }
    }

    fn is_executable_file(&self, path: &Path) -> bool {
        let Ok(meta) = std::fs::metadata(path) else { return false };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            meta.is_file() && meta.permissions().mode() & 0o111 != 0
        }
        #[cfg(not(unix))]
        {
            meta.is_file()
        }
    }

    fn real_path(&self, path: &Path) -> Option<PathBuf> {
        std::fs::canonicalize(path).ok()
    }

    fn create_dir_all(&self, path: &Path) -> io::Result<()> {
        std::fs::create_dir_all(path)
    }

    fn symlink(&self, target: &Path, link: &Path) -> io::Result<()> {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link)
        }
        #[cfg(not(unix))]
        {
            let _ = (target, link);
            Err(io::Error::new(io::ErrorKind::Unsupported, "links are not made on this system"))
        }
    }
}

/// Why an install did nothing, or stopped. The words are the user's: they say what is wrong and what to do.
#[derive(Debug, PartialEq, Eq)]
pub enum InstallError {
    /// Windows, or no home directory to link from.
    Unavailable,
    /// The daemon's binary is not installed, so there is nothing to link to.
    NoBinary,
    /// Something the app did not make is at the link's place; it was left as it is.
    Occupied,
    /// The folder or the link could not be created.
    Io(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable => f.write_str("The command-line tool is not available on this machine."),
            Self::NoBinary => f.write_str("Pi Studio's daemon is not installed yet. Start the local daemon first, then install the command-line tool."),
            Self::Occupied => {
                f.write_str("A file that Pi Studio did not make is at ~/.local/bin/pi-studio. Pi Studio never replaces it: move or remove it, then try again.")
            }
            Self::Io(why) => write!(f, "The command-line tool could not be linked at ~/.local/bin/pi-studio: {why}."),
        }
    }
}

/// Where the link goes and what it points at.
struct Places {
    /// `$PI_STUDIO_HOME/bin/current/pi-studio`.
    program: PathBuf,
    /// `~/.local/bin/pi-studio`.
    link: PathBuf,
}

impl Places {
    /// `None` when `supported` is false, or when there is no absolute home to link from or to.
    fn of(supported: bool, env: &[(String, String)], home_dir: Option<PathBuf>) -> Option<Self> {
        if !supported {
            return None;
        }
        let home = shell_env::home_of(env, home_dir.clone()).filter(|h| h.is_absolute())?;
        let program = shell_env::bin_dir(&shell_env::pi_studio_home(env, home_dir)?).join("current").join(PROGRAM);
        Some(Self { program, link: home.join(".local").join("bin").join(PROGRAM) })
    }

    fn dir(&self) -> Option<&Path> {
        self.link.parent()
    }
}

/// How the place of the link stands.
enum Link {
    Missing,
    /// Our link: a symbolic link to the current binary.
    Ours,
    /// Anything else, or what cannot be told.
    Foreign,
}

fn link_at(files: &dyn Files, places: &Places) -> Link {
    match files.entry(&places.link) {
        Ok(Entry::Missing) => Link::Missing,
        Ok(Entry::Symlink(target)) => {
            // A relative target is read from the link's own folder.
            let target = if target.is_absolute() { target } else { places.dir().map_or(target.clone(), |dir| dir.join(&target)) };
            if normalized(&target) == places.program { Link::Ours } else { Link::Foreign }
        }
        Ok(Entry::Other) | Err(_) => Link::Foreign,
    }
}

/// `path` with `.` and `..` read away, without asking the file system: `~/.local/bin/../../.pi-studio/…` is the
/// same place as `~/.pi-studio/…`.
fn normalized(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// The first `pi-studio` a shell with `path` as its `PATH` runs: the first absolute folder that has an executable
/// file of that name. An empty or relative entry means the folder the shell is in, which the app has no way to know.
fn find_on_path(files: &dyn Files, path: Option<&str>) -> Option<PathBuf> {
    std::env::split_paths(path?).filter(|dir| dir.is_absolute()).map(|dir| dir.join(PROGRAM)).find(|candidate| files.is_executable_file(candidate))
}

/// The state of the tool, with `env` the login shell's environment and `home_dir` the fallback home.
pub fn state(files: &dyn Files, env: &[(String, String)], home_dir: Option<PathBuf>) -> CliToolState {
    decide(SUPPORTED, files, env, home_dir)
}

fn decide(supported: bool, files: &dyn Files, env: &[(String, String)], home_dir: Option<PathBuf>) -> CliToolState {
    let Some(places) = Places::of(supported, env, home_dir) else { return CliToolState::Unavailable };
    if !files.is_executable_file(&places.program) {
        return CliToolState::Unavailable;
    }
    match link_at(files, &places) {
        Link::Missing => CliToolState::Absent,
        Link::Foreign => CliToolState::Occupied,
        Link::Ours => {
            let Some(found) = find_on_path(files, lookup(env, "PATH")) else { return CliToolState::NotOnPath };
            let same = matches!((files.real_path(&found), files.real_path(&places.link)), (Some(a), Some(b)) if a == b);
            if same { CliToolState::Installed } else { CliToolState::Shadowed { path: found.to_string_lossy().into_owned() } }
        }
    }
}

/// Link `~/.local/bin/pi-studio` to the current binary: create the folder, refuse when something that is not our
/// link is in the way (nothing is replaced, ever), make the link, ask `recapture` for the login shell's environment
/// again (it may have `~/.local/bin` on its `PATH` now), and answer the state in that environment. A link that is
/// ours already is left as it is.
pub fn install(
    files: &dyn Files,
    env: &[(String, String)],
    home_dir: Option<PathBuf>,
    recapture: &dyn Fn() -> Vec<(String, String)>,
) -> Result<CliToolState, InstallError> {
    install_on(SUPPORTED, files, env, home_dir, recapture)
}

fn install_on(
    supported: bool,
    files: &dyn Files,
    env: &[(String, String)],
    home_dir: Option<PathBuf>,
    recapture: &dyn Fn() -> Vec<(String, String)>,
) -> Result<CliToolState, InstallError> {
    let places = Places::of(supported, env, home_dir.clone()).ok_or(InstallError::Unavailable)?;
    if !files.is_executable_file(&places.program) {
        return Err(InstallError::NoBinary);
    }
    let dir = places.dir().ok_or(InstallError::Unavailable)?;
    files.create_dir_all(dir).map_err(|e| InstallError::Io(e.to_string()))?;
    match link_at(files, &places) {
        Link::Foreign => return Err(InstallError::Occupied),
        Link::Ours => {}
        Link::Missing => match files.symlink(&places.program, &places.link) {
            Ok(()) => {}
            // Something appeared since we looked: it is not ours.
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(InstallError::Occupied),
            Err(e) => return Err(InstallError::Io(e.to_string())),
        },
    }
    Ok(decide(supported, files, &recapture(), home_dir))
}

/// The state's name for a log line.
pub fn state_name(state: &CliToolState) -> &'static str {
    match state {
        CliToolState::Absent => "absent",
        CliToolState::Installed => "installed",
        CliToolState::NotOnPath => "not_on_path",
        CliToolState::Shadowed { .. } => "shadowed",
        CliToolState::Occupied => "occupied",
        CliToolState::Unavailable => "unavailable",
    }
}

#[cfg(test)]
mod tests;
