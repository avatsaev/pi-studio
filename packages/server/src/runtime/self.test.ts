import { execFileSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { resolveBundledPiCli } from "../agent/providers/pi/rpc-transport.js";
import { resolveSkillsCli } from "../resources/skills-cli.js";
import { HELPER_SCRIPT, type HelperParams } from "../update/helper.js";
import {
  assetsDir,
  currentRuntime,
  daemonCommand,
  daemonStartScript,
  helperCommand,
  isBinary,
  piCommand,
  relayCommand,
  relayStartScript,
  skillsCommand,
  type SelfRuntime,
} from "./self.js";

const NODE: SelfRuntime = { isBinary: false, execPath: "/usr/bin/node" };
const BINARY: SelfRuntime = { isBinary: true, execPath: "/opt/pi-studio/pi-studio" };

const DAEMON = { host: "0.0.0.0", port: 6767, home: "/h" };
const RELAY = { host: "127.0.0.1", port: 6768, logDir: "/h/logs" };
const HELPER: HelperParams = {
  oldPid: 42,
  target: "2.0.0",
  previous: "1.0.0",
  listen: "127.0.0.1:6767",
  home: "/h",
  packageName: "@av-pi-studio/cli",
};

describe("the real runtime", () => {
  it("is Node when no build-time define is set", () => {
    expect(isBinary).toBe(false);
    expect(currentRuntime()).toEqual({ isBinary: false, execPath: process.execPath });
  });

  it("builds today's Node commands with no runtime argument", () => {
    expect(piCommand(["--mode", "rpc"])).toEqual([
      process.execPath,
      resolveBundledPiCli(),
      "--mode",
      "rpc",
    ]);
  });
});

describe("on Node (isBinary false) every command is the one built before the seam", () => {
  it("piCommand: [execPath, <Pi's bin>, …args]", () => {
    const cli = resolveBundledPiCli();
    expect(cli).toBeTruthy();
    expect(piCommand(["install", "npm:x"], NODE)).toEqual([NODE.execPath, cli, "install", "npm:x"]);
  });

  it("skillsCommand: [execPath, <skills bin>, …args]", () => {
    const cli = resolveSkillsCli();
    expect(cli).toBeTruthy();
    expect(skillsCommand(["update", "-g", "-y"], NODE)).toEqual([
      NODE.execPath,
      cli,
      "update",
      "-g",
      "-y",
    ]);
  });

  it("daemonCommand: [execPath, --input-type=module, -e, <script with the resolved URL>]", () => {
    const resolve = vi.fn(() => "file:///srv/server/dist/index.js");
    expect(daemonCommand(DAEMON, resolve, NODE)).toEqual([
      NODE.execPath,
      "--input-type=module",
      "-e",
      daemonStartScript("file:///srv/server/dist/index.js", DAEMON),
    ]);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("daemonCommand surfaces a resolver failure", () => {
    expect(() =>
      daemonCommand(
        DAEMON,
        () => {
          throw new Error("cannot resolve");
        },
        NODE,
      ),
    ).toThrow("cannot resolve");
  });

  it("relayCommand: [execPath, --input-type=module, -e, <script with the resolved URL>]", () => {
    expect(relayCommand(RELAY, () => "file:///srv/relay/dist/server.js", NODE)).toEqual([
      NODE.execPath,
      "--input-type=module",
      "-e",
      relayStartScript("file:///srv/relay/dist/server.js", RELAY),
    ]);
  });

  it("helperCommand: [execPath, -e, HELPER_SCRIPT, json]", () => {
    expect(helperCommand(HELPER, HELPER_SCRIPT, NODE)).toEqual([
      NODE.execPath,
      "-e",
      HELPER_SCRIPT,
      JSON.stringify(HELPER),
    ]);
  });

  it("assetsDir is only defined for the binary", () => {
    expect(() => assetsDir(NODE)).toThrow(/binary/);
  });
});

/** A module resolver the binary must never call. */
const unused = (): string => {
  throw new Error("the binary never resolves a module");
};

describe("in the binary (isBinary true) every command is [execPath, __<name>, …]", () => {
  it("piCommand → __pi", () => {
    expect(piCommand(["--mode", "rpc"], BINARY)).toEqual([
      BINARY.execPath,
      "__pi",
      "--mode",
      "rpc",
    ]);
  });

  it("skillsCommand → __skills", () => {
    expect(skillsCommand(["add", "src", "-g"], BINARY)).toEqual([
      BINARY.execPath,
      "__skills",
      "add",
      "src",
      "-g",
    ]);
  });

  it("daemonCommand → __daemon <json>", () => {
    const command = daemonCommand(DAEMON, unused, BINARY);
    expect(command.slice(0, 2)).toEqual([BINARY.execPath, "__daemon"]);
    expect(command).toHaveLength(3);
    expect(JSON.parse(command[2] as string)).toEqual(DAEMON);
  });

  it("relayCommand → __relay <json>", () => {
    const command = relayCommand(RELAY, unused, BINARY);
    expect(command.slice(0, 2)).toEqual([BINARY.execPath, "__relay"]);
    expect(command).toHaveLength(3);
    expect(JSON.parse(command[2] as string)).toEqual(RELAY);
  });

  it("helperCommand → __update-helper <json>, without the Node script", () => {
    expect(helperCommand(HELPER, HELPER_SCRIPT, BINARY)).toEqual([
      BINARY.execPath,
      "__update-helper",
      JSON.stringify(HELPER),
    ]);
  });

  it("assetsDir is the binary's folder", () => {
    expect(assetsDir(BINARY)).toBe("/opt/pi-studio");
  });
});

describe("daemonStartScript", () => {
  it("calls runDaemon (the process entry), never startDaemon", () => {
    const script = daemonStartScript("file:///srv/server/dist/index.js", DAEMON);
    expect(script).toContain("m.runDaemon(");
    expect(script).not.toContain("startDaemon");
    expect(script).toContain(JSON.stringify("file:///srv/server/dist/index.js"));
  });

  it("run as `node -e` against a stub server module, hands runDaemon the host, port and home", () => {
    const stub = `data:text/javascript,${encodeURIComponent(
      "export const runDaemon = (o) => console.log(JSON.stringify(o));",
    )}`;
    const script = daemonStartScript(stub, { host: "127.0.0.1", port: 7001, home: "/tmp/h" });
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(out)).toEqual({ host: "127.0.0.1", port: 7001, home: "/tmp/h" });
  });
});

describe("relayStartScript", () => {
  it("run as `node -e` against a stub relay module, hands startRelayServer the host, port and a logger", () => {
    const stub = `data:text/javascript,${encodeURIComponent(
      "export const createRelayLogger = (o) => ({ dir: o.logDir });" +
        "export const startRelayServer = (o) => console.log(JSON.stringify(o));",
    )}`;
    const script = relayStartScript(stub, RELAY);
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
    expect(JSON.parse(out)).toEqual({ host: "127.0.0.1", port: 6768, logger: { dir: "/h/logs" } });
  });
});
