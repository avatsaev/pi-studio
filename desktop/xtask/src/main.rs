//! Workspace tooling: `cargo xtask <command>` (the alias is in `.cargo/config.toml`).
//!
//! Plain Rust, so the gate runs the same on every OS and in CI with nothing but cargo and npm.

mod layers;

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

const USAGE: &str = "\
usage: cargo xtask <command>

commands:
  layers   enforce the crate dependency layering (xtask/src/layers.rs)
  web      the frontend: npm ci at the monorepo root when needed, then type check, lint, tests and build (apps/pistudiodesktop)
  wasm     cargo check --target wasm32-unknown-unknown for the layered crates
  test     workspace tests (cargo nextest when installed, else cargo test), then doctests
  ci       the gate: fmt --check, web, clippy -D warnings, layers, tests, panic_hunt, doctests, wasm
";

/// The desktop app's web project (React + TypeScript); its Tauri crate is in `src-tauri` inside.
const WEB_DIR: &str = "apps/pistudiodesktop";

/// The gate builds exactly what is committed.
const GATE_ARGS: &[&str] = &["--workspace", "--locked"];

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("layers") => cmd_layers(),
        Some("web") => cmd_web(),
        Some("wasm") => cmd_wasm(),
        Some("test") => cmd_test(&["--workspace"]).and_then(|()| cmd_doctest(&["--workspace"])),
        Some("ci") => cmd_ci(),
        Some("-h" | "--help" | "help") | None => {
            print!("{USAGE}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command `{other}`\n\n{USAGE}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Workspace root (the parent of the xtask crate).
fn root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.parent().unwrap_or(manifest).to_path_buf()
}

fn cargo() -> Command {
    let mut c = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    c.current_dir(root());
    c
}

/// The npm workspace root: the monorepo root, one level above this Cargo workspace. The frontend is
/// one of its npm workspaces, so the lock file and the install are up there.
fn npm_root() -> PathBuf {
    let root = root();
    root.parent().map(Path::to_path_buf).unwrap_or(root)
}

/// On Windows `npm` is a script, `npm.cmd`.
fn npm(dir: &Path) -> Command {
    let mut c = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" });
    c.current_dir(dir);
    c
}

/// Whether the frontend's dependencies are installed. The probe is a package only the frontend
/// depends on. npm hoists it to the monorepo root unless versions conflict, so look in both places.
fn web_deps_installed(web: &Path) -> bool {
    const PROBE: &str = "node_modules/@tauri-apps/api";
    web.join(PROBE).is_dir() || npm_root().join(PROBE).is_dir()
}

fn run(mut cmd: Command) -> Result<(), String> {
    let program = Path::new(cmd.get_program()).file_stem().unwrap_or(cmd.get_program()).to_string_lossy().into_owned();
    let what = format!("{program} {}", cmd.get_args().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" "));
    eprintln!("$ {what}");
    let status = cmd.status().map_err(|e| format!("{what}: failed to spawn: {e} (is {program} installed and on PATH?)"))?;
    if status.success() { Ok(()) } else { Err(format!("{what}: exited with {status}")) }
}

/// Check, lint, test and build the frontend. The build is not optional: Tauri embeds `dist/` into the
/// desktop binary at compile time, so every cargo step that compiles the app needs it.
fn cmd_web() -> Result<(), String> {
    let web = root().join(WEB_DIR);
    if !web_deps_installed(&web) {
        let mut c = npm(&npm_root());
        c.arg("ci");
        run(c)?;
    }
    for script in ["check", "lint", "test", "build"] {
        let mut c = npm(&web);
        c.args(["run", script]);
        run(c)?;
    }
    Ok(())
}

fn cmd_layers() -> Result<(), String> {
    let out = cargo().args(["metadata", "--format-version", "1", "--no-deps"]).output().map_err(|e| format!("cargo metadata: {e}"))?;
    if !out.status.success() {
        return Err(format!("cargo metadata failed:\n{}", String::from_utf8_lossy(&out.stderr)));
    }
    let meta = serde_json::from_slice(&out.stdout).map_err(|e| format!("cargo metadata: bad JSON: {e}"))?;
    let crates = layers::from_metadata(&meta)?;
    println!("{:<20} {:<14} workspace deps", "crate", "layer");
    for c in &crates {
        let deps: Vec<&str> = c.deps.iter().filter(|d| d.workspace && d.name != c.name).map(|d| layers::short_name(&d.name)).collect();
        println!("{:<20} {:<14} {}", c.name, layers::describe(layers::classify(&c.name)), deps.join(" "));
    }
    let violations = layers::check(&crates);
    let lock = std::fs::read_to_string("Cargo.lock").map_err(|e| format!("Cargo.lock: {e}"))?;
    let forbidden = layers::forbidden_in_lock(&lock);
    if violations.is_empty() && forbidden.is_empty() {
        println!("\nlayering: ok ({} crates, no aws-lc package)", crates.len());
        return Ok(());
    }
    for v in &violations {
        eprintln!("  {v}");
    }
    for name in &forbidden {
        eprintln!("  Cargo.lock holds `{name}`: it needs cmake or NASM on Windows; build the dependency with `ring`");
    }
    Err(format!("{} layering violation(s), {} forbidden package(s)", violations.len(), forbidden.len()))
}

/// Everything below the apps must build for wasm32: it keeps file-system, thread and OS
/// assumptions out of the core, whether or not a browser build ever ships.
fn cmd_wasm() -> Result<(), String> {
    let mut c = cargo();
    c.args(["check", "--target", "wasm32-unknown-unknown"]);
    for (name, class) in layers::TABLE {
        if matches!(class, layers::Class::Layer(_) | layers::Class::Standalone) {
            c.args(["-p", &format!("{}{name}", layers::PREFIX)]);
        }
    }
    run(c)
}

fn nextest_available() -> bool {
    cargo().args(["nextest", "--version"]).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

fn cmd_test(scope: &[&str]) -> Result<(), String> {
    let mut c = cargo();
    if nextest_available() {
        c.args(["nextest", "run", "--profile", "ci"]);
    } else {
        eprintln!("note: cargo-nextest is not installed, running cargo test (cargo install cargo-nextest --locked)");
        c.arg("test");
    }
    // Library, binary and integration tests. Examples are built by clippy; doctests run apart.
    c.args(scope).args(["--lib", "--bins", "--tests"]);
    run(c)
}

/// The ignored full-registry fuzz: every command, adversarial params.
fn cmd_panic_hunt() -> Result<(), String> {
    let mut c = cargo();
    c.args(["test", "--locked", "-p", &format!("{}engine", layers::PREFIX), "--test", "panic_hunt", "--", "--ignored"]);
    run(c)
}

fn cmd_doctest(scope: &[&str]) -> Result<(), String> {
    let mut c = cargo();
    c.arg("test").args(scope).arg("--doc");
    run(c)
}

fn cmd_ci() -> Result<(), String> {
    type Step = (&'static str, fn() -> Result<(), String>);
    let steps: &[Step] = &[
        ("fmt", || {
            let mut c = cargo();
            c.args(["fmt", "--all", "--", "--check"]);
            run(c)
        }),
        ("web", cmd_web),
        ("clippy", || {
            let mut c = cargo();
            c.arg("clippy").args(GATE_ARGS).args(["--all-targets", "--", "-D", "warnings"]);
            run(c)
        }),
        ("layers", cmd_layers),
        ("test", || cmd_test(GATE_ARGS)),
        ("panic_hunt", cmd_panic_hunt),
        ("doctest", || cmd_doctest(GATE_ARGS)),
        ("wasm", cmd_wasm),
    ];
    let mut done = Vec::new();
    for (name, step) in steps {
        eprintln!("\n=== ci: {name} ===");
        if let Err(e) = step() {
            println!("\nCI summary:");
            for d in &done {
                println!("  ok    {d}");
            }
            println!("  FAIL  {name}: {e}");
            for (skipped, _) in steps.iter().skip(done.len() + 1) {
                println!("  skip  {skipped}");
            }
            return Err(format!("ci failed at `{name}`"));
        }
        done.push(*name);
    }
    println!("\nCI summary: all {} steps passed ({})", done.len(), done.join(", "));
    Ok(())
}
