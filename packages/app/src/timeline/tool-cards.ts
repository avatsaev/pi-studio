// Tool-call card view models.
// clean-room-scope/features/timeline-rendering.md § Tool-call cards

export type ToolCallStatus = "running" | "completed" | "failed" | "canceled";

export type ToolDetailType =
  | "shell"
  | "worktree_setup"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "fetch"
  | "sub_agent"
  | "plan"
  | "plain_text"
  | "unknown";

export type ToolIcon =
  | "terminal"
  | "eye"
  | "pencil"
  | "search"
  | "bot"
  | "brain"
  | "mic"
  | "wrench"
  | "pi-studio";

export type ToolCardPresentation = {
  displayName: string;
  summary: string;
  icon: ToolIcon;
  status: ToolCallStatus;
  errorText?: string;
  isLoadingDetails: boolean;
  hasDetails: boolean;
  canOpenDetails: boolean;
  openFilePath?: string;
  isPlan: boolean;
};

export type ToolCallPayload = {
  callId: string;
  name: string;
  status: ToolCallStatus;
  detail?: ToolCallDetail;
  error?: string;
  metadata?: unknown;
};

export type ToolCallDetail =
  | { type: "shell"; command: string; output?: string; exitCode?: number }
  | { type: "worktree_setup"; branch: string; path?: string; log?: string }
  | { type: "read"; filePath: string; content?: string; offset?: number }
  | { type: "edit"; filePath: string; diff?: string }
  | { type: "write"; filePath: string; content?: string }
  | { type: "search"; query: string; content?: string; filePaths?: string[]; webResults?: WebResult[] }
  | { type: "fetch"; url: string; result?: string }
  | { type: "sub_agent"; subAgentType?: string; description?: string; log?: string; sessionId?: string }
  | { type: "plan"; title?: string; description?: string; body?: string }
  | { type: "plain_text"; label?: string; text: string; icon?: string }
  | { type: "unknown"; input?: unknown; output?: unknown };

export type WebResult = { title: string; url: string; snippet?: string };

const TRUNCATE_LIMIT = 2000;

export function buildToolCardPresentation(payload: ToolCallPayload): ToolCardPresentation {
  const detail = payload.detail;
  const detailType: ToolDetailType = detail?.type ?? "unknown";
  return {
    displayName: resolveDisplayName(detailType, payload.name, detail),
    summary: resolveSummary(detailType, detail),
    icon: resolveIcon(detailType, payload.name),
    status: payload.status,
    errorText: payload.status === "failed" ? payload.error : undefined,
    isLoadingDetails: payload.status === "running" && !detail,
    hasDetails: Boolean(detail),
    canOpenDetails: detailType !== "unknown" || Boolean(detail),
    openFilePath: resolveOpenFilePath(detail),
    isPlan: detailType === "plan",
  };
}

function resolveDisplayName(type: ToolDetailType, name: string, detail: ToolCallDetail | undefined): string {
  switch (type) {
    case "shell": return "Shell";
    case "worktree_setup": return "Worktree Setup";
    case "read": return "Read";
    case "edit": return "Edit";
    case "write": return "Write";
    case "search": return "Search";
    case "fetch": return "Fetch";
    case "sub_agent": return (detail as { subAgentType?: string } | undefined)?.subAgentType ?? "Task";
    case "plan": return "Plan";
    case "plain_text": return (detail as { label?: string } | undefined)?.label ?? humanizeName(name);
    default:
      if (name === "task" || name === "thinking") return humanizeName(name);
      if (name === "terminal") return "Terminal";
      return humanizeName(name);
  }
}

function resolveSummary(type: ToolDetailType, detail: ToolCallDetail | undefined): string {
  if (!detail) return "";
  switch (type) {
    case "shell": return (detail as { command: string }).command ?? "";
    case "worktree_setup": return (detail as { branch: string }).branch ?? "";
    case "read": return (detail as { filePath: string }).filePath ?? "";
    case "edit": return (detail as { filePath: string }).filePath ?? "";
    case "write": return (detail as { filePath: string }).filePath ?? "";
    case "search": return (detail as { query: string }).query ?? "";
    case "fetch": return (detail as { url: string }).url ?? "";
    case "sub_agent": return (detail as { description?: string }).description ?? "";
    default: return "";
  }
}

function resolveIcon(type: ToolDetailType, name: string): ToolIcon {
  switch (type) {
    case "shell": case "worktree_setup": return "terminal";
    case "read": return "eye";
    case "edit": case "write": return "pencil";
    case "search": case "fetch": return "search";
    case "sub_agent": return "bot";
    case "plan": return "brain";
    case "plain_text":
      if (name === "speak") return "mic";
      return "wrench";
    default:
      if (name === "task" || name.includes("agent")) return "bot";
      if (name === "thinking") return "brain";
      if (name === "speak") return "mic";
      return "wrench";
  }
}

function resolveOpenFilePath(detail: ToolCallDetail | undefined): string | undefined {
  if (!detail) return undefined;
  if ("filePath" in detail) return (detail as { filePath: string }).filePath;
  return undefined;
}

export function humanizeName(name: string): string {
  // Keep paths, ::, __ verbatim; convert snake/kebab to Title Case for simple names
  if (name.includes("/") || name.includes("::") || name.includes("__")) return name;
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Expanded detail model ─────────────────────────────────────────────────

export type ExpandedDetailSection =
  | { kind: "code"; language: string; content: string; fullBleed: boolean }
  | { kind: "diff"; filePath: string; diff: string }
  | { kind: "text"; content: string }
  | { kind: "json"; label: string; value: unknown }
  | { kind: "sub-agent-log"; lines: SubAgentLogLine[]; sessionId?: string }
  | { kind: "search-results"; content?: string; filePaths?: string[]; webResults?: WebResult[] }
  | { kind: "error"; errorText: string }
  | { kind: "empty" };

export type SubAgentLogLine =
  | { type: "action"; tool: string; summary: string }
  | { type: "text"; text: string };

export function buildExpandedDetail(payload: ToolCallPayload): ExpandedDetailSection[] {
  const sections: ExpandedDetailSection[] = [];
  const detail = payload.detail;
  if (!detail) return [{ kind: "empty" }];

  switch (detail.type) {
    case "shell":
      sections.push({ kind: "code", language: "shell", content: `$ ${detail.command}${detail.output ? `\n${truncate(detail.output)}` : ""}`, fullBleed: true });
      break;
    case "worktree_setup":
      sections.push({ kind: "code", language: "plaintext", content: detail.log ?? `Preparing worktree ${detail.branch}${detail.path ? ` at ${detail.path}` : ""}`, fullBleed: true });
      break;
    case "read":
      sections.push({ kind: "code", language: extensionOf(detail.filePath), content: truncate(detail.content ?? ""), fullBleed: false });
      break;
    case "edit":
      sections.push({ kind: "diff", filePath: detail.filePath, diff: detail.diff ?? "" });
      break;
    case "write":
      sections.push({ kind: "code", language: extensionOf(detail.filePath), content: truncate(detail.content ?? ""), fullBleed: true });
      break;
    case "search":
      sections.push({ kind: "search-results", content: detail.content, filePaths: detail.filePaths, webResults: detail.webResults });
      break;
    case "fetch":
      sections.push({ kind: "text", content: detail.url });
      if (detail.result) sections.push({ kind: "code", language: "plaintext", content: truncate(detail.result), fullBleed: false });
      break;
    case "sub_agent":
      sections.push({ kind: "sub-agent-log", lines: parseSubAgentLog(detail.log ?? ""), sessionId: detail.sessionId });
      break;
    case "plan":
      sections.push({ kind: "text", content: [detail.title, detail.description, detail.body].filter(Boolean).join("\n\n") });
      break;
    case "plain_text":
      sections.push({ kind: "text", content: detail.text });
      break;
    case "unknown":
      if (detail.input) sections.push({ kind: "json", label: "Input", value: detail.input });
      if (detail.output) sections.push({ kind: "json", label: "Output", value: detail.output });
      if (!detail.input && !detail.output) sections.push({ kind: "empty" });
      break;
  }

  if (payload.error) {
    sections.push({ kind: "error", errorText: payload.error });
  }

  return sections;
}

export function truncate(text: string, limit = TRUNCATE_LIMIT): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n… (${text.length - limit} more characters)`;
}

function parseSubAgentLog(log: string): SubAgentLogLine[] {
  return log.split("\n").map((line) => {
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
    return m ? { type: "action" as const, tool: m[1]!, summary: m[2]! } : { type: "text" as const, text: line };
  });
}

function extensionOf(filePath: string): string {
  const m = /\.(\w+)$/.exec(filePath);
  return m?.[1] ?? "plaintext";
}

// ─── Status visual model ───────────────────────────────────────────────────

export type StatusVisual = {
  shimmer: boolean;
  iconVariant: "normal" | "alert" | "dimmed";
  labelDimmed: boolean;
};

export function resolveStatusVisual(status: ToolCallStatus): StatusVisual {
  switch (status) {
    case "running": return { shimmer: true, iconVariant: "dimmed", labelDimmed: true };
    case "completed": return { shimmer: false, iconVariant: "normal", labelDimmed: false };
    case "failed": return { shimmer: false, iconVariant: "alert", labelDimmed: false };
    case "canceled": return { shimmer: false, iconVariant: "dimmed", labelDimmed: false };
  }
}
