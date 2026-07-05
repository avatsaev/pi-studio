import { describe, expect, it } from "vitest";

import { DEFAULT_BINDINGS } from "./registry.js";
import {
  dispatchShortcut,
  getShortcutPlatform,
  lookupBinding,
  resolveKeyboardFocusScope,
  type FocusTarget,
} from "./dispatcher.js";
import {
  KeyboardShortcutOverridesStore,
  OVERRIDES_STORAGE_KEY,
} from "./overrides-store.js";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
describe("getShortcutPlatform", () => {
  it("detects mac from a macOS UA string", () => {
    expect(getShortcutPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("mac");
  });
  it("detects non-mac from a Windows UA", () => {
    expect(getShortcutPlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe("non-mac");
  });
  it("detects non-mac from a Linux UA", () => {
    expect(getShortcutPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("non-mac");
  });
  it("falls back to non-mac on empty string", () => {
    expect(getShortcutPlatform("")).toBe("non-mac");
  });
});

// ---------------------------------------------------------------------------
// Focus-scope resolution
// ---------------------------------------------------------------------------
describe("resolveKeyboardFocusScope", () => {
  it("returns 'terminal' for xterm-classed element", () => {
    const target: FocusTarget = { className: "xterm-viewport" };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: false })).toBe("terminal");
  });

  it("returns 'terminal' for element with data-testid=terminal-surface", () => {
    const target: FocusTarget = { dataset: { testid: "terminal-surface" } };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: false })).toBe("terminal");
  });

  it("returns 'terminal' when parent has the terminal class", () => {
    const target: FocusTarget = {
      tagName: "input",
      parentElement: { className: "xterm-screen" },
    };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: false })).toBe("terminal");
  });

  it("returns 'command-center' when commandCenterOpen + target inside it", () => {
    const target: FocusTarget = { dataset: { testid: "command-center-input" } };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: true })).toBe("command-center");
  });

  it("returns 'message-input' for an <input> element", () => {
    const target: FocusTarget = { tagName: "input" };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: false })).toBe("message-input");
  });

  it("returns 'message-input' for a <textarea>", () => {
    const target: FocusTarget = { tagName: "textarea" };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: false })).toBe("message-input");
  });

  it("returns 'command-center' for any target when commandCenterOpen and no specific match", () => {
    const target: FocusTarget = { tagName: "div" };
    expect(resolveKeyboardFocusScope({ target, commandCenterOpen: true })).toBe("command-center");
  });

  it("returns 'other' when no target and commandCenterOpen=false", () => {
    expect(resolveKeyboardFocusScope({ target: null, commandCenterOpen: false })).toBe("other");
  });

  it("returns 'command-center' when no target and commandCenterOpen=true", () => {
    expect(resolveKeyboardFocusScope({ target: null, commandCenterOpen: true })).toBe("command-center");
  });
});

// ---------------------------------------------------------------------------
// lookupBinding
// ---------------------------------------------------------------------------
describe("lookupBinding", () => {
  it("matches a mac binding by normalized combo", () => {
    const result = lookupBinding("cmd+shift+o", "other", "mac", DEFAULT_BINDINGS);
    expect(result?.action).toBe("new-agent");
  });

  it("matches a non-mac binding", () => {
    const result = lookupBinding("ctrl+shift+o", "other", "non-mac", DEFAULT_BINDINGS);
    expect(result?.action).toBe("new-agent");
  });

  it("is case-insensitive (normalizes combo)", () => {
    const result = lookupBinding("CMD+SHIFT+O", "other", "mac", DEFAULT_BINDINGS);
    expect(result?.action).toBe("new-agent");
  });

  it("returns null for an unrecognized combo", () => {
    expect(lookupBinding("ctrl+z", "other", "mac", DEFAULT_BINDINGS)).toBe(null);
  });

  it("suppresses bindings inside terminal scope (suppressInTerminal=true)", () => {
    // toggle-left-sidebar has suppressInTerminal: true
    const result = lookupBinding("cmd+b", "terminal", "mac", DEFAULT_BINDINGS);
    expect(result).toBe(null);
  });

  it("allows non-suppressed bindings inside terminal scope", () => {
    // toggle-command-center has suppressInTerminal: false
    const result = lookupBinding("cmd+k", "terminal", "mac", DEFAULT_BINDINGS);
    expect(result?.action).toBe("toggle-command-center");
  });

  it("override replaces the default combo (both platforms)", () => {
    const overrides = { "toggle-settings": "ctrl+alt+s" };
    // Default is cmd+, on mac; override is ctrl+alt+s
    expect(lookupBinding("cmd+,", "other", "mac", DEFAULT_BINDINGS, overrides)).toBe(null);
    const result = lookupBinding("ctrl+alt+s", "other", "mac", DEFAULT_BINDINGS, overrides);
    expect(result?.action).toBe("toggle-settings");
  });
});

// ---------------------------------------------------------------------------
// dispatchShortcut
// ---------------------------------------------------------------------------
describe("dispatchShortcut", () => {
  it("returns matched:true with action when binding found", () => {
    const result = dispatchShortcut("cmd+k", "other", "mac", DEFAULT_BINDINGS);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.action).toBe("toggle-command-center");
      expect(result.bindingId).toBe("toggle-command-center");
    }
  });

  it("returns matched:false when no binding", () => {
    const result = dispatchShortcut("ctrl+z", "other", "mac", DEFAULT_BINDINGS);
    expect(result.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Overrides store
// ---------------------------------------------------------------------------
describe("KeyboardShortcutOverridesStore", () => {
  it("starts empty", () => {
    const store = new KeyboardShortcutOverridesStore();
    expect(Object.keys(store.getAll())).toHaveLength(0);
  });

  it("set + get", () => {
    const store = new KeyboardShortcutOverridesStore();
    store.set("toggle-settings", "ctrl+alt+s");
    expect(store.get("toggle-settings")).toBe("ctrl+alt+s");
  });

  it("remove deletes a key", () => {
    const store = new KeyboardShortcutOverridesStore({ "a": "x" });
    store.remove("a");
    expect(store.get("a")).toBeUndefined();
  });

  it("resetAll clears everything", () => {
    const store = new KeyboardShortcutOverridesStore({ a: "x", b: "y" });
    store.resetAll();
    expect(Object.keys(store.getAll())).toHaveLength(0);
  });

  it("serialize + deserialize round-trip", () => {
    const store = new KeyboardShortcutOverridesStore({ "toggle-settings": "ctrl+alt+s" });
    const json = store.serialize();
    const restored = KeyboardShortcutOverridesStore.deserialize(json);
    expect(restored.get("toggle-settings")).toBe("ctrl+alt+s");
  });

  it("deserialize handles corrupt JSON gracefully", () => {
    const store = KeyboardShortcutOverridesStore.deserialize("{bad json}");
    expect(Object.keys(store.getAll())).toHaveLength(0);
  });

  it("deserialize ignores non-string values", () => {
    const store = KeyboardShortcutOverridesStore.deserialize(
      JSON.stringify({ a: "valid", b: 123, c: null }),
    );
    expect(store.get("a")).toBe("valid");
    expect(store.get("b")).toBeUndefined();
    expect(store.get("c")).toBeUndefined();
  });

  it("uses the documented storage key", () => {
    expect(OVERRIDES_STORAGE_KEY).toBe("@pi-studio:keyboard-shortcut-overrides");
  });
});
