import { describe, expect, it } from "vitest";

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import type { HostProfile } from "../runtime/host-profile.js";
import {
  isLocalHost,
  openProjectTileLayout,
  shouldOpenSidebarOnOpenProjectMount,
  visibleOpenProjectTiles,
} from "./open-project.js";
import {
  createAgentDefaults,
  filterRefs,
  newWorkspaceInitialDraft,
  parseNewWorkspaceParams,
  submitNewWorkspace,
  worktreeCapableProjects,
  type NewWorkspaceClient,
} from "./new-workspace.js";

function host(profile: HostProfile): HostRuntimeSnapshot {
  return { profile, status: "online", serverId: profile.serverId, features: {}, reconnectAttempt: 0 };
}

describe("open-project model", () => {
  it("global route shows three tiles, no pair-device without a fixed local host", () => {
    expect(visibleOpenProjectTiles({}).map((t) => t.id)).toEqual(["add-project", "import-session", "setup-providers"]);
  });

  it("per-host local embedded route shows Pair device", () => {
    const local = host({ id: "local", kind: "local-embedded", label: "This Mac", localUrl: "ws://127.0.0.1:6767", createdAtMs: 1, serverId: "local-srv" });
    expect(isLocalHost(local)).toBe(true);
    expect(visibleOpenProjectTiles({ serverId: "local-srv", host: local }).map((t) => t.id)).toContain("pair-device");
  });

  it("direct localhost also counts as local", () => {
    const local = host({ id: "local", kind: "direct", label: "Local", url: "ws://localhost:6767", createdAtMs: 1, serverId: "local-srv" });
    expect(isLocalHost(local)).toBe(true);
  });

  it("remote host hides Pair device", () => {
    const remote = host({ id: "remote", kind: "direct", label: "Remote", url: "wss://remote.example", createdAtMs: 1, serverId: "remote" });
    expect(visibleOpenProjectTiles({ serverId: "remote", host: remote }).map((t) => t.id)).not.toContain("pair-device");
  });

  it("desktop non-compact opens sidebar on mount", () => {
    expect(shouldOpenSidebarOnOpenProjectMount({ isDesktop: true, isCompact: false })).toBe(true);
    expect(shouldOpenSidebarOnOpenProjectMount({ isDesktop: true, isCompact: true })).toBe(false);
    expect(shouldOpenSidebarOnOpenProjectMount({ isDesktop: false, isCompact: false })).toBe(false);
  });

  it("tile layout stacks on phone width and cards on wide", () => {
    expect(openProjectTileLayout(375)).toBe("stacked");
    expect(openProjectTileLayout(800)).toBe("cards");
  });
});

describe("new-workspace params and pickers", () => {
  it("reads host from ?serverId= query parameter", () => {
    expect(parseNewWorkspaceParams("/new?serverId=srv&dir=%2Ftmp&name=feat&projectId=p1&draftId=d1")).toEqual({
      serverId: "srv",
      dir: "/tmp",
      name: "feat",
      projectId: "p1",
      draftId: "d1",
    });
  });

  it("worktreeCapableProjects filters out non-worktree projects", () => {
    const projects = [
      { projectId: "p1", projectKey: "k1", name: "One", worktreeCapable: true },
      { projectId: "p2", projectKey: "k2", name: "Two", worktreeCapable: false },
    ];
    expect(worktreeCapableProjects(projects).map((p) => p.projectId)).toEqual(["p1"]);
  });

  it("filterRefs searches branch and GitHub PR refs", () => {
    const refs = [
      { id: "main", label: "main", kind: "branch" as const },
      { id: "pr-42", label: "#42 Fix bug", kind: "github-pr" as const },
    ];
    expect(filterRefs(refs, "fix").map((r) => r.id)).toEqual(["pr-42"]);
  });

  it("createAgentDefaults reads provider/model/mode/thinking/features/favorites/isolation", () => {
    expect(createAgentDefaults({
      provider: "claude",
      providerPreferences: {
        claude: {
          model: "sonnet",
          mode: "plan",
          thinkingByModel: { sonnet: "high" },
          featureValues: { web: true },
        },
      },
      favoriteModels: [{ provider: "claude", modelId: "sonnet" }],
      isolation: "local",
    })).toEqual({
      provider: "claude",
      model: "sonnet",
      mode: "plan",
      thinking: "high",
      featureValues: { web: true },
      favoriteModels: [{ provider: "claude", modelId: "sonnet" }],
      isolation: "local",
    });
  });

  it("createAgentDefaults defaults isolation to worktree", () => {
    expect(createAgentDefaults(undefined).isolation).toBe("worktree");
  });
});

describe("submitNewWorkspace", () => {
  function client(calls: string[]): NewWorkspaceClient {
    return {
      async createEmptyWorktree() { calls.push("createEmptyWorktree"); return { workspaceId: "w-empty" }; },
      async ensureWorktree() { calls.push("ensureWorktree"); return { workspaceId: "w-draft" }; },
      async stagePendingDraft(input) { calls.push(`stage:${input.text}`); return { draftId: "d1" }; },
    };
  }

  it("empty submit creates empty worktree and navigates to workspace", async () => {
    const calls: string[] = [];
    const result = await submitNewWorkspace({ params: { serverId: "srv", projectId: "p1" }, text: "", client: client(calls) });
    expect(calls).toEqual(["createEmptyWorktree"]);
    expect(result).toEqual({ ok: true, workspaceId: "w-empty", route: "/h/srv/workspace/w-empty" });
  });

  it("prompt submit ensures worktree, stages pending draft, and navigates to prepared draft tab", async () => {
    const calls: string[] = [];
    const result = await submitNewWorkspace({ params: { serverId: "srv" }, text: "hello", attachments: ["img1"], client: client(calls) });
    expect(calls).toEqual(["ensureWorktree", "stage:hello"]);
    expect(result).toEqual({ ok: true, workspaceId: "w-draft", draftId: "d1", route: "/h/srv/workspace/w-draft?open=draft%3Ad1" });
  });

  it("missing serverId returns an inline error", async () => {
    const calls: string[] = [];
    const result = await submitNewWorkspace({ params: {}, text: "hello", client: client(calls) });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("client failures surface as error result", async () => {
    const result = await submitNewWorkspace({
      params: { serverId: "srv" },
      text: "",
      client: {
        async createEmptyWorktree() { throw new Error("boom"); },
        async ensureWorktree() { throw new Error("unused"); },
        async stagePendingDraft() { throw new Error("unused"); },
      },
    });
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("initial draft helper returns draft open intent", () => {
    expect(newWorkspaceInitialDraft({ draftId: "d1" })).toEqual({ draftId: "d1", openIntent: { kind: "draft", id: "d1" } });
  });
});
