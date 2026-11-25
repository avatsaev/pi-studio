import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ViewerSettings } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { recordingLogger } from "../test-support/recording-logger.js";
import {
  applyViewerSettingsPatch,
  loadViewerSettings,
  saveViewerSettings,
  viewerSettingsPath,
} from "./viewer-settings-state.js";

function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-viewer-settings-state-"));
}

/** The contents of every `viewer-settings.json.corrupt-<timestamp>` file in `dir`. */
async function readSetAside(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((name) => name.includes(".corrupt-")).toSorted();
  return Promise.all(names.map((name) => readFile(join(dir, name), "utf8")));
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
    expect(await loadViewerSettings(dir, silentLogger())).toEqual(SAMPLE);
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
    const loaded = await loadViewerSettings(dir, silentLogger());
    expect((loaded as typeof withExtra).futureTopLevelField).toBe("from-a-newer-daemon");
    expect((loaded as typeof withExtra).viewers["molviewer"]?.futureField).toBe(42);
  });

  it("absent file yields all-enabled defaults and logs nothing", async () => {
    const dir = await tempHome();
    const { logger, lines } = recordingLogger();
    expect(await loadViewerSettings(dir, logger)).toEqual({ version: 1, viewers: {} });
    expect(lines).toEqual([]);
  });

  it("a viewer id this daemon has never heard of is a valid row, not an error", async () => {
    const dir = await tempHome();
    await saveViewerSettings(dir, {
      version: 1,
      viewers: { "totally-unknown-viewer": { enabled: true } },
    });
    expect(await loadViewerSettings(dir, silentLogger())).toEqual({
      version: 1,
      viewers: { "totally-unknown-viewer": { enabled: true } },
    });
  });

  it.each([
    ["corrupt JSON", "{not valid json"],
    ["a schema mismatch", JSON.stringify({ version: 1, viewers: "not-an-object" })],
  ])(
    "%s loads as all-enabled defaults, and the file is set aside with its bytes and logged as an error",
    async (_name, original) => {
      const dir = await tempHome();
      const path = viewerSettingsPath(dir);
      await writeFile(path, original, "utf8");
      const { logger, lines } = recordingLogger();

      expect(await loadViewerSettings(dir, logger)).toEqual({ version: 1, viewers: {} });

      expect(await readdir(dir)).not.toContain("viewer-settings.json");
      expect(await readSetAside(dir)).toEqual([original]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: "error", obj: { path } });
    },
  );

  it("the change after a damaged file writes a fresh file and leaves the damaged bytes aside", async () => {
    const dir = await tempHome();
    await writeFile(viewerSettingsPath(dir), "{not valid json", "utf8");

    const current = await loadViewerSettings(dir, silentLogger());
    await saveViewerSettings(
      dir,
      applyViewerSettingsPatch(current, { molviewer: { enabled: false } }),
    );

    expect(await loadViewerSettings(dir, silentLogger())).toEqual({
      version: 1,
      viewers: { molviewer: { enabled: false } },
    });
    expect(await readSetAside(dir)).toEqual(["{not valid json"]);
  });

  it("throws, and leaves the file alone, when it cannot be read", async () => {
    const dir = await tempHome();
    await mkdir(viewerSettingsPath(dir)); // a directory where the file belongs

    await expect(loadViewerSettings(dir, silentLogger())).rejects.toBeDefined();

    expect(await readdir(dir)).toEqual(["viewer-settings.json"]);
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
