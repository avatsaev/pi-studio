/**
 * BulkCloseDialog — confirmation flow for closing workspace/many tabs.
 * workspace-ui.md § Bulk close
 */

import { useMemo } from "react";
import { Button } from "../primitives/index.js";
import { AdaptiveSheet } from "../overlays/Dialog.js";
import {
  planBulkClose,
  type BulkClosePlan,
} from "../../workspace/bulk-close.js";
import type { WorkspaceTab } from "../../workspace/tabs.js";
import type { AgentForSubagentPolicy } from "../../workspace/subagents.js";

export interface BulkCloseDialogProps {
  visible: boolean;
  tabs: readonly WorkspaceTab[];
  agents: readonly AgentForSubagentPolicy[];
  onConfirm: (plan: BulkClosePlan) => void;
  onCancel: () => void;
}

export function BulkCloseDialog({
  visible,
  tabs,
  agents,
  onConfirm,
  onCancel,
}: BulkCloseDialogProps) {
  const plan = useMemo(() => planBulkClose(tabs, agents), [tabs, agents]);

  return (
    <AdaptiveSheet visible={visible} onClose={onCancel} title="Close workspace">
      <p style={{ fontSize: 13, color: "var(--pi-color-foreground)", margin: "0 0 16px" }}>
        {plan.confirmation}
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <Button variant="destructive" onClick={() => onConfirm(plan)}>
          Close all
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </AdaptiveSheet>
  );
}
