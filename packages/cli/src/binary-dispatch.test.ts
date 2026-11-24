import { describe, expect, it } from "vitest";

import { daemonCommand, relayCommand } from "@av-pi-studio/server";

import { parseBinaryCommand, parseDaemonOpts, parseRelayOpts } from "./binary-dispatch.js";

const binary = { isBinary: true, execPath: "/opt/pi-studio" } as const;
const never = (): string => {
  throw new Error("the binary never resolves a module URL");
};

describe("parseBinaryCommand", () => {
  it("reads back what the runtime seam emits for the daemon and the relay", () => {
    const daemon = { host: "127.0.0.1", port: 6767, home: "/h" };
    const [, ...daemonArgs] = daemonCommand(daemon, never, binary);
    expect(parseBinaryCommand(daemonArgs)).toEqual({ kind: "daemon", opts: daemon });

    const relay = { host: "0.0.0.0", port: 7000, logDir: "/h/logs" };
    const [, ...relayArgs] = relayCommand(relay, never, binary);
    expect(parseBinaryCommand(relayArgs)).toEqual({ kind: "relay", opts: relay });
  });

  it("passes everything after __pi and __skills through verbatim", () => {
    expect(parseBinaryCommand(["__pi", "--mode", "rpc", "--version"])).toEqual({
      kind: "pi",
      args: ["--mode", "rpc", "--version"],
    });
    expect(parseBinaryCommand(["__skills", "--help"])).toEqual({
      kind: "skills",
      args: ["--help"],
    });
  });

  it("keeps the JSON of the update helper as given", () => {
    expect(parseBinaryCommand(["__update-helper", '{"a":1}'])).toEqual({
      kind: "update-helper",
      json: '{"a":1}',
    });
    expect(() => parseBinaryCommand(["__update-helper"])).toThrow(/missing JSON/);
  });

  it("treats anything else as the CLI's own command line, including none", () => {
    expect(parseBinaryCommand(["--json", "daemon", "start"])).toEqual({
      kind: "cli",
      args: ["--json", "daemon", "start"],
    });
    expect(parseBinaryCommand([])).toEqual({ kind: "cli", args: [] });
  });
});

describe("parseDaemonOpts", () => {
  it("accepts a missing host and rejects bad fields", () => {
    expect(parseDaemonOpts('{"port":6767,"home":"/h"}')).toEqual({
      host: undefined,
      port: 6767,
      home: "/h",
    });
    expect(() => parseDaemonOpts(undefined)).toThrow(/missing JSON/);
    expect(() => parseDaemonOpts("{")).toThrow(/not valid JSON/);
    expect(() => parseDaemonOpts("[]")).toThrow(/JSON object/);
    expect(() => parseDaemonOpts('{"port":0,"home":"/h"}')).toThrow(/port/);
    expect(() => parseDaemonOpts('{"port":"6767","home":"/h"}')).toThrow(/port/);
    expect(() => parseDaemonOpts('{"host":1,"port":6767,"home":"/h"}')).toThrow(/host/);
    expect(() => parseDaemonOpts('{"port":6767}')).toThrow(/home/);
  });
});

describe("parseRelayOpts", () => {
  it("requires host, port and logDir", () => {
    expect(parseRelayOpts('{"host":"h","port":7000,"logDir":"/l"}')).toEqual({
      host: "h",
      port: 7000,
      logDir: "/l",
    });
    expect(() => parseRelayOpts('{"port":7000,"logDir":"/l"}')).toThrow(/host/);
    expect(() => parseRelayOpts('{"host":"h","port":7000}')).toThrow(/logDir/);
  });
});
