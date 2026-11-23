//! `log` records to standard error. Pi Studio's own crates log at `info`, everything else (wgpu,
//! winit) at `warn`; `PISTUDIODESKTOP_LOG=debug` or `trace` raises Pi Studio's level.

use log::{Level, LevelFilter, Log, Metadata, Record};

struct StderrLogger {
    own: Level,
}

impl Log for StderrLogger {
    // Not a detail: the WebSocket library logs the whole upgrade request at `trace`, and the request
    // to a daemon carries the password as its subprotocol. Only `warn` and above may come from a
    // library, whatever level Pi Studio's own targets are raised to.
    //
    // The updater plug-in's own `error` lines carry the manifest's address ("error sending request for url
    // (…)"), and with `--update-manifest` that is not the fixed one: the spec lets the log hold no address
    // but the fixed one. The app logs the code itself (`update check failed: offline`), so the plug-in is silent.
    fn enabled(&self, metadata: &Metadata) -> bool {
        let target = metadata.target();
        if target.starts_with("tauri_plugin_updater") {
            return false;
        }
        metadata.level() <= if target.starts_with("pistudiodesktop") { self.own } else { Level::Warn }
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{:<5} {}: {}", record.level(), record.target(), record.args());
        }
    }

    fn flush(&self) {}
}

pub fn init() {
    let own = match std::env::var("PISTUDIODESKTOP_LOG").as_deref() {
        Ok("trace") => Level::Trace,
        Ok("debug") => Level::Debug,
        Ok("warn") => Level::Warn,
        Ok("error") => Level::Error,
        _ => Level::Info,
    };
    // Fails only if a logger is already set; then that one stays.
    if log::set_boxed_logger(Box::new(StderrLogger { own })).is_ok() {
        log::set_max_level(LevelFilter::Trace);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled(own: Level, target: &str, level: Level) -> bool {
        StderrLogger { own }.enabled(&Metadata::builder().target(target).level(level).build())
    }

    #[test]
    fn a_library_is_heard_from_warn_up_only_so_the_upgrade_request_with_the_password_is_never_logged() {
        for level in [Level::Trace, Level::Debug, Level::Info] {
            assert!(!enabled(Level::Trace, "tungstenite::handshake::client", level), "{level}");
        }
        assert!(enabled(Level::Trace, "tungstenite::handshake::client", Level::Warn));
        assert!(enabled(Level::Trace, "pistudiodesktop::transport", Level::Trace));
        assert!(!enabled(Level::Info, "pistudiodesktop::transport", Level::Debug));
    }

    #[test]
    fn the_updater_plugin_is_never_logged_because_its_errors_name_the_manifest_address() {
        for level in [Level::Trace, Level::Debug, Level::Info, Level::Warn, Level::Error] {
            assert!(!enabled(Level::Trace, "tauri_plugin_updater::updater", level), "{level}");
        }
        assert!(enabled(Level::Info, "tauri_utils", Level::Warn));
    }
}
