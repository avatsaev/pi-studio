import { describe, expect, it } from "vitest";

import {
  BUTTON_ICON_SIZE,
  BUTTON_MIN_HEIGHT,
  buttonIconColorToken,
  ghostHoverIconToken,
  resolveButtonState,
  type ButtonSize,
  type ButtonVariant,
} from "./button.js";
import { formatChord, formatCombo, type OsFamily } from "./shortcut.js";
import { avatarColor, avatarInitial } from "./avatar.js";
import {
  comboboxReducer,
  filterOptions,
  initialComboboxState,
  withCustomValueOption,
  type ComboboxOption,
} from "./combobox.js";
import { alertIconInfo, attachmentPillRemoveVisible, statusBadgeTokens } from "./status-badge.js";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
describe("BUTTON_MIN_HEIGHT", () => {
  it("xs is 28, lg is 40", () => {
    expect(BUTTON_MIN_HEIGHT.xs).toBe(28);
    expect(BUTTON_MIN_HEIGHT.lg).toBe(40);
  });
  it("sizes increase monotonically", () => {
    const sizes: ButtonSize[] = ["xs", "sm", "md", "lg"];
    for (let i = 1; i < sizes.length; i++) {
      expect(BUTTON_MIN_HEIGHT[sizes[i]!]).toBeGreaterThan(BUTTON_MIN_HEIGHT[sizes[i - 1]!]);
    }
  });
});

describe("BUTTON_ICON_SIZE", () => {
  it("maps to iconSize token values", () => {
    expect(BUTTON_ICON_SIZE.xs).toBe(12);
    expect(BUTTON_ICON_SIZE.sm).toBe(14);
    expect(BUTTON_ICON_SIZE.md).toBe(16);
    expect(BUTTON_ICON_SIZE.lg).toBe(20);
  });
});

describe("resolveButtonState", () => {
  const base = { variant: "default" as ButtonVariant, pressed: false, disabled: false, loading: false };

  it("normal state → opacity 1", () => {
    expect(resolveButtonState(base).opacity).toBe(1);
  });
  it("pressed → opacity 0.85", () => {
    expect(resolveButtonState({ ...base, pressed: true }).opacity).toBe(0.85);
  });
  it("disabled → opacity 0.5", () => {
    expect(resolveButtonState({ ...base, disabled: true }).opacity).toBe(0.5);
  });
  it("loading → opacity 0.5", () => {
    expect(resolveButtonState({ ...base, loading: true }).opacity).toBe(0.5);
  });
  it("disabled overrides pressed", () => {
    expect(resolveButtonState({ ...base, pressed: true, disabled: true }).opacity).toBe(0.5);
  });
});

describe("buttonIconColorToken", () => {
  it("default variant → accentForeground", () => {
    expect(buttonIconColorToken("default")).toBe("accentForeground");
  });
  it("destructive → destructiveForeground", () => {
    expect(buttonIconColorToken("destructive")).toBe("destructiveForeground");
  });
  it("ghost → foregroundMuted", () => {
    expect(buttonIconColorToken("ghost")).toBe("foregroundMuted");
  });
});

describe("ghostHoverIconToken", () => {
  it("hovered → foreground", () => {
    expect(ghostHoverIconToken(true)).toBe("foreground");
  });
  it("not hovered → foregroundMuted", () => {
    expect(ghostHoverIconToken(false)).toBe("foregroundMuted");
  });
});

// ---------------------------------------------------------------------------
// Shortcut formatting
// ---------------------------------------------------------------------------
describe("formatCombo — macOS", () => {
  it("cmd+k → ⌘K", () => {
    expect(formatCombo("cmd+k", "macos")).toBe("⌘K");
  });
  it("cmd+shift+k → ⌘⇧K", () => {
    expect(formatCombo("cmd+shift+k", "macos")).toBe("⌘⇧K");
  });
  it("ctrl+alt+t → ⌃⌥T", () => {
    expect(formatCombo("ctrl+alt+t", "macos")).toBe("⌃⌥T");
  });
  it("Enter key stays as Enter", () => {
    expect(formatCombo("cmd+enter", "macos")).toBe("⌘Enter");
  });
  it("Escape key", () => {
    expect(formatCombo("esc", "macos")).toBe("Esc");
  });
});

describe("formatCombo — windows", () => {
  it("cmd+k → Ctrl+K", () => {
    expect(formatCombo("cmd+k", "windows")).toBe("Ctrl+K");
  });
  it("cmd+shift+k → Ctrl+Shift+K", () => {
    expect(formatCombo("cmd+shift+k", "windows")).toBe("Ctrl+Shift+K");
  });
  it("alt+f4 → Alt+F4", () => {
    expect(formatCombo("alt+f4", "windows")).toBe("Alt+F4");
  });
});

describe("formatCombo — linux", () => {
  it("meta key → Super", () => {
    expect(formatCombo("meta+t", "linux")).toBe("Super+T");
  });
});

describe("formatChord", () => {
  const os: OsFamily = "macos";
  it("formats a chord sequence", () => {
    expect(formatChord(["cmd+k", "cmd+s"], os)).toBe("⌘K ⌘S");
  });
  it("single-combo chord", () => {
    expect(formatChord(["cmd+k"], os)).toBe("⌘K");
  });
  it("empty array → empty string", () => {
    expect(formatChord([], os)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
describe("avatarColor", () => {
  it("returns a valid hex color", () => {
    const color = avatarColor("my-project");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("is deterministic — same key always same color", () => {
    const a = avatarColor("pi-studio");
    const b = avatarColor("pi-studio");
    expect(a).toBe(b);
  });

  it("different keys produce different colors (statistical)", () => {
    const keys = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
    const colors = keys.map(avatarColor);
    // At least 4 distinct colors from 6 distinct keys.
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it("empty string returns a color (does not throw)", () => {
    expect(() => avatarColor("")).not.toThrow();
    expect(avatarColor("")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("avatarInitial", () => {
  it("returns first alphanumeric uppercased", () => {
    expect(avatarInitial("pi-studio")).toBe("P");
    expect(avatarInitial("my project")).toBe("M");
    expect(avatarInitial("123abc")).toBe("1");
  });
  it("returns ? for non-alphanumeric key", () => {
    expect(avatarInitial("---")).toBe("?");
    expect(avatarInitial("")).toBe("?");
  });
});

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------
const OPTIONS: ComboboxOption<string>[] = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "date", label: "Date", disabled: true },
];

describe("filterOptions", () => {
  it("empty query returns all options", () => {
    expect(filterOptions(OPTIONS, "")).toHaveLength(4);
  });
  it("filters case-insensitively by label", () => {
    const result = filterOptions(OPTIONS, "an");
    expect(result.map((o) => o.value)).toEqual(["banana"]);
  });
  it("filters by description", () => {
    const opts: ComboboxOption<string>[] = [
      { value: "x", label: "X", description: "extra info" },
      { value: "y", label: "Y" },
    ];
    expect(filterOptions(opts, "extra")).toHaveLength(1);
  });
  it("no match returns empty array", () => {
    expect(filterOptions(OPTIONS, "zzz")).toHaveLength(0);
  });
});

describe("comboboxReducer", () => {
  it("OPEN sets isOpen and resets highlightedIndex to 0", () => {
    const state = initialComboboxState(OPTIONS);
    const next = comboboxReducer(state, { type: "OPEN" });
    expect(next.isOpen).toBe(true);
    expect(next.highlightedIndex).toBe(0);
  });

  it("CLOSE resets isOpen and query", () => {
    let state = comboboxReducer(initialComboboxState(OPTIONS), { type: "OPEN" });
    state = comboboxReducer(state, { type: "SET_QUERY", query: "an" });
    state = comboboxReducer(state, { type: "CLOSE" });
    expect(state.isOpen).toBe(false);
    expect(state.query).toBe("");
    expect(state.filtered).toHaveLength(OPTIONS.length);
  });

  it("SET_QUERY filters options and resets highlightedIndex", () => {
    const state = comboboxReducer(initialComboboxState(OPTIONS), { type: "SET_QUERY", query: "a" });
    // "Apple" and "Banana" and "Date" match "a"
    const labels = state.filtered.map((o) => o.label);
    expect(labels).toContain("Apple");
    expect(labels).toContain("Banana");
    expect(state.highlightedIndex).toBe(0);
  });

  it("ARROW_DOWN moves highlight forward, wraps around", () => {
    let state = comboboxReducer(initialComboboxState(OPTIONS), { type: "OPEN" });
    // index 0 → 1 (skip none)
    state = comboboxReducer(state, { type: "ARROW_DOWN" });
    expect(state.highlightedIndex).toBe(1);
    // 2 more → index 3 is disabled, should skip to 0
    state = comboboxReducer(state, { type: "ARROW_DOWN" }); // → 2
    state = comboboxReducer(state, { type: "ARROW_DOWN" }); // → 3 is disabled → wrap to 0
    expect(state.highlightedIndex).toBe(0);
  });

  it("ARROW_UP moves highlight backward, wraps around", () => {
    let state = comboboxReducer(initialComboboxState(OPTIONS), { type: "OPEN" });
    // index 0, up → wraps; index 3 is disabled, so → index 2
    state = comboboxReducer(state, { type: "ARROW_UP" });
    expect(state.highlightedIndex).toBe(2);
  });

  it("ARROW_DOWN opens closed combobox", () => {
    const state = comboboxReducer(initialComboboxState(OPTIONS), { type: "ARROW_DOWN" });
    expect(state.isOpen).toBe(true);
  });

  it("SELECT_HIGHLIGHTED closes and resets query", () => {
    let state = comboboxReducer(initialComboboxState(OPTIONS), { type: "OPEN" });
    state = comboboxReducer(state, { type: "SELECT_HIGHLIGHTED" });
    expect(state.isOpen).toBe(false);
    expect(state.query).toBe("");
  });

  it("SELECT_INDEX closes and sets highlightedIndex", () => {
    let state = comboboxReducer(initialComboboxState(OPTIONS), { type: "OPEN" });
    state = comboboxReducer(state, { type: "SELECT_INDEX", index: 2 });
    expect(state.isOpen).toBe(false);
    expect(state.highlightedIndex).toBe(2);
  });

  it("SELECT_INDEX out of range is a no-op", () => {
    const state = comboboxReducer(initialComboboxState(OPTIONS), { type: "SELECT_INDEX", index: 99 });
    expect(state.highlightedIndex).toBe(0);
  });
});

describe("withCustomValueOption", () => {
  const strOpts: ComboboxOption<string>[] = [
    { value: "apple", label: "Apple" },
    { value: "banana", label: "Banana" },
  ];

  it("prepends a synthetic option when query does not match exactly", () => {
    const result = withCustomValueOption(strOpts, "mango");
    expect(result[0]?.kind).toBe("custom");
    expect(result[0]?.value).toBe("mango");
    expect(result).toHaveLength(3);
  });

  it("does not prepend when query matches an existing label exactly", () => {
    const result = withCustomValueOption(strOpts, "Apple");
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBeUndefined();
  });

  it("empty query returns filtered list unchanged", () => {
    expect(withCustomValueOption(strOpts, "")).toHaveLength(2);
  });

  it("respects custom prefix", () => {
    const result = withCustomValueOption(strOpts, "mango", "Add");
    expect(result[0]?.label).toBe('Add "mango"');
  });
});

// ---------------------------------------------------------------------------
// StatusBadge + Alert + AttachmentPill
// ---------------------------------------------------------------------------
describe("statusBadgeTokens", () => {
  it("success variant has success bg token", () => {
    const t = statusBadgeTokens("success");
    expect(t.bg).toBe("success");
    expect(t.border).toBe("statusSuccess");
  });
  it("error variant has destructive tokens", () => {
    const t = statusBadgeTokens("error");
    expect(t.bg).toBe("destructive");
  });
  it("muted variant has surface2 bg", () => {
    const t = statusBadgeTokens("muted");
    expect(t.bg).toBe("surface2");
    expect(t.text).toBe("foregroundMuted");
  });
});

describe("alertIconInfo", () => {
  it("each variant has an icon name and accent token", () => {
    const variants = ["default", "info", "success", "warning", "error"] as const;
    for (const v of variants) {
      const info = alertIconInfo(v);
      expect(typeof info.icon).toBe("string");
      expect(info.icon.length).toBeGreaterThan(0);
      expect(typeof info.accentToken).toBe("string");
    }
  });
  it("success → check-circle", () => {
    expect(alertIconInfo("success").icon).toBe("check-circle");
  });
  it("warning → triangle-alert", () => {
    expect(alertIconInfo("warning").icon).toBe("triangle-alert");
  });
});

describe("attachmentPillRemoveVisible", () => {
  it("visible when native", () => expect(attachmentPillRemoveVisible(true, false, false)).toBe(true));
  it("visible when compact", () => expect(attachmentPillRemoveVisible(false, true, false)).toBe(true));
  it("visible when hovered", () => expect(attachmentPillRemoveVisible(false, false, true)).toBe(true));
  it("hidden when none", () => expect(attachmentPillRemoveVisible(false, false, false)).toBe(false));
});
