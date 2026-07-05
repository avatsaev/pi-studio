// Rewind RPC handler — sprint-015/task-007.
// features/rewind.md § Wire contract, § Behavior & Algorithms (daemon side)

import {
  agentRewindRequestSchema,
  agentRewindResponseSchema,
  type AgentRewindRequest,
  type RewindMode,
} from "@av-pi-studio/protocol";
import type { HandlerRegistry, RpcHandlerContext } from "../ws/router.js";
import { AgentTimelineStore as TimelineStore } from "./timeline-store.js";

export interface RewindDeps {
  /** Look up an agent's timeline store by agentId. Returns undefined if not found. */
  getTimelineStore: (agentId: string) => TimelineStore | undefined;
  /**
   * Revert workspace file changes since the checkpoint at / before messageId.
   * For worktree-backed workspaces this means a git-based revert.
   * Returns a promise that resolves on success or rejects on failure.
   * TODO(verify): exact checkpoint strategy for non-git workspaces.
   */
  revertFilesSince: (agentId: string, messageId: string) => Promise<void>;
}

export function registerRewindHandler(registry: HandlerRegistry, deps: RewindDeps): void {
  registry.register("agent.rewind.request", async (ctx: RpcHandlerContext) => {
    const parsed = agentRewindRequestSchema.safeParse(ctx.message);
    if (!parsed.success) throw new Error(`Invalid rewind request: ${parsed.error.message}`);

    const { agentId, messageId, mode, requestId } = parsed.data;

    const rewindConversation = mode !== "files";
    const rewindFiles = mode !== "conversation";

    let truncatedAt: string | undefined;

    if (rewindConversation) {
      const store = deps.getTimelineStore(agentId);
      if (!store) throw new Error(`Agent not found: ${agentId}`);
      truncatedAt = store.truncateBeforeMessage(messageId);
    }

    if (rewindFiles) {
      await deps.revertFilesSince(agentId, messageId);
    }

    return agentRewindResponseSchema.parse({
      type: "agent.rewind.response",
      requestId,
      payload: { agentId, messageId, mode, truncatedAt },
    });
  });
}
