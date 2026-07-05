import { describe, expect, it } from "vitest";
import { buildExpandedDetail, buildToolCardPresentation, humanizeName, resolveStatusVisual, truncate, type ToolCallPayload } from "./index.js";

function payload(overrides: Partial<ToolCallPayload>): ToolCallPayload {
  return { callId: "c1", name: "unknown", status: "completed", ...overrides };
}

describe("tool-call card presentation", () => {
  it("shell detail maps to terminal icon and command summary", () => {
    const p = buildToolCardPresentation(payload({ name: "bash", detail: { type: "shell", command: "npm run build" }, status: "completed" }));
    expect(p.displayName).toBe("Shell");
    expect(p.summary).toBe("npm run build");
    expect(p.icon).toBe("terminal");
  });

  it("edit/write detail maps to pencil icon and file path summary", () => {
    expect(buildToolCardPresentation(payload({ name: "write_file", detail: { type: "write", filePath: "src/app.ts" } })).icon).toBe("pencil");
    expect(buildToolCardPresentation(payload({ name: "edit_file", detail: { type: "edit", filePath: "src/index.ts" } })).summary).toBe("src/index.ts");
    expect(buildToolCardPresentation(payload({ name: "read_file", detail: { type: "read", filePath: "README.md" } })).icon).toBe("eye");
  });

  it("search/fetch map to search icon", () => {
    expect(buildToolCardPresentation(payload({ name: "grep", detail: { type: "search", query: "TODO" } })).icon).toBe("search");
    expect(buildToolCardPresentation(payload({ name: "fetch", detail: { type: "fetch", url: "https://example.com" } })).icon).toBe("search");
  });

  it("sub_agent maps to bot icon with description summary", () => {
    const p = buildToolCardPresentation(payload({ name: "task", detail: { type: "sub_agent", subAgentType: "WebSearch", description: "Search the web" } }));
    expect(p.icon).toBe("bot");
    expect(p.displayName).toBe("WebSearch");
    expect(p.summary).toBe("Search the web");
  });

  it("plan maps to brain icon and isPlan=true", () => {
    const p = buildToolCardPresentation(payload({ name: "plan", detail: { type: "plan", title: "My Plan" } }));
    expect(p.icon).toBe("brain");
    expect(p.isPlan).toBe(true);
  });

  it("failed status sets errorText and alert icon visual", () => {
    const p = buildToolCardPresentation(payload({ status: "failed", error: "Exit code 1", detail: { type: "shell", command: "make" } }));
    expect(p.errorText).toBe("Exit code 1");
    const v = resolveStatusVisual("failed");
    expect(v.iconVariant).toBe("alert");
    expect(v.shimmer).toBe(false);
  });

  it("running status sets shimmer and loading when no detail yet", () => {
    const p = buildToolCardPresentation(payload({ status: "running" }));
    expect(p.isLoadingDetails).toBe(true);
    expect(p.hasDetails).toBe(false);
    const v = resolveStatusVisual("running");
    expect(v.shimmer).toBe(true);
    expect(v.labelDimmed).toBe(true);
  });
});

describe("expanded tool detail", () => {
  it("shell detail produces full-bleed code section with command+output", () => {
    const sections = buildExpandedDetail(payload({ detail: { type: "shell", command: "ls", output: "a\nb" } }));
    expect(sections[0]?.kind).toBe("code");
    expect(sections[0]).toMatchObject({ kind: "code", fullBleed: true, language: "shell" });
    expect((sections[0] as { content: string }).content).toContain("$ ls");
  });

  it("edit detail produces diff section", () => {
    const sections = buildExpandedDetail(payload({ detail: { type: "edit", filePath: "src/a.ts", diff: "@@ -1 +1 @@" } }));
    expect(sections[0]?.kind).toBe("diff");
  });

  it("unknown detail produces json Input/Output sections", () => {
    const sections = buildExpandedDetail(payload({ detail: { type: "unknown", input: { x: 1 }, output: { y: 2 } } }));
    expect(sections.map((s) => s.kind)).toEqual(["json", "json"]);
  });

  it("failed detail appends error section", () => {
    const sections = buildExpandedDetail({ callId: "c1", name: "bash", status: "failed", error: "Oops", detail: { type: "shell", command: "exit 1" } });
    expect(sections.at(-1)?.kind).toBe("error");
  });
});

describe("truncate and humanizeName", () => {
  it("truncates long output and appends character count", () => {
    const text = "x".repeat(3000);
    const t = truncate(text, 2000);
    expect(t.length).toBeLessThan(text.length);
    expect(t).toContain("more characters");
  });

  it("humanizes snake_case names to Title Case", () => {
    expect(humanizeName("read_file")).toBe("Read File");
    expect(humanizeName("my-tool")).toBe("My Tool");
    expect(humanizeName("path/to/tool")).toBe("path/to/tool");
    expect(humanizeName("my::ns")).toBe("my::ns");
  });
});
