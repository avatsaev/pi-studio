import { describe, expect, it } from "vitest";

import { parseDaemonsView } from "./daemons-view.js";

const VIEW = {
  currentId: "local",
  entries: [{ id: "local", kind: "local", name: "This machine", hasPassword: false }],
  local: { state: "stopped" },
  settings: { autoStartLocalDaemon: true, cliPath: null },
};

describe("parseDaemonsView secretStore", () => {
  it("keeps keychain", () => {
    expect(parseDaemonsView({ ...VIEW, secretStore: "keychain" })?.secretStore).toBe("keychain");
  });

  it("keeps file", () => {
    expect(parseDaemonsView({ ...VIEW, secretStore: "file" })?.secretStore).toBe("file");
  });

  it("leaves the field out when it is absent", () => {
    const view = parseDaemonsView(VIEW);
    expect(view).not.toBeNull();
    expect(view).not.toHaveProperty("secretStore");
  });

  it.each(["memory", "", 7, null, {}])("drops the unknown value %j and keeps the view", (value) => {
    const view = parseDaemonsView({ ...VIEW, secretStore: value });
    expect(view).toEqual(VIEW);
    expect(view).not.toHaveProperty("secretStore");
  });
});
