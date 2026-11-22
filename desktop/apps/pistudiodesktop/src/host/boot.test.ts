import { describe, expect, it } from "vitest";

import { errorReason, noticeText, parseBootSnapshot, runBoot } from "./boot.js";
import { selectHostKind } from "./select.js";

const daemons = {
  currentId: "local",
  entries: [
    { id: "local", kind: "local", name: "This machine", hasPassword: false },
    { id: "d1", kind: "direct", name: "Box", address: "box:6767", hasPassword: true },
  ],
  local: { state: "running", host: "127.0.0.1", port: 6767 },
  settings: { autoStartLocalDaemon: true, cliPath: null },
};

const good = {
  app: { title: "Pi Studio", version: "1.0.0", platform: "desktop", minDaemonVersion: "0.0.119" },
  storage: { k: "v" },
  notices: [{ kind: "file_reset", file: "settings.json", keptAs: "settings.json.bad" }],
  preview: "origin",
  transfers: "engine",
  daemons,
};

describe("parseBootSnapshot", () => {
  it("accepts the expected shape", () => {
    expect(parseBootSnapshot(good)?.storage).toEqual({ k: "v" });
  });
  it("carries the transfers mode", () => {
    expect(parseBootSnapshot(good)?.transfers).toBe("engine");
    expect(parseBootSnapshot({ ...good, transfers: "page" })?.transfers).toBe("page");
  });
  it("carries the daemon view and the minimum daemon version", () => {
    const parsed = parseBootSnapshot(good);
    expect(parsed?.daemons).toEqual(daemons);
    expect(parsed?.app.minDaemonVersion).toBe("0.0.119");
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
    ["transfers missing", { ...good, transfers: undefined }],
    ["transfers unknown", { ...good, transfers: "fast" }],
    ["no minDaemonVersion", { ...good, app: { ...good.app, minDaemonVersion: undefined } }],
    ["empty minDaemonVersion", { ...good, app: { ...good.app, minDaemonVersion: "" } }],
    ["no daemons", { ...good, daemons: undefined }],
    ["daemons without settings", { ...good, daemons: { ...daemons, settings: undefined } }],
    ["daemons with an unknown local state", { ...good, daemons: { ...daemons, local: { state: "x" } } }],
    ["daemons with a bad entry", { ...good, daemons: { ...daemons, entries: [{ id: "a" }] } }],
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
  it("accepts and words the notice that secrets were not moved", () => {
    const notice = { kind: "secrets_not_moved" } as const;
    expect(parseBootSnapshot({ ...good, notices: [notice] })?.notices).toEqual([notice]);
    expect(noticeText(notice)).toMatch(/could not be moved to the secret store/);
  });
  it("accepts a reset file that could not be renamed and words it without a name", () => {
    const notice = { kind: "file_reset", file: "secrets.json", keptAs: null } as const;
    expect(parseBootSnapshot({ ...good, notices: [notice] })?.notices).toEqual([notice]);
    expect(noticeText(notice)).toBe(
      "secrets.json could not be read and was reset. The old file could not be renamed and is still in the folder.",
    );
    expect(parseBootSnapshot({ ...good, notices: [{ kind: "file_reset", file: "a" }] })).toBeNull();
  });
  it("accepts and words the notice that the keychain was not used, by reason", () => {
    for (const [reason, start] of [
      ["unavailable", "No keychain could be reached"],
      ["denied", "The keychain refused access"],
      ["failed", "The keychain did not work"],
      ["something new", "The keychain could not be used"],
      ["constructor", "The keychain could not be used"],
    ] as const) {
      const notice = { kind: "secret_store_fallback", reason } as const;
      expect(parseBootSnapshot({ ...good, notices: [notice] })?.notices).toEqual([notice]);
      const text = noticeText(notice);
      expect(text.slice(0, start.length)).toBe(start);
      expect(text).toMatch(/secrets\.json, a file only you can read\.$/);
    }
    expect(parseBootSnapshot({ ...good, notices: [{ kind: "secret_store_fallback" }] })).toBeNull();
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
