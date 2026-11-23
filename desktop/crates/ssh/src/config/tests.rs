use std::fs;
use std::path::PathBuf;

use tempfile::TempDir;

use super::*;

const LOCAL_USER: &str = "local";

/// A temp home with `.ssh/config` holding `text`.
struct Home {
    dir: TempDir,
}

impl Home {
    fn new(text: &str) -> Self {
        let home = Self { dir: tempfile::tempdir().expect("temp dir") };
        home.file(".ssh/config", text);
        home
    }

    fn file(&self, relative: &str, text: &str) {
        let path = self.dir.path().join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create dir");
        fs::write(path, text).expect("write file");
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    fn resolve(&self, entry: &Entry<'_>) -> Result<Target, ConfigError> {
        let config = self.path(".ssh/config");
        resolve(entry, &ConfigSource { config: &config, home: self.dir.path() }, LOCAL_USER)
    }

    fn resolve_host(&self, host: &str) -> Result<Target, ConfigError> {
        self.resolve(&entry(host))
    }

    fn hosts(&self) -> Result<Vec<HostSuggestion>, ConfigError> {
        let config = self.path(".ssh/config");
        hosts(&ConfigSource { config: &config, home: self.dir.path() })
    }
}

fn entry(host: &str) -> Entry<'_> {
    Entry { host, user: None, port: None, identity_file: None, jump: None }
}

fn names(target: &Target) -> Vec<&str> {
    target.hops.iter().map(|hop| hop.host.as_str()).collect()
}

#[test]
fn an_alias_resolves_to_its_host_name_port_user_and_key() {
    let home = Home::new("Host prod\n  HostName prod.example.com\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/id_prod\n");
    let target = home.resolve_host("prod").expect("resolves");
    assert_eq!(
        target,
        Target {
            host: "prod.example.com".to_owned(),
            port: 2222,
            user: "deploy".to_owned(),
            identity_files: vec![home.path(".ssh/id_prod")],
            identities_only: false,
            agent: Agent::Default,
            hops: Vec::new(),
        }
    );
}

#[test]
fn a_name_the_file_does_not_know_resolves_to_itself_with_the_defaults() {
    let home = Home::new("Host other\n  User x\n");
    let target = home.resolve_host("plain.example.com").expect("resolves");
    assert_eq!(target.host, "plain.example.com");
    assert_eq!(target.port, DEFAULT_SSH_PORT);
    assert_eq!(target.user, LOCAL_USER);
    assert!(target.identity_files.is_empty());
    assert_eq!(target.agent, Agent::Default);
}

#[test]
fn an_absent_file_is_an_empty_config() {
    let home = Home::new("");
    let missing = home.path("nowhere/config");
    let source = ConfigSource { config: &missing, home: home.dir.path() };
    let target = resolve(&entry("h"), &source, LOCAL_USER).expect("resolves");
    assert_eq!((target.host.as_str(), target.port, target.user.as_str()), ("h", 22, LOCAL_USER));
    assert_eq!(hosts(&source), Ok(Vec::new()));
}

#[test]
fn the_first_value_wins_and_a_wildcard_block_fills_the_rest() {
    let home = Home::new("Host db\n  User dba\n\nHost *\n  User fallback\n  Port 2200\n  IdentityFile ~/.ssh/shared\n\nHost db\n  IdentityFile ~/.ssh/id_db\n");
    let target = home.resolve_host("db").expect("resolves");
    assert_eq!((target.user.as_str(), target.port), ("dba", 2200));
    // IdentityFile adds up across blocks, in file order.
    assert_eq!(target.identity_files, vec![home.path(".ssh/shared"), home.path(".ssh/id_db")]);
}

#[test]
fn an_include_is_followed_relative_to_dot_ssh() {
    let home = Home::new("Include conf.d/*.conf\n\nHost *\n  User fallback\n");
    home.file(".ssh/conf.d/a.conf", "Host viainclude\n  HostName inc.example.com\n  Port 2201\n");
    let target = home.resolve_host("viainclude").expect("resolves");
    assert_eq!((target.host.as_str(), target.port), ("inc.example.com", 2201));
    // The block below the include still applies to the includer's hosts.
    assert_eq!(target.user, "fallback");
}

#[test]
fn an_include_that_matches_no_file_is_skipped() {
    let home = Home::new("Include missing/*\nHost a\n  Port 2203\n");
    assert_eq!(home.resolve_host("a").expect("resolves").port, 2203);
}

#[test]
fn the_entry_wins_over_the_file() {
    let home = Home::new("Host prod\n  HostName prod.example.com\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/id_prod\n");
    let entry = Entry { host: "prod", user: Some("me"), port: Some(2022), identity_file: Some("~/keys/mine"), jump: None };
    let target = home.resolve(&entry).expect("resolves");
    assert_eq!((target.user.as_str(), target.port), ("me", 2022));
    // HostName has no entry field: the file keeps it.
    assert_eq!(target.host, "prod.example.com");
    // The entry's key is tried first, the file's after it.
    assert_eq!(target.identity_files, vec![home.path("keys/mine"), home.path(".ssh/id_prod")]);
}

#[test]
fn an_entry_key_that_the_file_repeats_is_listed_once() {
    let home = Home::new("Host h\n  IdentityFile ~/.ssh/id_h\n");
    let entry = Entry { identity_file: Some("~/.ssh/id_h"), ..entry("h") };
    assert_eq!(home.resolve(&entry).expect("resolves").identity_files, vec![home.path(".ssh/id_h")]);
}

#[test]
fn identities_only_is_read_from_the_untyped_fields() {
    let home = Home::new("Host strict\n  IdentitiesOnly yes\nHost loose\n  IdentitiesOnly no\nHost shouty\n  identitiesonly TRUE\n");
    assert!(home.resolve_host("strict").expect("resolves").identities_only);
    assert!(!home.resolve_host("loose").expect("resolves").identities_only);
    assert!(home.resolve_host("shouty").expect("resolves").identities_only);
    assert!(!home.resolve_host("unlisted").expect("resolves").identities_only);
}

#[test]
fn identities_only_with_another_value_is_refused() {
    let home = Home::new("Host odd\n  IdentitiesOnly sometimes\n");
    assert_eq!(home.resolve_host("odd"), Err(ConfigError::InvalidOption { option: "IdentitiesOnly" }));
}

#[test]
fn identity_agent_is_a_socket_none_or_a_variable() {
    let home = Home::new(
        "Host sock\n  IdentityAgent ~/.run/agent.sock\nHost abs\n  IdentityAgent /tmp/agent\nHost off\n  IdentityAgent none\n\
         Host env\n  IdentityAgent SSH_AUTH_SOCK\nHost var\n  IdentityAgent $MY_AGENT\nHost quoted\n  IdentityAgent \"/tmp/with space/agent\"\n",
    );
    assert_eq!(home.resolve_host("sock").expect("resolves").agent, Agent::Socket(home.path(".run/agent.sock")));
    assert_eq!(home.resolve_host("abs").expect("resolves").agent, Agent::Socket(PathBuf::from("/tmp/agent")));
    assert_eq!(home.resolve_host("off").expect("resolves").agent, Agent::Disabled);
    assert_eq!(home.resolve_host("env").expect("resolves").agent, Agent::Env("SSH_AUTH_SOCK".to_owned()));
    assert_eq!(home.resolve_host("var").expect("resolves").agent, Agent::Env("MY_AGENT".to_owned()));
    assert_eq!(home.resolve_host("quoted").expect("resolves").agent, Agent::Socket(PathBuf::from("/tmp/with space/agent")));
    assert_eq!(home.resolve_host("none-here").expect("resolves").agent, Agent::Default);
}

#[test]
fn proxy_jump_with_two_hops_resolves_each_hop_like_a_host() {
    let home = Home::new(
        "Host target\n  HostName target.internal\n  ProxyJump ops@bastion1,bastion2:2200\n\n\
         Host bastion1\n  HostName b1.example.com\n  Port 2201\n  IdentityFile ~/.ssh/id_b1\n  IdentitiesOnly yes\n  User ignored\n\n\
         Host bastion2\n  HostName b2.example.com\n  User second\n  Port 2299\n",
    );
    let target = home.resolve_host("target").expect("resolves");
    assert_eq!(target.host, "target.internal");
    assert_eq!(names(&target), ["b1.example.com", "b2.example.com"]);

    let first = &target.hops[0];
    // The `user@` of the jump list beats the block's `User`; the block's port stands (the list names none).
    assert_eq!((first.user.as_str(), first.port), ("ops", 2201));
    assert_eq!(first.identity_files, vec![home.path(".ssh/id_b1")]);
    assert!(first.identities_only);
    assert!(first.hops.is_empty());

    let second = &target.hops[1];
    // The list's port beats the block's.
    assert_eq!((second.user.as_str(), second.port), ("second", 2200));
}

#[test]
fn a_hop_with_no_block_is_its_own_name_and_the_local_user() {
    let home = Home::new("Host target\n  ProxyJump plainhop\n");
    let target = home.resolve_host("target").expect("resolves");
    assert_eq!(names(&target), ["plainhop"]);
    assert_eq!((target.hops[0].user.as_str(), target.hops[0].port), (LOCAL_USER, DEFAULT_SSH_PORT));
}

#[test]
fn a_hop_may_be_an_ssh_uri_or_a_bracketed_address() {
    let home = Home::new("Host a\n  ProxyJump ssh://who@uri.example.com:2300\nHost b\n  ProxyJump [::1]:2400\nHost c\n  ProxyJump fe80::1\n");
    let a = home.resolve_host("a").expect("resolves");
    assert_eq!((a.hops[0].host.as_str(), a.hops[0].user.as_str(), a.hops[0].port), ("uri.example.com", "who", 2300));
    let b = home.resolve_host("b").expect("resolves");
    assert_eq!((b.hops[0].host.as_str(), b.hops[0].port), ("::1", 2400));
    let c = home.resolve_host("c").expect("resolves");
    assert_eq!((c.hops[0].host.as_str(), c.hops[0].port), ("fe80::1", DEFAULT_SSH_PORT));
}

#[test]
fn a_hops_own_proxy_jump_is_spliced_in_front_of_it() {
    let home = Home::new("Host target\n  ProxyJump mid\nHost mid\n  ProxyJump edge\nHost edge\n  Port 2500\n");
    let target = home.resolve_host("target").expect("resolves");
    assert_eq!(names(&target), ["edge", "mid"]);
    assert_eq!(target.hops[0].port, 2500);
    assert!(target.hops.iter().all(|hop| hop.hops.is_empty()));
}

#[test]
fn proxy_jump_none_switches_the_jump_off() {
    let home = Home::new("Host direct gateway\n  ProxyJump none\nHost *\n  ProxyJump gateway\n");
    assert!(home.resolve_host("direct").expect("resolves").hops.is_empty());
    assert_eq!(names(&home.resolve_host("other").expect("resolves")), ["gateway"]);
}

#[test]
fn the_entrys_jump_list_replaces_the_files_proxy_jump() {
    let home = Home::new("Host target\n  ProxyJump fromfile\nHost viaentry\n  Port 2600\n");
    let entry = Entry { jump: Some("me@viaentry,last:2700"), ..entry("target") };
    let target = home.resolve(&entry).expect("resolves");
    assert_eq!(names(&target), ["viaentry", "last"]);
    assert_eq!((target.hops[0].user.as_str(), target.hops[0].port), ("me", 2600));
    assert_eq!((target.hops[1].user.as_str(), target.hops[1].port), (LOCAL_USER, 2700));
}

#[test]
fn four_hops_are_allowed_and_five_are_not() {
    let home =
        Home::new("Host four\n  ProxyJump h1,h2,h3,h4\nHost five\n  ProxyJump h1,h2,h3,h4,h5\nHost chain\n  ProxyJump c1,c2\nHost c2\n  ProxyJump h3,h4,h5\n");
    assert_eq!(home.resolve_host("four").expect("resolves").hops.len(), MAX_HOPS);
    assert_eq!(home.resolve_host("five"), Err(ConfigError::TooManyHops));
    // The hops a hop names count too.
    assert_eq!(home.resolve_host("chain"), Err(ConfigError::TooManyHops));
}

#[test]
fn a_jump_loop_ends_in_an_error() {
    let home = Home::new("Host a\n  ProxyJump b\nHost b\n  ProxyJump a\nHost self\n  ProxyJump self\n");
    assert_eq!(home.resolve_host("a"), Err(ConfigError::TooManyHops));
    assert_eq!(home.resolve_host("self"), Err(ConfigError::TooManyHops));
}

#[test]
fn a_jump_host_that_is_not_a_host_is_refused() {
    let home = Home::new("Host x\n  ProxyJump ok\n");
    for bad in ["", "a,,b", "user@", "@host", "host:0", "host:65536", "host:22x", "host:", "[::1", "a b", "[::1]x"] {
        let entry = Entry { jump: Some(bad), ..entry("x") };
        assert_eq!(home.resolve(&entry), Err(ConfigError::InvalidJump), "jump {bad:?}");
    }
}

#[test]
fn a_proxy_command_for_the_host_is_refused() {
    let home = Home::new("Host viaproxy\n  ProxyCommand ssh -W %h:%p bastion\n");
    let error = home.resolve_host("viaproxy").expect_err("refused");
    assert_eq!(error, ConfigError::ProxyCommand { command: "ssh -W %h:%p bastion".to_owned() });
    // What a log may print names nothing of the file.
    assert_eq!(error.to_string(), "~/.ssh/config: ProxyCommand is not supported");
}

#[test]
fn a_proxy_command_of_another_host_does_not_matter() {
    let home = Home::new("Host viaproxy\n  ProxyCommand nc %h %p\nHost fine\n  Port 2800\n");
    assert_eq!(home.resolve_host("fine").expect("resolves").port, 2800);
}

#[test]
fn a_proxy_command_of_none_is_no_proxy_command() {
    let home = Home::new("Host direct\n  ProxyCommand none\nHost *\n  ProxyCommand nc %h %p\n");
    assert!(home.resolve_host("direct").is_ok());
    assert!(matches!(home.resolve_host("elsewhere"), Err(ConfigError::ProxyCommand { .. })));
}

#[test]
fn a_proxy_command_on_a_jump_host_is_refused() {
    let home = Home::new("Host target\n  ProxyJump hop\nHost hop\n  ProxyCommand nc %h %p\n");
    assert!(matches!(home.resolve_host("target"), Err(ConfigError::ProxyCommand { .. })));
}

#[test]
fn an_entry_jump_list_is_not_held_up_by_the_proxy_command_of_the_entry_host() {
    let home = Home::new("Host target\n  ProxyCommand nc %h %p\n");
    let entry = Entry { jump: Some("hop"), ..entry("target") };
    assert_eq!(names(&home.resolve(&entry).expect("resolves")), ["hop"]);
}

#[test]
fn match_blocks_apply_to_nobody() {
    let home = Home::new(
        "Host a\n  Port 2901\nMatch host a\n  Port 1\n  User matched\n  ProxyCommand nc %h %p\nHost b\n  Port 2902\n  match all\n  User also-matched\nHost c\n  Port 2903\n",
    );
    let a = home.resolve_host("a").expect("resolves");
    assert_eq!((a.port, a.user.as_str()), (2901, LOCAL_USER));
    let b = home.resolve_host("b").expect("resolves");
    assert_eq!((b.port, b.user.as_str()), (2902, LOCAL_USER));
    assert_eq!(home.resolve_host("c").expect("resolves").port, 2903);
    // A `Match` never shows in the host list.
    let aliases: Vec<String> = home.hosts().expect("lists").into_iter().map(|host| host.alias).collect();
    assert_eq!(aliases, ["a", "b", "c"]);
}

#[test]
fn percent_tokens_are_left_as_written() {
    let home = Home::new("Host t\n  HostName %h.example.com\n  IdentityAgent /run/user/%i/agent\n");
    let target = home.resolve_host("t").expect("resolves");
    assert_eq!(target.host, "%h.example.com");
    assert_eq!(target.agent, Agent::Socket(PathBuf::from("/run/user/%i/agent")));
}

#[test]
fn unknown_options_are_skipped() {
    let home = Home::new("Host t\n  SomeFutureOption yes\n  Port 2904\n");
    assert_eq!(home.resolve_host("t").expect("resolves").port, 2904);
}

#[test]
fn a_file_that_does_not_parse_names_the_line() {
    let home = Home::new("Host a\n  Port 22\n  Port not-a-number\nHost b\n");
    assert_eq!(home.resolve_host("a"), Err(ConfigError::Malformed { line: 3, reason: "expected a port number" }));
    assert_eq!(home.hosts(), Err(ConfigError::Malformed { line: 3, reason: "expected a port number" }));
}

#[test]
fn a_fault_on_the_last_line_without_a_newline_names_it() {
    let home = Home::new("Host a\n  User \"unterminated");
    assert_eq!(home.resolve_host("a"), Err(ConfigError::Malformed { line: 2, reason: "unbalanced quotes" }));
}

#[test]
fn a_fault_in_an_included_file_names_the_include_line_and_no_path() {
    let home = Home::new("Host a\n  Port 2905\nInclude bad.conf\n");
    home.file(".ssh/bad.conf", "Host broken\n  Port nope\n");
    let error = home.resolve_host("a").expect_err("refused");
    assert_eq!(error, ConfigError::Malformed { line: 3, reason: "expected a port number" });
    assert!(!error.to_string().contains("bad.conf"));
}

#[test]
fn an_include_loop_is_a_fault() {
    let home = Home::new("Include loop.conf\n");
    home.file(".ssh/loop.conf", "Include config\n");
    assert!(matches!(home.resolve_host("a"), Err(ConfigError::Malformed { .. })));
}

#[test]
fn a_line_with_a_keyword_and_nothing_else_is_a_fault() {
    let home = Home::new("Host a\n  HostName\n");
    assert_eq!(home.resolve_host("a"), Err(ConfigError::Malformed { line: 2, reason: "missing argument" }));
}

#[test]
fn a_file_that_cannot_be_read_is_refused() {
    let home = Home::new("");
    // A directory where the file should be.
    let dir_as_config = home.path(".ssh");
    let source = ConfigSource { config: &dir_as_config, home: home.dir.path() };
    assert_eq!(resolve(&entry("h"), &source, LOCAL_USER), Err(ConfigError::Unreadable("not readable")));

    let binary = home.path(".ssh/binary");
    fs::write(&binary, [0xff, 0xfe, b'\n']).expect("write file");
    let source = ConfigSource { config: &binary, home: home.dir.path() };
    assert_eq!(hosts(&source), Err(ConfigError::Unreadable("not UTF-8")));
}

#[test]
fn a_file_over_the_limit_is_refused_and_one_at_it_is_read() {
    let home = Home::new("");
    let comment = "#".repeat(1023);
    let line = format!("{comment}\n");
    let at_limit = line.repeat(usize::try_from(MAX_CONFIG_BYTES).expect("fits") / line.len());
    assert_eq!(u64::try_from(at_limit.len()).expect("fits"), MAX_CONFIG_BYTES);
    home.file(".ssh/at", &at_limit);
    home.file(".ssh/over", &format!("{at_limit}#"));

    let at = home.path(".ssh/at");
    let source = ConfigSource { config: &at, home: home.dir.path() };
    assert_eq!(hosts(&source), Ok(Vec::new()));
    let over = home.path(".ssh/over");
    let source = ConfigSource { config: &over, home: home.dir.path() };
    assert_eq!(hosts(&source), Err(ConfigError::Unreadable("larger than 1 MiB")));
}

#[test]
fn default_identity_files_are_the_three_standard_names_in_order() {
    let home = Home::new("");
    assert_eq!(default_identity_files(home.dir.path()), vec![home.path(".ssh/id_ed25519"), home.path(".ssh/id_ecdsa"), home.path(".ssh/id_rsa")]);
}

#[test]
fn the_host_list_skips_patterns_and_keeps_file_order() {
    let home = Home::new(
        "Host *\n  User all\nHost web*\n  Port 1\nHost alpha beta\n  HostName shared.example.com\nHost !gone gamma\nHost ?x\nHost *.example.com\nHost alpha\n  Port 3000\nHost delta\n",
    );
    let aliases: Vec<String> = home.hosts().expect("lists").into_iter().map(|host| host.alias).collect();
    // `!gone` is a negation, `alpha` is listed once.
    assert_eq!(aliases, ["alpha", "beta", "gamma", "delta"]);
}

#[test]
fn a_listed_host_carries_what_resolving_it_gives() {
    let home = Home::new(
        "Host prod\n  HostName prod.example.com\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/id_a\n  IdentityFile ~/.ssh/id_b\n  ProxyJump j1,j2\n\nHost bare\n\nHost *\n  User fallback\n",
    );
    let list = home.hosts().expect("lists");
    assert_eq!(
        list,
        vec![
            HostSuggestion {
                alias: "prod".to_owned(),
                host_name: Some("prod.example.com".to_owned()),
                user: Some("deploy".to_owned()),
                port: Some(2222),
                identity_file: Some(home.path(".ssh/id_a").display().to_string()),
                jump: Some("j1,j2".to_owned()),
            },
            HostSuggestion { alias: "bare".to_owned(), user: Some("fallback".to_owned()), ..HostSuggestion::default() },
        ]
    );
}

#[test]
fn the_host_list_follows_includes_in_place() {
    let home = Home::new("Include more.conf\nHost last\n");
    home.file(".ssh/more.conf", "Host middle\n  Port 2906\n");
    let list = home.hosts().expect("lists");
    let aliases: Vec<&str> = list.iter().map(|host| host.alias.as_str()).collect();
    assert_eq!(aliases, ["middle", "last"]);
    assert_eq!(list[0].port, Some(2906));
}

#[test]
fn the_host_list_stops_at_the_limit() {
    let text: String = (0..MAX_SUGGESTIONS + 20).map(|n| format!("Host h{n}\n")).collect();
    let home = Home::new(&text);
    let list = home.hosts().expect("lists");
    assert_eq!(list.len(), MAX_SUGGESTIONS);
    assert_eq!(list.last().map(|host| host.alias.as_str()), Some("h255"));
}

#[test]
fn the_host_list_leaves_out_names_that_are_too_long() {
    let long = "x".repeat(MAX_HOST_CHARS + 1);
    let home = Home::new(&format!("Host {long} ok\n"));
    let aliases: Vec<String> = home.hosts().expect("lists").into_iter().map(|host| host.alias).collect();
    assert_eq!(aliases, ["ok"]);
}

#[test]
fn the_host_list_ignores_an_untyped_option_with_a_bad_value() {
    // Only resolving a host reads IdentitiesOnly; listing never fails on it.
    let home = Home::new("Host odd\n  IdentitiesOnly maybe\n");
    assert_eq!(home.hosts().expect("lists").len(), 1);
}

#[test]
fn the_hop_limit_matches_its_message() {
    assert_eq!(MAX_HOPS, 4);
    assert_eq!(ConfigError::TooManyHops.to_string(), "more than 4 jump hosts");
}
