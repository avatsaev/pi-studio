//! Finding the `pi-studio` CLI the way a terminal would, through the hooks of [`Services`].

use std::path::{Path, PathBuf};

use crate::services::Services;

/// The CLI's file name.
pub const CLI_NAME: &str = "pi-studio";

/// Directories under the home directory where npm and the Node version managers put global
/// binaries, in the order they are tried.
pub const HOME_BIN_DIRS: &[&str] = &[
    ".npm-global/bin",
    ".local/bin",
    ".volta/bin",
    ".bun/bin",
    ".yarn/bin",
    ".local/share/pnpm",
    ".asdf/shims",
    ".local/share/mise/shims",
    ".npm-packages/bin",
];

/// Directories under the home directory that hold one directory per Node version, each with the
/// binaries in `bin_under`. Newest name first.
pub const HOME_VERSIONED_DIRS: &[(&str, &str)] = &[
    (".nvm/versions/node", "bin"),
    (".local/share/fnm/node-versions", "installation/bin"),
    (".fnm/node-versions", "installation/bin"),
    (".asdf/installs/nodejs", "bin"),
];

/// Where system-wide installs go.
pub const SYSTEM_BIN_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"];

/// No file can be run as the CLI. `path` is the `cliPath` setting that was tried, when one was set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliMissing {
    pub path: Option<String>,
}

/// The directories of the usual install locations for `home`; `list_dir` lists a directory.
pub fn candidate_dirs(home: Option<&Path>, list_dir: &dyn Fn(&Path) -> Vec<PathBuf>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.extend(HOME_BIN_DIRS.iter().map(|d| home.join(d)));
        for (root, bin) in HOME_VERSIONED_DIRS {
            let mut versions = list_dir(&home.join(root));
            versions.sort();
            dirs.extend(versions.into_iter().rev().map(|v| v.join(bin)));
        }
    }
    dirs.extend(SYSTEM_BIN_DIRS.iter().map(PathBuf::from));
    dirs
}

/// The first `name` that `is_executable` accepts in the directories of `path_var` (separated as
/// `PATH` is: `:`, or `;` on Windows). Empty entries are skipped.
pub fn lookup_in_path(path_var: &str, name: &str, is_executable: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    std::env::split_paths(path_var).filter(|dir| !dir.as_os_str().is_empty()).map(|dir| dir.join(name)).find(|file| is_executable(file))
}

/// Find the CLI. `cli_path` is the user's setting; when set it is the only place looked at.
/// `env` is the shell environment ([`crate::shell_env`]). Without an `is_executable` hook nothing is found.
pub fn find(services: &Services, env: &[(String, String)], cli_path: Option<&str>) -> Result<PathBuf, CliMissing> {
    let Some(is_executable) = services.is_executable.as_ref() else { return Err(CliMissing { path: cli_path.map(str::to_string) }) };
    if let Some(set) = cli_path {
        let file = PathBuf::from(set);
        return if is_executable(&file) { Ok(file) } else { Err(CliMissing { path: Some(set.to_string()) }) };
    }
    let path_var = env.iter().find(|(k, _)| k == "PATH").map(|(_, v)| v.as_str()).unwrap_or_default();
    if let Some(found) = lookup_in_path(path_var, CLI_NAME, is_executable.as_ref()) {
        return Ok(found);
    }
    let home = services.home_dir.as_ref().and_then(|h| h());
    let no_listing = |_: &Path| Vec::new();
    let dirs = match services.list_dir.as_ref() {
        Some(list) => candidate_dirs(home.as_deref(), list.as_ref()),
        None => candidate_dirs(home.as_deref(), &no_listing),
    };
    dirs.into_iter().map(|dir| dir.join(CLI_NAME)).find(|file| is_executable(file)).ok_or(CliMissing { path: None })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::Arc;

    use super::*;

    fn fake(executables: &[&str], home: &str, listing: &[(&str, &[&str])]) -> Services {
        let files: HashSet<PathBuf> = executables.iter().map(PathBuf::from).collect();
        let listing: Vec<(PathBuf, Vec<PathBuf>)> = listing.iter().map(|(d, e)| (PathBuf::from(d), e.iter().map(PathBuf::from).collect())).collect();
        let home = PathBuf::from(home);
        Services {
            is_executable: Some(Arc::new(move |p: &Path| files.contains(p))),
            home_dir: Some(Arc::new(move || Some(home.clone()))),
            list_dir: Some(Arc::new(move |d: &Path| listing.iter().find(|(k, _)| k == d).map(|(_, v)| v.clone()).unwrap_or_default())),
            ..Services::default()
        }
    }

    fn path(value: &str) -> Vec<(String, String)> {
        vec![("PATH".into(), value.into())]
    }

    #[test]
    fn a_set_cli_path_that_is_not_executable_is_missing_without_a_search() {
        let services = fake(&["/usr/bin/pi-studio"], "/home/u", &[]);
        let missing = find(&services, &path("/usr/bin"), Some("/opt/nope/pi-studio"));
        assert_eq!(missing, Err(CliMissing { path: Some("/opt/nope/pi-studio".into()) }));
    }

    #[test]
    fn a_set_cli_path_that_is_executable_wins_over_path() {
        let services = fake(&["/usr/bin/pi-studio", "/opt/pi/pi-studio"], "/home/u", &[]);
        assert_eq!(find(&services, &path("/usr/bin"), Some("/opt/pi/pi-studio")), Ok(PathBuf::from("/opt/pi/pi-studio")));
    }

    #[test]
    fn the_path_of_the_shell_environment_is_searched_in_order() {
        let services = fake(&["/b/pi-studio", "/c/pi-studio"], "/home/u", &[]);
        assert_eq!(find(&services, &path("/a::/b:/c"), None), Ok(PathBuf::from("/b/pi-studio")));
    }

    #[test]
    fn a_version_managers_directory_is_found_when_path_lacks_it() {
        let services = fake(
            &["/home/u/.nvm/versions/node/v22.1.0/bin/pi-studio"],
            "/home/u",
            &[("/home/u/.nvm/versions/node", &["/home/u/.nvm/versions/node/v18.0.0", "/home/u/.nvm/versions/node/v22.1.0"])],
        );
        assert_eq!(find(&services, &path("/usr/bin"), None), Ok(PathBuf::from("/home/u/.nvm/versions/node/v22.1.0/bin/pi-studio")));
    }

    #[test]
    fn a_plain_npm_prefix_under_home_and_system_prefixes_are_found() {
        let services = fake(&["/home/u/.npm-global/bin/pi-studio"], "/home/u", &[]);
        assert_eq!(find(&services, &[], None), Ok(PathBuf::from("/home/u/.npm-global/bin/pi-studio")));
        let services = fake(&["/opt/homebrew/bin/pi-studio"], "/home/u", &[]);
        assert_eq!(find(&services, &[], None), Ok(PathBuf::from("/opt/homebrew/bin/pi-studio")));
    }

    #[test]
    fn nothing_found_is_missing_without_a_path() {
        let services = fake(&[], "/home/u", &[]);
        assert_eq!(find(&services, &path("/usr/bin"), None), Err(CliMissing { path: None }));
    }

    #[test]
    fn candidate_dirs_lists_newest_version_first_and_works_without_a_home() {
        let list = |d: &Path| {
            if d == Path::new("/h/.nvm/versions/node") {
                vec![PathBuf::from("/h/.nvm/versions/node/v1"), PathBuf::from("/h/.nvm/versions/node/v2")]
            } else {
                vec![]
            }
        };
        let dirs = candidate_dirs(Some(Path::new("/h")), &list);
        let pos = |p: &str| dirs.iter().position(|d| d == Path::new(p)).expect("present");
        assert!(pos("/h/.nvm/versions/node/v2/bin") < pos("/h/.nvm/versions/node/v1/bin"));
        assert!(pos("/h/.npm-global/bin") < pos("/usr/local/bin"));
        assert_eq!(candidate_dirs(None, &list), SYSTEM_BIN_DIRS.iter().map(PathBuf::from).collect::<Vec<_>>());
    }
}
