// Permission request prompt model.
// clean-room-scope/features/timeline-rendering.md § Permission request prompt
// clean-room-scope/features/tool-permissions.md

export type PermissionKind = "question" | "plan" | "tool";

export type PermissionOption = {
  id: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
};

export type ToolPermissionState = "pending" | "responding" | "resolved";

export type ResolvedBy = { source: "user" | "auto"; option: string };

export type PermissionPromptModel = {
  kind: PermissionKind;
  title?: string;
  description?: string;
  body?: string;
  toolSummary?: string;
  options: PermissionOption[];
  state: ToolPermissionState;
  respondingOption?: string;
  resolvedBy?: ResolvedBy;
};

export const DEFAULT_OPTIONS: PermissionOption[] = [
  { id: "deny", label: "Deny", variant: "danger" },
  { id: "allow_once", label: "Allow once", variant: "secondary" },
  { id: "allow_always", label: "Allow always", variant: "primary" },
];

export function buildPermissionPrompt(payload: {
  kind: PermissionKind;
  title?: string;
  description?: string;
  body?: string;
  toolSummary?: string;
  options?: PermissionOption[];
}): PermissionPromptModel {
  return {
    kind: payload.kind,
    title: payload.title,
    description: payload.description,
    body: payload.body,
    toolSummary: payload.toolSummary,
    options: payload.options ?? DEFAULT_OPTIONS,
    state: "pending",
  };
}

export function startResponding(prompt: PermissionPromptModel, optionId: string): PermissionPromptModel {
  return { ...prompt, state: "responding", respondingOption: optionId };
}

export function resolvePermission(prompt: PermissionPromptModel, resolvedBy: ResolvedBy): PermissionPromptModel {
  return { ...prompt, state: "resolved", resolvedBy, respondingOption: undefined };
}

export type PermissionAnswerPayload = {
  permissionId: string;
  optionId: string;
  agentId: string;
};

export function buildAnswerPayload(permissionId: string, optionId: string, agentId: string): PermissionAnswerPayload {
  return { permissionId, optionId, agentId };
}

export function isAnswerable(prompt: PermissionPromptModel): boolean {
  return prompt.state === "pending";
}

export function isButtonDisabled(prompt: PermissionPromptModel, optionId: string): boolean {
  return prompt.state === "responding" && prompt.respondingOption !== optionId;
}

export function isButtonSpinning(prompt: PermissionPromptModel, optionId: string): boolean {
  return prompt.state === "responding" && prompt.respondingOption === optionId;
}
