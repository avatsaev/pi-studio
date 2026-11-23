//! `~/.ssh/config`: the target an SSH entry names, and the hosts the file lists.
//!
//! * [`resolve`] looks an entry's host up the way `ssh` does (first value wins, `Include` followed, `Host`
//!   patterns matched) and gives a [`Target`] with its jump hosts; the entry's own fields win over the file.
//! * [`hosts`] lists the file's plain `Host` names as [`HostSuggestion`]s.
//!
//! `HostName`, `User`, `Port`, `IdentityFile`, `IdentitiesOnly`, `IdentityAgent` and `ProxyJump` apply. `ProxyCommand` is
//! refused, `Match` blocks are skipped (their lines never apply to a host) and `%` tokens are left as written.
//! `ssh2-config` has no typed field for `IdentitiesOnly`, `IdentityAgent` and `ProxyCommand`: it keeps their arguments in
//! `HostParams::unsupported_fields`, keyed by the lowercase option name, when the file is parsed with
//! `ParseRule::ALLOW_UNSUPPORTED_FIELDS`. Those are read here.
//!
//! The file is the user's but still input: it is read up to [`MAX_CONFIG_BYTES`], a bad line gives an error and never a
//! panic, and an error says which line and why but never names a host or a path.

use std::fs::File;
use std::io::{self, BufRead, Read};
use std::path::{Path, PathBuf};

use ssh2_config::{HostParams, ParseRule, SshConfig, SshParserError};

/// Most jump hosts in front of the final host, however they are named.
pub const MAX_HOPS: usize = 4;
/// Most hosts [`hosts`] lists.
pub const MAX_SUGGESTIONS: usize = 256;
/// Largest config file read.
pub const MAX_CONFIG_BYTES: u64 = 1 << 20;
/// The SSH port when neither the entry nor the file gives one.
pub const DEFAULT_SSH_PORT: u16 = 22;
/// Longest host name taken from a name, a hop or the file.
const MAX_HOST_CHARS: usize = 255;
/// The key files `ssh` tries when the file names none, in order, under `~/.ssh`.
pub const DEFAULT_IDENTITY_NAMES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];
/// The `IdentityAgent` value that names the environment variable `SSH_AUTH_SOCK`.
const AGENT_ENV_NAME: &str = "SSH_AUTH_SOCK";
/// The `ProxyCommand`, `ProxyJump` and `IdentityAgent` value that switches the option off.
const NONE: &str = "none";
/// A `Host` line no host matches: what a `Match` line becomes, so the lines under it apply to nobody.
const NEVER_MATCHES: &str = "Host !*";
/// What `ssh2-config` keeps of the options it does not type, keyed by lowercase name.
const IDENTITIES_ONLY_KEY: &str = "identitiesonly";
const IDENTITY_AGENT_KEY: &str = "identityagent";
const PROXY_COMMAND_KEY: &str = "proxycommand";
/// Unknown options are skipped, as `ssh` skips those of a newer version only with `IgnoreUnknown`; a real file has many.
const PARSE_RULES: ParseRule = ParseRule::ALLOW_UNKNOWN_FIELDS.union(ParseRule::ALLOW_UNSUPPORTED_FIELDS);

/// Why a host could not be resolved. Every case is the wire code `ssh_config`. `Display` carries no host name, path or
/// command; the fields do, for the one place that shows the user their own file.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    /// The file does not parse; `line` is the 1-based line being read (the `Include` line for a fault in an included file).
    #[error("~/.ssh/config line {line}: {reason}")]
    Malformed { line: usize, reason: &'static str },
    /// The file could not be read at all.
    #[error("~/.ssh/config cannot be read: {0}")]
    Unreadable(&'static str),
    /// The file names a `ProxyCommand` (`command` is its arguments as written) for a host of the chain.
    #[error("~/.ssh/config: ProxyCommand is not supported")]
    ProxyCommand { command: String },
    /// An option has a value that is not valid (`IdentitiesOnly` not yes or no).
    #[error("~/.ssh/config: {option} has an invalid value")]
    InvalidOption { option: &'static str },
    /// A jump host is not `[user@]host[:port]` (or an `ssh://` URI).
    #[error("a jump host is not [user@]host[:port]")]
    InvalidJump,
    /// More than [`MAX_HOPS`] jump hosts, counting those the jump hosts name themselves.
    #[error("more than 4 jump hosts")]
    TooManyHops,
}

/// Where the config is read from. `home` expands `~` and resolves a relative `Include` under `<home>/.ssh`.
#[derive(Clone, Copy, Debug)]
pub struct ConfigSource<'a> {
    pub config: &'a Path,
    pub home: &'a Path,
}

/// The fields of an SSH entry that take part in resolving; each present one wins over the file.
#[derive(Clone, Copy, Debug)]
pub struct Entry<'a> {
    pub host: &'a str,
    pub user: Option<&'a str>,
    pub port: Option<u16>,
    pub identity_file: Option<&'a str>,
    /// `[user@]host[:port]`, comma-separated. Present: the file's `ProxyJump` (and `ProxyCommand`) is not consulted.
    pub jump: Option<&'a str>,
}

/// Where the agent's socket is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Agent {
    /// No `IdentityAgent`: `SSH_AUTH_SOCK` of the login-shell environment, or the platform's agent.
    Default,
    /// `IdentityAgent none`.
    Disabled,
    /// `IdentityAgent <path>`, `~` expanded.
    Socket(PathBuf),
    /// `IdentityAgent SSH_AUTH_SOCK` or `$NAME`: the environment variable of that name, read by the caller.
    Env(String),
}

/// One host to log in to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    /// `HostName`, else the name as given: the name to connect to and to look up in `known_hosts`.
    pub host: String,
    pub port: u16,
    pub user: String,
    /// The key files named by the entry, then the file's `IdentityFile`s, without repeats. The defaults are not here: see
    /// [`default_identity_files`].
    pub identity_files: Vec<PathBuf>,
    pub identities_only: bool,
    pub agent: Agent,
    /// The jump hosts, first to last, at most [`MAX_HOPS`]. A jump host's own `ProxyJump` is already spliced in front of
    /// it, so the `hops` of a hop are empty.
    pub hops: Vec<Target>,
}

/// A name from the file's `Host` lines, with what resolving it would give.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HostSuggestion {
    pub alias: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    /// The first `IdentityFile`.
    pub identity_file: Option<String>,
    /// `ProxyJump`, comma-separated.
    pub jump: Option<String>,
}

/// The key files `ssh` tries when none is named, under `<home>/.ssh`. The caller skips those that do not exist.
pub fn default_identity_files(home: &Path) -> Vec<PathBuf> {
    DEFAULT_IDENTITY_NAMES.iter().map(|name| home.join(".ssh").join(name)).collect()
}

/// Resolves `entry` against the config. `local_user` is the user when neither the entry nor the file gives one.
pub fn resolve(entry: &Entry<'_>, source: &ConfigSource<'_>, local_user: &str) -> Result<Target, ConfigError> {
    let config = load(source)?;
    let own = settings(&config, entry.host, source.home)?;
    let jumps = match entry.jump {
        Some(list) => list.split(',').map(str::to_owned).collect(),
        None => {
            if let Some(command) = own.proxy_command {
                return Err(ConfigError::ProxyCommand { command });
            }
            own.proxy_jump
        }
    };
    let mut hops = Vec::new();
    splice_hops(&config, source.home, local_user, &jumps, 0, &mut hops)?;

    let mut identity_files: Vec<PathBuf> = entry.identity_file.map(|path| expand_tilde(path, source.home)).into_iter().collect();
    for file in own.identity_files {
        if !identity_files.contains(&file) {
            identity_files.push(file);
        }
    }
    Ok(Target {
        host: own.host_name.unwrap_or_else(|| entry.host.to_owned()),
        port: entry.port.or(own.port).unwrap_or(DEFAULT_SSH_PORT),
        user: entry.user.map(str::to_owned).or(own.user).unwrap_or_else(|| local_user.to_owned()),
        identity_files,
        identities_only: own.identities_only,
        agent: own.agent,
        hops,
    })
}

/// The file's plain `Host` names in file order, at most [`MAX_SUGGESTIONS`]: no wildcard, no negation, each once. An absent
/// file lists nothing.
pub fn hosts(source: &ConfigSource<'_>) -> Result<Vec<HostSuggestion>, ConfigError> {
    let config = load(source)?;
    let mut list: Vec<HostSuggestion> = Vec::new();
    let clauses = config.get_hosts().iter().flat_map(|host| host.pattern.iter());
    for clause in clauses {
        if list.len() >= MAX_SUGGESTIONS {
            break;
        }
        let alias = clause.pattern.as_str();
        if clause.negated || !plain_host(alias) || list.iter().any(|seen| seen.alias == alias) {
            continue;
        }
        list.push(suggestion(&config, alias));
    }
    Ok(list)
}

fn suggestion(config: &SshConfig, alias: &str) -> HostSuggestion {
    let params = config.query(alias);
    let jump = jump_list(&params);
    HostSuggestion {
        alias: alias.to_owned(),
        host_name: params.host_name.filter(|name| !name.is_empty()),
        user: params.user.filter(|user| !user.is_empty()),
        port: params.port,
        identity_file: params.identity_file.and_then(|files| files.into_iter().next()).map(|file| file.display().to_string()),
        jump: (!jump.is_empty()).then(|| jump.join(",")),
    }
}

/// A host name that stands for one host: not empty, not too long, no `*` or `?`.
fn plain_host(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= MAX_HOST_CHARS && !name.contains(['*', '?']) && !name.chars().any(char::is_whitespace)
}

/// What the file says about one host name.
struct Settings {
    host_name: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    identity_files: Vec<PathBuf>,
    identities_only: bool,
    agent: Agent,
    proxy_command: Option<String>,
    proxy_jump: Vec<String>,
}

fn settings(config: &SshConfig, name: &str, home: &Path) -> Result<Settings, ConfigError> {
    let params = config.query(name);
    let identities_only = match first_arg(&params, IDENTITIES_ONLY_KEY) {
        None => false,
        Some(value) if value.eq_ignore_ascii_case("yes") || value.eq_ignore_ascii_case("true") => true,
        Some(value) if value.eq_ignore_ascii_case("no") || value.eq_ignore_ascii_case("false") => false,
        Some(_) => return Err(ConfigError::InvalidOption { option: "IdentitiesOnly" }),
    };
    let agent = first_arg(&params, IDENTITY_AGENT_KEY).map_or(Agent::Default, |value| agent_from(value, home));
    let proxy_command = params
        .unsupported_fields
        .get(PROXY_COMMAND_KEY)
        .filter(|args| !(args.len() == 1 && args.first().is_some_and(|arg| arg.eq_ignore_ascii_case(NONE))))
        .map(|args| args.join(" "));
    let proxy_jump = jump_list(&params);
    Ok(Settings {
        host_name: params.host_name.filter(|host| !host.is_empty()),
        port: params.port,
        user: params.user.filter(|user| !user.is_empty()),
        identity_files: params.identity_file.unwrap_or_default(),
        identities_only,
        agent,
        proxy_command,
        proxy_jump,
    })
}

/// The first argument of an option `ssh2-config` does not type.
fn first_arg<'a>(params: &'a HostParams, key: &str) -> Option<&'a str> {
    params.unsupported_fields.get(key)?.first().map(String::as_str)
}

/// `ProxyJump`'s hosts; `none` is no host.
fn jump_list(params: &HostParams) -> Vec<String> {
    match params.proxy_jump.as_deref() {
        Some([only]) if only.eq_ignore_ascii_case(NONE) => Vec::new(),
        Some(list) => list.to_vec(),
        None => Vec::new(),
    }
}

fn agent_from(value: &str, home: &Path) -> Agent {
    if value.eq_ignore_ascii_case(NONE) {
        Agent::Disabled
    } else if value == AGENT_ENV_NAME {
        Agent::Env(AGENT_ENV_NAME.to_owned())
    } else if let Some(name) = value.strip_prefix('$') {
        Agent::Env(name.to_owned())
    } else {
        Agent::Socket(expand_tilde(value, home))
    }
}

/// `~` and `~/rest` against `home`; anything else as written.
fn expand_tilde(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) => match rest.strip_prefix(['/', std::path::MAIN_SEPARATOR]) {
            Some(tail) => home.join(tail),
            None => PathBuf::from(path),
        },
        None => PathBuf::from(path),
    }
}

/// One jump host as written: `[user@]host[:port]`, `[v6]:port`, or `ssh://` and that.
struct Jump<'a> {
    user: Option<&'a str>,
    host: &'a str,
    port: Option<u16>,
}

fn parse_jump(spec: &str) -> Result<Jump<'_>, ConfigError> {
    let spec = spec.strip_prefix("ssh://").unwrap_or(spec).trim_end_matches('/');
    let (user, rest) = match spec.rsplit_once('@') {
        Some((user, rest)) => (Some(user), rest),
        None => (None, spec),
    };
    let (host, port) = split_host_port(rest).ok_or(ConfigError::InvalidJump)?;
    let port = match port {
        None => None,
        Some(digits) => match digits.parse::<u16>() {
            Ok(port) if port != 0 && digits.bytes().all(|byte| byte.is_ascii_digit()) => Some(port),
            _ => return Err(ConfigError::InvalidJump),
        },
    };
    let user_ok = user.is_none_or(|user| !user.is_empty() && !user.chars().any(char::is_whitespace));
    if user_ok && plain_host(host) { Ok(Jump { user, host, port }) } else { Err(ConfigError::InvalidJump) }
}

/// `host`, `host:port` or `[host]:port`; a bare IPv6 address (several colons) is all host.
fn split_host_port(text: &str) -> Option<(&str, Option<&str>)> {
    if let Some(rest) = text.strip_prefix('[') {
        let (host, tail) = rest.split_once(']')?;
        return if tail.is_empty() { Some((host, None)) } else { Some((host, Some(tail.strip_prefix(':')?))) };
    }
    if text.matches(':').count() > 1 {
        return Some((text, None));
    }
    Some(match text.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (text, None),
    })
}

/// Appends the hosts of `specs` to `out` in order, each preceded by the jump hosts its own `ProxyJump` names. A hop's
/// `ProxyCommand` is refused like the final host's. Every pass of the loop either fails or adds a host, so the work is
/// bounded by [`MAX_HOPS`] however the file loops.
fn splice_hops(config: &SshConfig, home: &Path, local_user: &str, specs: &[String], depth: usize, out: &mut Vec<Target>) -> Result<(), ConfigError> {
    if depth >= MAX_HOPS {
        return Err(ConfigError::TooManyHops);
    }
    for spec in specs {
        if out.len() >= MAX_HOPS {
            return Err(ConfigError::TooManyHops);
        }
        let jump = parse_jump(spec)?;
        let own = settings(config, jump.host, home)?;
        if let Some(command) = own.proxy_command {
            return Err(ConfigError::ProxyCommand { command });
        }
        splice_hops(config, home, local_user, &own.proxy_jump, depth + 1, out)?;
        if out.len() >= MAX_HOPS {
            return Err(ConfigError::TooManyHops);
        }
        out.push(Target {
            host: own.host_name.unwrap_or_else(|| jump.host.to_owned()),
            port: jump.port.or(own.port).unwrap_or(DEFAULT_SSH_PORT),
            user: jump.user.map(str::to_owned).or(own.user).unwrap_or_else(|| local_user.to_owned()),
            identity_files: own.identity_files,
            identities_only: own.identities_only,
            agent: own.agent,
            hops: Vec::new(),
        });
    }
    Ok(())
}

/// Reads and parses the file. An absent file is an empty config.
fn load(source: &ConfigSource<'_>) -> Result<SshConfig, ConfigError> {
    let Some(text) = read_text(source.config)? else {
        return Ok(SshConfig::default());
    };
    let text = skip_match_blocks(&text);
    let mut reader = Lines::new(&text);
    SshConfig::default()
        .home_dir(source.home)
        .parse(&mut reader, PARSE_RULES)
        .map_err(|error| ConfigError::Malformed { line: reader.line(), reason: reason(&error) })
}

/// The file's text, `None` when there is no file.
fn read_text(path: &Path) -> Result<Option<String>, ConfigError> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ConfigError::Unreadable("not readable")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_CONFIG_BYTES + 1).read_to_end(&mut bytes).map_err(|_| ConfigError::Unreadable("not readable"))?;
    if u64::try_from(bytes.len()).is_ok_and(|len| len > MAX_CONFIG_BYTES) {
        return Err(ConfigError::Unreadable("larger than 1 MiB"));
    }
    String::from_utf8(bytes).map(Some).map_err(|_| ConfigError::Unreadable("not UTF-8"))
}

/// Turns every `Match` line into a `Host` line no host matches, keeping the line count. `ssh2-config` skips `Match` as an
/// unknown option, and the lines below it would then apply to the `Host` block above.
fn skip_match_blocks(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let keyword = line.trim_start().split(|c: char| c.is_whitespace() || c == '=').next().unwrap_or("");
        out.push_str(if keyword.eq_ignore_ascii_case("match") { NEVER_MATCHES } else { line });
        out.push('\n');
    }
    out
}

/// A fixed text for a parse fault: the parser's own messages can hold a path.
fn reason(error: &SshParserError) -> &'static str {
    match error {
        SshParserError::ExpectedBoolean => "expected yes or no",
        SshParserError::ExpectedPort => "expected a port number",
        SshParserError::ExpectedUnsigned => "expected a number",
        SshParserError::ExpectedAlgorithms => "expected algorithms",
        SshParserError::ExpectedPath => "expected a path",
        SshParserError::HomeNotFound(_) => "no home directory",
        SshParserError::IncludeCycle(_) => "include cycle",
        SshParserError::Io(_) => "an included file cannot be read",
        SshParserError::Glob(_) | SshParserError::PatternError(_) => "invalid include",
        SshParserError::InvalidQuotes => "unbalanced quotes",
        SshParserError::InvalidRemoteForward(_) => "invalid RemoteForward",
        SshParserError::MissingArgument => "missing argument",
        SshParserError::UnknownField(..) | SshParserError::UnsupportedField(..) => "unknown option",
    }
}

/// The text as a `BufRead` that knows how many lines the parser has consumed, to name the line of a fault.
struct Lines<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Lines<'a> {
    fn new(text: &'a str) -> Self {
        Self { data: text.as_bytes(), pos: 0 }
    }

    /// The 1-based number of the line last read: the lines consumed so far, counting a last line with no newline.
    fn line(&self) -> usize {
        let read = self.data.get(..self.pos).unwrap_or(self.data);
        read.iter().filter(|&&byte| byte == b'\n').count() + usize::from(!read.is_empty() && !read.ends_with(b"\n"))
    }
}

impl Read for Lines<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let rest = self.data.get(self.pos..).unwrap_or(&[]);
        let n = rest.len().min(buf.len());
        if let (Some(from), Some(to)) = (rest.get(..n), buf.get_mut(..n)) {
            to.copy_from_slice(from);
        }
        self.consume(n);
        Ok(n)
    }
}

impl BufRead for Lines<'_> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        Ok(self.data.get(self.pos..).unwrap_or(&[]))
    }

    fn consume(&mut self, amount: usize) {
        self.pos = self.pos.saturating_add(amount).min(self.data.len());
    }
}

#[cfg(test)]
mod tests;
