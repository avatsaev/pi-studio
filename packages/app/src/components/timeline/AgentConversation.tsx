/**
 * AgentConversation — the timeline + composer composition for a single agent.
 *
 * Extracted so both the workspace AgentPane (PaneContentRouter) and the
 * standalone Agent detail screen (LiveAgentPage) render the exact same
 * conversation surface from one source of truth.
 *
 * clean-room-scope/features/timeline-rendering.md, features/composer-ui.md
 */

import { Timeline, Composer } from "./index.js";
import type { RenderItem } from "../../timeline/render-model.js";
import { useAgentTimelineSubscription } from "../../hooks/use-timeline-hooks.js";
import { useDraft, useComposerController } from "../../hooks/use-composer.js";
import { useComposerAutocomplete } from "../../hooks/use-composer-autocomplete.js";
import { useAgentUsage } from "../../hooks/use-usage.js";
import { useClient } from "../../hooks/client-context.js";
import { useSessionStore } from "../../store/session-store.js";

export interface AgentConversationProps {
  serverId: string;
  agentId: string;
}

export function AgentConversation({ serverId, agentId }: AgentConversationProps) {
  const { items, loadingOlder, loadOlder } = useAgentTimelineSubscription(agentId);
  const rows = items.map((i: RenderItem) => i.row);
  const draftKey = `agent:${agentId}`;
  const draft = useDraft(draftKey);
  const controller = useComposerController({ agentId, draftKey });
  const client = useClient();
  const cwd = useSessionStore((s) => s.agents[agentId]?.cwd);
  const model = useSessionStore((s) => s.agents[agentId]?.model);
  const usage = useAgentUsage(agentId, model);
  const { providerCommands, fileEntries } = useComposerAutocomplete(
    serverId,
    agentId,
    cwd,
    client as Parameters<typeof useComposerAutocomplete>[3],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <Timeline rows={rows} onLoadOlder={loadOlder} loadingOlder={loadingOlder} />
      </div>
      <Composer
        key={draftKey}
        agentRunning={controller.agentRunning}
        processingState={controller.processingState}
        initialDraft={draft.text}
        initialAttachments={draft.attachments}
        onDraftChange={draft.setText}
        onAttachmentsChange={draft.setAttachments}
        providerCommands={providerCommands}
        fileEntries={fileEntries}
        providerUsageLabel={usage.label}
        usageBreakdown={usage.breakdown}
        onSubmit={(text, attachments) => void controller.submit(text, attachments)}
        onQueue={(text) => void controller.submit(text, [])}
      />
    </div>
  );
}
