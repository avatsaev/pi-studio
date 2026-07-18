/**
 * ChatPanel — the tab content mounted by `panel-registry.ts` for `kind: "chat"` tabs. Looks up
 * the session by `tab.data.sessionId`, keeps its timeline live via `useAgentStream`, and renders
 * the virtualized `Timeline` + `Composer` (POC_TO_APP_PLAN_UI.md §4.3/§4.4).
 */

import { useAgentStream } from "@pi-studio-ui/hooks/use-agent-stream.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import type { Tab, ChatTabData } from "@pi-studio-ui/stores/tab-store.js";
import { Timeline } from "./Timeline.js";
import { Composer } from "./Composer.js";
import styles from "./ChatPanel.module.css";

export interface ChatPanelProps {
  tab: Tab;
}

export function ChatPanel({ tab }: ChatPanelProps) {
  // `panel-registry.ts` only ever mounts this component for `tab.kind === "chat"`, whose `data`
  // is always `ChatTabData` — narrowed here since `Tab["data"]` is a union at the type level.
  const { sessionId } = tab.data as ChatTabData;
  const session = useSessionStore((s) => s.sessions[sessionId]);

  useAgentStream(sessionId);

  if (!session) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>Session not found.</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <Timeline session={session} />
      <Composer sessionId={session.id} />
    </div>
  );
}
