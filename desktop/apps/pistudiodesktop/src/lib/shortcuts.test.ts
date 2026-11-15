import { describe, expect, it } from "vitest";

import { sampleView } from "../test-support";
import { findShortcut, formatShortcut, matches } from "./shortcuts";
import type { Shortcut } from "./types";

const undo: Shortcut = { text: "Cmd+Z", cmd: true, ctrl: false, shift: false, alt: false, key: "z" };
const redo: Shortcut = { ...undo, text: "Cmd+Shift+Z", shift: true };

function key(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("shortcuts", () => {
  it("treats Cmd as Ctrl off macOS and as the command key on it", () => {
    expect(matches(undo, key({ key: "z", ctrlKey: true }), false)).toBe(true);
    expect(matches(undo, key({ key: "z", metaKey: true }), false)).toBe(false);
    expect(matches(undo, key({ key: "z", metaKey: true }), true)).toBe(true);
    expect(matches(undo, key({ key: "z", ctrlKey: true }), true)).toBe(false);
  });

  it("matches modifiers exactly, so redo never runs undo", () => {
    const pressed = key({ key: "Z", ctrlKey: true, shiftKey: true });
    expect(matches(undo, pressed, false)).toBe(false);
    expect(matches(redo, pressed, false)).toBe(true);
    expect(findShortcut(sampleView().menus, pressed, false)).toBe("edit.redo");
    expect(findShortcut(sampleView().menus, key({ key: "q", ctrlKey: true }), false)).toBeNull();
  });

  it("leaves undo to a text field that has the focus", () => {
    const field = document.createElement("input");
    document.body.append(field);
    expect(findShortcut(sampleView().menus, key({ key: "z", ctrlKey: true }, field), false)).toBeNull();
    expect(findShortcut(sampleView().menus, key({ key: "z", ctrlKey: true }), false)).toBe("edit.undo");
    field.remove();
  });

  it("formats for the platform", () => {
    expect(formatShortcut(redo, false)).toBe("Ctrl+Shift+Z");
    expect(formatShortcut(redo, true)).toBe("⇧⌘Z");
    expect(formatShortcut({ ...undo, cmd: false, alt: true, key: "f4" }, false)).toBe("Alt+F4");
  });
});
