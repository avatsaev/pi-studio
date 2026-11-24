import { describe, expect, it } from "vitest";
import { type CliToolState } from "../../host/types.js";
import {
  CLI_TOOL_CHECK_LABEL,
  CLI_TOOL_INSTALL_LABEL,
  CLI_TOOL_PATH_LINE,
  cliToolFailureText,
  cliToolView,
} from "./cli-tool-presentation.js";

describe("cliToolView", () => {
  it("draws nothing before the first answer and when there is nothing to offer", () => {
    expect(cliToolView(null)).toBeNull();
    expect(cliToolView({ state: "unavailable" })).toBeNull();
  });

  it("offers the install when nothing is at the link", () => {
    const view = cliToolView({ state: "absent" });
    expect(view?.tone).toBe("plain");
    expect(view?.action).toEqual({ label: CLI_TOOL_INSTALL_LABEL, call: "install" });
    expect(CLI_TOOL_INSTALL_LABEL).toBe("Install the command-line tool");
    expect(view?.command).toBeUndefined();
    expect(view?.text).toContain("~/.local/bin/pi-studio");
  });

  it("confirms an installed tool and offers Check again, to see a later change of PATH", () => {
    const view = cliToolView({ state: "installed" });
    expect(view?.tone).toBe("ok");
    expect(view?.text).toContain("installed");
    expect(view?.action).toEqual({ label: CLI_TOOL_CHECK_LABEL, call: "install" });
    expect(view?.command).toBeUndefined();
  });

  it("gives the line to add to the start-up file when the folder is not on PATH", () => {
    const view = cliToolView({ state: "not_on_path" });
    expect(view?.tone).toBe("warn");
    expect(view?.command).toBe('export PATH="$HOME/.local/bin:$PATH"');
    expect(view?.command).toBe(CLI_TOOL_PATH_LINE);
    expect(view?.text).toContain("~/.local/bin is not on your PATH");
    expect(view?.text).toContain("start-up file");
    // The app edits no file: the only action reads the login shell again.
    expect(view?.action).toEqual({ label: CLI_TOOL_CHECK_LABEL, call: "install" });
  });

  it("names the other pi-studio that comes first", () => {
    const view = cliToolView({ state: "shadowed", path: "/usr/local/bin/pi-studio" });
    expect(view?.tone).toBe("warn");
    expect(view?.text).toContain("/usr/local/bin/pi-studio");
    expect(view?.command).toBeUndefined();
    expect(view?.action).toEqual({ label: CLI_TOOL_CHECK_LABEL, call: "install" });
  });

  it("says a file is in the way and that it is never replaced, and only looks again", () => {
    const view = cliToolView({ state: "occupied" });
    expect(view?.tone).toBe("warn");
    expect(view?.text).toContain("A file that Pi Studio did not make is at ~/.local/bin/pi-studio");
    expect(view?.text).toContain("never replaces");
    // The install refuses over what is not the app's: the button only looks.
    expect(view?.action).toEqual({ label: CLI_TOOL_CHECK_LABEL, call: "state" });
  });

  it("has an install button for `absent` only, and Check again for every state that has a link or a file", () => {
    const states: CliToolState[] = [
      { state: "absent" },
      { state: "installed" },
      { state: "not_on_path" },
      { state: "shadowed", path: "/opt/bin/pi-studio" },
      { state: "occupied" },
      { state: "unavailable" },
    ];
    const labels = states.map((state) => cliToolView(state)?.action?.label ?? null);
    expect(labels).toEqual([
      CLI_TOOL_INSTALL_LABEL,
      CLI_TOOL_CHECK_LABEL,
      CLI_TOOL_CHECK_LABEL,
      CLI_TOOL_CHECK_LABEL,
      CLI_TOOL_CHECK_LABEL,
      null,
    ]);
  });
});

describe("cliToolFailureText", () => {
  it("shows the host's words, else a plain sentence", () => {
    expect(cliToolFailureText(new Error("A file is in the way."))).toBe("A file is in the way.");
    expect(cliToolFailureText(new Error("  "))).toBe("The command-line tool could not be set up.");
    expect(cliToolFailureText("x")).toBe("The command-line tool could not be set up.");
    expect(cliToolFailureText(undefined)).toBe("The command-line tool could not be set up.");
  });
});
