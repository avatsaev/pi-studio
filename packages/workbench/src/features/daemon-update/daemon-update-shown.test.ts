import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "@av-pi-studio/ui-library";
import {
  SHOWN_RESULT_KEY,
  isUnseenResult,
  readShownMarker,
  writeShownMarker,
} from "./daemon-update-shown.js";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return { get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) };
}

const RESULT = { from: "0.0.129", to: "0.0.130", outcome: "updated", at: 100 };

describe("shown marker", () => {
  it("is per daemon and survives other daemons' writes", () => {
    const store = memoryStore();
    writeShownMarker(store, "a", 100);
    writeShownMarker(store, "b", 200);
    expect(readShownMarker(store, "a")).toBe(100);
    expect(readShownMarker(store, "b")).toBe(200);
    expect(readShownMarker(store, "c")).toBeUndefined();
  });

  it("reads a malformed record as empty", () => {
    for (const raw of ["not json", "[]", "null", '{"a":"x"}']) {
      expect(readShownMarker(memoryStore({ [SHOWN_RESULT_KEY]: raw }), "a")).toBeUndefined();
    }
  });

  it("treats a result as unseen without a marker or when newer than it", () => {
    expect(isUnseenResult(RESULT, undefined)).toBe(true);
    expect(isUnseenResult(RESULT, 99)).toBe(true);
    expect(isUnseenResult(RESULT, 100)).toBe(false);
    expect(isUnseenResult(RESULT, 150)).toBe(false);
    expect(isUnseenResult(undefined, undefined)).toBe(false);
  });
});
