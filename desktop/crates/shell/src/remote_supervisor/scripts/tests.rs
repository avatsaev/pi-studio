//! The scripts as text and, on a Unix machine, as the real `/bin/sh` runs them in a scratch folder.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;

fn facts_of(os: &str, cpu: &str, musl: bool) -> Facts {
    let text = format!(
        "pi-studio-fact:os={os}\npi-studio-fact:cpu={cpu}\npi-studio-fact:musl={}\npi-studio-fact:dir=/home/me/.pi-studio\npi-studio-fact:ver=\n",
        u8::from(musl)
    );
    parse_facts(&text).unwrap()
}

#[test]
fn each_supported_system_maps_to_its_target() {
    for (os, cpu, target) in [
        ("Linux", "x86_64", "linux-x64"),
        ("Linux", "aarch64", "linux-arm64"),
        ("Linux", "arm64", "linux-arm64"),
        ("Darwin", "arm64", "darwin-arm64"),
        ("Darwin", "x86_64", "darwin-x64"),
    ] {
        assert_eq!(facts_of(os, cpu, false).target, Ok(target), "{os} {cpu}");
    }
}

#[test]
fn musl_other_systems_and_no_uname_are_unsupported_by_name() {
    let unsupported = |os, cpu, musl| facts_of(os, cpu, musl).target.unwrap_err();
    assert_eq!(unsupported("Linux", "x86_64", true), "Linux x86_64 (musl)");
    assert_eq!(unsupported("Linux", "aarch64", true), "Linux aarch64 (musl)");
    assert_eq!(unsupported("Linux", "armv7l", false), "Linux armv7l");
    assert_eq!(unsupported("Linux", "i686", false), "Linux i686");
    assert_eq!(unsupported("FreeBSD", "amd64", false), "FreeBSD amd64");
    assert_eq!(unsupported("SunOS", "", false), "SunOS");
    assert_eq!(unsupported("Darwin", "i386", false), "Darwin i386");
    assert_eq!(unsupported("MINGW64_NT-10.0-22631", "x86_64", false), "Windows");
    assert_eq!(unsupported("CYGWIN_NT-10.0", "x86_64", false), "Windows");
    assert_eq!(unsupported("", "", false), "unknown");
    // An unsupported system needs no folder; a supported one does.
    assert_eq!(parse_facts("pi-studio-fact:os=SunOS\npi-studio-fact:cpu=sun4v\n").unwrap().folder, "");
    assert_eq!(parse_facts("no facts at all").unwrap().target, Err("unknown".to_owned()));
}

#[test]
fn a_supported_system_without_an_absolute_folder_is_bad_output() {
    for dir in ["", "relative/.pi-studio", "~/.pi-studio"] {
        let text = format!("pi-studio-fact:os=Linux\npi-studio-fact:cpu=x86_64\npi-studio-fact:musl=0\npi-studio-fact:dir={dir}\n");
        assert_eq!(parse_facts(&text), None, "{dir:?}");
    }
}

#[test]
fn the_facts_are_read_between_whatever_the_start_up_files_print() {
    let text = "Welcome back!\n\
        pi-studio-fact:os=Linux\r\n\
        motd line\n\
        pi-studio-fact:cpu=x86_64\n\
        pi-studio-fact:musl=0\n\
        pi-studio-fact:dir=/opt/pi home/.pi-studio\n\
        pi-studio-fact:ver=0.0.131\n";
    let facts = parse_facts(text).unwrap();
    assert_eq!(facts.folder, "/opt/pi home/.pi-studio");
    assert_eq!(facts.version, cli_answers::parse_version("0.0.131"));
    assert_eq!(facts.target, Ok("linux-x64"));
    // No version, an unreadable version: no binary.
    assert_eq!(facts_of("Linux", "x86_64", false).version, None);
    let junk = text.replace("0.0.131", "command not found");
    assert_eq!(parse_facts(&junk).unwrap().version, None);
}

#[test]
fn what_the_host_prints_for_its_system_is_cut_down_to_a_name() {
    let text = "pi-studio-fact:os=Odd\u{1b}[31m;rm -rf /\npi-studio-fact:cpu=x86_64\n";
    let system = parse_facts(text).unwrap().target.unwrap_err();
    assert!(system.starts_with("Odd") && system.ends_with("x86_64"), "{system}");
    assert!(!system.contains(['\u{1b}', ';', '/', '[']), "{system}");
    let long = format!("pi-studio-fact:os={}\n", "A".repeat(500));
    assert!(parse_facts(&long).unwrap().target.unwrap_err().len() < 40);
}

#[test]
fn commands_quote_what_they_hold() {
    assert_eq!(quote("a b"), "'a b'");
    assert_eq!(quote("it's"), "'it'\\''s'");
    assert_eq!(program("/h/.pi-studio"), "/h/.pi-studio/bin/current/pi-studio");
    assert_eq!(daemon_command("/h/it's", 7878, "start"), "'/h/it'\\''s/bin/current/pi-studio' --json -H 127.0.0.1:7878 daemon start");
    assert_eq!(daemon_command("/h", 1, "restart"), "'/h/bin/current/pi-studio' --json -H 127.0.0.1:1 daemon restart");
    assert!(facts_command().starts_with("/bin/sh -c '"));
}

#[cfg(unix)]
mod on_unix {
    use std::fs;
    use std::os::unix::fs::PermissionsExt as _;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::*;

    const VERSION: &str = "0.0.200";

    /// Runs a command line as the host's login shell would, with the home the scratch folder.
    fn run(command: &str, home: &Path) -> (i32, String) {
        let out = Command::new("/bin/sh").arg("-c").arg(command).env("PI_STUDIO_HOME", home).output().unwrap();
        (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// A program that answers `version` to `--version`.
    fn program_text(version: &str) -> String {
        format!("#!/bin/sh\necho {version}\n")
    }

    fn make_program(dir: &Path, text: &str) {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join("pi-studio");
        fs::write(&path, text).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A `.tar.gz` at `<base>.tar.gz` holding `program` at its root, or in a folder `top`.
    fn make_archive(base: &Path, text: &str, top: Option<&str>) -> PathBuf {
        let stage = tempfile::tempdir().unwrap();
        let root = top.map_or_else(|| stage.path().to_path_buf(), |top| stage.path().join(top));
        make_program(&root, text);
        fs::write(root.join("README"), "hello").unwrap();
        let archive = PathBuf::from(format!("{}.tar.gz", base.display()));
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        let status = Command::new("tar").arg("-czf").arg(&archive).arg("-C").arg(stage.path()).arg(".").status().unwrap();
        assert!(status.success());
        archive
    }

    struct Host {
        dir: tempfile::TempDir,
        folder: String,
        base: String,
    }

    impl Host {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let folder = dir.path().join("home with 'quote'/.pi-studio");
            fs::create_dir_all(folder.join("bin")).unwrap();
            let folder = folder.to_str().unwrap().to_owned();
            let base = temp_base(&folder, "ab12cd34");
            Host { dir, folder, base }
        }

        fn home(&self) -> &Path {
            self.dir.path()
        }

        fn bin(&self) -> PathBuf {
            Path::new(&self.folder).join("bin")
        }

        fn current_version(&self) -> Option<String> {
            let out = Command::new(self.bin().join("current/pi-studio")).arg("--version").output().ok()?;
            Some(String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }

        fn names(&self, of: &str) -> Vec<String> {
            let mut names: Vec<String> =
                fs::read_dir(self.bin().join(of)).map(|d| d.map(|e| e.unwrap().file_name().into_string().unwrap()).collect()).unwrap_or_default();
            names.sort();
            names
        }

        fn unpack(&self) -> (i32, String) {
            run(&unpack_command(&self.folder, &self.base, VERSION), self.home())
        }

        fn nothing_left(&self) {
            assert_eq!(self.names("tmp"), Vec::<String>::new(), "bin/tmp");
            assert!(!self.bin().join("current").exists() && !self.bin().join("versions").join(VERSION).exists());
        }
    }

    #[test]
    fn the_facts_script_reads_the_folder_and_the_version_of_the_installed_program() {
        let host = Host::new();
        // The folder is `$PI_STUDIO_HOME` as the shell sees it, with no binary yet.
        let (status, out) = run(&facts_command(), Path::new(&host.folder));
        assert_eq!(status, 0);
        assert!(out.contains(&format!("pi-studio-fact:dir={}\n", host.folder)), "{out}");
        assert!(out.contains("pi-studio-fact:ver=\n"), "{out}");
        for key in ["os=", "cpu=", "musl="] {
            assert!(out.contains(&format!("pi-studio-fact:{key}")), "{key}");
        }
        make_program(&host.bin().join("versions/0.0.9"), &program_text("0.0.9"));
        std::os::unix::fs::symlink("versions/0.0.9", host.bin().join("current")).unwrap();
        let (_, out) = run(&facts_command(), Path::new(&host.folder));
        assert!(out.contains("pi-studio-fact:ver=0.0.9\n"), "{out}");
        // With no `PI_STUDIO_HOME` the folder is under the home.
        let out = Command::new("/bin/sh").arg("-c").arg(facts_command()).env_remove("PI_STUDIO_HOME").env("HOME", "/nonexistent-home").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains("pi-studio-fact:dir=/nonexistent-home/.pi-studio\n"));
        // And with neither, no folder at all.
        let out = Command::new("/bin/sh").arg("-c").arg(facts_command()).env_remove("PI_STUDIO_HOME").env_remove("HOME").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains("pi-studio-fact:dir=\n"));
    }

    #[test]
    fn prepare_makes_the_folder_removes_the_leftovers_and_old_files_but_not_young_ones() {
        let host = Host::new();
        let tmp = host.bin().join("tmp");
        fs::create_dir_all(&tmp).unwrap();
        let left = temp_base(&host.folder, "dead0001");
        fs::write(format!("{left}.tar.gz"), "partial").unwrap();
        fs::create_dir_all(&left).unwrap();
        fs::write(tmp.join("young.tar.gz"), "another app's install").unwrap();
        fs::write(tmp.join("old.tar.gz"), "ancient").unwrap();
        assert!(Command::new("touch").args(["-t", "200001010000"]).arg(tmp.join("old.tar.gz")).status().unwrap().success());
        let (status, out) = run(&prepare_command(&host.folder, std::slice::from_ref(&left)), host.home());
        assert_eq!((status, out.as_str()), (0, ""));
        assert_eq!(host.names("tmp"), ["young.tar.gz"]);
        // A folder that cannot be made fails with the host's words.
        let blocked = host.home().join("blocked");
        fs::write(&blocked, "a file").unwrap();
        let (status, out) = run(&prepare_command(blocked.join("x").to_str().unwrap(), &[]), host.home());
        assert_eq!(status, 1);
        assert!(!out.trim().is_empty(), "the host's error is printed");
    }

    #[test]
    fn unpack_installs_the_program_and_makes_it_current_and_leaves_nothing_else() {
        for top in [None, Some("pi-studio-0.0.200-linux-x64")] {
            let host = Host::new();
            make_archive(Path::new(&host.base), &program_text(VERSION), top);
            let (status, out) = host.unpack();
            assert_eq!((status, out.as_str()), (0, ""), "{top:?}");
            assert_eq!(host.current_version().as_deref(), Some(VERSION));
            assert_eq!(host.names("versions"), [VERSION]);
            assert_eq!(host.names("tmp"), Vec::<String>::new(), "the archive and the folder are removed");
            assert_eq!(fs::read_link(host.bin().join("current")).unwrap(), Path::new("versions/0.0.200"));
        }
    }

    #[test]
    fn unpack_of_a_version_that_is_present_only_switches_the_link() {
        let host = Host::new();
        make_program(&host.bin().join("versions/0.0.200"), &program_text(VERSION));
        make_program(&host.bin().join("versions/0.0.100"), &program_text("0.0.100"));
        std::os::unix::fs::symlink("versions/0.0.100", host.bin().join("current")).unwrap();
        // The archive is never read: it is not even an archive.
        fs::create_dir_all(host.bin().join("tmp")).unwrap();
        fs::write(format!("{}.tar.gz", host.base), "not an archive").unwrap();
        let (status, out) = host.unpack();
        assert_eq!((status, out.as_str()), (0, ""));
        assert_eq!(host.current_version().as_deref(), Some(VERSION));
        assert_eq!(host.names("versions"), ["0.0.100", "0.0.200"], "nothing was unpacked or replaced");
        assert_eq!(host.names("tmp"), Vec::<String>::new());
    }

    #[test]
    fn unpack_replaces_a_version_folder_that_does_not_answer_the_version() {
        let host = Host::new();
        make_program(&host.bin().join("versions/0.0.200"), "#!/bin/sh\nexit 1\n");
        make_archive(Path::new(&host.base), &program_text(VERSION), None);
        assert_eq!(host.unpack().0, 0);
        assert_eq!(host.current_version().as_deref(), Some(VERSION));
    }

    #[test]
    fn unpack_failures_print_the_hosts_words_and_leave_nothing() {
        // Not a gzip file: `tar`'s own error.
        let host = Host::new();
        fs::create_dir_all(host.bin().join("tmp")).unwrap();
        fs::write(format!("{}.tar.gz", host.base), "not an archive").unwrap();
        let (status, out) = host.unpack();
        assert_eq!(status, 1);
        assert!(out.contains("the archive could not be unpacked"), "{out}");
        host.nothing_left();

        // An archive with no program in it.
        let host = Host::new();
        let stage = tempfile::tempdir().unwrap();
        fs::write(stage.path().join("README"), "x").unwrap();
        fs::create_dir_all(host.bin().join("tmp")).unwrap();
        let archive = format!("{}.tar.gz", host.base);
        assert!(Command::new("tar").arg("-czf").arg(&archive).arg("-C").arg(stage.path()).arg(".").status().unwrap().success());
        let (status, out) = host.unpack();
        assert_eq!(status, 1);
        assert!(out.contains("the archive holds no pi-studio"), "{out}");
        host.nothing_left();

        // A program of another version.
        let host = Host::new();
        make_archive(Path::new(&host.base), &program_text("0.0.1"), None);
        let (status, out) = host.unpack();
        assert_eq!(status, 1);
        assert!(out.contains("the unpacked program is version 0.0.1, not 0.0.200"), "{out}");
        host.nothing_left();

        // A program that does not run here (a C library too old, a `noexec` mount): what it says is passed on.
        let host = Host::new();
        make_archive(Path::new(&host.base), "#!/bin/sh\necho 'GLIBC_2.99 not found' >&2\nexit 1\n", None);
        let (status, out) = host.unpack();
        assert_eq!(status, 1);
        assert!(out.contains("GLIBC_2.99 not found") && out.contains("the program does not run on this host"), "{out}");
        host.nothing_left();
    }

    #[test]
    fn a_failed_unpack_keeps_the_previous_current_version() {
        let host = Host::new();
        make_program(&host.bin().join("versions/0.0.100"), &program_text("0.0.100"));
        std::os::unix::fs::symlink("versions/0.0.100", host.bin().join("current")).unwrap();
        make_archive(Path::new(&host.base), &program_text("0.0.1"), None);
        assert_eq!(host.unpack().0, 1);
        assert_eq!(host.current_version().as_deref(), Some("0.0.100"));
        assert_eq!(host.names("versions"), ["0.0.100"]);
        assert_eq!(host.names("tmp"), Vec::<String>::new());
    }

    fn sha256_of(path: &Path) -> String {
        let out = Command::new("sha256sum").arg(path).output().or_else(|_| Command::new("shasum").args(["-a", "256"]).arg(path).output()).unwrap();
        String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap().to_owned()
    }

    #[test]
    fn the_check_passes_the_pinned_file_and_deletes_any_other() {
        let host = Host::new();
        let archive = make_archive(Path::new(&host.base), &program_text(VERSION), None);
        let size = fs::metadata(&archive).unwrap().len();
        let sha = sha256_of(&archive);
        let check = |size: u64, sha: &str| run(&check_command(&host.base, size, sha), host.home());
        assert_eq!(check(size, &sha), (0, String::new()));
        // The pin may spell its hash in capitals.
        assert_eq!(check(size, &sha.to_ascii_uppercase()).0, 0);
        assert!(archive.exists());
        let (status, out) = check(size + 1, &sha);
        assert_eq!(status, CHECK_MISMATCH);
        assert!(out.contains("bytes"), "{out}");
        assert!(!archive.exists(), "a file of the wrong size is deleted");
        let archive = make_archive(Path::new(&host.base), &program_text(VERSION), None);
        let (status, _) = check(size_of(&archive), &"0".repeat(64));
        assert_eq!(status, CHECK_MISMATCH);
        assert!(!archive.exists(), "a file with another checksum is deleted");
        // No file: not a mismatch, another status.
        assert_eq!(check(size, &sha).0, 2);
    }

    fn size_of(path: &Path) -> u64 {
        fs::metadata(path).unwrap().len()
    }

    #[test]
    fn prune_keeps_current_and_the_greatest_other_version_only() {
        let host = Host::new();
        for version in ["0.0.9", "0.0.10", "0.0.131", "0.0.132", "stray"] {
            make_program(&host.bin().join("versions").join(version), &program_text(version));
        }
        std::os::unix::fs::symlink("versions/0.0.132", host.bin().join("current")).unwrap();
        let (status, _) = run(&prune_command(&host.folder), host.home());
        assert_eq!(status, 0);
        assert_eq!(host.names("versions"), ["0.0.131", "0.0.132"]);
        assert_eq!(host.current_version().as_deref(), Some("0.0.132"));
        // Nothing installed, nothing to prune.
        let bare = Host::new();
        assert_eq!(run(&prune_command(&bare.folder), bare.home()).0, 0);
    }

    #[test]
    fn diagnose_reports_the_hosts_room_and_removes_the_file() {
        let host = Host::new();
        fs::create_dir_all(host.bin().join("tmp")).unwrap();
        let (status, out) = run(&diagnose_command(&host.base), host.home());
        assert_eq!(status, 0);
        assert!(out.contains('/'), "a line of `df`: {out}");
        assert_eq!(host.names("tmp"), Vec::<String>::new());
        // A folder that is not there: the host's own error comes first.
        let gone = Host::new();
        let (_, out) = run(&diagnose_command(&gone.base), gone.home());
        assert!(out.to_lowercase().contains("no such file") || out.to_lowercase().contains("nonexistent") || out.contains("cannot"), "{out}");
    }

    #[test]
    fn remove_deletes_the_file_the_folder_and_the_error_file() {
        let host = Host::new();
        fs::create_dir_all(host.bin().join("tmp")).unwrap();
        fs::write(format!("{}.tar.gz", host.base), "x").unwrap();
        fs::write(format!("{}.err", host.base), "x").unwrap();
        fs::create_dir_all(&host.base).unwrap();
        assert_eq!(run(&remove_command(&host.base), host.home()).0, 0);
        assert_eq!(host.names("tmp"), Vec::<String>::new());
    }

    #[test]
    fn a_quoted_path_reaches_the_shell_as_one_word() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["it's here", "a b", "$HOME `id` \"x\" ; echo no", "-dash"] {
            let path = dir.path().join(name);
            let (status, _) = run(&sh(&format!("printf x > {}", quote(path.to_str().unwrap()))), dir.path());
            assert_eq!(status, 0, "{name}");
            assert_eq!(fs::read_to_string(&path).unwrap(), "x");
        }
    }
}
