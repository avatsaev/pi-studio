import { describe, expect, it } from "vitest";
import { ARM_WARNING, computeHint, pressEscape, submitKeyClaimsShift } from "./keyboard.js";

describe("submitKeyClaimsShift", () => {
  it("claims the shift chord only for editor", () => {
    expect(submitKeyClaimsShift("editor")).toBe(true);
  });

  it("leaves every other kind on bare Enter", () => {
    expect(submitKeyClaimsShift("input")).toBe(false);
    expect(submitKeyClaimsShift("select")).toBe(false);
    expect(submitKeyClaimsShift("confirm")).toBe(false);
    expect(submitKeyClaimsShift("some-unrecognised-method")).toBe(false);
  });
});

describe("computeHint", () => {
  it("advertises bare Enter for a non-editor kind", () => {
    const hint = computeHint("input", false);
    expect(hint).toEqual({
      kind: "keys",
      segments: [
        { key: "↵", label: "submit" },
        { key: "Esc", label: "dismiss" },
      ],
    });
  });

  it("advertises the shift chord for editor, never bare Enter", () => {
    const hint = computeHint("editor", false);
    expect(hint.kind).toBe("keys");
    if (hint.kind !== "keys") throw new Error("unreachable");
    expect(hint.segments[0]).toEqual({ key: "⇧↵", label: "submit" });
    expect(hint.segments.some((s) => s.key === "↵")).toBe(false);
  });

  it("never mixes an editor's chord into a non-editor kind's hint", () => {
    for (const method of ["select", "confirm", "input", "unrecognised"]) {
      const hint = computeHint(method, false);
      if (hint.kind !== "keys") throw new Error("unreachable");
      expect(hint.segments.some((s) => s.key === "⇧↵")).toBe(false);
    }
  });

  it("replaces the key hint with the arm warning regardless of method", () => {
    for (const method of ["select", "confirm", "input", "editor"]) {
      expect(computeHint(method, true)).toEqual({ kind: "warning", text: ARM_WARNING });
    }
  });
});

describe("pressEscape", () => {
  it("arms on the first press without resolving", () => {
    expect(pressEscape(false)).toEqual({ armed: true, resolve: false });
  });

  it("resolves on the second press and disarms", () => {
    expect(pressEscape(true)).toEqual({ armed: false, resolve: true });
  });

  it("round-trips: press, press again resolves, a fresh press re-arms", () => {
    let armed = false;
    let first = pressEscape(armed);
    armed = first.armed;
    expect(armed).toBe(true);
    expect(first.resolve).toBe(false);

    let second = pressEscape(armed);
    armed = second.armed;
    expect(armed).toBe(false);
    expect(second.resolve).toBe(true);

    let third = pressEscape(armed);
    expect(third).toEqual({ armed: true, resolve: false });
  });
});
