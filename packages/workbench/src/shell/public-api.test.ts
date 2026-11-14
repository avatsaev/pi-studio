import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as api from "../index.js";

const REGIONS = [
  "ConnectionBar",
  "SessionList",
  "PaneArea",
  "RightSidebar",
  "StatusBar",
  "OpenWorkspaceDialog",
  "WorkbenchBoot",
] as const;

const HOOKS = ["useConnection", "useShellLayout", "useSettingsDialog"] as const;

describe("public API", () => {
  it("exports exactly the documented values", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "Workbench",
        "WorkbenchProvider",
        "WorkspaceShell",
        "SettingsDialog",
        "createBrowserHost",
        ...REGIONS,
        ...HOOKS,
      ].sort(),
    );
  });

  it.each(REGIONS)("%s outside WorkbenchProvider throws an error naming the provider", (name) => {
    const component = api[name] as () => null;
    expect(() => renderToString(createElement(component))).toThrow(
      `${name} must be rendered inside <WorkbenchProvider>`,
    );
  });

  it.each(HOOKS)("%s outside WorkbenchProvider throws an error naming the provider", (name) => {
    const hook = api[name] as () => unknown;
    function Probe() {
      hook();
      return null;
    }
    expect(() => renderToString(createElement(Probe))).toThrow(
      `${name} must be rendered inside <WorkbenchProvider>`,
    );
  });
});
