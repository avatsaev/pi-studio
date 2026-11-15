//! The desktop's implementations of the shell's service hooks.

use pistudiodesktop_shell::{PickKind, Services};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt as _;

pub fn native(handle: AppHandle) -> Services {
    Services {
        // Called on the thread that owns the shell, never on the main thread: the dialog
        // plug-in's blocking calls wait for the main thread to show the dialog.
        pick_file: Some(Box::new(move |kind| {
            let dialog = handle.dialog().file().add_filter("Pi Studio document", &[pistudiodesktop_format::EXTENSION]);
            let picked = match kind {
                PickKind::Open => dialog.blocking_pick_file(),
                PickKind::Save => dialog.set_file_name(format!("Untitled.{}", pistudiodesktop_format::EXTENSION)).blocking_save_file(),
            };
            picked.and_then(|path| path.into_path().ok())
        })),
    }
}
