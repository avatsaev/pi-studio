import { describe, expect, it } from "vitest";
import {
  buildAnswerPayload,
  buildDiffRowViewModel,
  buildPermissionPrompt,
  DEFAULT_OPTIONS,
  diffStatLabel,
  isButtonDisabled,
  isButtonSpinning,
  parseDiff,
  resolvePermission,
  startResponding,
} from "./index.js";

const SAMPLE_DIFF = `@@ -1,3 +1,4 @@
 line1
-old line
+new line
+extra line
 line3`;

describe("diff rows", () => {
  it("parses diff hunks and counts adds/removes", () => {
    const parsed = parseDiff(SAMPLE_DIFF, "src/a.ts");
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.stat.added).toBe(2);
    expect(parsed.stat.removed).toBe(1);
    expect(parsed.filePath).toBe("src/a.ts");
    expect(parsed.truncated).toBe(false);
  });

  it("classifies line types correctly", () => {
    const lines = parseDiff(SAMPLE_DIFF).hunks[0]!.lines;
    expect(lines.find((l) => l.prefix === "+")?.type).toBe("add");
    expect(lines.find((l) => l.prefix === "-")?.type).toBe("remove");
    expect(lines.find((l) => l.prefix === " ")?.type).toBe("context");
  });

  it("buildDiffRowViewModel collapses large diffs and allows expand", () => {
    const bigDiff = Array.from({ length: 40 }, (_, i) => `@@ -${i} +${i} @@\n+line`).join("\n");
    const vm = buildDiffRowViewModel(bigDiff);
    expect(vm.collapsed).toBe(true);
    expect(vm.canExpand).toBe(true);
  });

  it("diffStatLabel renders +N / -N combined", () => {
    expect(diffStatLabel({ added: 3, removed: 1 })).toBe("+3 -1");
    expect(diffStatLabel({ added: 2, removed: 0 })).toBe("+2");
    expect(diffStatLabel({ added: 0, removed: 0 })).toBe("");
  });
});

describe("permission prompts", () => {
  it("builds a pending prompt with default options", () => {
    const prompt = buildPermissionPrompt({ kind: "tool", title: "Run command?", description: "ls -la" });
    expect(prompt.state).toBe("pending");
    expect(prompt.options).toEqual(DEFAULT_OPTIONS);
    expect(prompt.kind).toBe("tool");
  });

  it("startResponding sets responding state and respondingOption", () => {
    const prompt = buildPermissionPrompt({ kind: "tool" });
    const r = startResponding(prompt, "allow_once");
    expect(r.state).toBe("responding");
    expect(r.respondingOption).toBe("allow_once");
  });

  it("non-responding option is disabled while one responds", () => {
    const r = startResponding(buildPermissionPrompt({ kind: "tool" }), "allow_once");
    expect(isButtonDisabled(r, "deny")).toBe(true);
    expect(isButtonDisabled(r, "allow_once")).toBe(false);
    expect(isButtonSpinning(r, "allow_once")).toBe(true);
    expect(isButtonSpinning(r, "deny")).toBe(false);
  });

  it("resolvePermission marks as resolved with resolvedBy", () => {
    const resolved = resolvePermission(buildPermissionPrompt({ kind: "question" }), { source: "user", option: "allow_always" });
    expect(resolved.state).toBe("resolved");
    expect(resolved.resolvedBy?.option).toBe("allow_always");
  });

  it("buildAnswerPayload assembles the right-shaped payload", () => {
    expect(buildAnswerPayload("perm-1", "deny", "agent-1")).toEqual({ permissionId: "perm-1", optionId: "deny", agentId: "agent-1" });
  });
});
