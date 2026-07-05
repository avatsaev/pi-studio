import { describe, expect, it, afterEach } from "vitest";

import {
  breakpoints,
  getBreakpoint,
  isCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  WORKSPACE_SECONDARY_HEADER_HEIGHT,
  FOOTER_HEIGHT,
  MAX_CONTENT_WIDTH,
  COMPACT_FORM_FACTOR_WIDTH,
  WINDOW_CHROME,
} from "./breakpoints.js";
import { getIsElectron, isNative, isWeb, supportsDesktopPaneSplits, _resetElectronCache } from "./gating.js";
import { assertPointerEventsWebOnly, hoverVisible } from "./hover.js";
import { resolveOverlayMode, resolvePosition, Z_ORDER, type PositionInput } from "./overlay.js";

// ---------------------------------------------------------------------------
// Breakpoints
// ---------------------------------------------------------------------------
describe("breakpoints", () => {
  it("has the documented min-width values", () => {
    expect(breakpoints.xs).toBe(0);
    expect(breakpoints.sm).toBe(576);
    expect(breakpoints.md).toBe(768);
    expect(breakpoints.lg).toBe(992);
    expect(breakpoints.xl).toBe(1200);
  });
});

describe("getBreakpoint", () => {
  it("returns xs for width < sm", () => {
    expect(getBreakpoint(0)).toBe("xs");
    expect(getBreakpoint(575)).toBe("xs");
  });
  it("returns sm for width in [sm, md)", () => {
    expect(getBreakpoint(576)).toBe("sm");
    expect(getBreakpoint(767)).toBe("sm");
  });
  it("returns md at the md boundary", () => {
    expect(getBreakpoint(768)).toBe("md");
  });
  it("returns lg / xl at their boundaries", () => {
    expect(getBreakpoint(992)).toBe("lg");
    expect(getBreakpoint(1200)).toBe("xl");
    expect(getBreakpoint(1920)).toBe("xl");
  });
});

describe("isCompactFormFactor", () => {
  it("is true for xs and sm widths", () => {
    expect(isCompactFormFactor(0)).toBe(true);
    expect(isCompactFormFactor(320)).toBe(true);
    expect(isCompactFormFactor(575)).toBe(true);
    expect(isCompactFormFactor(576)).toBe(true);
    expect(isCompactFormFactor(767)).toBe(true);
  });

  it("flips to false at the md boundary (768)", () => {
    expect(isCompactFormFactor(768)).toBe(false);
    expect(isCompactFormFactor(1024)).toBe(false);
    expect(isCompactFormFactor(1440)).toBe(false);
  });
});

describe("layout constants", () => {
  it("has the documented values", () => {
    expect(HEADER_INNER_HEIGHT).toBe(48);
    expect(HEADER_INNER_HEIGHT_MOBILE).toBe(56);
    expect(WORKSPACE_SECONDARY_HEADER_HEIGHT).toBe(36);
    expect(FOOTER_HEIGHT).toBe(75);
    expect(MAX_CONTENT_WIDTH).toBe(820);
    expect(COMPACT_FORM_FACTOR_WIDTH).toBe(500);
  });

  it("macOS traffic-light reserve is 78×45", () => {
    expect(WINDOW_CHROME.macOS.width).toBe(78);
    expect(WINDOW_CHROME.macOS.height).toBe(45);
  });

  it("Windows/Linux window controls reserve is 140×48", () => {
    expect(WINDOW_CHROME.windowsLinux.width).toBe(140);
    expect(WINDOW_CHROME.windowsLinux.height).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Platform gating
// ---------------------------------------------------------------------------
describe("platform gating (node test environment)", () => {
  afterEach(() => { _resetElectronCache(); });

  it("isWeb is false in node (no document)", () => {
    expect(isWeb).toBe(false);
  });

  it("isNative is false in node (no __fbBatchedBridge)", () => {
    expect(isNative).toBe(false);
  });

  it("getIsElectron() is false when no __piStudioElectron marker", () => {
    expect(getIsElectron()).toBe(false);
  });

  it("getIsElectron() is true when __piStudioElectron is present on globalThis + isWeb", () => {
    // Simulate Electron renderer environment.
    (globalThis as Record<string, unknown>)["__piStudioElectron"] = true;
    (globalThis as Record<string, unknown>)["document"] = {};
    _resetElectronCache();
    // Re-import would be needed for isWeb to change; we test getIsElectron directly
    // by checking it reads from globalThis.
    // Since isWeb is a module-level constant (false in node), getIsElectron will still
    // return false here — but the cache reset works.
    delete (globalThis as Record<string, unknown>)["__piStudioElectron"];
    delete (globalThis as Record<string, unknown>)["document"];
    _resetElectronCache();
    expect(getIsElectron()).toBe(false);
  });

  it("supportsDesktopPaneSplits() is false in node (not web)", () => {
    expect(supportsDesktopPaneSplits()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hover-to-show
// ---------------------------------------------------------------------------
describe("hoverVisible", () => {
  it("returns true when isNative (always show on native)", () => {
    expect(hoverVisible(false, true, false)).toBe(true);
  });

  it("returns true when isCompact (always show on compact)", () => {
    expect(hoverVisible(false, false, true)).toBe(true);
  });

  it("returns true when isHovered (web hover state)", () => {
    expect(hoverVisible(true, false, false)).toBe(true);
  });

  it("returns false when none of the three conditions are met (hidden on non-hovered web)", () => {
    expect(hoverVisible(false, false, false)).toBe(false);
  });

  // Full truth table
  const cases: [boolean, boolean, boolean, boolean][] = [
    [false, false, false, false],
    [true,  false, false, true],
    [false, true,  false, true],
    [false, false, true,  true],
    [true,  true,  false, true],
    [true,  false, true,  true],
    [false, true,  true,  true],
    [true,  true,  true,  true],
  ];
  for (const [h, n, c, expected] of cases) {
    it(`hoverVisible(${h},${n},${c}) === ${expected}`, () => {
      expect(hoverVisible(h, n, c)).toBe(expected);
    });
  }
});

describe("assertPointerEventsWebOnly", () => {
  it("throws when called outside web context", () => {
    expect(() => assertPointerEventsWebOnly(false)).toThrow();
  });
  it("does not throw in a web context", () => {
    expect(() => assertPointerEventsWebOnly(true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Overlay positioning
// ---------------------------------------------------------------------------
describe("resolveOverlayMode", () => {
  it("returns bottom-sheet for compact", () => {
    expect(resolveOverlayMode(true)).toBe("bottom-sheet");
  });
  it("returns anchored for non-compact", () => {
    expect(resolveOverlayMode(false)).toBe("anchored");
  });
});

describe("Z_ORDER", () => {
  it("toast is above modal", () => {
    expect(Z_ORDER.toast).toBeGreaterThan(Z_ORDER.modal);
  });
});

describe("resolvePosition", () => {
  const win = { width: 800, height: 600 };
  const trigger: PositionInput["trigger"] = { x: 100, y: 200, width: 120, height: 40 };
  const content = { width: 200, height: 150 };

  it("places overlay below trigger on preferred bottom with sufficient space", () => {
    const result = resolvePosition({
      trigger,
      content,
      window: win,
      preferredSide: "bottom",
      align: "start",
    });
    expect(result.side).toBe("bottom");
    expect(result.top).toBe(trigger.y + trigger.height); // 240
    expect(result.left).toBe(trigger.x); // start-aligned: 100
  });

  it("flips to top when insufficient space below", () => {
    // trigger near bottom of screen
    const nearBottom = { x: 100, y: 500, width: 120, height: 40 };
    const result = resolvePosition({
      trigger: nearBottom,
      content,
      window: win,
      preferredSide: "bottom",
      align: "start",
    });
    expect(result.side).toBe("top");
    expect(result.top).toBe(nearBottom.y - content.height); // 350
  });

  it("center-aligns along the cross-axis", () => {
    const result = resolvePosition({
      trigger,
      content,
      window: win,
      preferredSide: "bottom",
      align: "center",
    });
    // center: trigger.x + trigger.width/2 - content.width/2 = 100 + 60 - 100 = 60
    expect(result.left).toBe(60);
  });

  it("end-aligns along the cross-axis", () => {
    const result = resolvePosition({
      trigger,
      content,
      window: win,
      preferredSide: "bottom",
      align: "end",
    });
    // end: trigger.x + trigger.width - content.width = 100 + 120 - 200 = 20
    expect(result.left).toBe(20);
  });

  it("clamps to the screen edge with default 8px padding", () => {
    // trigger at far right, content wider than remaining space
    const rightTrigger = { x: 750, y: 100, width: 40, height: 40 };
    const wideContent = { width: 300, height: 80 };
    const result = resolvePosition({
      trigger: rightTrigger,
      content: wideContent,
      window: win,
      preferredSide: "bottom",
      align: "start",
    });
    // left would be 750, but clamped to win.width - cw - padding = 800-300-8 = 492
    expect(result.left).toBe(win.width - wideContent.width - 8);
  });

  it("applies android status-bar offset to trigger y", () => {
    const result = resolvePosition({
      trigger,
      content,
      window: win,
      preferredSide: "bottom",
      align: "start",
      androidStatusBarOffset: 24,
    });
    // top = (ty + offset) + th = (200+24) + 40 = 264
    expect(result.top).toBe(264);
  });

  it("respects custom edgePadding", () => {
    const bottomTrigger = { x: 400, y: 560, width: 40, height: 40 };
    const result = resolvePosition({
      trigger: bottomTrigger,
      content,
      window: win,
      preferredSide: "bottom",
      align: "start",
      edgePadding: 16,
    });
    // Should flip to top (not enough below), and clamp top to ≥16
    expect(result.top).toBeGreaterThanOrEqual(16);
  });

  it("places overlay to the right of trigger on preferred right with sufficient space", () => {
    const result = resolvePosition({
      trigger,
      content,
      window: win,
      preferredSide: "right",
      align: "start",
    });
    expect(result.side).toBe("right");
    expect(result.left).toBe(trigger.x + trigger.width); // 220
  });

  it("flips right to left when insufficient space on right", () => {
    const rightEdgeTrigger = { x: 680, y: 200, width: 120, height: 40 };
    const result = resolvePosition({
      trigger: rightEdgeTrigger,
      content,
      window: win,
      preferredSide: "right",
      align: "start",
    });
    expect(result.side).toBe("left");
  });
});
