import { beforeEach, describe, expect, it } from "vitest";
import { installHost, resetHostForTests } from "../host/install.js";
import { createTestHost } from "../test/test-host.js";
import {
  parseZoom,
  stepZoom,
  useZoomStore,
  ZOOM_LEVELS,
  ZOOM_STORAGE_KEY,
  zoomShortcut,
} from "./zoom-store.js";

const key = (init: Partial<KeyboardEvent>) => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...init,
});

beforeEach(() => {
  resetHostForTests();
  useZoomStore.setState({ factor: 1 });
});

describe("zoom ladder", () => {
  it("snaps a stored value to the nearest level and falls back to 100%", () => {
    expect(parseZoom("1.25")).toBe(1.25);
    expect(parseZoom("1.2")).toBe(1.25);
    expect(parseZoom("9")).toBe(2);
    expect(parseZoom(null)).toBe(1);
    expect(parseZoom("garbage")).toBe(1);
    expect(parseZoom("-1")).toBe(1);
  });

  it("steps one level and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(ZOOM_LEVELS.at(-1)!, 1)).toBe(ZOOM_LEVELS.at(-1));
    expect(stepZoom(ZOOM_LEVELS[0]!, -1)).toBe(ZOOM_LEVELS[0]);
  });
});

describe("zoomShortcut", () => {
  it("reads Ctrl or Cmd with = + − _ 0 and the keypad", () => {
    expect(zoomShortcut(key({ ctrlKey: true, key: "=" }))).toBe("in");
    expect(zoomShortcut(key({ metaKey: true, key: "+" }))).toBe("in");
    expect(zoomShortcut(key({ ctrlKey: true, code: "NumpadAdd", key: "+" }))).toBe("in");
    expect(zoomShortcut(key({ ctrlKey: true, key: "-" }))).toBe("out");
    expect(zoomShortcut(key({ ctrlKey: true, key: "_" }))).toBe("out");
    expect(zoomShortcut(key({ metaKey: true, key: "0" }))).toBe("reset");
  });

  it("ignores the keys without a modifier, or with Alt", () => {
    expect(zoomShortcut(key({ key: "=" }))).toBeNull();
    expect(zoomShortcut(key({ ctrlKey: true, altKey: true, key: "-" }))).toBeNull();
    expect(zoomShortcut(key({ ctrlKey: true, key: "t" }))).toBeNull();
  });
});

describe("useZoomStore", () => {
  it("applies the stored level on the host the shell installs", () => {
    const host = createTestHost({ zoom: true, storage: { [ZOOM_STORAGE_KEY]: "1.25" } });
    installHost(host);
    expect(useZoomStore.getState().factor).toBe(1.25);
    expect(host.calls).toContainEqual({ member: "zoom.set", args: [1.25] });
  });

  it("does not call the host at 100%", () => {
    const host = createTestHost({ zoom: true });
    installHost(host);
    expect(host.calls.some((c) => c.member === "zoom.set")).toBe(false);
  });

  it("stores and applies each change, and reset returns to 100%", () => {
    const host = createTestHost({ zoom: true });
    installHost(host);
    useZoomStore.getState().apply("in");
    expect(host.data.get(ZOOM_STORAGE_KEY)).toBe("1.1");
    useZoomStore.getState().apply("reset");
    expect(host.data.get(ZOOM_STORAGE_KEY)).toBe("1");
    expect(host.calls.filter((c) => c.member === "zoom.set").map((c) => c.args[0])).toEqual([
      1.1, 1,
    ]);
  });
});
