import { describe, expect, it } from "vitest";

import { findAccountByEntry, findItem, security } from "./macos-keychain.mjs";

/** An `exec` double: answers by the first argument of `security`. */
function fakeExec(answers) {
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, ...args]);
    const answer = answers[args[0]];
    if (answer instanceof Error) throw answer;
    return { stdout: answer ?? "" };
  };
  exec.calls = calls;
  return exec;
}

const failure = (code, stderr, extra = {}) => Object.assign(new Error(stderr), { code, stderr, stdout: "", ...extra });

describe("security", () => {
  it("answers a non-zero exit instead of throwing, and says when the call timed out", async () => {
    expect(await security(["x"], { exec: fakeExec({ x: failure(44, "not found") }) })).toMatchObject({ code: 44, timedOut: false });
    expect(await security(["x"], { exec: fakeExec({ x: failure(null, "", { killed: true, code: "ETIMEDOUT" }) }) })).toMatchObject({ code: null, timedOut: true });
  });
});

describe("findItem", () => {
  const ITEM = '    "acct"<blob>="s/id/password"\n    "mdat"<timedate>=0x00  "20261122130100Z\\000"\n    "svce"<blob>="com.avatsaev.pi-studio"\n';

  it("asks for the service and the account, never for the secret", async () => {
    const exec = fakeExec({ "find-generic-password": ITEM });
    const item = await findItem("s/id/password", { exec });
    expect(item).toMatchObject({ account: "s/id/password", modified: "20261122130100Z" });
    expect(exec.calls[0]).toEqual(["security", "find-generic-password", "-s", "com.avatsaev.pi-studio", "-a", "s/id/password"]);
    expect(exec.calls[0]).not.toContain("-w");
    expect(exec.calls[0]).not.toContain("-g");
  });

  it("is null for exit 44 (no such item)", async () => {
    expect(await findItem("a", { exec: fakeExec({ "find-generic-password": failure(44, "The specified item could not be found") }) })).toBeNull();
  });

  it("throws for a timeout, naming the prompt, and for any other exit", async () => {
    await expect(findItem("a", { exec: fakeExec({ "find-generic-password": failure(null, "", { killed: true }) }) })).rejects.toThrow("did not answer");
    await expect(findItem("a", { exec: fakeExec({ "find-generic-password": failure(36, "User interaction is not allowed.") }) })).rejects.toThrow("exited 36: User interaction is not allowed.");
  });
});

describe("findAccountByEntry", () => {
  const LISTING = 'keychain: "/x"\n    "acct"<blob>="other/1/password"\n    "acct"<blob>="abc/3f2b8a40-1111/password"\n';

  it("finds the account that names the entry, from attributes only", async () => {
    const exec = fakeExec({ "dump-keychain": LISTING });
    expect(await findAccountByEntry("3f2b8a40-1111", { exec })).toBe("abc/3f2b8a40-1111/password");
    expect(exec.calls[0]).toEqual(["security", "dump-keychain"]);
  });

  it("is null when no account names it or the listing failed", async () => {
    expect(await findAccountByEntry("zzz", { exec: fakeExec({ "dump-keychain": LISTING }) })).toBeNull();
    expect(await findAccountByEntry("zzz", { exec: fakeExec({ "dump-keychain": failure(1, "no") }) })).toBeNull();
  });
});
