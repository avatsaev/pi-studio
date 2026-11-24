import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installedVersions,
  managedVersionOf,
  pruneVersions,
  resetTmpDir,
  switchCurrent,
  versionExecutable,
} from "./binary-layout.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-layout-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function install(version: string, executable = true): Promise<void> {
  await mkdir(join(home, "bin/versions", version), { recursive: true });
  const file = versionExecutable(home, version);
  await writeFile(file, "#!/bin/sh\n");
  await chmod(file, executable ? 0o755 : 0o644);
}

describe("switchCurrent", () => {
  it("creates current, then switches it by renaming a staged link over it", async () => {
    await install("0.0.1");
    await install("0.0.2");
    await switchCurrent(home, "0.0.1");
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.1"));
    await switchCurrent(home, "0.0.2");
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.2"));
    expect(await readdir(join(home, "bin"))).toEqual(["current", "versions"]);
    // The link resolves to the executable the helper starts.
    expect((await lstat(join(home, "bin/current/pi-studio"))).isFile()).toBe(true);
  });

  it("leaves current untouched when the version is missing or not executable", async () => {
    await install("0.0.1");
    await install("0.0.3", false);
    await switchCurrent(home, "0.0.1");
    await expect(switchCurrent(home, "0.0.2")).rejects.toThrow();
    await expect(switchCurrent(home, "0.0.3")).rejects.toThrow();
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.1"));
  });

  it("replaces a stale current.new", async () => {
    await install("0.0.1");
    await symlink("nowhere", join(home, "bin/current.new"));
    await switchCurrent(home, "0.0.1");
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.1"));
    expect(await readdir(join(home, "bin"))).not.toContain("current.new");
  });
});

describe("pruneVersions and installedVersions", () => {
  it("removes every version folder but the kept ones", async () => {
    for (const v of ["0.0.1", "0.0.2", "0.0.3", "0.0.4"]) await install(v);
    expect((await installedVersions(home)).toSorted()).toEqual([
      "0.0.1",
      "0.0.2",
      "0.0.3",
      "0.0.4",
    ]);
    expect((await pruneVersions(home, ["0.0.4", "0.0.3"])).toSorted()).toEqual(["0.0.1", "0.0.2"]);
    expect((await readdir(join(home, "bin/versions"))).toSorted()).toEqual(["0.0.3", "0.0.4"]);
  });

  it("is a no-op without a versions folder", async () => {
    expect(await installedVersions(home)).toEqual([]);
    expect(await pruneVersions(home, ["0.0.1"])).toEqual([]);
  });
});

describe("resetTmpDir", () => {
  it("returns an empty bin/tmp", async () => {
    await mkdir(join(home, "bin/tmp/old"), { recursive: true });
    await writeFile(join(home, "bin/tmp/old/partial"), "x");
    const dir = await resetTmpDir(home);
    expect(dir).toBe(join(home, "bin/tmp"));
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("managedVersionOf", () => {
  const versions = "/h/bin/versions";
  it("names the version of <versions>/<v>/pi-studio only", () => {
    expect(managedVersionOf(versions, "/h/bin/versions/0.0.130/pi-studio")).toBe("0.0.130");
    expect(managedVersionOf(versions, "/h/bin/versions/0.0.130/x")).toBeNull();
    expect(managedVersionOf(versions, "/h/bin/versions/0.0.130/a/pi-studio")).toBeNull();
    expect(managedVersionOf(versions, "/h/bin/versions/dev/pi-studio")).toBeNull();
    expect(managedVersionOf(versions, "/h/bin/pi-studio")).toBeNull();
    expect(managedVersionOf(versions, "/elsewhere/pi-studio")).toBeNull();
  });
});
