import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { armDragGuard, disarmDragGuard, DRAG_GUARD_ATTR } from "./drag-guard.js";

// The guard only works as a *pair*: the attribute this module sets on <body> and the `pointer-events`
// rule in global.css that reacts to it. Renaming one and not the other breaks tab/file drops over the
// HTML preview iframe silently — nothing throws, no test that isn't this one fails, and the symptom
// (a drag that sticks over one particular pane) is easy to mistake for an unrelated dnd-kit quirk.

const GLOBAL_CSS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "global.css");

/** Minimal stand-in for <body>: the suite runs under a plain Node environment, with no DOM. */
function fakeBody(): DragGuardRecorder {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
  };
}

interface DragGuardRecorder {
  attrs: Map<string, string>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

describe("drag guard", () => {
  it("arms and disarms the attribute global.css keys off", () => {
    const body = fakeBody();

    armDragGuard(body);
    expect(body.attrs.has(DRAG_GUARD_ATTR)).toBe(true);

    disarmDragGuard(body);
    expect(body.attrs.has(DRAG_GUARD_ATTR)).toBe(false);
  });

  it("survives a gesture that disarms twice (dragend then drop)", () => {
    const body = fakeBody();

    armDragGuard(body);
    disarmDragGuard(body);
    disarmDragGuard(body);

    expect(body.attrs.has(DRAG_GUARD_ATTR)).toBe(false);
  });

  it("has a matching global.css rule that neutralizes iframe hit-testing", () => {
    const css = readFileSync(GLOBAL_CSS, "utf8");
    const rule = new RegExp(
      `body\\[${DRAG_GUARD_ATTR}\\]\\s+iframe\\s*\\{[^}]*pointer-events:\\s*none`,
    );

    expect(css).toMatch(rule);
  });
});
