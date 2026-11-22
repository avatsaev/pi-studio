import { describe, expect, it } from "vitest";

import { parseDaemonsView } from "./daemons-view.js";

const VIEW = {
  currentId: "local",
  entries: [{ id: "local", kind: "local", name: "This machine", hasPassword: false }],
  local: { state: "stopped" },
  remote: null,
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

const SSH_ENTRY = {
  id: "s1",
  kind: "ssh",
  name: "Box",
  hasPassword: false,
  ssh: { host: "box", user: "me", port: 2222, identityFile: "~/.ssh/id", jump: "gw", daemonPort: 6767, hasSshPassword: true, hasPassphrase: false },
};

describe("parseDaemonsView ssh", () => {
  it("keeps an ssh entry with its view", () => {
    const view = parseDaemonsView({ ...VIEW, entries: [SSH_ENTRY] });
    expect(view?.entries).toEqual([SSH_ENTRY]);
  });

  it("keeps an ssh entry without the optional fields", () => {
    const ssh = { host: "box", daemonPort: 6767, hasSshPassword: false, hasPassphrase: false };
    expect(parseDaemonsView({ ...VIEW, entries: [{ ...SSH_ENTRY, ssh }] })?.entries).toEqual([{ ...SSH_ENTRY, ssh }]);
  });

  it("drops the view when an ssh entry has no ssh part, or another kind has one", () => {
    expect(parseDaemonsView({ ...VIEW, entries: [{ ...SSH_ENTRY, ssh: undefined }] })).toBeNull();
    expect(parseDaemonsView({ ...VIEW, entries: [{ ...SSH_ENTRY, kind: "direct" }] })).toBeNull();
  });

  it("drops the view when the ssh part is malformed", () => {
    expect(parseDaemonsView({ ...VIEW, entries: [{ ...SSH_ENTRY, ssh: { ...SSH_ENTRY.ssh, daemonPort: "x" } }] })).toBeNull();
  });
});

describe("parseDaemonsView remote", () => {
  it.each(["unknown", "checking", "running", "stopped", "not_installed", "starting"])("keeps %s", (state) => {
    expect(parseDaemonsView({ ...VIEW, remote: { state } })?.remote).toEqual({ state });
  });

  it("keeps cli_outdated with its version", () => {
    expect(parseDaemonsView({ ...VIEW, remote: { state: "cli_outdated", version: "0.9.0" } })?.remote).toEqual({
      state: "cli_outdated",
      version: "0.9.0",
    });
  });

  it.each(["not_healthy", "timeout", "bad_output", "exec_failed", "no_shell"])("keeps failed %s", (reason) => {
    expect(parseDaemonsView({ ...VIEW, remote: { state: "failed", reason } })?.remote).toEqual({ state: "failed", reason });
  });

  it("is null for an absent or null field", () => {
    expect(parseDaemonsView({ ...VIEW, remote: null })?.remote).toBeNull();
  });

  it.each([{ state: "bogus" }, { state: "failed", reason: "nope" }, { state: "cli_outdated" }])(
    "reads the bad remote %j as null and keeps the view",
    (remote) => {
      expect(parseDaemonsView({ ...VIEW, remote })?.remote).toBeNull();
    },
  );
});
