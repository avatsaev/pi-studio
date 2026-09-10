import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ViewerSettings } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";
import {
  applyViewerSettingsPatch,
  loadViewerSettings,
  saveViewerSettings,
  viewerSettingsPath,
} from "./viewer-settings-state.js";

function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-viewer-settings-state-"));
}

function noop(): undefined {
  return undefined;
}

function fakeLogger(): Logger & { warnCalls: unknown[][] } {
  const warnCalls: unknown[][] = [];
  return {
    warnCalls,
    trace: noop,
    debug: noop,
    info: noop,
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
    error: noop,
    fatal: noop,
    child: () => fakeLogger(),
  } as unknown as Logger & { warnCalls: unknown[][] };
}

const SAMPLE: ViewerSettings = {
  version: 1,
  viewers: {
    molviewer: { enabled: false, config: { autoRotate: true } },
  },
};

describe("viewerSettingsPath", () => {
  it("is <home>/viewer-settings.json", () => {
    expect(viewerSettingsPath("/x")).toBe(join("/x", "viewer-settings.json"));
  });
});

describe("loadViewerSettings / saveViewerSettings round-trip", () => {
  it("round-trips a full document deep-equal", async () => {
    const dir = await tempHome();
    await saveViewerSettings(dir, SAMPLE);
    expect(await loadViewerSettings(dir)).toEqual(SAMPLE);
  });

  it("writes atomically — no temp file left behind on success", async () => {
    const dir = await tempHome();
    await saveViewerSettings(dir, SAMPLE);
    const entries = await readdir(dir);
    expect(entries).toEqual(["viewer-settings.json"]);
  });

  it("a document with unknown extra fields survives the round trip (.passthrough())", async () => {
    const dir = await tempHome();
    const withExtra = {
      ...SAMPLE,
      futureTopLevelField: "from-a-newer-daemon",
      viewers: { molviewer: { ...SAMPLE.viewers["molviewer"], futureField: 42 } },
    };
    await writeFile(viewerSettingsPath(dir), JSON.stringify(withExtra), "utf8");
    const loaded = await loadViewerSettings(dir);
    expect((loaded as typeof withExtra).futureTopLevelField).toBe("from-a-newer-daemon");
    expect((loaded as typeof withExtra).viewers["molviewer"]?.futureField).toBe(42);
  });

  it("absent file yields all-enabled defaults and logs no warning", async () => {
    const dir = await tempHome();
    const logger = fakeLogger();
    expect(await loadViewerSettings(dir, logger)).toEqual({ version: 1, viewers: {} });
    expect(logger.warnCalls).toHaveLength(0);
  });

  it("a viewer id this daemon has never heard of is a valid row, not an error", async () => {
    const dir = await tempHome();
    await saveViewerSettings(dir, {
      version: 1,
      viewers: { "totally-unknown-viewer": { enabled: true } },
    });
    expect(await loadViewerSettings(dir)).toEqual({
      version: 1,
      viewers: { "totally-unknown-viewer": { enabled: true } },
    });
  });

  it("corrupt JSON degrades to all-enabled defaults, logs a warning, and leaves the file untouched", async () => {
    const dir = await tempHome();
    const path = viewerSettingsPath(dir);
    await writeFile(path, "{not valid json", "utf8");
    const logger = fakeLogger();
    expect(await loadViewerSettings(dir, logger)).toEqual({ version: 1, viewers: {} });
    expect(logger.warnCalls.length).toBeGreaterThan(0);
    expect(await readFile(path, "utf8")).toBe("{not valid json");
  });

  it("a schema-mismatched document degrades to all-enabled defaults and logs a warning", async () => {
    const dir = await tempHome();
    const path = viewerSettingsPath(dir);
    await writeFile(path, JSON.stringify({ version: 1, viewers: "not-an-object" }), "utf8");
    const logger = fakeLogger();
    expect(await loadViewerSettings(dir, logger)).toEqual({ version: 1, viewers: {} });
    expect(logger.warnCalls.length).toBeGreaterThan(0);
  });
});

describe("applyViewerSettingsPatch", () => {
  it("creates a new row, defaulting enabled to true when the patch omits it", () => {
    const result = applyViewerSettingsPatch(
      { version: 1, viewers: {} },
      { molviewer: { config: { autoRotate: true } } },
    );
    expect(result.viewers["molviewer"]).toEqual({ enabled: true, config: { autoRotate: true } });
  });

  it("a config-only patch preserves the row's existing enabled", () => {
    const current: ViewerSettings = {
      version: 1,
      viewers: { molviewer: { enabled: false } },
    };
    const result = applyViewerSettingsPatch(current, { molviewer: { config: { theme: "dark" } } });
    expect(result.viewers["molviewer"]).toEqual({ enabled: false, config: { theme: "dark" } });
  });

  it("an enabled-only patch preserves the row's existing config", () => {
    const current: ViewerSettings = {
      version: 1,
      viewers: { molviewer: { enabled: false, config: { autoRotate: true } } },
    };
    const result = applyViewerSettingsPatch(current, { molviewer: { enabled: true } });
    expect(result.viewers["molviewer"]).toEqual({ enabled: true, config: { autoRotate: true } });
  });

  it("leaves rows not named in the patch untouched", () => {
    const current: ViewerSettings = {
      version: 1,
      viewers: {
        molviewer: { enabled: true },
        "other-viewer": { enabled: false, config: { x: 1 } },
      },
    };
    const result = applyViewerSettingsPatch(current, { molviewer: { enabled: false } });
    expect(result.viewers["other-viewer"]).toEqual({ enabled: false, config: { x: 1 } });
  });

  it("is pure — never mutates the input document", () => {
    const current: ViewerSettings = { version: 1, viewers: { molviewer: { enabled: true } } };
    const snapshot = structuredClone(current);
    applyViewerSettingsPatch(current, { molviewer: { enabled: false } });
    expect(current).toEqual(snapshot);
  });
});
