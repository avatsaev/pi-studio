//! The platform hooks of the shell ([`pistudiodesktop_shell::Services`]) as the desktop app fills
//! them: native dialogs through the dialog plug-in, and the system's default application through
//! the opener plug-in.
//!
//! Plug-ins are used from here, in Rust. The page is granted no plug-in permission
//! (`capabilities/default.json`); it reaches these hooks only through the app's own commands,
//! which check what the page sent before a hook runs (`commands.rs`).
//!
//! The save dialog and the open dialog are two of those hooks: they only pick paths. Creating the
//! file, and everything after, is `pistudiodesktop_shell::saves`; keeping the picked paths is
//! `pistudiodesktop_shell::picked`.
//!
//! A hook may block until the user has answered. The commands call it on a thread of the blocking
//! pool, so neither the thread that owns the session nor the main thread waits for a dialog:
//! stored keys keep being written and the control socket keeps answering while one is open.

use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex, PoisonError};

use pistudiodesktop_shell::{Services, process};
use tauri::plugin::Plugin;
use tauri::{AppHandle, Manager as _, Runtime};
use tauri_plugin_dialog::{Dialog, MessageDialogButtons};
use tauri_plugin_opener::Opener;

/// The label of the window every dialog belongs to.
pub const MAIN_WINDOW: &str = "main";

/// The opener plug-in, used by [`native`] only. Its script, which opens `<a target="_blank">`
/// links, is off: it would have the page call the plug-in's commands, and the page holds no
/// permission for them. A link is opened by the page asking `open_external`, which checks it first.
pub fn opener_plugin<R: Runtime>() -> impl Plugin<R> {
    tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build()
}

/// Show the main window, un-minimise it and focus it.
pub fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        for result in [window.show(), window.unminimize(), window.set_focus()] {
            if let Err(e) = result {
                log::warn!("cannot bring the window forward: {e}");
            }
        }
    }
}

/// What the native hooks share.
struct Native<R: Runtime> {
    app: AppHandle<R>,
    /// Titles every dialog: the product name.
    title: String,
    /// Held while a dialog is open. A second request waits for the first to be closed, as the
    /// page's calls did when the browser's own dialogs blocked it, instead of stacking windows.
    one_at_a_time: Mutex<()>,
}

impl<R: Runtime> Native<R> {
    /// Show a dialog with `buttons` on the main window, bringing the window forward first, and say
    /// whether the affirmative button was pressed. Closing the dialog, and a dialog that cannot be
    /// shown, answer `false`.
    fn ask(&self, message: &str, buttons: MessageDialogButtons) -> bool {
        // A panic while a dialog was open protects nothing worth refusing the next one for.
        let _open = self.one_at_a_time.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(dialog) = self.app.try_state::<Dialog<R>>() else {
            log::warn!("no dialog plug-in: the dialog is not shown");
            return false;
        };
        bring_forward(&self.app);
        let mut builder = dialog.message(message).title(&self.title).buttons(buttons);
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
            builder = builder.parent(&window);
        }
        // `show`, not `blocking_show`: that one panics when the app is quitting and the answer
        // never comes, and here the dropped sender is just "no".
        let (answer, received) = channel();
        builder.show(move |pressed| {
            let _ = answer.send(pressed);
        });
        received.recv().unwrap_or(false)
    }

    /// Show the save dialog on the main window, suggesting `name` and starting in `folder`, and
    /// return the path the user chose. `None` when the dialog was cancelled, or could not be shown
    /// or answered with something that is not a file path.
    fn pick_save_path(&self, name: &str, folder: Option<&Path>) -> Option<PathBuf> {
        // One dialog at a time, as for the message dialogs.
        let _open = self.one_at_a_time.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(dialog) = self.app.try_state::<Dialog<R>>() else {
            log::warn!("no dialog plug-in: the save dialog is not shown");
            return None;
        };
        bring_forward(&self.app);
        let mut builder = dialog.file().set_file_name(name);
        if let Some(folder) = folder {
            builder = builder.set_directory(folder);
        }
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
            builder = builder.set_parent(&window);
        }
        // `save_file`, not `blocking_save_file`, for the reason given in `ask`.
        let (answer, received) = channel();
        builder.save_file(move |chosen| {
            let _ = answer.send(chosen);
        });
        match received.recv().ok().flatten()?.into_path() {
            Ok(path) => Some(path),
            Err(e) => {
                log::warn!("the save dialog answered with something that is not a file path: {e}");
                None
            }
        }
    }

    /// Show the open dialog on the main window for one or more files, starting in `folder`, and
    /// return the paths the user chose. Empty when the dialog was cancelled or could not be shown;
    /// an answer that is not a file path is left out.
    fn pick_files(&self, folder: Option<&Path>) -> Vec<PathBuf> {
        // One dialog at a time, as for the message dialogs.
        let _open = self.one_at_a_time.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(dialog) = self.app.try_state::<Dialog<R>>() else {
            log::warn!("no dialog plug-in: the open dialog is not shown");
            return Vec::new();
        };
        bring_forward(&self.app);
        let mut builder = dialog.file();
        if let Some(folder) = folder {
            builder = builder.set_directory(folder);
        }
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
            builder = builder.set_parent(&window);
        }
        // `pick_files`, not `blocking_pick_files`, for the reason given in `ask`.
        let (answer, received) = channel();
        builder.pick_files(move |chosen| {
            let _ = answer.send(chosen);
        });
        received
            .recv()
            .ok()
            .flatten()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|chosen| chosen.into_path().inspect_err(|e| log::warn!("the open dialog answered with something that is not a file path: {e}")).ok())
            .collect()
    }

    fn open(&self, url: &str) -> Result<(), String> {
        let opener = self.app.try_state::<Opener<R>>().ok_or("no opener plug-in")?;
        opener.open_url(url, None::<&str>).map_err(|e| e.to_string())
    }
}

/// The hooks of the running app. `title` is the product name, shown as the title of every dialog.
/// The dialog and opener plug-ins must be registered on `app`: without them a confirmation is
/// declined, a message is dropped and a link is not opened, each with a log line.
pub fn native<R: Runtime>(app: &AppHandle<R>, title: String) -> Services {
    let native = Arc::new(Native { app: app.clone(), title, one_at_a_time: Mutex::new(()) });
    let (for_confirm, for_alert, for_open, for_save, for_pick) = (Arc::clone(&native), Arc::clone(&native), Arc::clone(&native), Arc::clone(&native), native);
    Services {
        confirm: Some(Arc::new(move |message: &str| for_confirm.ask(message, MessageDialogButtons::OkCancel))),
        alert: Some(Arc::new(move |message: &str| {
            for_alert.ask(message, MessageDialogButtons::Ok);
        })),
        open_url: Some(Arc::new(move |url: &str| for_open.open(url))),
        pick_save_path: Some(Arc::new(move |name: &str, folder: Option<&Path>| for_save.pick_save_path(name, folder))),
        pick_files: Some(Arc::new(move |folder: Option<&Path>| for_pick.pick_files(folder))),
        run: Some(Arc::new(process::run)),
        is_executable: Some(Arc::new(process::is_executable)),
        env: Some(Arc::new(process::process_env)),
        home_dir: Some(Arc::new(process::home_dir)),
        list_dir: Some(Arc::new(process::list_dir)),
        // Filled by `main` once the transport state and the SSH sessions exist (`Transport::inspector`,
        // `TransferEngine::inspector`, `SshSessions::remote_run_hook`).
        transports: None,
        transfers: None,
        remote_run: None,
    }
}

#[cfg(test)]
mod tests {
    use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

    use super::*;

    #[test]
    fn without_the_plug_ins_a_confirmation_is_declined_and_a_link_is_not_opened_and_nothing_panics() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let services = native::<MockRuntime>(app.handle(), "Pi Studio".into());
        let (confirm, alert, open_url) = (services.confirm.unwrap(), services.alert.unwrap(), services.open_url.unwrap());
        let (pick_save_path, pick_files) = (services.pick_save_path.unwrap(), services.pick_files.unwrap());
        assert!(!confirm("Delete it?"));
        alert("Saved.");
        assert_eq!(open_url("https://example.com"), Err("no opener plug-in".to_string()));
        assert_eq!(pick_save_path("a.txt", None), None);
        assert_eq!(pick_files(None), Vec::<PathBuf>::new());
    }

    #[test]
    fn bringing_a_window_forward_that_does_not_exist_is_a_no_op() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        bring_forward::<MockRuntime>(app.handle());
    }
}
