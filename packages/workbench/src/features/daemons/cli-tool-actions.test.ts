import { describe, expect, it } from "vitest";
import { type HostDaemons } from "../../host/types.js";
import { createTestDaemons } from "../../test/test-daemons.js";
import { readCliTool, runCliTool } from "./cli-tool-actions.js";

describe("readCliTool", () => {
  it("answers the host's state", async () => {
    const daemons = createTestDaemons({ cliTool: { state: "shadowed", path: "/opt/pi-studio" } });
    expect(await readCliTool(daemons)).toEqual({ state: "shadowed", path: "/opt/pi-studio" });
  });

  it("is `unavailable` when the host cannot say", async () => {
    const daemons = createTestDaemons();
    const broken: HostDaemons = {
      ...daemons,
      cliTool: {
        ...daemons.cliTool,
        state: () => Promise.reject(new Error("no")),
      },
    };
    expect(await readCliTool(broken)).toEqual({ state: "unavailable" });
  });
});

describe("runCliTool", () => {
  it("installs and answers the state reached", async () => {
    const daemons = createTestDaemons({ cliTool: { state: "absent" } });
    expect(await runCliTool(daemons, "install")).toEqual({ state: { state: "installed" } });
    expect(daemons.cliToolInstalls).toEqual(["install"]);
    expect(await readCliTool(daemons)).toEqual({ state: "installed" });
  });

  it("answers the state after a different outcome (the folder is not on PATH)", async () => {
    const daemons = createTestDaemons({ cliToolInstall: { state: "not_on_path" } });
    expect(await runCliTool(daemons, "install")).toEqual({ state: { state: "not_on_path" } });
  });

  it("only looks for `state`, and installs nothing", async () => {
    const daemons = createTestDaemons({ cliTool: { state: "occupied" } });
    expect(await runCliTool(daemons, "state")).toEqual({ state: { state: "occupied" } });
    daemons.setCliToolState({ state: "absent" });
    expect(await runCliTool(daemons, "state")).toEqual({ state: { state: "absent" } });
    expect(daemons.cliToolInstalls).toEqual([]);
  });

  it("answers the host's words when the install refuses", async () => {
    const daemons = createTestDaemons({
      cliTool: { state: "occupied" },
      cliToolInstall: new Error("A file that Pi Studio did not make is at ~/.local/bin/pi-studio."),
    });
    expect(await runCliTool(daemons, "install")).toEqual({
      failure: "A file that Pi Studio did not make is at ~/.local/bin/pi-studio.",
    });
    expect(await readCliTool(daemons)).toEqual({ state: "occupied" });
  });

  it("has a plain sentence for a rejection with no words", async () => {
    const daemons = createTestDaemons({ cliToolInstall: new Error("") });
    expect(await runCliTool(daemons, "install")).toEqual({
      failure: "The command-line tool could not be set up.",
    });
  });
});
