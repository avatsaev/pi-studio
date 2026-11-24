import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTarGz, type TarFixtureEntry } from "../test-support/tar-fixture.js";
import { extractTarGz, UnsafeArchiveError } from "./tar-extract.js";

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "pi-studio-tar-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function extract(entries: readonly TarFixtureEntry[]): Promise<string> {
  const archive = join(work, "a.tar.gz");
  await writeFile(archive, buildTarGz(entries));
  const dest = join(work, "out");
  await extractTarGz(archive, dest);
  return dest;
}

describe("extractTarGz", () => {
  it("unpacks files, folders, modes and links inside the folder", async () => {
    const dest = await extract([
      { name: "top/", type: "dir" },
      { name: "top/pi-studio", content: "#!/bin/sh\n", mode: 0o755 },
      { name: "top/data/readme.txt", content: "hello" },
      { name: "top/bun", type: "symlink", linkname: "pi-studio" },
      { name: "top/data/up", type: "symlink", linkname: "../pi-studio" },
      { name: "top/copy", type: "hardlink", linkname: "top/data/readme.txt" },
    ]);
    expect(await readFile(join(dest, "top/data/readme.txt"), "utf8")).toBe("hello");
    expect((await stat(join(dest, "top/pi-studio"))).mode & 0o777).toBe(0o755);
    expect(await readlink(join(dest, "top/bun"))).toBe("pi-studio");
    expect(await readFile(join(dest, "top/copy"), "utf8")).toBe("hello");
  });

  it("drops setuid bits and keeps only permission bits", async () => {
    const dest = await extract([{ name: "x", content: "x", mode: 0o4755 }]);
    expect((await stat(join(dest, "x"))).mode & 0o7777).toBe(0o755);
  });

  it("reads GNU long names", async () => {
    const long = `${"d".repeat(60)}/${"f".repeat(80)}.txt`;
    const dest = await extract([{ name: long, content: "long", gnuLongName: true }]);
    expect(await readFile(join(dest, long), "utf8")).toBe("long");
  });

  it("unpacks what the system tar wrote (the build's archive layout)", async () => {
    const src = join(work, "src/pi-studio-1.0.0-linux-x64");
    await mkdir(join(src, "web"), { recursive: true });
    await writeFile(join(src, "pi-studio"), "bin", { mode: 0o755 });
    await writeFile(join(src, "web/index.html"), "<html>");
    await symlink("pi-studio", join(src, "alias"));
    const archive = join(work, "sys.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", join(work, "src"), "pi-studio-1.0.0-linux-x64"]);
    const dest = join(work, "sys-out");
    await extractTarGz(archive, dest);
    expect(await readFile(join(dest, "pi-studio-1.0.0-linux-x64/web/index.html"), "utf8")).toBe(
      "<html>",
    );
    expect(await readlink(join(dest, "pi-studio-1.0.0-linux-x64/alias"))).toBe("pi-studio");
  });

  describe("refuses", () => {
    const refused: Array<[string, TarFixtureEntry[]]> = [
      ["an absolute name", [{ name: "/etc/evil", content: "x" }]],
      ["a .. segment", [{ name: "a/../../evil", content: "x" }]],
      ["a leading ..", [{ name: "../evil", content: "x" }]],
      ["an absolute symbolic link", [{ name: "l", type: "symlink", linkname: "/etc" }]],
      ["a symbolic link out of the folder", [{ name: "l", type: "symlink", linkname: "../x" }]],
      [
        "a nested symbolic link out of the folder",
        [{ name: "a/b/l", type: "symlink", linkname: "../../../x" }],
      ],
      ["a hard link out of the folder", [{ name: "h", type: "hardlink", linkname: "../x" }]],
      ["a device", [{ name: "dev", type: "device" }]],
      [
        "an entry written through a symbolic link",
        [
          { name: "l", type: "symlink", linkname: "." },
          { name: "l/inside", content: "x" },
        ],
      ],
      [
        "a file replacing a symbolic link",
        [
          { name: "l", type: "symlink", linkname: "t" },
          { name: "l", content: "x" },
        ],
      ],
      [
        "a link chain that leaves the folder",
        [
          { name: "d/", type: "dir" },
          { name: "d/up", type: "symlink", linkname: ".." },
          { name: "d/a", type: "symlink", linkname: "up" },
          { name: "x", type: "symlink", linkname: "d/a/.." },
        ],
      ],
    ];
    it.each(refused)("%s", async (_name, entries) => {
      await expect(extract(entries)).rejects.toBeInstanceOf(UnsafeArchiveError);
      // Nothing was written outside the folder.
      await expect(lstat(join(work, "evil"))).rejects.toThrow();
      await expect(lstat(join(work, "x"))).rejects.toThrow();
    });
  });

  it("refuses an archive over the entry limit and a truncated one", async () => {
    const archive = join(work, "big.tar.gz");
    await writeFile(
      archive,
      buildTarGz([
        { name: "a", content: "1" },
        { name: "b", content: "2" },
      ]),
    );
    await expect(
      extractTarGz(archive, join(work, "o1"), { maxEntries: 1, maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(UnsafeArchiveError);
    await expect(
      extractTarGz(archive, join(work, "o2"), { maxEntries: 10, maxBytes: 1 }),
    ).rejects.toBeInstanceOf(UnsafeArchiveError);

    const full = buildTarGz([{ name: "a", content: "x".repeat(2000) }]);
    const cut = join(work, "cut.tar.gz");
    await writeFile(cut, full.subarray(0, full.length - 30));
    await expect(extractTarGz(cut, join(work, "o3"))).rejects.toThrow();
  });
});
