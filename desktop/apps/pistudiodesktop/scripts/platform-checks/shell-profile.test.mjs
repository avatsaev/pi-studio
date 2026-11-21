import { describe, expect, it } from "vitest";

import { defaultConfigSuffix } from "./macos.mjs";
import { cliWrapperText, displayVariables, dockEnvironment, profileText, SHELLS, shellQuote } from "./shell-profile.mjs";

describe("shellQuote", () => {
  it("single-quotes, and escapes a single quote", () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("profileText", () => {
  it("puts the bin directories first on PATH and sets PI_STUDIO_HOME", () => {
    const text = profileText({ binDirs: ["/s/bin", "/n/bin"], piHome: "/s/pi home" });
    expect(text).toContain(`export PATH='/s/bin:/n/bin':"$PATH"`);
    expect(text).toContain("export PI_STUDIO_HOME='/s/pi home'");
  });
});

describe("cliWrapperText", () => {
  it("runs the repository's CLI with node from PATH and a fixed host", () => {
    const text = cliWrapperText({ cliEntry: "/r/packages/cli/dist/cli.js", host: "127.0.0.1:5555" });
    expect(text).toBe(`#!/bin/sh\nexec node '/r/packages/cli/dist/cli.js' --host '127.0.0.1:5555' "$@"\n`);
  });
});

describe("dockEnvironment", () => {
  it("has the system PATH only, and none of the shell's or the CLI's variables", () => {
    const env = dockEnvironment({ home: "/h", shell: "bash", tmpdir: "/t", user: "u", extra: { FAKE: "1" } });
    expect(env).toEqual({ HOME: "/h", USER: "u", LOGNAME: "u", SHELL: SHELLS.bash.path, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: "/t", FAKE: "1" });
    expect(Object.keys(env).some((key) => key.startsWith("PI_STUDIO"))).toBe(false);
  });

  it("names a start-up file per shell", () => {
    expect(SHELLS.zsh.profile).toBe(".zprofile");
    expect(SHELLS.bash.profile).toBe(".bash_profile");
  });
});

describe("defaultConfigSuffix", () => {
  it("is the per-user directory of the app identifier", () => {
    expect(defaultConfigSuffix("darwin")).toBe("Library/Application Support/com.avatsaev.pi-studio");
    expect(defaultConfigSuffix("linux")).toBe(".config/com.avatsaev.pi-studio");
  });
});

describe("displayVariables", () => {
  it("passes on the display variables that are set, and nothing else", () => {
    expect(displayVariables({ DISPLAY: ":99", PATH: "/x", HOME: "/h" })).toEqual({ DISPLAY: ":99" });
    expect(displayVariables({ PATH: "/x" })).toEqual({});
  });
});
