import { describe, expect, it } from "vitest";

import { HandlerRegistry } from "../ws/router.js";
import type { GitRunner } from "./git-detect.js";
import { GitHubService, type GhRunner } from "./github-service.js";

/** A stubbed `gh` runner driven by a route table keyed on the leading args. */
function makeGh(routes: Record<string, { stdout?: string; stderr?: string; code?: number }>): {
  gh: GhRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    for (const [prefix, res] of Object.entries(routes)) {
      if (args.join(" ").startsWith(prefix)) {
        return Promise.resolve({
          stdout: res.stdout ?? "",
          stderr: res.stderr ?? "",
          code: res.code ?? 0,
        });
      }
    }
    return Promise.resolve({ stdout: "", stderr: "unrouted", code: 1 });
  };
  return { gh, calls };
}

const okGit: GitRunner = () => Promise.resolve({ stdout: "", stderr: "", code: 0 });
const noopGenerate = async (): Promise<string> => "Generated";

describe("createPr", () => {
  it("pushes the branch, generates title/body, and returns a PR reference", async () => {
    const { gh, calls } = makeGh({
      "auth status": { code: 0 },
      "pr create": { stdout: "https://github.com/acme/repo/pull/42\n", code: 0 },
    });
    const svc = new GitHubService({
      ghRunner: gh,
      gitRunner: okGit,
      generate: noopGenerate,
      setAutoMergeEnabled: true,
    });
    const result = await svc.createPr({ cwd: "/w" });
    expect(result.ok).toBe(true);
    expect(result.pr?.number).toBe(42);
    expect(result.pr?.url).toContain("/pull/42");
    // Title/body were generated (no explicit values) and passed to gh pr create.
    const createCall = calls.find((c) => c[0] === "pr" && c[1] === "create");
    expect(createCall).toContain("--title");
  });

  it("surfaces a GitHub auth error when not logged in", async () => {
    const { gh } = makeGh({
      "auth status": { code: 1, stderr: "You are not logged into any GitHub hosts" },
    });
    const svc = new GitHubService({ ghRunner: gh, gitRunner: okGit, setAutoMergeEnabled: true });
    const result = await svc.createPr({ cwd: "/w" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("github_auth_required");
  });
});

describe("setAutoMerge + feature gate", () => {
  it("registers checkout.github.set_auto_merge and echoes requestId in the payload", async () => {
    const { gh } = makeGh({ "auth status": { code: 0 }, "pr merge": { code: 0 } });
    const svc = new GitHubService({ ghRunner: gh, gitRunner: okGit, setAutoMergeEnabled: true });
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);

    const handler = registry.get("checkout.github.set_auto_merge.request");
    expect(handler).toBeDefined();
    const response = (await handler!({
      session: {} as never,
      message: {
        type: "checkout.github.set_auto_merge.request",
        cwd: "/w",
        enabled: true,
        mergeMethod: "squash",
        requestId: "req-1",
      },
      requestId: "req-1",
    })) as { type: string; payload: Record<string, unknown> };
    expect(response.type).toBe("checkout.github.set_auto_merge.response");
    expect(response.payload.requestId).toBe("req-1");
    expect(response.payload.success).toBe(true);
    expect(response.payload.enabled).toBe(true);
  });

  it("does NOT register the dotted RPC when the feature is disabled (old daemon)", () => {
    const { gh } = makeGh({});
    const svc = new GitHubService({ ghRunner: gh, setAutoMergeEnabled: false });
    const registry = new HandlerRegistry();
    svc.registerHandlers(registry);
    expect(registry.get("checkout.github.set_auto_merge.request")).toBeUndefined();
  });
});

describe("auto-archive-on-merge", () => {
  it("archives the workspace once the PR is merged", async () => {
    const archived: string[] = [];
    const { gh } = makeGh({
      "auth status": { code: 0 },
      "pr view": {
        stdout: JSON.stringify({ state: "MERGED", mergedAt: "2024-01-01T00:00:00Z", number: 7 }),
        code: 0,
      },
    });
    const svc = new GitHubService({
      ghRunner: gh,
      setAutoMergeEnabled: true,
      archiveWorkspace: async (id) => {
        archived.push(id);
      },
    });
    const did = await svc.autoArchiveOnMerge("/w", "ws-1");
    expect(did).toBe(true);
    expect(archived).toEqual(["ws-1"]);
  });

  it("does not archive when the PR is not yet merged", async () => {
    const archived: string[] = [];
    const { gh } = makeGh({
      "auth status": { code: 0 },
      "pr view": { stdout: JSON.stringify({ state: "OPEN", mergedAt: null }), code: 0 },
    });
    const svc = new GitHubService({
      ghRunner: gh,
      setAutoMergeEnabled: true,
      archiveWorkspace: async (id) => archived.push(id),
    });
    expect(await svc.autoArchiveOnMerge("/w", "ws-1")).toBe(false);
    expect(archived).toHaveLength(0);
  });
});
