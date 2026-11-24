import { describe, expect, it } from "vitest";

import { parseDaemonsView } from "./daemons-view.js";

const VIEW = {
  currentId: "local",
  entries: [{ id: "local", kind: "local", name: "This machine", hasPassword: false }],
  local: { state: "stopped" },
  remote: null,
  settings: { autoStartLocalDaemon: true },
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

describe("parseDaemonsView local states", () => {
  it("keeps updating for the local and the remote state", () => {
    expect(parseDaemonsView({ ...VIEW, local: { state: "updating" } })?.local).toEqual({ state: "updating" });
    expect(parseDaemonsView({ ...VIEW, remote: { state: "updating" } })?.remote).toEqual({ state: "updating" });
  });

  it("keeps outdated with its version, downloading with its counts and installing", () => {
    expect(parseDaemonsView({ ...VIEW, local: { state: "outdated", version: "0.0.100" } })?.local).toEqual({
      state: "outdated",
      version: "0.0.100",
    });
    expect(parseDaemonsView({ ...VIEW, local: { state: "downloading", received: 10, total: 20 } })?.local).toEqual({
      state: "downloading",
      received: 10,
      total: 20,
    });
    expect(parseDaemonsView({ ...VIEW, local: { state: "installing" } })?.local).toEqual({ state: "installing" });
  });

  it.each([
    { state: "outdated" },
    { state: "downloading", received: 1 },
    { state: "downloading", received: "1", total: 2 },
    { state: "cli_missing" },
    { state: "cli_outdated", version: "0.0.1" },
    { state: "failed", reason: "update_failed" },
  ])("drops the view for the local state %j", (local) => {
    expect(parseDaemonsView({ ...VIEW, local })).toBeNull();
  });

  it("keeps a failed install with its output, or without", () => {
    const output = "unpack: refused";
    const failed = { state: "failed", reason: "install_failed" };
    expect(parseDaemonsView({ ...VIEW, local: { ...failed, output } })?.local).toEqual({ ...failed, output });
    expect(parseDaemonsView({ ...VIEW, local: failed })?.local).toEqual(failed);
    for (const reason of ["download_failed", "checksum_mismatch"]) {
      expect(parseDaemonsView({ ...VIEW, local: { state: "failed", reason } })?.local).toEqual({ state: "failed", reason });
    }
  });

  it("keeps a failed remote update with its output, or without", () => {
    const output = "npm ERR! EACCES";
    const failed = { state: "failed", reason: "update_failed" };
    expect(parseDaemonsView({ ...VIEW, remote: { ...failed, output } })?.remote).toEqual({ ...failed, output });
    expect(parseDaemonsView({ ...VIEW, remote: failed })?.remote).toEqual(failed);
  });

  it("reads a non-string output as a bad state", () => {
    expect(parseDaemonsView({ ...VIEW, local: { state: "failed", reason: "install_failed", output: 3 } })).toBeNull();
    expect(parseDaemonsView({ ...VIEW, remote: { state: "failed", reason: "update_failed", output: 3 } })?.remote).toBeNull();
  });
});
