import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  binaryBlocker,
  canWriteGlobalFolder,
  detectInstallKind,
  updateBlocker,
  type BinaryBlockerSeams,
  type InstallKindFs,
} from "./install-kind.js";

function fakeFs(files: Record<string, string>): InstallKindFs {
  return {
    exists: (path) => path in files,
    readText: (path) => {
      if (!(path in files)) throw new Error("ENOENT");
      return files[path] as string;
    },
    realpath: (path) => path,
  };
}

const url = (path: string): string => pathToFileURL(path).href;
const noNpm = async (): Promise<string | null> => null;

describe("detectInstallKind", () => {
  it("lets PI_STUDIO_INSTALL_KIND win over everything", async () => {
    const root = "/usr/lib/node_modules";
    const self = `${root}/@av-pi-studio/server/dist/update/install-kind.js`;
    const kind = await detectInstallKind(
      { PI_STUDIO_INSTALL_KIND: "docker" },
      url(self),
      async () => root,
      fakeFs({}),
    );
    expect(kind).toBe("docker");
  });

  it("finds binary for the compiled binary without asking npm", async () => {
    const kind = await detectInstallKind(
      {},
      url("/$bunfs/root/pi-studio"),
      async () => {
        throw new Error("npm must not be asked");
      },
      fakeFs({}),
      true,
    );
    expect(kind).toBe("binary");
  });

  it("lets PI_STUDIO_INSTALL_KIND win over the binary", async () => {
    const kind = await detectInstallKind(
      { PI_STUDIO_INSTALL_KIND: "docker" },
      url("/$bunfs/root/pi-studio"),
      noNpm,
      fakeFs({}),
      true,
    );
    expect(kind).toBe("docker");
  });

  it("ignores an invalid env value and detects normally", async () => {
    const kind = await detectInstallKind(
      { PI_STUDIO_INSTALL_KIND: "bogus" },
      url("/tmp/x/dist/a.js"),
      noNpm,
      fakeFs({}),
    );
    expect(kind).toBe("unknown");
  });

  it("finds npm-global when the file is inside npm root -g", async () => {
    const root = "/usr/lib/node_modules";
    const self = `${root}/@av-pi-studio/server/dist/update/install-kind.js`;
    const kind = await detectInstallKind({}, url(self), async () => root, fakeFs({}));
    expect(kind).toBe("npm-global");
  });

  it("finds source for <root>/packages/server in a workspace root", async () => {
    const files = {
      "/repo/package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "/repo/packages/server/package.json": "{}",
    };
    const kind = await detectInstallKind(
      {},
      url("/repo/packages/server/dist/update/install-kind.js"),
      async () => "/usr/lib/node_modules",
      fakeFs(files),
    );
    expect(kind).toBe("source");
  });

  it("finds unknown for a project-local install or when npm is missing", async () => {
    const files = {
      "/proj/package.json": JSON.stringify({ workspaces: ["x"] }),
      "/proj/node_modules/@av-pi-studio/server/package.json": "{}",
    };
    const kind = await detectInstallKind(
      {},
      url("/proj/node_modules/@av-pi-studio/server/dist/update/install-kind.js"),
      noNpm,
      fakeFs(files),
    );
    expect(kind).toBe("unknown");
  });
});

describe("updateBlocker", () => {
  it("maps each non-updatable kind to its reason", () => {
    expect(updateBlocker("docker", "linux")).toBe("docker");
    expect(updateBlocker("source", "linux")).toBe("source");
    expect(updateBlocker("unknown", "linux")).toBe("unknown_install");
  });

  it("allows npm-global and binary except on Windows", () => {
    expect(updateBlocker("npm-global", "linux")).toBeNull();
    expect(updateBlocker("npm-global", "darwin")).toBeNull();
    expect(updateBlocker("npm-global", "win32")).toBe("unsupported_platform");
    expect(updateBlocker("binary", "linux")).toBeNull();
    expect(updateBlocker("binary", "darwin")).toBeNull();
    expect(updateBlocker("binary", "win32")).toBe("unsupported_platform");
  });
});

/** What `binaryBlocker` reads: symbolic links (path → target) and whether `bin` is writable. */
const seams = (links: Record<string, string> = {}, writable = true): BinaryBlockerSeams => ({
  realpath: (path) => links[path] ?? path,
  checkAccess: async () => {
    if (!writable) throw new Error("EACCES");
  },
});

describe("binaryBlocker", () => {
  const home = "/home/u/.pi-studio";

  it("is null for $PI_STUDIO_HOME/bin/versions/<v>/pi-studio with bin writable", async () => {
    const exec = `${home}/bin/versions/0.0.130/pi-studio`;
    expect(await binaryBlocker(exec, home, seams())).toBeNull();
  });

  it("resolves symbolic links on the executable and on the home", async () => {
    const exec = `${home}/bin/current/pi-studio`;
    expect(
      await binaryBlocker(exec, home, seams({ [exec]: `${home}/bin/versions/0.0.131/pi-studio` })),
    ).toBeNull();
    expect(
      await binaryBlocker(
        "/real/bin/versions/0.0.131/pi-studio",
        home,
        seams({ [`${home}/bin/versions`]: "/real/bin/versions" }),
      ),
    ).toBeNull();
  });

  it("is unmanaged_binary anywhere else", async () => {
    for (const exec of [
      "/usr/local/bin/pi-studio",
      `${home}/bin/pi-studio`,
      `${home}/bin/versions/latest/pi-studio`,
      `${home}/bin/versions/0.0.130/other`,
      `${home}/bin/versions/0.0.130/sub/pi-studio`,
      `${home}/bin/versions/../pi-studio`,
    ]) {
      expect(await binaryBlocker(exec, home, seams())).toBe("unmanaged_binary");
    }
  });

  it("is not_writable when bin cannot be written", async () => {
    const exec = `${home}/bin/versions/0.0.130/pi-studio`;
    expect(await binaryBlocker(exec, home, seams({}, false))).toBe("not_writable");
  });
});

describe("canWriteGlobalFolder", () => {
  it("is false without a folder and when access fails, true when it passes", async () => {
    expect(await canWriteGlobalFolder(null)).toBe(false);
    expect(
      await canWriteGlobalFolder("/g", async () => {
        throw new Error("EACCES");
      }),
    ).toBe(false);
    let probed = "";
    expect(
      await canWriteGlobalFolder("/g", async (path) => {
        probed = path;
      }),
    ).toBe(true);
    expect(probed).toBe("/g");
  });
});

describe("docker image", () => {
  it("daemon.Dockerfile sets PI_STUDIO_INSTALL_KIND=docker", () => {
    const dockerfile = readFileSync(
      resolve(import.meta.dirname, "../../../../docker/daemon.Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(/^ENV PI_STUDIO_INSTALL_KIND=docker$/m);
  });
});
