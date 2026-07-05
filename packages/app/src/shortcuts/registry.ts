// Keyboard shortcut binding registry + dispatcher.
// features/keyboard-shortcuts.md § Binding shape, § Dispatch, § Focus-scope resolution

export type ShortcutSectionId =
  | "navigation"
  | "tabs-panes"
  | "projects"
  | "panels"
  | "agent-input";

export type KeyboardFocusScope =
  | "terminal"
  | "command-center"
  | "message-input"
  | "other";

export type ShortcutActionId =
  | "new-agent"
  | "toggle-command-center"
  | "toggle-left-sidebar"
  | "toggle-right-sidebar"
  | "toggle-both-sidebars"
  | "toggle-focus"
  | "theme.cycle"
  | "toggle-settings"
  | "show-shortcuts"
  | "cycle-agent-mode"
  | "dictation-toggle"
  | "dictation-confirm"
  | "focus-message-input"
  | "message-input.action"
  | "agent.interrupt"
  | "voice.toggle"
  | "voice.mute-toggle"
  | "archive-worktree";

export type ShortcutBinding = {
  id: string;
  action: ShortcutActionId;
  /** Key combo on macOS, e.g. "cmd+shift+o" */
  mac: string;
  /** Key combo on Windows/Linux, e.g. "ctrl+shift+o" */
  nonMac: string;
  section: ShortcutSectionId;
  labelKey: string;
  /** If true, the binding is suppressed inside terminal scope. Default true. */
  suppressInTerminal?: boolean;
};

// Default binding table — representative set per the spec table.
export const DEFAULT_BINDINGS: readonly ShortcutBinding[] = [
  { id: "new-agent", action: "new-agent", mac: "cmd+shift+o", nonMac: "ctrl+shift+o", section: "projects", labelKey: "shortcuts.newAgent", suppressInTerminal: true },
  { id: "toggle-command-center", action: "toggle-command-center", mac: "cmd+k", nonMac: "ctrl+k", section: "navigation", labelKey: "shortcuts.toggleCommandCenter", suppressInTerminal: false },
  { id: "toggle-left-sidebar", action: "toggle-left-sidebar", mac: "cmd+b", nonMac: "ctrl+b", section: "navigation", labelKey: "shortcuts.toggleLeftSidebar", suppressInTerminal: true },
  { id: "toggle-right-sidebar", action: "toggle-right-sidebar", mac: "cmd+e", nonMac: "ctrl+e", section: "navigation", labelKey: "shortcuts.toggleRightSidebar", suppressInTerminal: true },
  { id: "toggle-both-sidebars", action: "toggle-both-sidebars", mac: "cmd+.", nonMac: "ctrl+.", section: "navigation", labelKey: "shortcuts.toggleBothSidebars", suppressInTerminal: true },
  { id: "toggle-settings", action: "toggle-settings", mac: "cmd+,", nonMac: "ctrl+,", section: "navigation", labelKey: "shortcuts.toggleSettings", suppressInTerminal: true },
  { id: "theme.cycle", action: "theme.cycle", mac: "cmd+shift+t", nonMac: "ctrl+alt+t", section: "navigation", labelKey: "shortcuts.cycleTheme", suppressInTerminal: true },
  { id: "show-shortcuts", action: "show-shortcuts", mac: "?", nonMac: "?", section: "navigation", labelKey: "shortcuts.showShortcuts", suppressInTerminal: true },
  { id: "focus-message-input", action: "focus-message-input", mac: "cmd+l", nonMac: "ctrl+l", section: "agent-input", labelKey: "shortcuts.focusMessageInput", suppressInTerminal: true },
  { id: "dictation-toggle", action: "dictation-toggle", mac: "cmd+d", nonMac: "ctrl+d", section: "agent-input", labelKey: "shortcuts.dictationToggle", suppressInTerminal: true },
  { id: "dictation-confirm", action: "dictation-confirm", mac: "enter", nonMac: "enter", section: "agent-input", labelKey: "shortcuts.dictationConfirm", suppressInTerminal: false },
  { id: "voice.toggle", action: "voice.toggle", mac: "cmd+shift+d", nonMac: "ctrl+shift+d", section: "agent-input", labelKey: "shortcuts.voiceToggle", suppressInTerminal: true },
  { id: "voice.mute-toggle", action: "voice.mute-toggle", mac: "space", nonMac: "space", section: "agent-input", labelKey: "shortcuts.voiceMuteToggle", suppressInTerminal: false },
  { id: "cycle-agent-mode", action: "cycle-agent-mode", mac: "shift+tab", nonMac: "shift+tab", section: "agent-input", labelKey: "shortcuts.cycleAgentMode", suppressInTerminal: true },
  { id: "agent.interrupt", action: "agent.interrupt", mac: "escape", nonMac: "escape", section: "agent-input", labelKey: "shortcuts.agentInterrupt", suppressInTerminal: false },
];
