import {
  type GenerateOpts,
  type GenerationTask,
  generate as defaultGenerate,
} from "../agent/structured-generation.js";
import type { HandlerRegistry } from "../ws/router.js";
import { defaultGitRunner, type GitRunner } from "./git-detect.js";
import { slugBranchName } from "./worktree-service.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

/**
 * Provider-neutral git mutation operations (features/git-checkout.md § Git operations, § Behavior
 * (commit), § Error Handling). Commit messages and branch names use the daemon's structured
 * generation. Git failures (merge conflict, non-fast-forward push) surface as `{ ok:false, error }`.
 */

export type GitOpResult = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export interface GitOperationsDeps {
  gitRunner?: GitRunner;
  /** Used to refresh the status projection after a successful mutation. */
  gitService?: WorkspaceGitService;
  /** Structured generation entrypoint (commit message / branch name). */
  generate?: (task: GenerationTask, opts?: GenerateOpts) => Promise<string>;
}

export interface CommitRequest {
  cwd: string;
  message?: string;
  /** Stage all changes (`git add -A`) before committing. */
  all?: boolean;
  /** Stage specific paths before committing. */
  paths?: string[];
}

/** Validate a branch name via `git check-ref-format --branch`, plus basic sanity checks. */
export async function validateBranchName(
  cwd: string,
  name: string,
  runner: GitRunner,
): Promise<{ valid: boolean; reason?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, reason: "empty" };
  if (/\s/.test(trimmed)) return { valid: false, reason: "whitespace" };
  const result = await runner(["check-ref-format", "--branch", trimmed], cwd);
  if (result.code !== 0) return { valid: false, reason: "invalid_ref_format" };
  return { valid: true };
}

export class GitOperationsService {
  private readonly git: GitRunner;
  private readonly generate: (task: GenerationTask, opts?: GenerateOpts) => Promise<string>;

  constructor(private readonly deps: GitOperationsDeps = {}) {
    this.git = deps.gitRunner ?? defaultGitRunner;
    this.generate = deps.generate ?? defaultGenerate;
  }

  registerHandlers(registry: HandlerRegistry): void {
    registry.register("checkout_commit_request", (ctx) =>
      this.respond("checkout_commit_response", this.commit(toCommitRequest(ctx.message))),
    );
    registry.register("checkout_switch_branch_request", (ctx) =>
      this.respond(
        "checkout_switch_branch_response",
        this.switchBranch(String(ctx.message.cwd ?? ""), {
          branch: String(ctx.message.branch ?? ""),
          create: Boolean(ctx.message.create),
        }),
      ),
    );
    registry.register("checkout_rename_branch_request", (ctx) =>
      this.respond(
        "checkout_rename_branch_response",
        this.renameBranch(String(ctx.message.cwd ?? ""), {
          to: String(ctx.message.to ?? ""),
          from: ctx.message.from as string | undefined,
        }),
      ),
    );
    registry.register("checkout_merge_request", (ctx) =>
      this.respond(
        "checkout_merge_response",
        this.merge(String(ctx.message.cwd ?? ""), String(ctx.message.branch ?? "")),
      ),
    );
    registry.register("checkout_merge_from_base_request", (ctx) =>
      this.respond(
        "checkout_merge_from_base_response",
        this.merge(String(ctx.message.cwd ?? ""), String(ctx.message.base ?? "")),
      ),
    );
    registry.register("checkout_pull_request", (ctx) =>
      this.respond("checkout_pull_response", this.pull(String(ctx.message.cwd ?? ""))),
    );
    registry.register("checkout_push_request", (ctx) =>
      this.respond(
        "checkout_push_response",
        this.push(String(ctx.message.cwd ?? ""), {
          remote: ctx.message.remote as string | undefined,
          branch: ctx.message.branch as string | undefined,
          setUpstream: Boolean(ctx.message.setUpstream),
        }),
      ),
    );
    registry.register("stash_save_request", (ctx) =>
      this.respond(
        "stash_save_response",
        this.stashSave(String(ctx.message.cwd ?? ""), ctx.message.message as string | undefined),
      ),
    );
    registry.register("stash_pop_request", (ctx) =>
      this.respond("stash_pop_response", this.stashPop(String(ctx.message.cwd ?? ""))),
    );
    registry.register("stash_list_request", (ctx) =>
      this.respond("stash_list_response", this.stashList(String(ctx.message.cwd ?? ""))),
    );
    registry.register("validate_branch_request", async (ctx) => {
      const result = await validateBranchName(
        String(ctx.message.cwd ?? ""),
        String(ctx.message.name ?? ""),
        this.git,
      );
      return { type: "validate_branch_response", ...result };
    });
    registry.register("branch_suggestions_request", async (ctx) => ({
      type: "branch_suggestions_response",
      suggestions: await this.branchSuggestions(String(ctx.message.prompt ?? "")),
    }));
  }

  private async respond(type: string, op: Promise<GitOpResult>): Promise<Record<string, unknown>> {
    return { type, ...(await op) };
  }

  // ─── Operations ──────────────────────────────────────────────────────────

  async commit(req: CommitRequest): Promise<GitOpResult> {
    if (req.all) {
      const add = await this.git(["add", "-A"], req.cwd);
      if (add.code !== 0) return fail(add);
    } else if (req.paths && req.paths.length > 0) {
      const add = await this.git(["add", "--", ...req.paths], req.cwd);
      if (add.code !== 0) return fail(add);
    }

    let message = req.message?.trim();
    let generated = false;
    if (!message) {
      const diff = await this.git(["diff", "--staged", "--stat"], req.cwd);
      message = await this.generate("commit_message", {
        context: { prompt: diff.stdout.trim() || "Update" },
      });
      generated = true;
    }

    const commit = await this.git(["commit", "-m", message], req.cwd);
    if (commit.code !== 0) return fail(commit);
    await this.refresh(req.cwd);
    return { ok: true, message, generated };
  }

  async switchBranch(
    cwd: string,
    opts: { branch: string; create?: boolean },
  ): Promise<GitOpResult> {
    if (opts.create) {
      const slug = slugBranchName(opts.branch);
      const valid = await validateBranchName(cwd, slug, this.git);
      if (!valid.valid) return { ok: false, error: `invalid_branch_name:${valid.reason}` };
      const res = await this.git(["switch", "-c", slug], cwd);
      if (res.code !== 0) return fail(res);
      await this.refresh(cwd);
      return { ok: true, branch: slug };
    }
    const res = await this.git(["switch", opts.branch], cwd);
    if (res.code !== 0) return fail(res);
    await this.refresh(cwd);
    return { ok: true, branch: opts.branch };
  }

  async renameBranch(cwd: string, opts: { to: string; from?: string }): Promise<GitOpResult> {
    const slug = slugBranchName(opts.to);
    const valid = await validateBranchName(cwd, slug, this.git);
    if (!valid.valid) return { ok: false, error: `invalid_branch_name:${valid.reason}` };
    const args = opts.from ? ["branch", "-m", opts.from, slug] : ["branch", "-m", slug];
    const res = await this.git(args, cwd);
    if (res.code !== 0) return fail(res);
    await this.refresh(cwd);
    return { ok: true, branch: slug };
  }

  async merge(cwd: string, ref: string): Promise<GitOpResult> {
    const res = await this.git(["merge", ref], cwd);
    if (res.code !== 0) {
      await this.refresh(cwd); // conflicts now show in the status projection
      return { ok: false, error: mergeErrorReason(res) };
    }
    await this.refresh(cwd);
    return { ok: true };
  }

  async pull(cwd: string): Promise<GitOpResult> {
    const res = await this.git(["pull"], cwd);
    if (res.code !== 0) return fail(res);
    await this.refresh(cwd);
    return { ok: true };
  }

  async push(
    cwd: string,
    opts: { remote?: string; branch?: string; setUpstream?: boolean } = {},
  ): Promise<GitOpResult> {
    const args = ["push"];
    if (opts.setUpstream) args.push("--set-upstream");
    if (opts.remote) args.push(opts.remote);
    if (opts.branch) args.push(opts.branch);
    const res = await this.git(args, cwd);
    if (res.code !== 0) return { ok: false, error: pushErrorReason(res) };
    return { ok: true };
  }

  async stashSave(cwd: string, message?: string): Promise<GitOpResult> {
    const args = message ? ["stash", "push", "-m", message] : ["stash", "push"];
    const res = await this.git(args, cwd);
    if (res.code !== 0) return fail(res);
    await this.refresh(cwd);
    return { ok: true };
  }

  async stashPop(cwd: string): Promise<GitOpResult> {
    const res = await this.git(["stash", "pop"], cwd);
    if (res.code !== 0) return fail(res);
    await this.refresh(cwd);
    return { ok: true };
  }

  async stashList(cwd: string): Promise<GitOpResult> {
    const res = await this.git(["stash", "list"], cwd);
    if (res.code !== 0) return fail(res);
    const entries = res.stdout.split("\n").filter((l) => l.trim().length > 0);
    return { ok: true, entries };
  }

  /** Generate slug-safe branch-name suggestions from a prompt. */
  async branchSuggestions(prompt: string): Promise<string[]> {
    const generated = await this.generate("branch_name", { context: { prompt } });
    const base = slugBranchName(generated);
    return [base, `${base}-1`, `feature/${base}`];
  }

  private async refresh(cwd: string): Promise<void> {
    await this.deps.gitService?.refresh(cwd);
  }
}

function toCommitRequest(message: Record<string, unknown>): CommitRequest {
  return {
    cwd: String(message.cwd ?? ""),
    message: message.message as string | undefined,
    all: Boolean(message.all),
    paths: Array.isArray(message.paths) ? (message.paths as string[]) : undefined,
  };
}

function fail(result: { stdout: string; stderr: string }): { ok: false; error: string } {
  const error = (result.stderr || result.stdout).trim().split("\n")[0] ?? "git_error";
  return { ok: false, error: error || "git_error" };
}

function mergeErrorReason(result: { stdout: string; stderr: string }): string {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/conflict/i.test(text)) return "merge_conflict";
  return fail(result).error;
}

function pushErrorReason(result: { stdout: string; stderr: string }): string {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/non-fast-forward|\[rejected\]|fetch first/i.test(text)) return "non_fast_forward";
  return fail(result).error;
}
