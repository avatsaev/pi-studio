// Command center model.
// app-navigation-screens.md § Command center

import { routes } from "../runtime/route-grammar.js";

export type CommandCenterAgent = {
  serverId: string;
  agentId: string;
  title?: string;
  cwd?: string;
  status: "idle" | "running" | "waiting" | "finished" | "error" | "queued" | "archived";
  requiresAttention?: boolean;
  pendingPermissionCount?: number;
  lastActivityMs: number;
};

export type StaticCommandAction = {
  id: "new-agent" | "home" | "settings";
  label: string;
  keywords: string[];
  route: string;
};

export const STATIC_COMMAND_ACTIONS: readonly StaticCommandAction[] = [
  { id: "new-agent", label: "New agent", keywords: ["new", "agent", "project"], route: routes.newWorkspace() },
  { id: "home", label: "Home", keywords: ["home", "open", "project"], route: routes.openProject() },
  { id: "settings", label: "Settings", keywords: ["settings", "preferences"], route: routes.settings() },
];

export type CommandCenterItem =
  | { kind: "agent"; agent: CommandCenterAgent; label: string; route: string; rank: number }
  | { kind: "action"; action: StaticCommandAction; label: string; route: string; rank: number };

export function commandCenterItems(input: {
  agents: readonly CommandCenterAgent[];
  query: string;
  staticActions?: readonly StaticCommandAction[];
}): CommandCenterItem[] {
  const q = input.query.trim().toLowerCase();
  const agentMatches = input.agents
    .filter((agent) => {
      if (!q) return true;
      return (agent.title ?? "New agent").toLowerCase().includes(q) || (agent.cwd ?? "").toLowerCase().includes(q);
    })
    .map((agent): CommandCenterItem => ({
      kind: "agent",
      agent,
      label: agent.title ?? "New agent",
      route: routes.agent(agent.serverId, agent.agentId),
      rank: agentRank(agent),
    }))
    .sort((a, b) => a.rank - b.rank || (b.kind === "agent" ? b.agent.lastActivityMs : 0) - (a.kind === "agent" ? a.agent.lastActivityMs : 0));

  const actions = (input.staticActions ?? STATIC_COMMAND_ACTIONS)
    .filter((action) => {
      if (!q) return true;
      const haystack = [action.label, ...action.keywords].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .map((action): CommandCenterItem => ({ kind: "action", action, label: action.label, route: action.route, rank: 10_000 }));

  return [...agentMatches, ...actions];
}

function agentRank(agent: CommandCenterAgent): number {
  if ((agent.pendingPermissionCount ?? 0) > 0) return 0;
  if (agent.requiresAttention) return 1;
  if (agent.status === "running" || agent.status === "queued") return 2;
  return 3;
}

export type CommandCenterState = {
  open: boolean;
  highlightedIndex: number;
  previousFocusId?: string;
};

export type CommandCenterAction =
  | { type: "OPEN"; previousFocusId?: string }
  | { type: "CLOSE" }
  | { type: "ARROW_DOWN"; itemCount: number }
  | { type: "ARROW_UP"; itemCount: number };

export function commandCenterReducer(state: CommandCenterState, action: CommandCenterAction): CommandCenterState {
  switch (action.type) {
    case "OPEN":
      return { open: true, highlightedIndex: 0, previousFocusId: action.previousFocusId };
    case "CLOSE":
      return { ...state, open: false };
    case "ARROW_DOWN":
      if (action.itemCount === 0) return state;
      return { ...state, highlightedIndex: (state.highlightedIndex + 1) % action.itemCount };
    case "ARROW_UP":
      if (action.itemCount === 0) return state;
      return { ...state, highlightedIndex: (state.highlightedIndex - 1 + action.itemCount) % action.itemCount };
  }
}

export function activateCommandCenterItem(item: CommandCenterItem): { route: string } {
  return { route: item.route };
}

export class FocusRestoreRegistry {
  private readonly callbacks = new Map<string, () => void>();

  register(id: string, restore: () => void): () => void {
    this.callbacks.set(id, restore);
    return () => this.callbacks.delete(id);
  }

  restore(id: string | undefined): boolean {
    if (!id) return false;
    const cb = this.callbacks.get(id);
    if (!cb) return false;
    cb();
    return true;
  }
}
