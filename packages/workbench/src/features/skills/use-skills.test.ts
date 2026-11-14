import { describe, expect, it } from "vitest";
import type { SkillsListResponse } from "@av-pi-studio/protocol";
import { applyOptimisticSkillToggle } from "./use-skills.js";

function response(): SkillsListResponse {
  return {
    type: "skills_list_response",
    requestId: "req-1",
    ok: true,
    skills: [
      {
        name: "a",
        path: "/agent/a",
        enabled: false,
        origin: "agent_dir",
        originLabel: "Pi skills",
        removable: true,
      },
      {
        name: "b",
        path: "/agent/b",
        enabled: true,
        origin: "agent_dir",
        originLabel: "Pi skills",
        removable: true,
      },
    ],
    packages: [],
  };
}

describe("applyOptimisticSkillToggle", () => {
  it("flips only the targeted skill's enabled field", () => {
    const next = applyOptimisticSkillToggle(response(), "/agent/a", true);
    expect(next.skills.find((s) => s.path === "/agent/a")!.enabled).toBe(true);
    expect(next.skills.find((s) => s.path === "/agent/b")!.enabled).toBe(true);
  });

  it("is a no-op when the path isn't found", () => {
    const original = response();
    const next = applyOptimisticSkillToggle(original, "/nowhere", true);
    expect(next.skills).toEqual(original.skills);
  });

  it("does not mutate the input response", () => {
    const original = response();
    const snapshot = JSON.parse(JSON.stringify(original));
    applyOptimisticSkillToggle(original, "/agent/a", true);
    expect(original).toEqual(snapshot);
  });

  it("preserves every other top-level field (ok, packages, …)", () => {
    const original = response();
    const next = applyOptimisticSkillToggle(original, "/agent/a", true);
    expect(next.ok).toBe(original.ok);
    expect(next.packages).toBe(original.packages);
  });
});
