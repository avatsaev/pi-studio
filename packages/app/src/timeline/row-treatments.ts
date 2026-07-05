// Row treatment view-models per kind.
// clean-room-scope/features/timeline-rendering.md § Row treatments

export type MessageAlignment = "left" | "right";

export type UserMessageModel = {
  alignment: "right";
  text: string;
  timestamp: number;
  images: readonly AttachmentImage[];
  attachments: readonly StructuredAttachment[];
  optimistic: boolean;
  showRewindMenu: boolean;
  showCopyButton: boolean;
};

export type AttachmentImage = {
  url: string;
  width?: number;
  height?: number;
};

export type StructuredAttachment = {
  kind: "pr" | "issue" | "review" | "text";
  label: string;
  url?: string;
  number?: number;
  commentCount?: number;
};

export type AssistantMessageModel = {
  alignment: "left";
  text: string;
  messageId?: string;
  blockGroupId?: string;
  blockIndex?: number;
  isStreaming: boolean;
  collapseTopSpacing: boolean;
  collapseBottomSpacing: boolean;
};

export type ThinkingRowModel = {
  kind: "thinking";
  text: string;
  status: "loading" | "ready";
  expanded: boolean;
};

export type ActivityLogModel = {
  activityType: "system" | "info" | "success" | "error" | "artifact";
  message: string;
  metadata?: unknown;
  clickable: boolean;
  detailsExpanded: boolean;
};

export type CompactionModel = {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
  label: string;
};

export type ErrorRowModel = {
  message: string;
  code?: string;
  retryable: boolean;
};

export function buildUserMessageModel(row: {
  text: string;
  timestamp: number;
  images?: readonly AttachmentImage[];
  attachments?: readonly StructuredAttachment[];
  optimistic?: boolean;
  canRewind: boolean;
}): UserMessageModel {
  return {
    alignment: "right",
    text: row.text,
    timestamp: row.timestamp,
    images: row.images ?? [],
    attachments: row.attachments ?? [],
    optimistic: row.optimistic ?? false,
    showRewindMenu: row.canRewind,
    showCopyButton: true,
  };
}

export function buildAssistantMessageModel(row: {
  text: string;
  messageId?: string;
  blockGroupId?: string;
  blockIndex?: number;
  isStreaming?: boolean;
  prevBlockGroupId?: string;
  nextBlockGroupId?: string;
}): AssistantMessageModel {
  const collapseTop = Boolean(row.prevBlockGroupId && row.prevBlockGroupId === row.blockGroupId);
  const collapseBottom = Boolean(row.nextBlockGroupId && row.nextBlockGroupId === row.blockGroupId);
  return {
    alignment: "left",
    text: row.text,
    messageId: row.messageId,
    blockGroupId: row.blockGroupId,
    blockIndex: row.blockIndex,
    isStreaming: row.isStreaming ?? false,
    collapseTopSpacing: collapseTop,
    collapseBottomSpacing: collapseBottom,
  };
}

export function buildCompactionModel(row: {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}): CompactionModel {
  let label: string;
  if (row.status === "loading") {
    label = "Compacting…";
  } else if (row.preTokens) {
    label = `Context compacted (${row.preTokens.toLocaleString()} tokens)`;
  } else {
    label = row.trigger === "manual"
      ? "Context manually compacted"
      : "Context automatically compacted";
  }
  return { status: row.status, trigger: row.trigger, preTokens: row.preTokens, label };
}

export function buildActivityLogModel(row: {
  activityType: ActivityLogModel["activityType"];
  message: string;
  metadata?: unknown;
}): ActivityLogModel {
  return { activityType: row.activityType, message: row.message, metadata: row.metadata, clickable: row.activityType === "artifact", detailsExpanded: false };
}
