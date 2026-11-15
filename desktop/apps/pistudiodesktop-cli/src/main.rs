//! The headless CLI: the same engine and the same commands as the window.
//!
//! ```sh
//! pistudiodesktop-cli commands --filter item
//! pistudiodesktop-cli run --new Groceries --cmd 'item.add {"text":"milk"}' --out list.pistudiodesktop
//! pistudiodesktop-cli run list.pistudiodesktop --cmd 'item.setDone {"id":1}' --cmd document.inspect --out list.pistudiodesktop
//! pistudiodesktop-cli info list.pistudiodesktop
//! ```
//!
//! Results are JSON lines on standard output; diagnostics go to standard error. Exit status 1
//! is a failed command, 2 a usage error.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use pistudiodesktop_engine::Session;
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
    /// Print a document as JSON.
    Info { file: PathBuf },
    /// Open or create a document, run commands in order, optionally save.
    Run {
        /// Document to open.
        file: Option<PathBuf>,
        /// Start a new document with this title instead of opening one.
        #[arg(long, value_name = "TITLE", conflicts_with = "file")]
        new: Option<String>,
        /// A command id, optionally followed by its JSON params: --cmd 'item.add {"text":"milk"}'
        #[arg(long = "cmd", value_name = "ID [JSON]")]
        cmds: Vec<String>,
        /// Save the result to this file.
        #[arg(long, value_name = "FILE")]
        out: Option<PathBuf>,
    },
}

fn execute(session: &mut Session, id: &str, params: Value) -> Result<Value, String> {
    session.execute(id, params).map_err(|e| e.to_string())
}

/// `item.add {"text":"milk"}` to (`item.add`, params).
fn parse_step(step: &str) -> Result<(&str, Value), String> {
    let step = step.trim();
    match step.split_once(char::is_whitespace) {
        None => Ok((step, Value::Null)),
        Some((id, params)) => serde_json::from_str(params).map(|params| (id, params)).map_err(|e| format!("--cmd {id}: params are not JSON: {e}")),
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let mut session = Session::new();
    match cli.command {
        Command::Commands { filter } => {
            let listed = execute(&mut session, "command.list", json!({"filter": filter}))?;
            for entry in listed.as_array().into_iter().flatten() {
                println!("{entry}");
            }
        }
        Command::Info { file } => {
            execute(&mut session, "file.open", json!({"path": file}))?;
            println!("{}", execute(&mut session, "document.inspect", Value::Null)?);
        }
        Command::Run { file, new, cmds, out } => {
            // Parse every step before running any: a typo in the last one must not leave the
            // first ones applied and unsaved.
            let steps = cmds.iter().map(|step| parse_step(step)).collect::<Result<Vec<_>, _>>()?;
            if let Some(file) = file {
                execute(&mut session, "file.open", json!({"path": file}))?;
            } else if let Some(title) = new {
                execute(&mut session, "file.new", json!({"title": title}))?;
            }
            for (id, params) in steps {
                let result = execute(&mut session, id, params).map_err(|e| format!("{id}: {e}"))?;
                println!("{}", json!({"command": id, "result": result}));
            }
            if let Some(out) = out {
                execute(&mut session, "file.saveAs", json!({"path": out}))?;
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
