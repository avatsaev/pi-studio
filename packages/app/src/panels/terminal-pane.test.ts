import { describe, expect, it } from "vitest";
import {
  applyKeyBarPress,
  clearSnapshot,
  dedupResize,
  INITIAL_KEY_BAR,
  INITIAL_TERMINAL_PANE,
  MOBILE_KEY_BAR,
  shouldSendOutput,
  shouldSendResize,
  snapshotCacheKey,
  storeSnapshot,
  terminalDescriptorLabel,
  terminalShouldKeepMounted,
  terminalStatusBucket,
  type TerminalPaneState,
  type RestoreSnapshot,
} from "./index.js";

const connected: TerminalPaneState = {
  ...INITIAL_TERMINAL_PANE,
  terminalId: "t1",
  status: { kind: "connected", terminalId: "t1" },
  isActive: true,
  isPaneFocused: true,
  workspaceAvailable: true,
};

describe("terminal pane state", () => {
  it("shouldSendResize: true only when connected + active + focused + workspace available", () => {
    expect(shouldSendResize(connected)).toBe(true);
    expect(shouldSendResize({ ...connected, isPaneFocused: false })).toBe(false);
    expect(shouldSendResize({ ...connected, workspaceAvailable: false })).toBe(false);
    expect(shouldSendResize({ ...connected, status: { kind: "connecting" } })).toBe(false);
  });

  it("shouldSendOutput: same conditions as resize", () => {
    expect(shouldSendOutput(connected)).toBe(true);
    expect(shouldSendOutput({ ...connected, isActive: false })).toBe(false);
  });

  it("dedupResize: returns true when size changes, false for same", () => {
    expect(dedupResize({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
    expect(dedupResize({ cols: 80, rows: 24 }, { cols: 120, rows: 30 })).toBe(true);
    expect(dedupResize(undefined, { cols: 80, rows: 24 })).toBe(true);
  });

  it("terminalShouldKeepMounted is true when connected or connecting", () => {
    expect(terminalShouldKeepMounted(connected)).toBe(true);
    expect(terminalShouldKeepMounted({ ...connected, status: { kind: "connecting" } })).toBe(true);
    expect(terminalShouldKeepMounted({ ...connected, status: { kind: "exited" } })).toBe(false);
  });

  it("terminalDescriptorLabel uses title, then last cwd segment, then fallback", () => {
    expect(terminalDescriptorLabel({ ...connected, title: "npm run dev" })).toBe("npm run dev");
    expect(terminalDescriptorLabel({ ...connected, cwd: "/repo/packages/app" })).toBe("app");
    expect(terminalDescriptorLabel(connected)).toBe("Terminal");
  });

  it("terminalStatusBucket maps status kinds", () => {
    expect(terminalStatusBucket(connected)).toBe("running");
    expect(terminalStatusBucket({ ...connected, status: { kind: "error", message: "fail" } })).toBe("failed");
    expect(terminalStatusBucket({ ...connected, status: { kind: "exited" } })).toBe("idle");
    expect(terminalStatusBucket({ ...connected, status: { kind: "connecting" } })).toBeUndefined();
  });
});

describe("snapshot cache", () => {
  it("stores and retrieves snapshots by scope key", () => {
    let cache = new Map<string, RestoreSnapshot>();
    const snap: RestoreSnapshot = { terminalId: "t1", scope: snapshotCacheKey("s1", "/repo"), data: "abcd", cols: 80, rows: 24 };
    cache = storeSnapshot(cache, snap);
    expect(cache.get(snapshotCacheKey("s1", "/repo"))?.data).toBe("abcd");
    cache = clearSnapshot(cache, snapshotCacheKey("s1", "/repo"));
    expect(cache.has(snapshotCacheKey("s1", "/repo"))).toBe(false);
  });
});

describe("mobile key bar", () => {
  it("has 12 keys matching the documented set", () => {
    expect(MOBILE_KEY_BAR).toHaveLength(12);
    expect(MOBILE_KEY_BAR.some((k) => k.label === "Esc")).toBe(true);
    expect(MOBILE_KEY_BAR.some((k) => k.label === "Ctrl")).toBe(true);
  });

  it("applyKeyBarPress toggles Ctrl and sends chord on next key", () => {
    let kb = INITIAL_KEY_BAR;
    const ctrl = MOBILE_KEY_BAR.find((k) => k.label === "Ctrl")!;
    const cKey = { label: "c", sequence: "c", isModifier: false };
    ({ newState: kb } = applyKeyBarPress(kb, ctrl));
    expect(kb.ctrlDown).toBe(true);
    const { newState, sequence } = applyKeyBarPress(kb, cKey);
    expect(sequence).toBe("\x03"); // Ctrl-C
    expect(newState.ctrlDown).toBe(false); // reset after use
  });

  it("Alt modifier prepends ESC to the sequence", () => {
    const alt = MOBILE_KEY_BAR.find((k) => k.label === "Alt")!;
    const fKey = { label: "f", sequence: "f", isModifier: false };
    const { newState: kb } = applyKeyBarPress(INITIAL_KEY_BAR, alt);
    const { sequence } = applyKeyBarPress(kb, fKey);
    expect(sequence).toBe("\x1bf");
  });
});
