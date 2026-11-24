#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unreachable)]

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use pistudiodesktop_model::CliToolState;

use super::{Entry, Files, InstallError, decide, install_on};

const HOME: &str = "/home/me";
const PROGRAM: &str = "/home/me/.pi-studio/bin/current/pi-studio";
const LINK: &str = "/home/me/.local/bin/pi-studio";

#[derive(Clone)]
enum Node {
    Dir,
    File { executable: bool },
    Link(PathBuf),
}

/// A file system in memory: the nodes by absolute path, and switches for the ways a real one fails.
#[derive(Default)]
struct Fake {
    nodes: Mutex<BTreeMap<PathBuf, Node>>,
    /// Every write fails (a read-only home).
    read_only: bool,
    /// `entry` says nothing is at the link's place, as when something is made there a moment later.
    stale_view: bool,
    made_links: AtomicUsize,
    made_dirs: AtomicUsize,
}

impl Fake {
    fn put(&self, path: &str, node: Node) -> &Self {
        let mut nodes = self.nodes.lock().unwrap();
        let mut parent = Path::new(path).parent();
        while let Some(dir) = parent {
            nodes.entry(dir.to_path_buf()).or_insert(Node::Dir);
            parent = dir.parent();
        }
        nodes.insert(PathBuf::from(path), node);
        self
    }

    fn file(&self, path: &str) -> &Self {
        self.put(path, Node::File { executable: true })
    }

    fn link(&self, path: &str, target: &str) -> &Self {
        self.put(path, Node::Link(PathBuf::from(target)))
    }

    /// The installed binary, as a version folder and `current` make it.
    fn binary(&self) -> &Self {
        self.file("/home/me/.pi-studio/bin/versions/0.0.131/pi-studio").link("/home/me/.pi-studio/bin/current", "versions/0.0.131")
    }

    fn at(&self, path: &str) -> Option<Node> {
        self.nodes.lock().unwrap().get(Path::new(path)).cloned()
    }

    /// Follow links in `path`, component by component (a link's relative target is read from its folder).
    fn resolve(&self, path: &Path) -> Option<(PathBuf, Node)> {
        let mut pending: Vec<std::ffi::OsString> = path.components().rev().map(|c| c.as_os_str().to_owned()).collect();
        let mut current = PathBuf::new();
        let mut hops = 0;
        while let Some(part) = pending.pop() {
            match part.to_str() {
                Some(".") => continue,
                Some("..") => {
                    current.pop();
                    continue;
                }
                _ => current.push(&part),
            }
            if current == Path::new("/") {
                continue;
            }
            let node = self.nodes.lock().unwrap().get(&current).cloned()?;
            if let Node::Link(target) = node {
                hops += 1;
                if hops > 16 {
                    return None;
                }
                current.pop();
                if target.is_absolute() {
                    current = PathBuf::from("/");
                }
                pending.extend(target.components().rev().map(|c| c.as_os_str().to_owned()).filter(|c| c != "/"));
            }
        }
        let node = if current == Path::new("/") { Node::Dir } else { self.nodes.lock().unwrap().get(&current).cloned()? };
        Some((current, node))
    }
}

impl Files for Fake {
    fn entry(&self, path: &Path) -> io::Result<Entry> {
        if self.stale_view {
            return Ok(Entry::Missing);
        }
        Ok(match self.at(&path.to_string_lossy()) {
            None => Entry::Missing,
            Some(Node::Link(target)) => Entry::Symlink(target),
            Some(_) => Entry::Other,
        })
    }

    fn is_executable_file(&self, path: &Path) -> bool {
        matches!(self.resolve(path), Some((_, Node::File { executable: true })))
    }

    fn real_path(&self, path: &Path) -> Option<PathBuf> {
        self.resolve(path).map(|(real, _)| real)
    }

    fn create_dir_all(&self, path: &Path) -> io::Result<()> {
        if self.read_only {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
        if matches!(self.at(&path.to_string_lossy()), Some(Node::File { .. })) {
            return Err(io::Error::other("not a folder"));
        }
        self.made_dirs.fetch_add(1, Ordering::SeqCst);
        self.put(&path.to_string_lossy(), Node::Dir);
        Ok(())
    }

    fn symlink(&self, target: &Path, link: &Path) -> io::Result<()> {
        if self.read_only {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
        if self.at(&link.to_string_lossy()).is_some() {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        self.made_links.fetch_add(1, Ordering::SeqCst);
        self.put(&link.to_string_lossy(), Node::Link(target.to_path_buf()));
        Ok(())
    }
}

fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
}

/// A login shell that has `~/.local/bin` on its `PATH`.
fn on_path() -> Vec<(String, String)> {
    env(&[("HOME", HOME), ("PATH", "/usr/bin:/home/me/.local/bin:/bin")])
}

/// One that has not.
fn off_path() -> Vec<(String, String)> {
    env(&[("HOME", HOME), ("PATH", "/usr/bin:/bin")])
}

fn state_of(files: &Fake, env: &[(String, String)]) -> CliToolState {
    decide(true, files, env, None)
}

#[test]
fn no_binary_is_unavailable_whatever_is_at_the_link() {
    let files = Fake::default();
    assert_eq!(state_of(&files, &on_path()), CliToolState::Unavailable);
    files.link(LINK, PROGRAM);
    assert_eq!(state_of(&files, &on_path()), CliToolState::Unavailable);
    // A `current` that leads nowhere, and a binary that cannot be run, are no binary.
    let files = Fake::default();
    files.link("/home/me/.pi-studio/bin/current", "versions/0.0.131");
    assert_eq!(state_of(&files, &on_path()), CliToolState::Unavailable);
    let files = Fake::default();
    files.put(PROGRAM, Node::File { executable: false });
    assert_eq!(state_of(&files, &on_path()), CliToolState::Unavailable);
}

#[test]
fn windows_and_a_machine_with_no_home_are_unavailable() {
    let files = Fake::default();
    files.binary();
    assert_eq!(decide(false, &files, &on_path(), None), CliToolState::Unavailable);
    assert_eq!(decide(true, &files, &env(&[("PATH", "/usr/bin")]), None), CliToolState::Unavailable);
    assert_eq!(decide(true, &files, &env(&[("HOME", "relative")]), None), CliToolState::Unavailable);
    // The hook's home directory serves when the shell's environment has none.
    assert_eq!(decide(true, &files, &env(&[("PATH", "/usr/bin")]), Some(PathBuf::from(HOME))), CliToolState::Absent);
}

#[test]
fn nothing_at_the_link_is_absent() {
    let files = Fake::default();
    files.binary();
    assert_eq!(state_of(&files, &on_path()), CliToolState::Absent);
}

#[test]
fn what_is_not_our_link_is_occupied() {
    for make in [
        (|f: &Fake| {
            f.file(LINK);
        }) as fn(&Fake),
        |f| {
            f.put(LINK, Node::Dir);
        },
        |f| {
            f.put(LINK, Node::File { executable: false });
        },
        // A link to another binary, and to the version's file rather than to `current`.
        |f| {
            f.file("/opt/pi-studio/pi-studio").link(LINK, "/opt/pi-studio/pi-studio");
        },
        |f| {
            f.link(LINK, "/home/me/.pi-studio/bin/versions/0.0.131/pi-studio");
        },
        // A link that leads nowhere and is not ours.
        |f| {
            f.link(LINK, "/gone/pi-studio");
        },
        |f| {
            f.link(LINK, "pi-studio-elsewhere");
        },
    ] {
        let files = Fake::default();
        files.binary();
        make(&files);
        assert_eq!(state_of(&files, &on_path()), CliToolState::Occupied);
    }
}

#[test]
fn a_link_to_another_home_is_occupied_and_to_the_moved_home_is_ours() {
    let files = Fake::default();
    files.binary();
    files.file("/data/ps/bin/versions/1/pi-studio").link("/data/ps/bin/current", "versions/1").link(LINK, PROGRAM);
    let moved = env(&[("HOME", HOME), ("PI_STUDIO_HOME", "/data/ps"), ("PATH", "/home/me/.local/bin")]);
    assert_eq!(state_of(&files, &moved), CliToolState::Occupied);
    files.link(LINK, "/data/ps/bin/current/pi-studio");
    assert_eq!(state_of(&files, &moved), CliToolState::Installed);
}

#[test]
fn a_relative_link_to_current_is_ours_and_to_anything_else_is_not() {
    let files = Fake::default();
    files.binary().link(LINK, "../../.pi-studio/bin/current/pi-studio");
    // Read from the link's folder and with the `..` read away, it is the current binary.
    assert_eq!(state_of(&files, &on_path()), CliToolState::Installed);
    files.link(LINK, "../../.pi-studio/bin/versions/0.0.131/pi-studio");
    assert_eq!(state_of(&files, &on_path()), CliToolState::Occupied);
}

#[test]
fn our_link_with_the_folder_off_path_is_not_on_path() {
    let files = Fake::default();
    files.binary().link(LINK, PROGRAM);
    assert_eq!(state_of(&files, &off_path()), CliToolState::NotOnPath);
    assert_eq!(state_of(&files, &env(&[("HOME", HOME)])), CliToolState::NotOnPath, "no PATH at all");
    assert_eq!(state_of(&files, &env(&[("HOME", HOME), ("PATH", "")])), CliToolState::NotOnPath);
}

#[test]
fn a_relative_or_empty_path_entry_is_not_searched() {
    let files = Fake::default();
    files.binary().link(LINK, PROGRAM).file("/work/pi-studio");
    let odd = env(&[("HOME", HOME), ("PATH", ":bin:./:/home/me/.local/bin")]);
    assert_eq!(state_of(&files, &odd), CliToolState::Installed);
    let odd = env(&[("HOME", HOME), ("PATH", ":bin:./")]);
    assert_eq!(state_of(&files, &odd), CliToolState::NotOnPath);
}

#[test]
fn another_pi_studio_first_on_path_is_shadowed_and_names_its_path() {
    let files = Fake::default();
    files.binary().link(LINK, PROGRAM).file("/usr/local/bin/pi-studio");
    let shadowed = env(&[("HOME", HOME), ("PATH", "/usr/local/bin:/home/me/.local/bin")]);
    assert_eq!(state_of(&files, &shadowed), CliToolState::Shadowed { path: "/usr/local/bin/pi-studio".into() });
    // Also when ~/.local/bin is not on the path at all: what the shell would run is somebody else's.
    let elsewhere = env(&[("HOME", HOME), ("PATH", "/usr/local/bin")]);
    assert_eq!(state_of(&files, &elsewhere), CliToolState::Shadowed { path: "/usr/local/bin/pi-studio".into() });
    // A folder after ours does not shadow it.
    let after = env(&[("HOME", HOME), ("PATH", "/home/me/.local/bin:/usr/local/bin")]);
    assert_eq!(state_of(&files, &after), CliToolState::Installed);
}

#[test]
fn an_earlier_path_entry_that_is_a_link_to_the_same_binary_is_installed() {
    let files = Fake::default();
    files.binary().link(LINK, PROGRAM).link("/usr/local/bin/pi-studio", "/home/me/.pi-studio/bin/versions/0.0.131/pi-studio");
    let env = env(&[("HOME", HOME), ("PATH", "/usr/local/bin:/home/me/.local/bin")]);
    assert_eq!(state_of(&files, &env), CliToolState::Installed);
}

#[test]
fn our_link_found_first_on_path_is_installed() {
    let files = Fake::default();
    files.binary().link(LINK, PROGRAM);
    assert_eq!(state_of(&files, &on_path()), CliToolState::Installed);
}

fn never() -> Vec<(String, String)> {
    unreachable!("the environment is asked for again only after a link was made or found")
}

#[test]
fn install_makes_the_link_the_folder_and_answers_the_state_of_the_fresh_environment() {
    let files = Fake::default();
    files.binary();
    let asked = AtomicUsize::new(0);
    let recapture = || {
        asked.fetch_add(1, Ordering::SeqCst);
        on_path()
    };
    let state = install_on(true, &files, &off_path(), None, &recapture).unwrap();
    assert_eq!(state, CliToolState::Installed, "the new login shell finds the folder now");
    assert_eq!(asked.load(Ordering::SeqCst), 1);
    assert_eq!(files.made_links.load(Ordering::SeqCst), 1);
    assert!(matches!(files.at(LINK), Some(Node::Link(target)) if target == Path::new(PROGRAM)));
    assert!(matches!(files.at("/home/me/.local/bin"), Some(Node::Dir)));
}

#[test]
fn install_answers_not_on_path_and_shadowed_from_the_fresh_environment() {
    let files = Fake::default();
    files.binary();
    assert_eq!(install_on(true, &files, &off_path(), None, &off_path).unwrap(), CliToolState::NotOnPath);
    files.file("/usr/local/bin/pi-studio");
    let shadowed = || env(&[("HOME", HOME), ("PATH", "/usr/local/bin:/home/me/.local/bin")]);
    assert_eq!(install_on(true, &files, &off_path(), None, &shadowed).unwrap(), CliToolState::Shadowed { path: "/usr/local/bin/pi-studio".into() });
}

#[test]
fn install_over_our_own_link_makes_nothing_and_still_answers() {
    let files = Fake::default();
    files.binary().link(LINK, PROGRAM);
    assert_eq!(install_on(true, &files, &off_path(), None, &on_path).unwrap(), CliToolState::Installed);
    assert_eq!(files.made_links.load(Ordering::SeqCst), 0);
}

#[test]
fn install_refuses_what_is_not_ours_and_leaves_it_as_it_is() {
    for occupant in [
        Node::File { executable: true },
        Node::File { executable: false },
        Node::Dir,
        Node::Link(PathBuf::from("/gone/pi-studio")),
        Node::Link(PathBuf::from("/usr/bin/true")),
    ] {
        let files = Fake::default();
        files.binary().put(LINK, occupant.clone());
        let refused = install_on(true, &files, &off_path(), None, &never).unwrap_err();
        assert_eq!(refused, InstallError::Occupied);
        assert!(refused.to_string().contains("never replaces"));
        assert_eq!(files.made_links.load(Ordering::SeqCst), 0);
        let kept = files.at(LINK).unwrap();
        match (kept, occupant) {
            (Node::File { executable: a }, Node::File { executable: b }) => assert_eq!(a, b),
            (Node::Dir, Node::Dir) => {}
            (Node::Link(a), Node::Link(b)) => assert_eq!(a, b),
            _ => panic!("the occupant was replaced"),
        }
    }
}

#[test]
fn install_refuses_what_appeared_between_the_look_and_the_link() {
    let files = Fake { stale_view: true, ..Fake::default() };
    files.binary().file(LINK);
    assert_eq!(install_on(true, &files, &off_path(), None, &never).unwrap_err(), InstallError::Occupied);
    assert!(matches!(files.at(LINK), Some(Node::File { .. })));
}

#[test]
fn install_with_no_binary_or_on_windows_does_nothing_at_all() {
    let files = Fake::default();
    assert_eq!(install_on(true, &files, &off_path(), None, &never).unwrap_err(), InstallError::NoBinary);
    files.binary();
    assert_eq!(install_on(false, &files, &off_path(), None, &never).unwrap_err(), InstallError::Unavailable);
    assert_eq!(files.made_dirs.load(Ordering::SeqCst) + files.made_links.load(Ordering::SeqCst), 0);
}

#[test]
fn install_that_cannot_write_says_so() {
    let files = Fake { read_only: true, ..Fake::default() };
    files.binary();
    let error = install_on(true, &files, &off_path(), None, &never).unwrap_err();
    assert!(matches!(&error, InstallError::Io(why) if !why.is_empty()), "{error:?}");
    assert!(error.to_string().starts_with("The command-line tool could not be linked"));
}

#[test]
fn install_when_a_file_is_where_the_folder_goes_says_so_and_changes_nothing() {
    let files = Fake::default();
    files.binary().file("/home/me/.local/bin");
    assert!(matches!(install_on(true, &files, &off_path(), None, &never), Err(InstallError::Io(_))));
    assert!(matches!(files.at("/home/me/.local/bin"), Some(Node::File { .. })));
}

#[cfg(unix)]
mod real {
    use std::os::unix::fs::PermissionsExt as _;

    use super::*;
    use crate::cli_tool::StdFiles;

    /// A home with the installed binary under `.pi-studio/bin/current`, as a real install leaves it.
    fn home_with_binary() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let version = home.path().join(".pi-studio/bin/versions/0.0.131");
        std::fs::create_dir_all(&version).unwrap();
        std::fs::write(version.join("pi-studio"), "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(version.join("pi-studio"), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink("versions/0.0.131", home.path().join(".pi-studio/bin/current")).unwrap();
        home
    }

    fn env_of(home: &Path, path: &str) -> Vec<(String, String)> {
        env(&[("HOME", &home.display().to_string()), ("PATH", path)])
    }

    #[test]
    fn the_real_files_go_from_absent_to_installed_and_a_foreign_file_is_never_replaced() {
        let home = home_with_binary();
        let bin = home.path().join(".local/bin");
        let off = env_of(home.path(), "/usr/bin:/bin");
        let on = env_of(home.path(), &format!("{}:/usr/bin", bin.display()));
        assert_eq!(decide(true, &StdFiles, &off, None), CliToolState::Absent);
        assert_eq!(install_on(true, &StdFiles, &off, None, &|| on.clone()).unwrap(), CliToolState::Installed);
        assert_eq!(std::fs::read_link(bin.join("pi-studio")).unwrap(), home.path().join(".pi-studio/bin/current/pi-studio"));
        assert_eq!(decide(true, &StdFiles, &off, None), CliToolState::NotOnPath);
        assert_eq!(decide(true, &StdFiles, &on, None), CliToolState::Installed);
        // The link follows an update: `current` moves, the link stays.
        let next = home.path().join(".pi-studio/bin/versions/0.0.132");
        std::fs::create_dir_all(&next).unwrap();
        std::fs::copy(home.path().join(".pi-studio/bin/versions/0.0.131/pi-studio"), next.join("pi-studio")).unwrap();
        std::fs::remove_file(home.path().join(".pi-studio/bin/current")).unwrap();
        std::os::unix::fs::symlink("versions/0.0.132", home.path().join(".pi-studio/bin/current")).unwrap();
        assert_eq!(decide(true, &StdFiles, &on, None), CliToolState::Installed);

        // A file of the user's at that place: occupied, refused, untouched.
        std::fs::remove_file(bin.join("pi-studio")).unwrap();
        std::fs::write(bin.join("pi-studio"), "mine").unwrap();
        assert_eq!(decide(true, &StdFiles, &on, None), CliToolState::Occupied);
        assert_eq!(install_on(true, &StdFiles, &off, None, &never).unwrap_err(), InstallError::Occupied);
        assert_eq!(std::fs::read_to_string(bin.join("pi-studio")).unwrap(), "mine");
        // A dangling link of somebody else's too.
        std::fs::remove_file(bin.join("pi-studio")).unwrap();
        std::os::unix::fs::symlink(home.path().join("nowhere"), bin.join("pi-studio")).unwrap();
        assert_eq!(decide(true, &StdFiles, &on, None), CliToolState::Occupied);
        assert_eq!(install_on(true, &StdFiles, &off, None, &never).unwrap_err(), InstallError::Occupied);
        assert_eq!(std::fs::read_link(bin.join("pi-studio")).unwrap(), home.path().join("nowhere"));
    }

    #[test]
    fn another_executable_first_on_the_real_path_shadows() {
        let home = home_with_binary();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("pi-studio"), "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(other.path().join("pi-studio"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let bin = home.path().join(".local/bin");
        let path = format!("{}:{}", other.path().display(), bin.display());
        let env = env_of(home.path(), &path);
        assert_eq!(
            install_on(true, &StdFiles, &env, None, &|| env.clone()).unwrap(),
            CliToolState::Shadowed { path: other.path().join("pi-studio").display().to_string() }
        );
        // A file without the execute bit is not what the shell runs.
        std::fs::set_permissions(other.path().join("pi-studio"), std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(decide(true, &StdFiles, &env, None), CliToolState::Installed);
    }
}
