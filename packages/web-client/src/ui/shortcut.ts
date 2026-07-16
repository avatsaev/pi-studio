// Keyboard-shortcut chip formatting per OS.
// ui-components.md § Shortcut

export type OsFamily = "macos" | "windows" | "linux";

// Canonical modifier names → per-OS display symbols/strings.
const MAC_SYMBOLS: Record<string, string> = {
  cmd: "⌘",
  command: "⌘",
  ctrl: "⌃",
  control: "⌃",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  meta: "⌘",
};

const WIN_SYMBOLS: Record<string, string> = {
  cmd: "Ctrl",
  command: "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  meta: "Win",
};

const LINUX_SYMBOLS: Record<string, string> = {
  cmd: "Ctrl",
  command: "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  meta: "Super",
};

function modifierMap(os: OsFamily): Record<string, string> {
  switch (os) {
    case "macos":
      return MAC_SYMBOLS;
    case "windows":
      return WIN_SYMBOLS;
    case "linux":
      return LINUX_SYMBOLS;
  }
}

/**
 * Format a single key combo string (e.g. "cmd+shift+k") for display.
 * Keys are split on `+`, modifiers are translated, non-modifiers are
 * uppercased single chars or kept as-is for special keys.
 */
export function formatCombo(combo: string, os: OsFamily): string {
  const symbols = modifierMap(os);
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((part) => {
      const mapped = symbols[part];
      if (mapped !== undefined) return mapped;
      // Special key names stay as-is (capitalized).
      const special = ["enter", "return", "tab", "escape", "esc", "backspace",
                       "delete", "space", "arrowup", "arrowdown", "arrowleft", "arrowright",
                       "home", "end", "pageup", "pagedown", "f1","f2","f3","f4","f5","f6",
                       "f7","f8","f9","f10","f11","f12"];
      if (special.includes(part)) return part.charAt(0).toUpperCase() + part.slice(1);
      // Single character — uppercase.
      if (part.length === 1) return part.toUpperCase();
      return part;
    });

  // On macOS join modifiers without separator; on others use +.
  return os === "macos" ? parts.join("") : parts.join("+");
}

/**
 * Format an array of chords (a sequence of combos) for display.
 * e.g. ["cmd+k", "cmd+s"] → "⌘K ⌘S" on macOS
 */
export function formatChord(chords: string[], os: OsFamily): string {
  return chords.map((c) => formatCombo(c, os)).join(" ");
}
