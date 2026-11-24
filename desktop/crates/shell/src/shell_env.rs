//! The user's shell environment. An app started from the dock or a launcher does not inherit the
//! terminal's `PATH` or the variables its start-up files export (`PI_STUDIO_HOME` moves the daemon's
//! folder), so the environment is read the way a terminal has it: the user's shell is run as a login,
//! interactive shell that prints its environment between two marker lines, and that is the environment
//! the daemon's binary runs in.
//!
//! The environment may hold tokens: it is never logged; a log line names the shell and the time it
//! took, nothing more.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::services::{RunSpec, Services};

/// The time the shell has to print its environment.
pub const SHELL_ENV_TIMEOUT: Duration = Duration::from_secs(5);

/// Used when `SHELL` is not set.
const FALLBACK_SHELL: &str = "/bin/sh";

/// The shell script: markers on lines of their own, around `env`.
fn script(start: &str, end: &str) -> String {
    format!("printf '%s\\n' '{start}'; env; printf '%s\\n' '{end}'")
}

/// The variables between the two marker lines of `output`, in order. Whatever the shell's start-up
/// files printed before or after is ignored. `None` when either marker line is missing.
///
/// A line that does not start `NAME=` continues the previous value (values may hold newlines).
/// A value whose own line looks like `NAME=…` is split wrongly; `env` does not allow telling.
pub fn parse_marked_env(output: &str, start: &str, end: &str) -> Option<Vec<(String, String)>> {
    let mut lines = output.lines();
    lines.by_ref().find(|line| *line == start)?;
    let mut vars: Vec<(String, String)> = Vec::new();
    for line in lines {
        if line == end {
            return Some(vars);
        }
        match split_assignment(line) {
            Some((name, value)) => vars.push((name.to_string(), value.to_string())),
            None => {
                if let Some((_, value)) = vars.last_mut() {
                    value.push('\n');
                    value.push_str(line);
                }
            }
        }
    }
    None
}

fn split_assignment(line: &str) -> Option<(&str, &str)> {
    let (name, value) = line.split_once('=')?;
    let mut chars = name.chars();
    let first = chars.next()?;
    (first.is_ascii_alphabetic() || first == '_').then_some(())?;
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_').then_some((name, value))
}

fn lookup<'a>(env: &'a [(String, String)], name: &str) -> Option<&'a str> {
    env.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

fn markers() -> Option<(String, String)> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Some((format!("__PISTUDIO_ENV_BEGIN_{id}__"), format!("__PISTUDIO_ENV_END_{id}__")))
}

/// The environment of the process itself, from the hook; empty without one.
pub fn process_env(services: &Services) -> Vec<(String, String)> {
    services.env.as_ref().map(|env| env()).unwrap_or_default()
}

/// Ask the user's shell for its environment, within `limit`. Any failure (no run hook, the shell
/// cannot start, it times out, the markers are missing, nothing between them) gives the process's
/// own environment.
pub fn read_with(services: &Services, limit: Duration) -> Vec<(String, String)> {
    let own = process_env(services);
    let (Some(run), Some((start, end))) = (services.run.as_ref(), markers()) else { return own };
    let shell = lookup(&own, "SHELL").filter(|s| !s.is_empty()).unwrap_or(FALLBACK_SHELL).to_string();
    let spec = RunSpec { program: PathBuf::from(&shell), args: vec!["-l".into(), "-i".into(), "-c".into(), script(&start, &end)], env: own.clone(), limit };
    let began = std::time::Instant::now();
    let parsed = run(&spec).ok().and_then(|output| parse_marked_env(&output, &start, &end)).filter(|vars| !vars.is_empty());
    log::info!(
        "shell environment: {shell} {} in {} ms",
        if parsed.is_some() { "answered" } else { "failed, using the process environment" },
        began.elapsed().as_millis()
    );
    parsed.unwrap_or(own)
}

/// The shell environment, read once and again on request.
#[derive(Default)]
pub struct ShellEnv {
    cached: Mutex<Option<Vec<(String, String)>>>,
}

impl ShellEnv {
    /// A cache that already holds `env`: nothing is asked of the shell until [`Self::refresh`].
    pub fn preset(env: Vec<(String, String)>) -> Self {
        Self { cached: Mutex::new(Some(env)) }
    }

    /// The cached environment; read on first use.
    pub fn get(&self, services: &Services) -> Vec<(String, String)> {
        let mut cached = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        cached.get_or_insert_with(|| read_with(services, SHELL_ENV_TIMEOUT)).clone()
    }

    /// Read it again (the user installed the CLI, or changed their start-up files).
    pub fn refresh(&self, services: &Services) -> Vec<(String, String)> {
        let fresh = read_with(services, SHELL_ENV_TIMEOUT);
        *self.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some(fresh.clone());
        fresh
    }
}

/// The folder the daemon keeps its state in, and its binaries under `bin/`: the `PI_STUDIO_HOME` of `env`
/// (the shell environment), else `.pi-studio` in the home directory (`HOME` of `env`, else `home_dir`). The
/// CLI resolves it the same way. `None` when `PI_STUDIO_HOME` is not an absolute path (a relative one would mean
/// the folder of whoever runs the program) and there is no home directory to fall back on.
pub fn pi_studio_home(env: &[(String, String)], home_dir: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(set) = lookup(env, "PI_STUDIO_HOME").map(str::trim).filter(|s| !s.is_empty()) {
        return Some(PathBuf::from(set)).filter(|p| p.is_absolute());
    }
    let home = lookup(env, "HOME").filter(|h| !h.is_empty()).map(PathBuf::from).or(home_dir)?;
    Some(home.join(".pi-studio"))
}

/// Where the installed binaries are: `bin/` of [`pi_studio_home`].
pub fn bin_dir(home: &Path) -> PathBuf {
    home.join("bin")
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: &str = "BEGIN";
    const E: &str = "END";

    #[test]
    fn parses_a_block_wrapped_in_noise() {
        let out = "motd line\nFOO=not this\nBEGIN\nPATH=/a:/b\nEQ=x=y=z\nMULTI=one\ntwo\nthree\nEMPTY=\nEND\nbye\nLATE=1\n";
        let vars = parse_marked_env(out, S, E).expect("parsed");
        assert_eq!(
            vars,
            vec![
                ("PATH".to_string(), "/a:/b".to_string()),
                ("EQ".to_string(), "x=y=z".to_string()),
                ("MULTI".to_string(), "one\ntwo\nthree".to_string()),
                ("EMPTY".to_string(), String::new()),
            ]
        );
    }

    #[test]
    fn missing_marker_gives_nothing() {
        assert_eq!(parse_marked_env("A=1\nEND\n", S, E), None);
        assert_eq!(parse_marked_env("BEGIN\nA=1\n", S, E), None);
        assert_eq!(parse_marked_env("", S, E), None);
    }

    #[test]
    fn noise_before_the_first_assignment_is_ignored() {
        let vars = parse_marked_env("BEGIN\nstray text\nA=1\nEND\n", S, E).expect("parsed");
        assert_eq!(vars, vec![("A".to_string(), "1".to_string())]);
    }

    #[test]
    fn without_a_run_hook_the_process_environment_is_used() {
        let services = Services { env: Some(std::sync::Arc::new(|| vec![("PATH".into(), "/p".into())])), ..Services::default() };
        assert_eq!(read_with(&services, Duration::from_secs(1)), vec![("PATH".to_string(), "/p".to_string())]);
    }

    #[test]
    fn a_failing_hook_falls_back_and_the_result_is_cached() {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        let services = Services {
            env: Some(Arc::new(|| vec![("SHELL".into(), "/bin/zsh".into())])),
            run: Some(Arc::new(move |spec: &RunSpec| {
                counted.fetch_add(1, Ordering::SeqCst);
                assert_eq!(spec.program, PathBuf::from("/bin/zsh"));
                assert_eq!(&spec.args[..3], ["-l", "-i", "-c"]);
                Err(crate::services::RunFailure::TimedOut)
            })),
            ..Services::default()
        };
        let cache = ShellEnv::default();
        assert_eq!(cache.get(&services), vec![("SHELL".to_string(), "/bin/zsh".to_string())]);
        cache.get(&services);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        cache.refresh(&services);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
    }

    #[test]
    fn the_home_is_the_variable_or_dot_pi_studio_in_the_home_directory() {
        let home = || Some(PathBuf::from("/home/me"));
        assert_eq!(pi_studio_home(&env(&[("PI_STUDIO_HOME", "/data/ps")]), home()), Some(PathBuf::from("/data/ps")));
        assert_eq!(pi_studio_home(&env(&[("PI_STUDIO_HOME", " /data/ps \n")]), None), Some(PathBuf::from("/data/ps")));
        assert_eq!(pi_studio_home(&env(&[]), home()), Some(PathBuf::from("/home/me/.pi-studio")));
        assert_eq!(pi_studio_home(&env(&[("PI_STUDIO_HOME", "  ")]), home()), Some(PathBuf::from("/home/me/.pi-studio")));
        assert_eq!(pi_studio_home(&env(&[("HOME", "/shell/home")]), home()), Some(PathBuf::from("/shell/home/.pi-studio")));
        assert_eq!(pi_studio_home(&env(&[]), None), None);
    }

    #[test]
    fn a_relative_home_is_refused_not_resolved_against_the_apps_folder() {
        assert_eq!(pi_studio_home(&env(&[("PI_STUDIO_HOME", "ps")]), Some(PathBuf::from("/home/me"))), None);
        assert_eq!(bin_dir(Path::new("/h")), PathBuf::from("/h/bin"));
    }
}

#[cfg(all(test, unix))]
mod native_tests {
    use std::os::unix::fs::PermissionsExt as _;
    use std::path::Path;
    use std::sync::Arc;
    use std::time::Instant;

    use super::*;

    fn services_with_shell(shell: &Path) -> Services {
        let shell = shell.display().to_string();
        Services {
            run: Some(Arc::new(crate::process::run)),
            env: Some(Arc::new(move || vec![("SHELL".into(), shell.clone()), ("PATH".into(), "/usr/bin:/bin".into())])),
            ..Services::default()
        }
    }

    #[allow(clippy::expect_used)]
    fn fake_shell(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("shell.sh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    #[test]
    fn a_shell_whose_startup_prints_still_yields_its_path() {
        let dir = tempfile::tempdir().expect("dir");
        // Behaves like a shell with a noisy start-up file: prints, sets PATH, then runs `-c`.
        let shell = fake_shell(dir.path(), "echo 'welcome to my shell'\nPATH=/from/startup:$PATH\nexport PATH\nshift 2\neval \"$2\"\necho 'goodbye'");
        let vars = read_with(&services_with_shell(&shell), Duration::from_secs(5));
        assert_eq!(lookup(&vars, "PATH"), Some("/from/startup:/usr/bin:/bin"));
    }

    #[test]
    fn a_shell_that_never_answers_falls_back_after_the_limit() {
        let dir = tempfile::tempdir().expect("dir");
        let shell = fake_shell(dir.path(), "sleep 30");
        let began = Instant::now();
        let vars = read_with(&services_with_shell(&shell), Duration::from_millis(300));
        assert!(began.elapsed() < Duration::from_secs(5));
        assert_eq!(lookup(&vars, "PATH"), Some("/usr/bin:/bin"));
        assert_eq!(lookup(&vars, "SHELL"), Some(shell.display().to_string().as_str()));
    }
}
