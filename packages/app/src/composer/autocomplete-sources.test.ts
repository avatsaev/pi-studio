import { describe, it, expect } from "vitest";
import {
  mergeSlashCommands,
  fuzzyMatchFiles,
  isSubsequence,
  providerModesToOptions,
  buildAgentConfigUpdate,
  type FileMentionEntry,
} from "./autocomplete-sources.js";
import type { SlashCommandOption } from "./autocomplete.js";
import type { ProviderMode } from "@av-pi-studio/protocol";

// ─── mergeSlashCommands ───────────────────────────────────────────────────────

const providerCmds: SlashCommandOption[] = [
  { name: "compact", description: "Compact the conversation" },
  { name: "review", description: "Review the diff" },
  { name: "plan", description: "Enter planning mode" },
  { name: "test", description: "Run the tests" },
  { name: "explain", description: "Explain the code" },
];

describe("mergeSlashCommands", () => {
  it("merges client + provider commands at root (empty query)", () => {
    const merged = mergeSlashCommands({ providerCommands: providerCmds, query: "" });
    const names = merged.map((c) => c.name);
    // client commands (exit, clear) present + all 5 provider commands
    expect(names).toContain("exit");
    expect(names).toContain("clear");
    expect(names).toContain("compact");
    expect(merged.length).toBe(7);
  });

  it("filters by prefix, ranking name-prefix ahead of description matches", () => {
    const merged = mergeSlashCommands({ providerCommands: providerCmds, query: "re" });
    // "review" is a name-prefix match (rank 1) and must sort first; other
    // entries may match via description-contains (rank 2), matching the
    // original filterCommands semantics.
    expect(merged[0]!.name).toBe("review");
  });

  it("filters to a single name-prefix match for a distinctive query", () => {
    const merged = mergeSlashCommands({ providerCommands: providerCmds, isDraft: true, query: "comp" });
    expect(merged.map((c) => c.name)).toEqual(["compact"]);
  });

  it("draft mode lists only provider commands (no client commands)", () => {
    const merged = mergeSlashCommands({ providerCommands: providerCmds, isDraft: true, query: "" });
    expect(merged.map((c) => c.name)).not.toContain("exit");
    expect(merged.length).toBe(5);
  });

  it("inline mode lists only provider commands", () => {
    const merged = mergeSlashCommands({ providerCommands: providerCmds, inline: true, query: "" });
    expect(merged.map((c) => c.name)).not.toContain("clear");
  });

  it("ranks exact/prefix before description matches", () => {
    const merged = mergeSlashCommands({
      providerCommands: [
        { name: "plan", description: "planning" },
        { name: "xyz", description: "make a plan" },
      ],
      isDraft: true,
      query: "plan",
    });
    expect(merged[0]!.name).toBe("plan");
  });
});

// ─── isSubsequence ────────────────────────────────────────────────────────────

describe("isSubsequence", () => {
  it("matches gapped subsequences case-insensitively", () => {
    expect(isSubsequence("rdme", "README")).toBe(true);
    expect(isSubsequence("abc", "aXbXc")).toBe(true);
    expect(isSubsequence("cba", "abc")).toBe(false);
    expect(isSubsequence("", "anything")).toBe(true);
  });
});

// ─── fuzzyMatchFiles ──────────────────────────────────────────────────────────

const files: FileMentionEntry[] = [
  { path: "README.md", name: "README.md", kind: "file" },
  { path: "src/app.ts", name: "app.ts", kind: "file" },
  { path: "src/components/Button.tsx", name: "Button.tsx", kind: "file" },
  { path: "src", name: "src", kind: "directory" },
  { path: "package.json", name: "package.json", kind: "file" },
];

describe("fuzzyMatchFiles", () => {
  it("finds README by prefix of name", () => {
    const out = fuzzyMatchFiles(files, "read");
    expect(out[0]!.path).toBe("README.md");
  });

  it("matches by path substring", () => {
    const out = fuzzyMatchFiles(files, "components");
    expect(out.map((o) => o.path)).toContain("src/components/Button.tsx");
  });

  it("empty query returns recent files in order when provided", () => {
    const out = fuzzyMatchFiles(files, "", { recentPaths: ["package.json", "src/app.ts"] });
    expect(out.map((o) => o.path)).toEqual(["package.json", "src/app.ts"]);
  });

  it("empty query without recents returns first N entries", () => {
    const out = fuzzyMatchFiles(files, "", { limit: 2 });
    expect(out).toHaveLength(2);
  });

  it("marks directory kind", () => {
    const out = fuzzyMatchFiles(files, "src");
    const dir = out.find((o) => o.path === "src");
    expect(dir?.kind).toBe("directory");
  });

  it("respects the limit", () => {
    const out = fuzzyMatchFiles(files, "s", { limit: 1 });
    expect(out).toHaveLength(1);
  });
});

// ─── modes / config update ──────────────────────────────────────────────────

describe("provider modes + config update", () => {
  const modes: ProviderMode[] = [
    { id: "default", label: "Default", colorTier: "safe" },
    { id: "plan", label: "Plan", colorTier: "planning" },
    { id: "yolo", colorTier: "dangerous" },
  ];

  it("providerModesToOptions maps id/label/tier and defaults label to id", () => {
    const opts = providerModesToOptions(modes);
    expect(opts[0]).toMatchObject({ id: "default", label: "Default", colorTier: "safe" });
    expect(opts[2]!.label).toBe("yolo");
  });

  it("buildAgentConfigUpdate omits undefined fields", () => {
    expect(buildAgentConfigUpdate({ modeId: "plan" })).toEqual({ modeId: "plan" });
    expect(buildAgentConfigUpdate({ model: "gpt-4o", thinkingOptionId: undefined })).toEqual({ model: "gpt-4o" });
    expect(buildAgentConfigUpdate({})).toEqual({});
  });
});
