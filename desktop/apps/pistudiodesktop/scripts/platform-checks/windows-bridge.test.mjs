import { describe, expect, it } from "vitest";

import { credentialTargets, deleteCredentials } from "./windows-bridge.mjs";

const LIST = `
Currently stored credentials:

    Target: LegacyGeneric:target=0123456789abcdef/3f2b8a40-1111-4222-8333-444455557777/password.com.avatsaev.pi-studio
    Type: Generic
    User: x
`;

describe("credentialTargets", () => {
  it("runs cmdkey /list and returns the targets that name the entry", async () => {
    const calls = [];
    const exec = async (command, args) => {
      calls.push([command, ...args]);
      return { stdout: LIST };
    };
    expect(await credentialTargets("3F2B8A40-1111-4222-8333-444455557777", { exec })).toEqual([
      "LegacyGeneric:target=0123456789abcdef/3f2b8a40-1111-4222-8333-444455557777/password.com.avatsaev.pi-studio",
    ]);
    expect(calls).toEqual([["cmdkey", "/list"]]);
    expect(await credentialTargets("ffffffff", { exec })).toEqual([]);
  });
});

describe("deleteCredentials", () => {
  it("deletes by the whole target and by the bare name, and ignores a delete that fails", async () => {
    const calls = [];
    const exec = async (_command, args) => {
      calls.push(args[0]);
      if (args[0].startsWith("/delete:LegacyGeneric")) throw new Error("not found");
      return { stdout: "" };
    };
    await deleteCredentials(["LegacyGeneric:target=abc/password"], { exec });
    expect(calls).toEqual(["/delete:LegacyGeneric:target=abc/password", "/delete:abc/password"]);
  });

  it("does nothing for no target", async () => {
    let called = false;
    await deleteCredentials([], {
      exec: async () => {
        called = true;
        return { stdout: "" };
      },
    });
    expect(called).toBe(false);
  });
});
