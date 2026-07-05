import { describe, expect, it } from "vitest";

import {
  buildToastEntry,
  copiedToast,
  DEFAULT_TOAST_DURATION_MS,
  errorToast,
  EscStack,
  remainingMs,
} from "./toast.js";
import { statusDotColor, STATUS_DOT_SIZE, type StatusDotInput } from "./status-dot.js";
import { headerPadding, HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "./screen-header.js";
import { WINDOW_CHROME } from "../platform/breakpoints.js";

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
describe("buildToastEntry", () => {
  it("applies default variant and duration", () => {
    const entry = buildToastEntry("1", "Hello", {});
    expect(entry.variant).toBe("default");
    expect(entry.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
    expect(entry.paused).toBe(false);
    expect(entry.content).toBe("Hello");
  });

  it("respects explicit variant and duration", () => {
    const entry = buildToastEntry("2", "Oops", { variant: "error", durationMs: 5000 });
    expect(entry.variant).toBe("error");
    expect(entry.durationMs).toBe(5000);
  });

  it("null durationMs → sticky", () => {
    const entry = buildToastEntry("3", "Sticky", { durationMs: null });
    expect(entry.durationMs).toBe(null);
  });
});

describe("copiedToast", () => {
  it("produces a success toast", () => {
    const { content, opts } = copiedToast();
    expect(content).toBe("Copied");
    expect(opts.variant).toBe("success");
  });
  it("respects custom label", () => {
    expect(copiedToast("Link copied").content).toBe("Link copied");
  });
});

describe("errorToast", () => {
  it("produces an error toast", () => {
    const { opts } = errorToast("Something went wrong");
    expect(opts.variant).toBe("error");
  });
});

describe("remainingMs", () => {
  it("returns null for sticky toast", () => {
    const entry = buildToastEntry("s", "sticky", { durationMs: null }, 1000);
    expect(remainingMs(entry, null, 2000)).toBe(null);
  });

  it("computes remaining time", () => {
    const entry = buildToastEntry("t", "msg", { durationMs: 2200 }, 0);
    expect(remainingMs(entry, null, 1000)).toBe(1200);
  });

  it("clamps to 0 when elapsed > duration", () => {
    const entry = buildToastEntry("t", "msg", { durationMs: 2200 }, 0);
    expect(remainingMs(entry, null, 5000)).toBe(0);
  });

  it("returns frozen remaining when paused", () => {
    const entry = buildToastEntry("t", "msg", { durationMs: 2200 }, 0);
    const paused = { ...entry, paused: true };
    expect(remainingMs(paused, 800, 9999)).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// EscStack
// ---------------------------------------------------------------------------
describe("EscStack", () => {
  it("closeTop calls the topmost close fn and removes it", () => {
    const stack = new EscStack();
    const results: string[] = [];
    stack.push("modal-1", () => results.push("m1"));
    stack.push("modal-2", () => results.push("m2"));
    expect(stack.size).toBe(2);
    expect(stack.topId()).toBe("modal-2");

    const closed = stack.closeTop();
    expect(closed).toBe(true);
    expect(results).toEqual(["m2"]);
    expect(stack.size).toBe(1);
    expect(stack.topId()).toBe("modal-1");
  });

  it("closeTop returns false on empty stack", () => {
    const stack = new EscStack();
    expect(stack.closeTop()).toBe(false);
  });

  it("pop removes a specific entry by id", () => {
    const stack = new EscStack();
    stack.push("a", () => {});
    stack.push("b", () => {});
    stack.pop("a");
    expect(stack.size).toBe(1);
    expect(stack.topId()).toBe("b");
  });

  it("pops the last occurrence when duplicate ids exist", () => {
    const stack = new EscStack();
    const results: string[] = [];
    stack.push("dup", () => results.push("first"));
    stack.push("dup", () => results.push("second"));
    stack.closeTop(); // closes "second"
    expect(results).toEqual(["second"]);
    expect(stack.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AgentStatusDot
// ---------------------------------------------------------------------------
describe("statusDotColor", () => {
  it("returns null for missing status", () => {
    expect(statusDotColor({ status: null })).toBe(null);
    expect(statusDotColor({ status: undefined })).toBe(null);
  });

  it("running → accent", () => {
    expect(statusDotColor({ status: "running" })).toBe("accent");
  });

  it("queued → accent", () => {
    expect(statusDotColor({ status: "queued" })).toBe("accent");
  });

  it("waiting → statusWarning", () => {
    expect(statusDotColor({ status: "waiting" })).toBe("statusWarning");
  });

  it("finished → statusSuccess", () => {
    expect(statusDotColor({ status: "finished" })).toBe("statusSuccess");
  });

  it("error → statusDanger", () => {
    expect(statusDotColor({ status: "error" })).toBe("statusDanger");
  });

  it("idle without showInactive → null", () => {
    expect(statusDotColor({ status: "idle" })).toBe(null);
  });

  it("idle with showInactive → foregroundMuted", () => {
    expect(statusDotColor({ status: "idle", showInactive: true })).toBe("foregroundMuted");
  });

  it("archived without showInactive → null", () => {
    expect(statusDotColor({ status: "archived" })).toBe(null);
  });

  describe("requiresAttention overrides", () => {
    const base: StatusDotInput = { status: "running", requiresAttention: true };
    it("permission → statusWarning", () => {
      expect(statusDotColor({ ...base, attentionReason: "permission" })).toBe("statusWarning");
    });
    it("error → statusDanger", () => {
      expect(statusDotColor({ ...base, attentionReason: "error" })).toBe("statusDanger");
    });
    it("finished → statusSuccess", () => {
      expect(statusDotColor({ ...base, attentionReason: "finished" })).toBe("statusSuccess");
    });
    it("no reason defaults to statusSuccess", () => {
      expect(statusDotColor({ status: "running", requiresAttention: true })).toBe("statusSuccess");
    });
  });

  it("STATUS_DOT_SIZE is 8", () => {
    expect(STATUS_DOT_SIZE).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// ScreenHeader padding
// ---------------------------------------------------------------------------
describe("headerPadding", () => {
  it("mobile header height is 56", () => {
    const p = headerPadding({ isDesktop: false, isMobile: true, os: "macos" });
    expect(p.height).toBe(HEADER_INNER_HEIGHT_MOBILE);
  });

  it("desktop header height is 48", () => {
    const p = headerPadding({ isDesktop: true, isMobile: false, os: "macos" });
    expect(p.height).toBe(HEADER_INNER_HEIGHT);
  });

  it("non-desktop → zero padding regardless of OS", () => {
    const p = headerPadding({ isDesktop: false, isMobile: false, os: "macos" });
    expect(p.paddingLeft).toBe(0);
    expect(p.paddingRight).toBe(0);
  });

  it("desktop macOS → left padding = traffic-light reserve (78)", () => {
    const p = headerPadding({ isDesktop: true, isMobile: false, os: "macos" });
    expect(p.paddingLeft).toBe(WINDOW_CHROME.macOS.width); // 78
    expect(p.paddingRight).toBe(0);
  });

  it("desktop Windows/Linux → right padding = 140", () => {
    const p = headerPadding({ isDesktop: true, isMobile: false, os: "windowsLinux" });
    expect(p.paddingRight).toBe(WINDOW_CHROME.windowsLinux.width); // 140
    expect(p.paddingLeft).toBe(0);
  });
});
