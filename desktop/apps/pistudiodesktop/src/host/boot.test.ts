import { describe, expect, it } from "vitest";

import { errorReason, noticeText, parseBootSnapshot, runBoot } from "./boot.js";
import { selectHostKind } from "./select.js";

const good = {
  app: { title: "Pi Studio", version: "1.0.0", platform: "desktop" },
  storage: { k: "v" },
  notices: [{ kind: "file_reset", file: "settings.json", keptAs: "settings.json.bad" }],
  preview: "origin",
};

describe("parseBootSnapshot", () => {
  it("accepts the expected shape", () => {
    expect(parseBootSnapshot(good)?.storage).toEqual({ k: "v" });
  });
  it.each([
    ["null", null],
    ["no app", { ...good, app: undefined }],
    ["wrong platform", { ...good, app: { ...good.app, platform: "web" } }],
    ["version not a string", { ...good, app: { ...good.app, version: 1 } }],
    ["storage missing", { ...good, storage: undefined }],
    ["storage value not a string", { ...good, storage: { k: 1 } }],
    ["notices not an array", { ...good, notices: {} }],
    ["preview missing", { ...good, preview: undefined }],
    ["preview unknown", { ...good, preview: "other" }],
    ["bad notice", { ...good, notices: [{ kind: "other", file: "a", keptAs: "b" }] }],
  ])("rejects %s", (_name, value) => {
    expect(parseBootSnapshot(value)).toBeNull();
  });
});

describe("runBoot", () => {
  it("rejects a malformed answer and passes a failure through", async () => {
    await expect(runBoot(async () => ({}))).rejects.toThrow(/unexpected shape/);
    await expect(runBoot(() => Promise.reject("down"))).rejects.toBe("down");
    expect((await runBoot(async () => good)).app.version).toBe("1.0.0");
  });
});

describe("text and selection", () => {
  it("words a notice", () => {
    expect(noticeText(good.notices[0] as never)).toBe(
      "settings.json could not be read and was reset. The old file was kept as settings.json.bad.",
    );
  });
  it("reads an error reason", () => {
    expect(errorReason(new Error("x"))).toBe("x");
    expect(errorReason("y")).toBe("y");
    expect(errorReason(3)).toBe("Unknown error.");
  });
  it("selects the host", () => {
    expect(selectHostKind(true)).toBe("desktop");
    expect(selectHostKind(false)).toBe("browser");
  });
});
