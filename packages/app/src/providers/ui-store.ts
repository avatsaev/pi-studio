/**
 * UI store: cross-screen UI state (sidebar, command center).
 * Pure reducer — can be wired into zustand or React context.
 */

export interface UIState {
  sidebarOpen: boolean;
  commandCenterOpen: boolean;
}

export type UIAction =
  | { type: "toggle_sidebar" }
  | { type: "set_sidebar"; open: boolean }
  | { type: "toggle_command_center" }
  | { type: "set_command_center"; open: boolean };

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "toggle_sidebar":
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case "set_sidebar":
      return { ...state, sidebarOpen: action.open };
    case "toggle_command_center":
      return { ...state, commandCenterOpen: !state.commandCenterOpen };
    case "set_command_center":
      return { ...state, commandCenterOpen: action.open };
  }
}

export const INITIAL_UI_STATE: UIState = {
  sidebarOpen: true,
  commandCenterOpen: false,
};
