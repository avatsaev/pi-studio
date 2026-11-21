//! The headless CLI: the same engine and the same commands as the window.
//!
//! ```sh
//! pistudiodesktop-cli commands --filter settings
//! pistudiodesktop-cli run --cmd settings.get
//! pistudiodesktop-cli run --config-dir ./cfg --cmd 'settings.set {"key":"autoStartLocalDaemon","value":false}' --cmd settings.get
//! ```
//!
//! Results are JSON lines on standard output; diagnostics go to standard error. Exit status 1
//! is a failed command, 2 a usage error.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Mutex;

use clap::{Parser, Subcommand};
use pistudiodesktop_engine::Session;
use pistudiodesktop_shell::process::native_services;
use pistudiodesktop_shell::supervisor::{Limits, Supervisor};
use serde_json::{Value, json};

#[derive(Parser)]
#[command(name = "pistudiodesktop-cli", version, about = "Pi Studio without a window: every engine command, scriptable")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List the command registry, one JSON object per line.
    Commands {
        /// Only commands whose id or label contains this.
        #[arg(long)]
        filter: Option<String>,
    },
    /// Run commands in order.
    Run {
        /// Act on the settings and stored state in this directory (nothing is created until a
        /// command writes). Without it the session lives in memory and writes no file.
        #[arg(long, value_name = "DIR")]
        config_dir: Option<PathBuf>,
        /// A command id, optionally followed by its JSON params: --cmd 'settings.set {"key":"cliPath","value":"/x"}'.
        /// Arguments show in the process list and the shell history: a password or pairing link passed
        /// here is visible there; that is the caller's choice.
        #[arg(long = "cmd", value_name = "ID [JSON]")]
        cmds: Vec<String>,
    },
}

fn execute(session: &Mutex<Session>, id: &str, params: Value) -> Result<Value, String> {
    session.lock().unwrap_or_else(|e| e.into_inner()).execute(id, params).map_err(|e| e.to_string())
}

/// `settings.set {"key":"cliPath","value":null}` to (`settings.set`, params).
fn parse_step(step: &str) -> Result<(&str, Value), String> {
    let step = step.trim();
    match step.split_once(char::is_whitespace) {
        None => Ok((step, Value::Null)),
        Some((id, params)) => serde_json::from_str(params).map(|params| (id, params)).map_err(|e| format!("--cmd {id}: params are not JSON: {e}")),
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Commands { filter } => {
            let listed = execute(&Mutex::new(Session::new()), "command.list", json!({"filter": filter}))?;
            for entry in listed.as_array().into_iter().flatten() {
                println!("{entry}");
            }
        }
        Command::Run { config_dir, cmds } => {
            // Parse every step before running any: a typo in the last one must not leave the
            // first ones applied.
            let steps = cmds.iter().map(|step| parse_step(step)).collect::<Result<Vec<_>, _>>()?;
            let mut session = match config_dir {
                Some(dir) => {
                    let (session, notices) = Session::with_config_dir(dir);
                    for notice in notices {
                        eprintln!("note: {}", notice.to_json());
                    }
                    session
                }
                None => Session::new(),
            };
            // Local daemon commands are carried out here, with the real CLI, as the app does: the
            // state is probed before the first of them (so `cliPath` set by an earlier step counts),
            // and every request is run to completion before the next step.
            let supervisor = Supervisor::new(native_services(), Limits::default());
            session.set_local_supported(cfg!(unix));
            let session = Mutex::new(session);
            let mut probed = false;
            for (id, params) in steps {
                if id.starts_with("daemon.local.") && !std::mem::replace(&mut probed, true) && Supervisor::probe_now(&session).is_ok() {
                    supervisor.pump(&session);
                }
                let result = execute(&session, id, params).map_err(|e| format!("{id}: {e}"))?;
                supervisor.pump(&session);
                println!("{}", json!({"command": id, "result": result}));
            }
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
