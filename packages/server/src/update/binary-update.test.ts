import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { persistedConfigSchema } from "../config/daemon-config.js";
import { startHttpFixture, type HttpFixture } from "../test-support/http-fixture.js";
import { buildTarGz, type TarFixtureEntry } from "../test-support/tar-fixture.js";
import { DAEMON_UPDATE_URL, DAEMON_UPDATE_URL_ENV, daemonUpdateUrl } from "./binary-manifest.js";
import {
  createBinaryUpdate,
  installBinaryRelease,
  lookupBinaryRelease,
  redirectSpawn,
} from "./binary-update.js";
import type { HelperSpawn } from "./helper.js";

let home: string;
let server: HttpFixture | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-binary-update-"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(home, { recursive: true, force: true });
});

function stub(version: string): TarFixtureEntry[] {
  return [
    { name: "pi-studio-x/", type: "dir" },
    { name: "pi-studio-x/pi-studio", content: `#!/bin/sh\necho ${version}\n`, mode: 0o755 },
    { name: "pi-studio-x/web/index.html", content: "<html>" },
  ];
}

interface Release {
  /** What `latest.json` says. */
  version: string;
  archive: Buffer;
  /** Overrides the manifest's checksum / size. */
  sha256?: string;
  size?: number;
  /** `latest.json` text instead of the generated one. */
  manifestText?: string;
  /** Targets in `assets` (default: this system's). */
  targets?: string[];
  /** Archive handler (default: the bytes). */
  archiveHandler?: (res: ServerResponse) => void;
}

async function serve(release: Release): Promise<NodeJS.ProcessEnv> {
  server = await startHttpFixture((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/latest.json") {
      const asset = {
        url: `${server?.origin}/archive.tar.gz`,
        sha256: release.sha256 ?? createHash("sha256").update(release.archive).digest("hex"),
        size: release.size ?? release.archive.length,
      };
      res.setHeader("content-type", "application/json");
      res.end(
        release.manifestText ??
          JSON.stringify({
            version: release.version,
            pub_date: "2026-11-24T00:00:00Z",
            assets: Object.fromEntries((release.targets ?? ["linux-x64"]).map((t) => [t, asset])),
          }),
      );
    } else if (req.url === "/archive.tar.gz") {
      if (release.archiveHandler) release.archiveHandler(res);
      else res.end(release.archive);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  return { [DAEMON_UPDATE_URL_ENV]: `${server.origin}/latest.json` };
}

const SYSTEM = { platform: "linux", arch: "x64" } as const;

describe("daemonUpdateUrl", () => {
  it("is the release's latest.json unless the test override is set", () => {
    expect(daemonUpdateUrl({})).toBe(DAEMON_UPDATE_URL);
    expect(daemonUpdateUrl({ [DAEMON_UPDATE_URL_ENV]: " " })).toBe(DAEMON_UPDATE_URL);
    expect(daemonUpdateUrl({ [DAEMON_UPDATE_URL_ENV]: "http://localhost:1/x.json" })).toBe(
      "http://localhost:1/x.json",
    );
    expect(DAEMON_UPDATE_URL).toBe(
      "https://github.com/avatsaev/pi-studio/releases/download/daemon-updates/latest.json",
    );
  });
});

describe("lookupBinaryRelease", () => {
  it("reads the newest version and this system's archive", async () => {
    const env = await serve({ version: "0.0.131", archive: buildTarGz(stub("0.0.131")) });
    const found = await lookupBinaryRelease({ env, ...SYSTEM });
    expect(found).toMatchObject({ kind: "ok", version: "0.0.131" });
    expect(found.kind === "ok" && found.asset?.url).toBe(`${server?.origin}/archive.tar.gz`);
  });

  it("has no archive for a system the manifest does not list", async () => {
    const env = await serve({
      version: "0.0.131",
      archive: Buffer.from("x"),
      targets: ["darwin-arm64"],
    });
    expect(await lookupBinaryRelease({ env, ...SYSTEM })).toMatchObject({
      kind: "ok",
      version: "0.0.131",
      asset: null,
    });
    expect(await lookupBinaryRelease({ env, platform: "win32", arch: "x64" })).toMatchObject({
      kind: "ok",
      asset: null,
    });
    expect(await lookupBinaryRelease({ env, platform: "linux", arch: "ia32" })).toMatchObject({
      kind: "ok",
      asset: null,
    });
  });

  it.each([
    ["not JSON", "<html>"],
    ["no version", JSON.stringify({ assets: {} })],
    ["a version that is not x.y.z", JSON.stringify({ version: "latest", assets: {} })],
    ["no assets", JSON.stringify({ version: "0.0.131" })],
  ])("is bad_answer for a manifest with %s", async (_name, manifestText) => {
    const env = await serve({ version: "0.0.131", archive: Buffer.from("x"), manifestText });
    expect(await lookupBinaryRelease({ env, ...SYSTEM })).toEqual({ kind: "bad_answer" });
  });

  it("is offline for an unreachable server and for a non-2xx answer", async () => {
    const env = await serve({ version: "0.0.131", archive: Buffer.from("x") });
    const missing = { [DAEMON_UPDATE_URL_ENV]: `${server?.origin}/nope.json` };
    expect(await lookupBinaryRelease({ env: missing, ...SYSTEM })).toEqual({ kind: "offline" });
    await server?.close();
    expect(await lookupBinaryRelease({ env, ...SYSTEM })).toEqual({ kind: "offline" });
    server = undefined;
  });

  it("treats a malformed asset entry as no archive", async () => {
    const env = await serve({
      version: "0.0.131",
      archive: Buffer.from("x"),
      manifestText: JSON.stringify({
        version: "0.0.131",
        assets: { "linux-x64": { url: "ftp://x/y", sha256: "zz", size: 1 } },
      }),
    });
    expect(await lookupBinaryRelease({ env, ...SYSTEM })).toMatchObject({ asset: null });
  });
});

/** `bin/versions/0.0.130` installed and `bin/current` pointing at it. */
async function installedCurrent(): Promise<void> {
  await mkdir(join(home, "bin/versions/0.0.130"), { recursive: true });
  await writeFile(join(home, "bin/versions/0.0.130/pi-studio"), "#!/bin/sh\necho 0.0.130\n", {
    mode: 0o755,
  });
  await symlink(join("versions", "0.0.130"), join(home, "bin/current"));
}

async function expectUntouched(): Promise<void> {
  expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.130"));
  expect(await readdir(join(home, "bin/versions"))).toEqual(["0.0.130"]);
}

describe("installBinaryRelease", () => {
  it("installs into bin/versions/<version>, leaves current alone and empties bin/tmp", async () => {
    await installedCurrent();
    const env = await serve({ version: "0.0.131", archive: buildTarGz(stub("0.0.131")) });
    const executable = await installBinaryRelease("0.0.131", { home, env, ...SYSTEM });
    expect(executable).toBe(join(home, "bin/versions/0.0.131/pi-studio"));
    expect(await readdir(join(home, "bin/versions"))).toEqual(["0.0.130", "0.0.131"]);
    expect((await lstat(join(home, "bin/versions/0.0.131/web/index.html"))).isFile()).toBe(true);
    expect(await readlink(join(home, "bin/current"))).toBe(join("versions", "0.0.130"));
    expect(await readdir(join(home, "bin")).then((names) => names.includes("tmp"))).toBe(false);
  });

  it("accepts an archive whose binary is at its top level", async () => {
    const env = await serve({
      version: "0.0.131",
      archive: buildTarGz([
        { name: "pi-studio", content: "#!/bin/sh\necho 0.0.131\n", mode: 0o755 },
      ]),
    });
    await installBinaryRelease("0.0.131", { home, env, ...SYSTEM });
    expect((await lstat(join(home, "bin/versions/0.0.131/pi-studio"))).isFile()).toBe(true);
  });

  const failures: Array<[string, Release, RegExp]> = [
    [
      "a checksum that does not match",
      { version: "0.0.131", archive: buildTarGz(stub("0.0.131")), sha256: "0".repeat(64) },
      /checksum mismatch/,
    ],
    [
      "an entry outside the folder",
      {
        version: "0.0.131",
        archive: buildTarGz([...stub("0.0.131"), { name: "../evil", content: "x" }]),
      },
      /unsafe archive/,
    ],
    [
      "a symbolic link out of the folder",
      {
        version: "0.0.131",
        archive: buildTarGz([
          ...stub("0.0.131"),
          { name: "pi-studio-x/l", type: "symlink", linkname: "../../../../etc" },
        ]),
      },
      /unsafe archive/,
    ],
    [
      "a binary that reports another version",
      { version: "0.0.131", archive: buildTarGz(stub("0.0.999")) },
      /reports version "0.0.999", expected 0.0.131/,
    ],
    [
      "a binary that does not run",
      {
        version: "0.0.131",
        archive: buildTarGz([{ name: "pi-studio", content: "#!/bin/sh\nexit 3\n", mode: 0o755 }]),
      },
      /does not run/,
    ],
    [
      "an archive without the binary",
      { version: "0.0.131", archive: buildTarGz([{ name: "readme", content: "x" }]) },
      /holds no pi-studio/,
    ],
    [
      "a size that differs from the manifest",
      { version: "0.0.131", archive: buildTarGz(stub("0.0.131")), size: 7 },
      /download failed/,
    ],
    [
      "an archive that is not gzip",
      { version: "0.0.131", archive: Buffer.from("not a tarball at all") },
      /./,
    ],
  ];
  it.each(failures)(
    "fails on %s and leaves current and the versions untouched",
    async (_n, release, message) => {
      await installedCurrent();
      const env = await serve(release);
      await expect(installBinaryRelease("0.0.131", { home, env, ...SYSTEM })).rejects.toThrow(
        message,
      );
      await expectUntouched();
      expect(await readdir(join(home, "bin")).then((names) => names.includes("tmp"))).toBe(false);
    },
  );

  it("fails on an HTTP error and on a download that stalls", async () => {
    await installedCurrent();
    const env = await serve({
      version: "0.0.131",
      archive: Buffer.from("x"),
      archiveHandler: (res) => {
        res.statusCode = 503;
        res.end();
      },
    });
    await expect(installBinaryRelease("0.0.131", { home, env, ...SYSTEM })).rejects.toThrow(
      /HTTP 503/,
    );
    await server?.close();

    const stalled = await serve({
      version: "0.0.131",
      archive: Buffer.alloc(10),
      archiveHandler: (res) => {
        res.writeHead(200, { "content-length": "10" });
        res.write("12345");
      },
    });
    await expect(
      installBinaryRelease("0.0.131", { home, env: stalled, ...SYSTEM, stallMs: 150 }),
    ).rejects.toThrow(/timed out after/);
    await expectUntouched();
  });

  it("fails when latest.json moved to another version or has no archive for this system", async () => {
    await installedCurrent();
    const moved = await serve({ version: "0.0.132", archive: buildTarGz(stub("0.0.132")) });
    await expect(installBinaryRelease("0.0.131", { home, env: moved, ...SYSTEM })).rejects.toThrow(
      /now names 0.0.132/,
    );
    await server?.close();
    const none = await serve({
      version: "0.0.131",
      archive: Buffer.from("x"),
      targets: ["darwin-arm64"],
    });
    await expect(installBinaryRelease("0.0.131", { home, env: none, ...SYSTEM })).rejects.toThrow(
      /no archive for this system/,
    );
    await expectUntouched();
  });

  it("replaces a broken folder of the same version", async () => {
    await mkdir(join(home, "bin/versions/0.0.131"), { recursive: true });
    await writeFile(join(home, "bin/versions/0.0.131/junk"), "x");
    const env = await serve({ version: "0.0.131", archive: buildTarGz(stub("0.0.131")) });
    await installBinaryRelease("0.0.131", { home, env, ...SYSTEM });
    expect(await readdir(join(home, "bin/versions/0.0.131"))).not.toContain("junk");
  });
});

describe("createBinaryUpdate", () => {
  const execPath = () => join(home, "bin/versions/0.0.130/pi-studio");

  it("probes: the manifest, and the can-update rule on this executable", async () => {
    await installedCurrent();
    const env = await serve({ version: "0.0.131", archive: buildTarGz(stub("0.0.131")) });
    const update = createBinaryUpdate({
      home,
      env,
      ...SYSTEM,
      execPath: execPath(),
      listen: () => "",
    });
    expect(await update.probes.lookup()).toEqual({
      kind: "ok",
      version: "0.0.131",
      hasAsset: true,
    });
    expect(await update.probes.blocker()).toBeNull();
    const elsewhere = createBinaryUpdate({
      home,
      env,
      ...SYSTEM,
      execPath: "/usr/bin/x",
      listen: () => "",
    });
    expect(await elsewhere.probes.blocker()).toBe("unmanaged_binary");
  });

  it("spawns the helper from the NEW binary with the carried listen address and home", async () => {
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> =
      [];
    const helperSpawn: HelperSpawn = (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return { pid: 42, unref: () => undefined, on: () => ({}) as never };
    };
    const update = createBinaryUpdate({
      home,
      env: { PI_STUDIO_PASSWORD: "x" },
      execPath: execPath(),
      listen: () => "127.0.0.1:6767",
      helperSpawn,
    });
    update.spawnHelper("0.0.131", "0.0.130");
    const [call] = calls;
    expect(call?.command).toBe(join(home, "bin/versions/0.0.131/pi-studio"));
    expect(call?.args[0]).toBe("__update-helper");
    expect(JSON.parse(call?.args[1] ?? "{}")).toMatchObject({
      oldPid: process.pid,
      target: "0.0.131",
      previous: "0.0.130",
      listen: "127.0.0.1:6767",
      home,
    });
    expect(call?.env).toMatchObject({
      PI_STUDIO_LISTEN: "127.0.0.1:6767",
      PI_STUDIO_HOME: home,
      PI_STUDIO_PASSWORD: "x",
    });
  });

  it("refuses the extensions step before an install", () => {
    const update = createBinaryUpdate({ home, ...SYSTEM, listen: () => "" });
    expect(() => update.updateExtensions({ config: persistedConfigSchema.parse({}) })).toThrow(
      /no new binary/,
    );
  });
});

describe("redirectSpawn", () => {
  it("runs the new executable where the command names the running one", async () => {
    const seen: string[][] = [];
    const spawn = redirectSpawn(async (request) => {
      seen.push(request.command);
      return { exitCode: 0, stderr: "" };
    }, "/new/pi-studio");
    await spawn({
      command: ["/old/pi-studio", "__pi", "update", "--extensions"],
      env: {},
      timeoutMs: 1,
    });
    expect(seen).toEqual([["/new/pi-studio", "__pi", "update", "--extensions"]]);
  });
});
