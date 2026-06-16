import { defaultGitRunner, type GitRunner } from "./git-detect.js";

/**
 * Checkout diff manager (features/git-checkout.md § Status & diff). Clients subscribe to a diff for
 * a cwd (optionally staged / a specific path); the manager streams `checkout_diff_update` payloads,
 * chunked for large diffs. Unsubscribe stops further updates.
 */

export interface DiffRequest {
  cwd: string;
  /** Diff the staged (index) changes instead of the worktree. */
  staged?: boolean;
  /** Limit the diff to a single path. */
  path?: string;
  /** Max bytes per `checkout_diff_update` chunk (default 64KiB). */
  chunkSize?: number;
}

export interface DiffUpdate {
  type: "checkout_diff_update";
  subscriptionId: string;
  cwd: string;
  /** 0-based chunk index. */
  chunk: number;
  /** Total chunk count for this diff. */
  totalChunks: number;
  /** Diff text for this chunk. */
  patch: string;
  /** True on the final chunk. */
  done: boolean;
}

export type DiffEmitter = (update: DiffUpdate) => void;

const DEFAULT_CHUNK = 64 * 1024;

export class CheckoutDiffManager {
  private readonly subscriptions = new Map<string, { request: DiffRequest; emit: DiffEmitter }>();
  private nextId = 0;

  constructor(private readonly gitRunner: GitRunner = defaultGitRunner) {}

  /** Subscribe to a diff. Streams the current diff immediately. Returns the subscription id. */
  async subscribe(request: DiffRequest, emit: DiffEmitter): Promise<string> {
    const subscriptionId = `diff-${++this.nextId}`;
    this.subscriptions.set(subscriptionId, { request, emit });
    await this.stream(subscriptionId);
    return subscriptionId;
  }

  /** Stop a diff subscription. Returns true when an active subscription was removed. */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  hasSubscription(subscriptionId: string): boolean {
    return this.subscriptions.has(subscriptionId);
  }

  /** Recompute + re-stream a live subscription (e.g. on a status change). No-op if unsubscribed. */
  async refresh(subscriptionId: string): Promise<boolean> {
    if (!this.subscriptions.has(subscriptionId)) return false;
    await this.stream(subscriptionId);
    return true;
  }

  private async stream(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;
    const { request, emit } = sub;

    const args = ["diff"];
    if (request.staged) args.push("--staged");
    if (request.path) args.push("--", request.path);
    const result = await this.gitRunner(args, request.cwd);
    const patch = result.code === 0 ? result.stdout : "";

    const chunkSize = request.chunkSize ?? DEFAULT_CHUNK;
    const chunks = chunkString(patch, chunkSize);
    const totalChunks = chunks.length === 0 ? 1 : chunks.length;

    if (chunks.length === 0) {
      emit({
        type: "checkout_diff_update",
        subscriptionId,
        cwd: request.cwd,
        chunk: 0,
        totalChunks: 1,
        patch: "",
        done: true,
      });
      return;
    }

    for (let i = 0; i < chunks.length; i++) {
      // A subscription cancelled mid-stream stops emitting.
      if (!this.subscriptions.has(subscriptionId)) return;
      emit({
        type: "checkout_diff_update",
        subscriptionId,
        cwd: request.cwd,
        chunk: i,
        totalChunks,
        patch: chunks[i] as string,
        done: i === chunks.length - 1,
      });
    }
  }
}

function chunkString(text: string, size: number): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
