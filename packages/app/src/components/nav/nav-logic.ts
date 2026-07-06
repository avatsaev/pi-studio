/**
 * Testable pure helpers for the navigation chrome.
 * Consumes sprint-013 sidebar/command-center view models.
 */

// Re-export the sprint-013 sidebar model functions for tests.
export {
  sidebarMode,
  shouldStartEdgeSwipe,
  groupWorkspaces,
  SIDEBAR_FOOTER_ACTIONS,
  type SidebarMode,
  type WorkspaceRow,
  type WorkspaceGroup,
  type SidebarFooterAction,
} from "../../screens/sidebar.js";

// Re-export the sprint-013 command-center model functions for tests.
export {
  commandCenterItems,
  commandCenterReducer,
  activateCommandCenterItem,
  STATIC_COMMAND_ACTIONS,
  type CommandCenterItem,
  type CommandCenterState,
  type CommandCenterAction,
  type CommandCenterAgent,
  type StaticCommandAction,
} from "../../screens/command-center.js";

// Re-export shortcut dispatcher utilities.
export {
  getShortcutPlatform,
  resolveKeyboardFocusScope,
  normalizeCombo,
  dispatchShortcut,
  type ShortcutPlatform,
  type FocusScopeInput,
} from "../../shortcuts/dispatcher.js";

export {
  DEFAULT_BINDINGS,
  type ShortcutBinding,
  type ShortcutActionId,
} from "../../shortcuts/registry.js";

export {
  KeyboardShortcutOverridesStore,
  OVERRIDES_STORAGE_KEY,
} from "../../shortcuts/overrides-store.js";
