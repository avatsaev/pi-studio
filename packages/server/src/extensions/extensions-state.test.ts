import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { persistedConfigSchema } from "../config/daemon-config.js";

import {
  effectivePiHomeKey,
  extensionsStatePath,
  loadExtensionsState,
  saveExtensionsState,
  type ExtensionsState,
} from "./extensions-state.js";

function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-extensions-state-"));
}

const SAMPLE: ExtensionsState = {
  version: 1,
  piHomes: {
    "/agent/dir": {
      offered: {
        "pi-web-access": {
          installedSpec: "npm:pi-web-access",
          atVersion: "0.0.73",
          at: "2026-08-12T12:00:00Z",
        },
      },
      failures: {
        "pi-lens": {
          source: "npm:pi-lens",
          reason: "not_found",
          message: "404",
          attempts: 1,
          at: "2026-08-12T12:00:00Z",
        },
      },
      lastSync: { at: "2026-08-12T12:00:00Z", outcome: "partial" },
    },
  },
};

describe("extensionsStatePath", () => {
  it("is <home>/extensions-state.json", () => {
    expect(extensionsStatePath("/x")).toBe(join("/x", "extensions-state.json"));
  });
});

describe("loadExtensionsState / saveExtensionsState round-trip", () => {
  it("round-trips a full document deep-equal", async () => {
    const dir = await tempHome();
    await saveExtensionsState(dir, SAMPLE);
    expect(await loadExtensionsState(dir)).toEqual(SAMPLE);
  });

  it("writes atomically — no temp file left behind on success", async () => {
    const dir = await tempHome();
    await saveExtensionsState(dir, SAMPLE);
    const entries = await readdir(dir);
    expect(entries).toEqual(["extensions-state.json"]);
  });

  it("a document with unknown extra fields survives the round trip (.passthrough())", async () => {
    const dir = await tempHome();
    const withExtra = {
      ...SAMPLE,
      futureTopLevelField: "from-a-newer-daemon",
      piHomes: {
        "/agent/dir": { ...SAMPLE.piHomes["/agent/dir"], futureField: 42 },
      },
    };
    await writeFile(extensionsStatePath(dir), JSON.stringify(withExtra), "utf8");
    const loaded = await loadExtensionsState(dir);
    expect(loaded).not.toBe("unreadable");
    expect((loaded as typeof withExtra).futureTopLevelField).toBe("from-a-newer-daemon");
    expect((loaded as typeof withExtra).piHomes["/agent/dir"]?.futureField).toBe(42);
  });

  it("absent file yields a valid empty state, not 'unreadable'", async () => {
    const dir = await tempHome();
    expect(await loadExtensionsState(dir)).toEqual({ version: 1, piHomes: {} });
  });

  it("malformed JSON returns 'unreadable' and leaves the file byte-identical", async () => {
    const dir = await tempHome();
    const path = extensionsStatePath(dir);
    await writeFile(path, "{not valid json", "utf8");
    expect(await loadExtensionsState(dir)).toBe("unreadable");
    expect(await readFile(path, "utf8")).toBe("{not valid json");
  });

  it("a repointed pi-home key finds no state, leaving the old key's state retained untouched", async () => {
    const dir = await tempHome();
    await saveExtensionsState(dir, SAMPLE);
    const loaded = await loadExtensionsState(dir);
    expect(loaded).not.toBe("unreadable");
    const state = loaded as ExtensionsState;
    expect(state.piHomes["/a-fresh-pi-home"]).toBeUndefined();
    expect(state.piHomes["/agent/dir"]).toEqual(SAMPLE.piHomes["/agent/dir"]);
  });
});

describe("effectivePiHomeKey", () => {
  it("returns <piHome>/agent for a daemon.piHome config, always absolute", () => {
    const config = persistedConfigSchema.parse({ daemon: { piHome: "/custom/.pi" } });
    expect(effectivePiHomeKey(config)).toBe(join("/custom/.pi", "agent"));
  });

  it("returns Pi's own default when unset", () => {
    const config = persistedConfigSchema.parse({});
    expect(effectivePiHomeKey(config)).toBe(join(homedir(), ".pi", "agent"));
  });

  it("honours the agents.providers.pi.env.PI_CODING_AGENT_DIR override above daemon.piHome", () => {
    const config = persistedConfigSchema.parse({
      daemon: { piHome: "/custom/.pi" },
      agents: { providers: { pi: { env: { PI_CODING_AGENT_DIR: "/explicit/agent" } } } },
    });
    expect(effectivePiHomeKey(config)).toBe("/explicit/agent");
  });
});
