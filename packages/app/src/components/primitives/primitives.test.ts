/**
 * Tests for core DOM primitive helpers.
 * Pure logic tests — no DOM/JSX needed.
 * design-system.md § Hover-to-show, ui-components.md § Pressables/Status
 */

import { describe, it, expect } from "vitest";
import {
  hoverVisible,
  buttonAriaAttrs,
  buttonInlineStyle,
  buttonIconPx,
  surfaceBgVar,
  statusDotVisible,
  BUTTON_MIN_HEIGHT,
  BUTTON_PADDING_H,
  BUTTON_FONT_SIZE,
  BUTTON_ICON_SIZE,
  resolveButtonState,
  buttonIconColorToken,
  ghostHoverIconToken,
  type ButtonVariant,
  type ButtonSize,
} from "./helpers.js";
import { ICON_SIZE_PX } from "./Icon.js";

// ---------------------------------------------------------------------------
// Hover-to-show
// ---------------------------------------------------------------------------
describe("hoverVisible", () => {
  it("returns true when hovered on desktop web", () => {
    expect(hoverVisible(true, false, false)).toBe(true);
  });
  it("returns false when not hovered on desktop web", () => {
    expect(hoverVisible(false, false, false)).toBe(false);
  });
  it("always true on native (isNative=true)", () => {
    expect(hoverVisible(false, true, false)).toBe(true);
  });
  it("always true on compact layout", () => {
    expect(hoverVisible(false, false, true)).toBe(true);
  });
  it("true when any condition holds", () => {
    expect(hoverVisible(true, true, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Button aria attrs
// ---------------------------------------------------------------------------
describe("buttonAriaAttrs", () => {
  it("normal state: not disabled, no aria-busy", () => {
    const attrs = buttonAriaAttrs({ disabled: false, loading: false });
    expect(attrs.disabled).toBe(false);
    expect(attrs["aria-busy"]).toBeUndefined();
    expect(attrs.tabIndex).toBe(0);
  });
  it("disabled: disabled=true, aria-disabled=true, tabIndex=-1", () => {
    const attrs = buttonAriaAttrs({ disabled: true, loading: false });
    expect(attrs.disabled).toBe(true);
    expect(attrs["aria-disabled"]).toBe(true);
    expect(attrs.tabIndex).toBe(-1);
  });
  it("loading: disabled=true, aria-busy=true, tabIndex=-1", () => {
    const attrs = buttonAriaAttrs({ disabled: false, loading: true });
    expect(attrs.disabled).toBe(true);
    expect(attrs["aria-busy"]).toBe(true);
    expect(attrs.tabIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Button inline styles
// ---------------------------------------------------------------------------
describe("buttonInlineStyle", () => {
  const base = { variant: "default" as ButtonVariant, pressed: false, disabled: false, loading: false };

  it("xs: minHeight=28, paddingLeft=8, fontSize=12", () => {
    const style = buttonInlineStyle({ ...base, size: "xs" });
    expect(style.minHeight).toBe(BUTTON_MIN_HEIGHT.xs);
    expect(style.paddingLeft).toBe(BUTTON_PADDING_H.xs);
    expect(style.fontSize).toBe(BUTTON_FONT_SIZE.xs);
    expect(style.opacity).toBe(1);
  });

  it("lg normal: opacity=1", () => {
    expect(buttonInlineStyle({ ...base, size: "lg" }).opacity).toBe(1);
  });

  it("pressed: opacity=0.85", () => {
    expect(buttonInlineStyle({ ...base, size: "md", pressed: true }).opacity).toBe(0.85);
  });

  it("disabled: opacity=0.5", () => {
    expect(buttonInlineStyle({ ...base, size: "md", disabled: true }).opacity).toBe(0.5);
  });

  it("loading: opacity=0.5", () => {
    expect(buttonInlineStyle({ ...base, size: "md", loading: true }).opacity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Button icon token
// ---------------------------------------------------------------------------
describe("buttonIconColorToken", () => {
  it("default → accentForeground", () => {
    expect(buttonIconColorToken("default")).toBe("accentForeground");
  });
  it("ghost → foregroundMuted", () => {
    expect(buttonIconColorToken("ghost")).toBe("foregroundMuted");
  });
  it("destructive → destructiveForeground", () => {
    expect(buttonIconColorToken("destructive")).toBe("destructiveForeground");
  });
  it("ghostHoverIconToken: not hovered → foregroundMuted", () => {
    expect(ghostHoverIconToken(false)).toBe("foregroundMuted");
  });
  it("ghostHoverIconToken: hovered → foreground", () => {
    expect(ghostHoverIconToken(true)).toBe("foreground");
  });
});

// ---------------------------------------------------------------------------
// Button icon px
// ---------------------------------------------------------------------------
describe("buttonIconPx", () => {
  const sizes: ButtonSize[] = ["xs", "sm", "md", "lg"];
  it("matches BUTTON_ICON_SIZE map", () => {
    for (const s of sizes) {
      expect(buttonIconPx(s)).toBe(BUTTON_ICON_SIZE[s]);
    }
  });
});

// ---------------------------------------------------------------------------
// Icon size tokens
// ---------------------------------------------------------------------------
describe("ICON_SIZE_PX", () => {
  it("xs=12, sm=14, md=16, lg=20", () => {
    expect(ICON_SIZE_PX.xs).toBe(12);
    expect(ICON_SIZE_PX.sm).toBe(14);
    expect(ICON_SIZE_PX.md).toBe(16);
    expect(ICON_SIZE_PX.lg).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Surface bg var
// ---------------------------------------------------------------------------
describe("surfaceBgVar", () => {
  it("elevation 0 → --pi-color-surface0", () => {
    expect(surfaceBgVar(0)).toBe("var(--pi-color-surface0)");
  });
  it("elevation 3 → --pi-color-surface3", () => {
    expect(surfaceBgVar(3)).toBe("var(--pi-color-surface3)");
  });
});

// ---------------------------------------------------------------------------
// StatusDot visibility
// ---------------------------------------------------------------------------
describe("statusDotVisible", () => {
  it("running → visible", () => {
    expect(statusDotVisible({ status: "running" })).toBe(true);
  });
  it("idle, showInactive=false → not visible", () => {
    expect(statusDotVisible({ status: "idle", showInactive: false })).toBe(false);
  });
  it("idle, showInactive=true → visible", () => {
    expect(statusDotVisible({ status: "idle", showInactive: true })).toBe(true);
  });
  it("null status → not visible", () => {
    expect(statusDotVisible({ status: null })).toBe(false);
  });
  it("error → visible", () => {
    expect(statusDotVisible({ status: "error" })).toBe(true);
  });
  it("attention permission → visible", () => {
    expect(statusDotVisible({ status: "waiting", requiresAttention: true, attentionReason: "permission" })).toBe(true);
  });
});
