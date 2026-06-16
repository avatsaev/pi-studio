import { execFile } from "node:child_process";

/**
 * Git detection for the open-project flow (features/projects-workspaces.md § Open project).
 * The git invocation is injectable so tests can run against a real temp repo or a fake runner.
 */

export interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type GitRunner = (args: string[], cwd: string) => Promise<GitRunResult>;

/** Default runner: invoke the `git` CLI, never throwing (non-zero exit → `code`). */
export const defaultGitRunner: GitRunner = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
      resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", code });
    });
  });

export interface GitDetection {
  isGit: boolean;
  /** Repo top-level (git rev-parse --show-toplevel), or the input path when not a repo. */
  rootPath: string;
  remote: string | null;
  branch: string | null;
}

export async function detectGit(
  path: string,
  runner: GitRunner = defaultGitRunner,
): Promise<GitDetection> {
  const top = await runner(["rev-parse", "--show-toplevel"], path);
  if (top.code !== 0) {
    return { isGit: false, rootPath: path, remote: null, branch: null };
  }
  const rootPath = top.stdout.trim() || path;

  // `symbolic-ref --short HEAD` works on an unborn branch (fresh repo, no commits); fall back to
  // `rev-parse --abbrev-ref HEAD` for detached HEAD.
  const [remoteRes, symbolicRes] = await Promise.all([
    runner(["remote", "get-url", "origin"], rootPath),
    runner(["symbolic-ref", "--short", "HEAD"], rootPath),
  ]);

  const remote = remoteRes.code === 0 && remoteRes.stdout.trim() ? remoteRes.stdout.trim() : null;
  let branch =
    symbolicRes.code === 0 && symbolicRes.stdout.trim() ? symbolicRes.stdout.trim() : null;
  if (!branch) {
    const abbrev = await runner(["rev-parse", "--abbrev-ref", "HEAD"], rootPath);
    const value = abbrev.stdout.trim();
    branch = abbrev.code === 0 && value && value !== "HEAD" ? value : null;
  }
  return { isGit: true, rootPath, remote, branch };
}
