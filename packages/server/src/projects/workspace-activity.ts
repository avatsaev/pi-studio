/**
 * Workspace activity bucket aggregation (features/projects-workspaces.md § Workspace activity bucket;
 * architecture/agent-lifecycle.md § Lifecycle status semantics).
 *
 * Workspace status is an aggregate signal — NOT an agent's literal status:
 * - Root agents contribute their own bucket to their workspace (by cwd).
 * - A running subagent escalates `running` to its ROOT PARENT's workspace, not its own cwd.
 * - Non-running subagent attention/error states stay in the parent's track and do NOT escalate the
 *   workspace bucket.
 */

export type WorkspaceBucket = "running" | "error" | "attention" | "idle" | "closed" | "none";

export interface AgentActivityInput {
  id: string;
  cwd: string;
  /** Literal agent status. */
  status: "initializing" | "idle" | "running" | "error" | "closed";
  /** Root parent has `null`; a subagent points at its (possibly transitive) parent. */
  parentAgentId: string | null;
  /** Root agents may flag a non-running attention state (permission/error needing the user). */
  needsAttention?: boolean;
}

const PRIORITY: Record<WorkspaceBucket, number> = {
  running: 5,
  error: 4,
  attention: 3,
  idle: 2,
  closed: 1,
  none: 0,
};

function statusBucket(
  status: AgentActivityInput["status"],
  needsAttention?: boolean,
): WorkspaceBucket {
  if (status === "running") return "running";
  if (status === "error") return "error";
  if (needsAttention) return "attention";
  if (status === "closed") return "closed";
  // initializing folds into idle for the workspace signal.
  return "idle";
}

function higher(a: WorkspaceBucket, b: WorkspaceBucket): WorkspaceBucket {
  return PRIORITY[a] >= PRIORITY[b] ? a : b;
}

/** Resolve an agent's root ancestor by walking parent links (cycle-safe). */
export function resolveRoot(
  agentId: string,
  byId: Map<string, AgentActivityInput>,
): AgentActivityInput | undefined {
  let current = byId.get(agentId);
  const seen = new Set<string>();
  while (current && current.parentAgentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentAgentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/**
 * Aggregate per-workspace activity buckets keyed by workspace cwd.
 */
export function aggregateWorkspaceActivity(
  agents: AgentActivityInput[],
): Map<string, WorkspaceBucket> {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const buckets = new Map<string, WorkspaceBucket>();

  const contribute = (cwd: string, bucket: WorkspaceBucket): void => {
    if (bucket === "none") return;
    buckets.set(cwd, higher(buckets.get(cwd) ?? "none", bucket));
  };

  for (const agent of agents) {
    const isRoot = agent.parentAgentId === null;
    if (isRoot) {
      contribute(agent.cwd, statusBucket(agent.status, agent.needsAttention));
      continue;
    }
    // Subagent: ONLY a running state escalates, and it escalates to the root parent's workspace.
    if (agent.status === "running") {
      const root = resolveRoot(agent.id, byId);
      if (root) contribute(root.cwd, "running");
    }
    // Non-running subagent attention/error stays in the parent's track — no workspace escalation.
  }

  return buckets;
}
