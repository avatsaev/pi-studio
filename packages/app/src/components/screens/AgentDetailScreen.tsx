/**
 * AgentDetailScreen — presentational chrome for the standalone Agent view
 * (`/h/:serverId/agent/:agentId`). Renders a header (title, provider, status,
 * action buttons) above a conversation slot (timeline + composer).
 *
 * Gate + action-availability logic lives in `screens/agent-detail.ts`; this
 * component is intentionally thin. Live data wiring is in
 * `router/LiveAgentPage.tsx`.
 *
 * clean-room-scope/features/app-navigation-screens.md § Sessions / agent routing
 */

import type { ReactNode } from "react";
import type { AgentStatus } from "@av-pi-studio/protocol";
import { Button, StatusBadge, Spinner } from "../primitives/index.js";
import {
  type AgentDetailGate,
  type AgentDetailAction,
  enabledAgentDetailActions,
  agentDetailActionLabel,
  agentStatusBadgeVariant,
  agentStatusLabel,
} from "../../screens/agent-detail.js";

export interface AgentDetailScreenProps {
  gate: AgentDetailGate;
  title: string;
  provider?: string;
  status: AgentStatus | undefined;
  /** Conversation content (timeline + composer). */
  children?: ReactNode;
  onAction: (action: AgentDetailAction) => void;
  onBack?: () => void;
}

export function AgentDetailScreen({
  gate,
  title,
  provider,
  status,
  children,
  onAction,
  onBack,
}: AgentDetailScreenProps) {
  if (gate === "loading") {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (gate === "not-found") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <strong>Agent not found</strong>
        <p style={{ opacity: 0.7, margin: 0 }}>This agent may have been archived or does not exist.</p>
        {onBack && (
          <Button variant="default" onClick={onBack}>
            Back to sessions
          </Button>
        )}
      </div>
    );
  }

  const actions = enabledAgentDetailActions(status);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid var(--pi-color-border, rgba(255,255,255,0.1))",
          flex: "0 0 auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </span>
            <StatusBadge label={agentStatusLabel(status)} variant={agentStatusBadgeVariant(status)} />
          </div>
          {provider && <span style={{ fontSize: 12, opacity: 0.6 }}>{provider}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "archive" ? "ghost" : "default"}
              onClick={() => onAction(action)}
            >
              {agentDetailActionLabel(action)}
            </Button>
          ))}
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
