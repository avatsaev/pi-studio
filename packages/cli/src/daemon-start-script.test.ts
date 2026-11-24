import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { daemonStartScript } from "./daemon-control.js";

describe("daemonStartScript", () => {
  it("calls runDaemon (the process entry), never startDaemon", () => {
    const script = daemonStartScript("file:///srv/server/dist/index.js", {
      host: "0.0.0.0",
      port: 6767,
      home: "/h",
    });
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
