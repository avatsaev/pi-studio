import { execFile } from "node:child_process";

import {
  type GenerateOpts,
  type GenerationTask,
  generate as defaultGenerate,
} from "../agent/structured-generation.js";
import type { HandlerRegistry } from "../ws/router.js";
import { defaultGitRunner, type GitRunner } from "./git-detect.js";

/**
 * GitHub PR operations via the `gh` CLI (features/git-checkout.md § GitHub operations, § Auto-merge
 * request shape, § Auto-archive on merge). New GitHub RPCs are namespaced `checkout.github.*`.
 * `checkout.github.set_auto_merge` is feature-gated by `features.checkoutGithubSetAutoMerge`.
 */

export interface GhRunResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type GhRunner = (args: string[], cwd: string) => Promise<GhRunResult>;

/** Default `gh` CLI runner (never throws; non-zero exit → `code`). */
export const defaultGhRunner: GhRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile("gh", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
      resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", code });
    });
  });

export type MergeMethod = "merge" | "squash" | "rebase";

export interface GitHubServiceDeps {
  ghRunner?: GhRunner;
  gitRunner?: GitRunner;
  generate?: (task: GenerationTask, opts?: GenerateOpts) => Promise<string>;
  /** Whether the daemon advertises `features.checkoutGithubSetAutoMerge`. */
  setAutoMergeEnabled: boolean;
  /** Archive a workspace (auto-archive-on-merge coupling). */
  archiveWorkspace?: (workspaceId: string) => Promise<void>;
}

const GITHUB_AUTH_REQUIRED = "github_auth_required";

export class GitHubService {
  private readonly gh: GhRunner;
  private readonly git: GitRunner;
  private readonly generate: (task: GenerationTask, opts?: GenerateOpts) => Promise<string>;

  constructor(private readonly deps: GitHubServiceDeps) {
    this.gh = deps.ghRunner ?? defaultGhRunner;
    this.git = deps.gitRunner ?? defaultGitRunner;
    this.generate = deps.generate ?? defaultGenerate;
  }

  registerHandlers(registry: HandlerRegistry): void {
    registry.register("checkout_pr_create_request", async (ctx) => ({
      type: "checkout_pr_create_response",
      ...(await this.createPr({
        cwd: String(ctx.message.cwd ?? ""),
        title: ctx.message.title as string | undefined,
        body: ctx.message.body as string | undefined,
        base: ctx.message.base as string | undefined,
        draft: Boolean(ctx.message.draft),
      })),
    }));

    registry.register("checkout_pr_merge_request", async (ctx) => ({
      type: "checkout_pr_merge_response",
      ...(await this.mergePr(String(ctx.message.cwd ?? ""), ctx.message.method as MergeMethod)),
    }));

    registry.register("checkout_pr_status_request", async (ctx) => ({
      type: "checkout_pr_status_response",
      ...(await this.prStatus(String(ctx.message.cwd ?? ""))),
    }));

    registry.register("pull_request_timeline_request", async (ctx) => ({
      type: "pull_request_timeline_response",
      ...(await this.prTimeline(String(ctx.message.cwd ?? ""))),
    }));

    registry.register("github_search_request", async (ctx) => ({
      type: "github_search_response",
      ...(await this.search(String(ctx.message.query ?? ""), String(ctx.message.cwd ?? "."))),
    }));

    // Feature-gated dotted RPC: only registered when the daemon advertises the feature. An old
    // daemon simply has no handler → the client hides the affordance instead of failing silently.
    if (this.deps.setAutoMergeEnabled) {
      registry.register("checkout.github.set_auto_merge.request", async (ctx) => {
        const cwd = String(ctx.message.cwd ?? "");
        const enabled = Boolean(ctx.message.enabled);
        const requestId = ctx.message.requestId as string | undefined;
        const result = await this.setAutoMerge(
          cwd,
          enabled,
          ctx.message.mergeMethod as MergeMethod,
        );
        return {
          type: "checkout.github.set_auto_merge.response",
          payload: { cwd, enabled, success: result.success, error: result.error, requestId },
        };
      });
    }
  }

  /** True when `gh` reports an authenticated session. */
  private async isAuthenticated(cwd: string): Promise<boolean> {
    const res = await this.gh(["auth", "status"], cwd);
    return res.code === 0;
  }

  async createPr(opts: {
    cwd: string;
    title?: string;
    body?: string;
    base?: string;
    draft?: boolean;
  }): Promise<{ ok: boolean; pr?: { number: number | null; url: string }; error?: string }> {
    if (!(await this.isAuthenticated(opts.cwd))) return { ok: false, error: GITHUB_AUTH_REQUIRED };

    // Push the current branch (sets upstream); ignore "everything up-to-date".
    const push = await this.git(["push", "--set-upstream", "origin", "HEAD"], opts.cwd);
    if (push.code !== 0 && !/up-to-date/i.test(`${push.stdout}${push.stderr}`)) {
      return {
        ok: false,
        error: (push.stderr || push.stdout).trim().split("\n")[0] || "push_failed",
      };
    }

    const title =
      opts.title?.trim() || (await this.generate("pr_title", { context: { prompt: "" } }));
    const body =
      opts.body?.trim() || (await this.generate("pr_body", { context: { prompt: title } }));

    const args = ["pr", "create", "--title", title, "--body", body];
    if (opts.base) args.push("--base", opts.base);
    if (opts.draft) args.push("--draft");
    const created = await this.gh(args, opts.cwd);
    if (created.code !== 0) {
      return { ok: false, error: classifyGhError(created) };
    }
    const url = created.stdout.trim().split("\n").at(-1) ?? "";
    return { ok: true, pr: { number: parsePrNumber(url), url } };
  }

  async mergePr(
    cwd: string,
    method: MergeMethod = "merge",
  ): Promise<{ ok: boolean; error?: string }> {
    if (!(await this.isAuthenticated(cwd))) return { ok: false, error: GITHUB_AUTH_REQUIRED };
    const res = await this.gh(["pr", "merge", `--${method}`], cwd);
    if (res.code !== 0) return { ok: false, error: classifyGhError(res) };
    return { ok: true };
  }

  async setAutoMerge(
    cwd: string,
    enabled: boolean,
    method: MergeMethod = "merge",
  ): Promise<{ success: boolean; error: string | null }> {
    if (!(await this.isAuthenticated(cwd))) return { success: false, error: GITHUB_AUTH_REQUIRED };
    const args = enabled
      ? ["pr", "merge", "--auto", `--${method}`]
      : ["pr", "merge", "--disable-auto"];
    const res = await this.gh(args, cwd);
    if (res.code !== 0) return { success: false, error: classifyGhError(res) };
    return { success: true, error: null };
  }

  async prStatus(
    cwd: string,
  ): Promise<{ ok: boolean; state?: string; merged?: boolean; error?: string }> {
    if (!(await this.isAuthenticated(cwd))) return { ok: false, error: GITHUB_AUTH_REQUIRED };
    const res = await this.gh(["pr", "view", "--json", "state,mergedAt,number,url"], cwd);
    if (res.code !== 0) return { ok: false, error: classifyGhError(res) };
    const parsed = safeJson(res.stdout) as { state?: string; mergedAt?: string | null };
    return { ok: true, state: parsed.state, merged: Boolean(parsed.mergedAt) };
  }

  async prTimeline(cwd: string): Promise<{ ok: boolean; events?: unknown; error?: string }> {
    if (!(await this.isAuthenticated(cwd))) return { ok: false, error: GITHUB_AUTH_REQUIRED };
    const res = await this.gh(["pr", "view", "--json", "comments,reviews,commits"], cwd);
    if (res.code !== 0) return { ok: false, error: classifyGhError(res) };
    return { ok: true, events: safeJson(res.stdout) };
  }

  async search(
    query: string,
    cwd: string,
  ): Promise<{ ok: boolean; results?: unknown; error?: string }> {
    const res = await this.gh(["search", "prs", query, "--json", "title,url,number"], cwd);
    if (res.code !== 0) return { ok: false, error: classifyGhError(res) };
    return { ok: true, results: safeJson(res.stdout) };
  }

  /**
   * Auto-archive-on-merge: if the PR for `cwd` is safely merged, archive its workspace. Returns true
   * when an archive was triggered.
   */
  async autoArchiveOnMerge(cwd: string, workspaceId: string): Promise<boolean> {
    const status = await this.prStatus(cwd);
    if (status.ok && status.merged) {
      await this.deps.archiveWorkspace?.(workspaceId);
      return true;
    }
    return false;
  }
}

function classifyGhError(res: GhRunResult): string {
  const text = `${res.stdout}\n${res.stderr}`;
  if (/auth|not logged in|gh auth login/i.test(text)) return GITHUB_AUTH_REQUIRED;
  return (res.stderr || res.stdout).trim().split("\n")[0] || "gh_error";
}

function parsePrNumber(url: string): number | null {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
