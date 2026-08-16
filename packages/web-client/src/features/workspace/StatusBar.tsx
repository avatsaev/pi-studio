/**
 * StatusBar — full-width, 35px, y-centered powerline bar at the bottom of the workspace shell
 * (sprint-042). Renders icon-prefixed segments for the **active session**: cwd, git branch
 * (+ ahead/behind/dirty/conflict), context usage, token total, and cost. Fully swaps when
 * `activeSessionId` changes — every value is read from the active session's entry or from
 * per-session `stats-store`; nothing here is scoped to a specific tab. Mounting this component is
 * also what drives the active session's stats poll (`useSessionStats`, sprint-042/task-004) — no
 * other consumer of `stats-store` exists yet, so the poll runs exactly while the bar is on screen.
 *
 * Every segment here is read-only. The interactive model picker this bar used to host now lives
 * in the composer's bottom toolbar (`features/chat/Composer.tsx`), next to the actions it belongs
 * with; this bar owns no `ModelMenu`, no `setModel`, and no `ensureMaterialized` call.
 */

import type { ReactNode } from "react";
import { ChevronRight, Coins, DollarSign, Folder, GitBranch, Gauge } from "lucide-react";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useGitStore } from "@pi-studio-ui/stores/git-store.js";
import { useStatsStore } from "@pi-studio-ui/stores/stats-store.js";
import { useSessionStats } from "@pi-studio-ui/hooks/use-session-stats.js";
import { useCheckoutStatus } from "@pi-studio-ui/hooks/use-checkout-status.js";
import { useHomeDir } from "@pi-studio-ui/hooks/use-home-dir.js";
import {
  formatBranchMeta,
  formatCost,
  formatCwd,
  formatPercent,
  formatTokens,
} from "./status-bar-format.js";
import styles from "./StatusBar.module.css";

interface Segment {
  key: string;
  icon: ReactNode;
  text: string;
  title?: string;
}

export function StatusBar() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) =>
    activeSessionId ? s.sessions[activeSessionId] : undefined,
  );
  const homeDir = useHomeDir();
  // Own the same live checkout-status subscription `ChangesPanel` uses (POC pattern,
  // `use-checkout-status.ts`), keyed off the same `activeWorkspaceCwd` — so the branch segment
  // updates live even when the Changes tab has never been opened. Subscribing to the SAME cwd
  // `ChangesPanel` would use is intentional and safe (idempotent re-subscribe); subscribing to a
  // *different* cwd than the Changes panel would corrupt its file list, since `git-store` is one
  // global singleton — this must always track the workspace-level cwd, never a per-session one.
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  useCheckoutStatus(activeWorkspaceCwd || "");
  const gitAvailable = useGitStore((s) => s.available);
  const branch = useGitStore((s) => s.branch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const detached = useGitStore((s) => s.detached);
  const conflictCount = useGitStore((s) => s.conflictCount);
  const dirtyCount = useGitStore((s) => s.changes.length);

  const stats = useStatsStore((s) => (activeSessionId ? s.bySession[activeSessionId] : undefined));

  useSessionStats(activeSessionId);

  const segments: Segment[] = [];

  if (session) {
    const cwdText = formatCwd(session.cwd, homeDir);
    segments.push({ key: "cwd", icon: <Folder size={13} />, text: cwdText, title: session.cwd });
  }

  if (gitAvailable) {
    const branchMeta = formatBranchMeta(ahead, behind);
    const parts = [detached ? "(detached)" : (branch ?? "?")];
    if (branchMeta) parts.push(branchMeta);
    if (dirtyCount > 0) parts.push(`●${dirtyCount}`);
    if (conflictCount > 0) parts.push(`⚠${conflictCount}`);
    segments.push({ key: "branch", icon: <GitBranch size={13} />, text: parts.join(" ") });
  }

  if (session) {
    const contextText = `${formatPercent(stats?.contextPercent)} (${formatTokens(stats?.contextTokens)}/${formatTokens(stats?.contextWindow)})`;
    segments.push({ key: "context", icon: <Gauge size={13} />, text: contextText });

    segments.push({
      key: "tokens",
      icon: <Coins size={13} />,
      text: formatTokens(stats?.totalTokens),
      title: `in ${formatTokens(stats?.inputTokens)} / out ${formatTokens(stats?.outputTokens)}`,
    });

    segments.push({
      key: "cost",
      icon: <DollarSign size={13} />,
      text: formatCost(stats?.cost),
    });
  }

  return (
    <div className={styles.statusBar}>
      {segments.map((seg, i) => (
        <span key={seg.key} className={styles.segmentGroup}>
          {i > 0 && <ChevronRight size={12} className={styles.chevron} aria-hidden="true" />}
          <span className={styles.segment} title={seg.title}>
            <span className={styles.icon}>{seg.icon}</span>
            <span className={styles.text}>{seg.text}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
