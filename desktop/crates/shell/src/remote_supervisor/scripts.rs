//! What the remote supervisor says to an SSH host and how it reads the answers: the shell scripts, the command lines
//! built around the host's folder, and the host's facts. Pure text in, pure text out; nothing here runs anything.
//!
//! The host's login shell may be anything (fish, csh): every script runs under `/bin/sh -c '<script>'`, the script
//! single-quoted ([`quote`] reads alike in POSIX shells and fish), with its own standard error folded into its standard
//! output, because the host's command channel returns only the latter. Paths and versions are quoted into the script
//! as words; none of them is ever part of a log line.

use std::fmt::Write as _;

use crate::cli_answers::{self, Version};

/// What a host's facts script prints before each fact, so that whatever a start-up file prints is passed over.
const FACT: &str = "pi-studio-fact:";

/// The status the check script ends with when the file is not the pinned one (it deleted it).
pub const CHECK_MISMATCH: i32 = 3;

/// The program's file name in a version folder.
const PROGRAM: &str = "pi-studio";

/// `word` as one word for a POSIX shell: in single quotes, each quote inside closed, escaped and opened again.
pub fn quote(word: &str) -> String {
    format!("'{}'", word.replace('\'', "'\\''"))
}

/// `script` as a command line for the host's login shell: run by `/bin/sh`.
fn sh(script: &str) -> String {
    format!("/bin/sh -c {}", quote(script))
}

/// The one script that reads the host: the system, the processor, whether the C library is musl (`ldd --version` prints
/// to standard error and exits non-zero on musl, so its streams are merged and only its text is looked at), the host's
/// folder (`$PI_STUDIO_HOME`, else `$HOME/.pi-studio`) and the version of the program the app installed there, when it is.
const FACTS_SCRIPT: &str = r#"exec 2>/dev/null
os=$(uname -s)
cpu=$(uname -m)
musl=0
if [ "$os" = Linux ]; then
  if ldd --version 2>&1 | grep -qi musl; then musl=1; fi
  if ls /lib/ld-musl-* >/dev/null 2>&1; then musl=1; fi
fi
dir=${PI_STUDIO_HOME:-}
if [ -z "$dir" ] && [ -n "$HOME" ]; then dir=$HOME/.pi-studio; fi
ver=
if [ -n "$dir" ] && [ -f "$dir/bin/current/pi-studio" ]; then ver=$("$dir/bin/current/pi-studio" --version </dev/null | tail -n 1); fi
printf 'pi-studio-fact:os=%s\n' "$os"
printf 'pi-studio-fact:cpu=%s\n' "$cpu"
printf 'pi-studio-fact:musl=%s\n' "$musl"
printf 'pi-studio-fact:dir=%s\n' "$dir"
printf 'pi-studio-fact:ver=%s\n' "$ver"
"#;

pub fn facts_command() -> String {
    sh(FACTS_SCRIPT)
}

/// What the host's facts say.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Facts {
    /// The host's folder, an absolute path; empty when the system is not supported (it was not needed).
    pub folder: String,
    /// The version of `<folder>/bin/current/pi-studio` when it is there and answers one.
    pub version: Option<Version>,
    /// The target the host's binary is published for, or the system as the screen shows it.
    pub target: Result<&'static str, String>,
}

/// Reads the output of [`facts_command`]. `None` when it does not hold what a supported system needs (a folder that is
/// not an absolute path).
pub fn parse_facts(stdout: &str) -> Option<Facts> {
    let mut os = String::new();
    let mut cpu = String::new();
    let mut musl = false;
    let mut folder = String::new();
    let mut version = None;
    for line in stdout.lines() {
        let Some((key, value)) = line.trim_end().strip_prefix(FACT).and_then(|fact| fact.split_once('=')) else { continue };
        match key {
            "os" => os = word(value),
            "cpu" => cpu = word(value),
            "musl" => musl = value == "1",
            "dir" => folder = value.to_owned(),
            "ver" => version = cli_answers::parse_version(value),
            _ => {}
        }
    }
    let target = target_of(&os, &cpu, musl);
    if target.is_ok() && !folder.starts_with('/') {
        return None;
    }
    Some(Facts { folder: if target.is_ok() { folder } else { String::new() }, version, target })
}

/// A word the host printed, kept to what a system's name is made of and cut: it is shown, so it may not be anything.
fn word(raw: &str) -> String {
    let kept: String = raw.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '+' | ' ')).take(32).collect();
    kept.trim().to_owned()
}

/// The target of the system `os` (`uname -s`) on `cpu` (`uname -m`), or the system's name for the screen.
fn target_of(os: &str, cpu: &str, musl: bool) -> Result<&'static str, String> {
    let target = match (os, cpu) {
        ("Linux", "x86_64") => Some("linux-x64"),
        ("Linux", "aarch64" | "arm64") => Some("linux-arm64"),
        ("Darwin", "arm64") => Some("darwin-arm64"),
        ("Darwin", "x86_64") => Some("darwin-x64"),
        _ => None,
    };
    match target {
        Some(target) if !musl => Ok(target),
        _ => Err(system_name(os, cpu, musl)),
    }
}

/// The system as the screen words it: `Linux x86_64 (musl)`, `FreeBSD amd64`, `Windows`; a host with no `uname` is `unknown`.
fn system_name(os: &str, cpu: &str, musl: bool) -> String {
    if os.is_empty() {
        return "unknown".to_owned();
    }
    // A POSIX layer on Windows (Git for Windows, Cygwin, MSYS2) names itself `MINGW64_NT-10.0` and the like.
    if ["MINGW", "MSYS", "CYGWIN", "Windows"].iter().any(|prefix| os.starts_with(prefix)) {
        return "Windows".to_owned();
    }
    let mut name = os.to_owned();
    if !cpu.is_empty() {
        name.push(' ');
        name.push_str(cpu);
    }
    if musl {
        name.push_str(" (musl)");
    }
    name
}

/// The program the app runs on the host, by its absolute path (R6).
pub fn program(folder: &str) -> String {
    format!("{folder}/bin/current/{PROGRAM}")
}

/// `<folder>/bin/tmp/<name>`: where the archive of one install is sent (`.tar.gz` after it) and unpacked.
pub fn temp_base(folder: &str, name: &str) -> String {
    format!("{folder}/bin/tmp/{name}")
}

/// `daemon <verb>` (`start` or `restart`) of the host's program on the entry's daemon port.
pub fn daemon_command(folder: &str, daemon_port: u16, verb: &str) -> String {
    format!("{} --json -H 127.0.0.1:{daemon_port} daemon {verb}", quote(&program(folder)))
}

/// Makes `<folder>/bin/tmp`, and clears it of what an earlier attempt left: the files named (`leftovers`, bases as
/// [`temp_base`] makes them) and whatever there is older than an hour (another app's install under way is younger).
pub fn prepare_command(folder: &str, leftovers: &[String]) -> String {
    let tmp = format!("{folder}/bin/tmp");
    let mut script =
        format!("exec 2>&1\nmkdir -p {tmp} || exit 1\nfind {tmp} -mindepth 1 -maxdepth 1 -mmin +60 -exec rm -rf {{}} + >/dev/null 2>&1\n", tmp = quote(&tmp));
    for base in leftovers {
        let _ = writeln!(script, "{}", remove_line(base));
    }
    script.push_str("exit 0\n");
    sh(&script)
}

/// The `rm` of everything one install made under `base`: the file sent, the unpack folder and its error file.
fn remove_line(base: &str) -> String {
    format!("rm -rf {} {} {}", quote(base), quote(&format!("{base}.tar.gz")), quote(&format!("{base}.err")))
}

/// Removes the file sent for an install, and what an unpack of it made.
pub fn remove_command(base: &str) -> String {
    sh(&remove_line(base))
}

/// What the host says about why a write at `<base>.tar.gz` failed: the error of making the file, and the room left in
/// its folder. The file is removed again.
pub fn diagnose_command(base: &str) -> String {
    let file = quote(&format!("{base}.tar.gz"));
    let folder = quote(base.rsplit_once('/').map_or("/", |(dir, _)| dir));
    sh(&format!("exec 2>&1\n( : >> {file} )\ndf -Pk {folder} | tail -n 1\nrm -f {file}\nexit 0\n"))
}

/// Checks the file the send made: its size, then its SHA-256 when `sha256sum` or `shasum` exists. A file that is not
/// the pinned one is deleted and the status is [`CHECK_MISMATCH`]; any other non-zero status says the file is not there
/// or cannot be read.
pub fn check_command(base: &str, size: u64, sha256: &str) -> String {
    let file = quote(&format!("{base}.tar.gz"));
    let sha256 = sha256.to_ascii_lowercase();
    sh(&format!(
        r#"exec 2>&1
file={file}
[ -f "$file" ] || {{ echo "the file is not on the host"; exit 2; }}
size=$(wc -c < "$file" | tr -d '[:space:]')
if [ "$size" != {size} ]; then rm -f "$file"; echo "the file on the host is $size bytes, not {size}"; exit {mismatch}; fi
if command -v sha256sum >/dev/null 2>&1; then sum=$(sha256sum "$file" | cut -d' ' -f1)
elif command -v shasum >/dev/null 2>&1; then sum=$(shasum -a 256 "$file" | cut -d' ' -f1)
else sum=; fi
sum=$(printf '%s' "$sum" | tr 'A-F' 'a-f')
if [ -n "$sum" ] && [ "$sum" != {sha256} ]; then rm -f "$file"; echo "the file on the host has another checksum"; exit {mismatch}; fi
exit 0
"#,
        sha256 = quote(&sha256),
        mismatch = CHECK_MISMATCH,
    ))
}

/// R5: unpack the archive into `<base>/`, run the program in it, move it to `versions/<version>` and switch `current`;
/// when `versions/<version>` is already there and answers the version, only switch `current`. On any failure what was
/// made is removed and the host's own words are printed (the status is 1); the archive is removed at the end either way.
pub fn unpack_command(folder: &str, base: &str, version: &str) -> String {
    let bin = quote(&format!("{folder}/bin"));
    let (work, archive) = (quote(base), quote(&format!("{base}.tar.gz")));
    sh(&format!(
        r#"exec 2>&1
bin={bin}
work={work}
archive={archive}
version={version}
program={PROGRAM}
clean() {{ rm -rf "$work" "$work.err" "$archive"; }}
fail() {{ printf '%s\n' "$1"; clean; exit 1; }}
if [ -f "$bin/versions/$version/$program" ]; then
  have=$("$bin/versions/$version/$program" --version </dev/null 2>/dev/null | tail -n 1 | tr -d '[:space:]')
  if [ "$have" = "$version" ]; then
    ln -sfn "versions/$version" "$bin/current" || fail "could not switch the current link"
    clean
    exit 0
  fi
fi
mkdir -p "$work" || fail "could not make a folder to unpack in"
tar -xzf "$archive" -C "$work" || fail "the archive could not be unpacked"
root=$work
if [ ! -f "$root/$program" ]; then
  root=
  for dir in "$work"/*/; do
    if [ -z "$root" ] && [ -f "${{dir}}$program" ]; then root=${{dir%/}}; fi
  done
  [ -n "$root" ] || fail "the archive holds no $program"
fi
chmod u+x "$root/$program" 2>/dev/null
if ! got=$("$root/$program" --version </dev/null 2>"$work.err"); then
  tail -n 5 "$work.err"
  fail "the program does not run on this host"
fi
got=$(printf '%s\n' "$got" | tail -n 1 | tr -d '[:space:]')
[ "$got" = "$version" ] || fail "the unpacked program is version $got, not $version"
mkdir -p "$bin/versions" || fail "could not make the versions folder"
rm -rf "$bin/versions/$version"
mv "$root" "$bin/versions/$version" || fail "could not move the program into place"
if ! ln -sfn "versions/$version" "$bin/current"; then rm -rf "$bin/versions/$version"; fail "could not switch the current link"; fi
clean
exit 0
"#,
        version = quote(version),
    ))
}

/// Removes the version folders other than the one `current` points to and the greatest other one (the way back).
/// Best effort: its status and output mean nothing.
pub fn prune_command(folder: &str) -> String {
    let bin = quote(&format!("{folder}/bin"));
    sh(&format!(
        r#"exec 2>&1
bin={bin}
cd "$bin/versions" 2>/dev/null || exit 0
cur=$(readlink "$bin/current" 2>/dev/null)
cur=${{cur##*/}}
[ -n "$cur" ] || exit 0
keep=$(ls -1 | grep -E '^[0-9]+[.][0-9]+[.][0-9]+$' | grep -v -x -F "$cur" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
for dir in *; do
  [ -e "$dir" ] || continue
  [ "$dir" = "$cur" ] && continue
  [ "$dir" = "$keep" ] && continue
  rm -rf -- "$dir"
done
exit 0
"#
    ))
}

#[cfg(test)]
mod tests;
