//! File transfers in flight, as the page reports them, and the question closing the window asks.

use std::sync::atomic::{AtomicUsize, Ordering};

use pistudiodesktop_shell::Services;
use pistudiodesktop_shell::dialogs;
use pistudiodesktop_shell::page::{CloseDecision, close_decision};
use tauri::{Manager as _, Window, WindowEvent};

/// The page's count of uploads and saves that have not settled. Managed by Tauri.
#[derive(Default)]
pub struct Transfers(AtomicUsize);

impl Transfers {
    pub fn set(&self, count: usize) {
        self.0.store(count, Ordering::SeqCst);
    }

    pub fn get(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

/// With transfers running, a close request is held back and the user is asked; "no" keeps the
/// window open, "yes" closes it. The dialog waits for the user, so it is shown off the event loop.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let Some(transfers) = window.try_state::<Transfers>() else { return };
    let CloseDecision::Ask(text) = close_decision(transfers.get()) else { return };
    api.prevent_close();
    let (window, services) = (window.clone(), window.try_state::<Services>().map(|s| Services::clone(&s)).unwrap_or_default());
    tauri::async_runtime::spawn_blocking(move || {
        if dialogs::confirm(&services, &text)
            && let Err(e) = window.destroy()
        {
            log::warn!("could not close the window: {e}");
        }
    });
}
