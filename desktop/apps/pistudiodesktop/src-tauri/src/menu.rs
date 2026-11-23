//! The native menu bar, drawn from the shell's model ([`pistudiodesktop_shell::menus`]) and rebuilt
//! after every change to the registry view. On macOS the standard application, Edit and Window
//! menus stay: without an Edit menu the copy, paste and select-all shortcuts stop working in the
//! webview.
//!
//! "Check for Updates…" (U10) is drawn where [`menus::in_application_menu`] says: after About in the
//! macOS application menu, in a Help menu elsewhere. It is enabled as the update's state allows
//! ([`Runner::check_enabled`]); the bar is drawn again when that changes.
//!
//! A click runs off the event loop ([`pistudiodesktop_shell::menus::handle_click`] blocks on
//! dialogs and on the owner thread). A switch is the page command's own path
//! ([`crate::daemons::switch_window`]); "Manage Daemons…" shows the window and tells the page;
//! "Check for Updates…" runs `update.check` and answers with a dialog ([`Runner::menu_check`]).

use std::sync::Arc;

use pistudiodesktop_shell::Services;
use pistudiodesktop_shell::menus::{self, Click, Menu as Model};
use serde_json::Value;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime};

use crate::bridge::Bridge;
use crate::daemons::switch_window;
use crate::services::{MAIN_WINDOW, bring_forward};
use crate::update::{Runner, check_menu_entry};

/// The event the page is told to show the Daemons screen with.
pub const MANAGE_EVENT: &str = "daemons_manage";

/// "Check for Updates…", enabled as the update's state allows.
fn check_item<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<MenuItem<R>> {
    let enabled = handle.try_state::<Arc<Runner>>().is_some_and(|runner| runner.check_enabled());
    let label = check_menu_entry().map_or("Check for Updates…", |(_, label)| label);
    MenuItem::with_id(handle, menus::UPDATE_CHECK_ID, label, enabled, None::<&str>)
}

/// The whole bar around the daemons menu.
fn bar<R: Runtime>(handle: &AppHandle<R>, daemons: &Model) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(handle)?;
    let check = check_item(handle)?;
    if cfg!(target_os = "macos") {
        let name = handle.package_info().name.clone();
        let app = Submenu::with_items(
            handle,
            name,
            true,
            &[
                &PredefinedMenuItem::about(handle, None, None)?,
                &check,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::services(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::hide(handle, None)?,
                &PredefinedMenuItem::hide_others(handle, None)?,
                &PredefinedMenuItem::show_all(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::quit(handle, None)?,
            ],
        )?;
        let edit = Submenu::with_items(
            handle,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(handle, None)?,
                &PredefinedMenuItem::redo(handle, None)?,
                &PredefinedMenuItem::separator(handle)?,
                &PredefinedMenuItem::cut(handle, None)?,
                &PredefinedMenuItem::copy(handle, None)?,
                &PredefinedMenuItem::paste(handle, None)?,
                &PredefinedMenuItem::select_all(handle, None)?,
            ],
        )?;
        menu.append(&app)?;
        menu.append(&edit)?;
    }
    menu.append(&submenu(handle, daemons)?)?;
    if !menus::in_application_menu(menus::UPDATE_CHECK_ID) {
        let help = check_menu_entry().map_or("Help", |(menu, _)| menu);
        menu.append(&Submenu::with_items(handle, help, true, &[&check])?)?;
    }
    if cfg!(target_os = "macos") {
        let window = Submenu::with_items(
            handle,
            "Window",
            true,
            &[&PredefinedMenuItem::minimize(handle, None)?, &PredefinedMenuItem::maximize(handle, None)?, &PredefinedMenuItem::close_window(handle, None)?],
        )?;
        menu.append(&window)?;
    }
    Ok(menu)
}

fn submenu<R: Runtime>(handle: &AppHandle<R>, model: &Model) -> tauri::Result<Submenu<R>> {
    let submenu = Submenu::new(handle, &model.label, true)?;
    for item in &model.items {
        if item.separator {
            submenu.append(&PredefinedMenuItem::separator(handle)?)?;
        } else if item.id.starts_with(menus::ENTRY_PREFIX) {
            submenu.append(&CheckMenuItem::with_id(handle, &item.id, &item.label, item.enabled, item.checked, None::<&str>)?)?;
        } else {
            submenu.append(&MenuItem::with_id(handle, &item.id, &item.label, item.enabled, None::<&str>)?)?;
        }
    }
    Ok(submenu)
}

/// Draw the bar for the registry `view` (`daemon.list`'s answer, or the `daemons_changed` event's).
/// Hops to the main thread, which owns the menus.
pub fn rebuild<R: Runtime>(handle: &AppHandle<R>, view: &Value) {
    let model = menus::daemons_menu(view);
    let on_main = handle.clone();
    if let Err(e) = handle.run_on_main_thread(move || match bar(&on_main, &model).and_then(|menu| on_main.set_menu(menu)) {
        Ok(_) => {}
        Err(e) => log::warn!("the native menu could not be drawn: {e}"),
    }) {
        log::warn!("the native menu could not be drawn: {e}");
    }
}

/// Draw the first bar once the owner thread answers, off the calling thread.
pub fn install<R: Runtime>(handle: AppHandle<R>) {
    std::thread::spawn(move || {
        let Some(bridge) = handle.try_state::<Bridge>() else { return };
        match bridge.access().execute("daemon.list", Value::Null) {
            Ok(view) => rebuild(&handle, &view),
            Err(e) => log::warn!("the native menu was not drawn: {e}"),
        }
    });
}

/// A click on an item of the bar. Ids the daemons menu does not own (the standard items) are
/// not ours.
pub fn on_event<R: Runtime>(handle: &AppHandle<R>, event: MenuEvent) {
    let handle = handle.clone();
    if event.id().as_ref() == menus::UPDATE_CHECK_ID {
        std::thread::spawn(move || match handle.try_state::<Arc<Runner>>() {
            Some(runner) => runner.menu_check(),
            None => log::warn!("a menu click came before the app was ready"),
        });
        return;
    }
    let Some(click) = menus::click_of(event.id().as_ref()) else { return };
    std::thread::spawn(move || run(&handle, &click));
}

fn run<R: Runtime>(handle: &AppHandle<R>, click: &Click) {
    let (Some(bridge), Some(services)) = (handle.try_state::<Bridge>(), handle.try_state::<Services>()) else {
        log::warn!("a menu click came before the app was ready");
        return;
    };
    let switch = |id: &str| match handle.get_webview_window(MAIN_WINDOW) {
        Some(window) => switch_window(handle, &window, id),
        None => Err("there is no window".to_owned()),
    };
    let manage = || {
        bring_forward(handle);
        if let Err(e) = handle.emit(MANAGE_EVENT, ()) {
            log::warn!("the page could not be told to show the daemons: {e}");
        }
    };
    menus::handle_click(&services, &bridge.access(), click, switch, manage);
}
