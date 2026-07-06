/**
 * ToolCard, DiffSection, PermissionPrompt — timeline row renderers.
 * timeline-rendering.md § Tool cards, § Diffs; tool-permissions.md
 */

import { useState, useMemo } from "react";
import { clsx } from "clsx";
import styles from "./ToolCards.module.css";
import { Button } from "../primitives/index.js";
import { registerRowRenderer, type RowRendererFn } from "./Timeline.js";
import {
  buildToolCardPresentation,
  buildExpandedDetail,
  resolveStatusVisual,
  type ToolCallPayload,
  type ToolCallStatus,
  type ExpandedDetailSection,
} from "../../timeline/tool-cards.js";
import {
  buildDiffRowViewModel,
  diffStatLabel,
  type DiffRowViewModel,
  type DiffLine,
} from "../../timeline/diff-rows.js";
import {
  buildPermissionPrompt,
  startResponding,
  resolvePermission,
  type PermissionPromptModel,
  type PermissionOption,
} from "../../timeline/permissions.js";
import type { RenderItem } from "../../timeline/render-model.js";

// ---------------------------------------------------------------------------
// Diff section (reusable)
// ---------------------------------------------------------------------------

function DiffSection({ raw, filePath }: { raw: string; filePath?: string }) {
  const vm = useMemo(() => buildDiffRowViewModel(raw, filePath), [raw, filePath]);

  return (
    <div>
      {vm.stat && <div className={styles.diffStat}>{diffStatLabel(vm.stat)}</div>}
      {vm.hunks.map((hunk, hi) => (
        <div key={hi} className={styles.diffHunk}>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={clsx(
                styles.diffLine,
                line.type === "add" && styles.diffAdd,
                line.type === "remove" && styles.diffRemove,
                line.type === "header" && styles.diffHeader,
              )}
            >
              <span className={styles.diffGutter}>{line.prefix}</span>
              <span className={styles.diffContent}>{line.content}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCard
// ---------------------------------------------------------------------------

function ToolCardView({ payload }: { payload: ToolCallPayload }) {
  const [expanded, setExpanded] = useState(false);
  const presentation = useMemo(() => buildToolCardPresentation(payload), [payload]);
  const statusVisual = resolveStatusVisual(payload.status ?? "completed");
  const detail = useMemo(() => expanded ? buildExpandedDetail(payload) : [], [expanded, payload]);
  const failed = payload.status === "failed";

  return (
    <div className={clsx(styles.card, failed && styles.cardError)}>
      <div className={styles.cardHeader} onClick={() => setExpanded(!expanded)}>
        <span className={styles.cardIcon}>{statusVisual.shimmer ? "⟳" : failed ? "⚠" : payload.status === "completed" ? "✓" : "•"}</span>
        <span className={clsx(styles.cardName, statusVisual.labelDimmed && styles.cardNameDimmed)}>{presentation.displayName}</span>
        {presentation.summary && <span className={styles.cardSummary}>{presentation.summary}</span>}
        <span className={clsx(
          styles.cardStatus,
          payload.status === "running" && styles.statusRunning,
          payload.status === "completed" && styles.statusCompleted,
          payload.status === "failed" && styles.statusFailed,
        )}>
          {payload.status ?? "completed"}
        </span>
      </div>

      {payload.status === "running" && <div className={styles.shimmer} style={{ height: 2 }} />}

      {expanded && detail.length > 0 && (
        <div className={styles.cardBody}>
          {detail.map((section, i) => (
            <DetailSectionView key={i} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}

const ToolCallCard: RowRendererFn = (item) => {
  const payload = item.row.payload as ToolCallPayload | undefined;
  if (!payload) return <div className={styles.card}>Unknown tool call</div>;
  return <ToolCardView payload={payload} />;
};

// Collapsible cluster of consecutive tool calls with a summary line.
function ToolClusterView({ summary, payloads, hasError }: { summary: string; payloads: ToolCallPayload[]; hasError: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={clsx(styles.cluster, hasError && styles.cardError)}>
      <button type="button" className={styles.clusterHeader} onClick={() => setOpen((v) => !v)}>
        <span>{open ? "▾" : "▸"}</span>
        <span>{summary}</span>
      </button>
      {open && (
        <div className={styles.clusterBody}>
          {payloads.map((p, i) => <ToolCardView key={p.callId ?? i} payload={p} />)}
        </div>
      )}
    </div>
  );
}

function DetailSectionView({ section }: { section: ExpandedDetailSection }) {
  switch (section.kind) {
    case "diff":
      return <DiffSection raw={section.diff} filePath={section.filePath} />;
    case "code":
      return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{section.content}</pre>;
    case "text":
      return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{section.content}</pre>;
    case "error":
      return <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--pi-color-statusDanger)" }}>{section.errorText}</pre>;
    case "json":
      return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(section.value, null, 2)}</pre>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Permission prompt
// ---------------------------------------------------------------------------

const PermissionRow: RowRendererFn = (item) => {
  const payload = item.row.payload as { question?: string; options?: PermissionOption[]; kind?: string; resolved?: { source: string; option: string } } | undefined;
  if (!payload) return null;

  const [prompt, setPrompt] = useState<PermissionPromptModel>(() =>
    buildPermissionPrompt({
      title: payload.question ?? "Allow?",
      options: payload.options,
      kind: (payload.kind as any) ?? "tool",
    }),
  );

  // If already resolved from server
  if (payload.resolved) {
    return (
      <div className={clsx(styles.permission, styles.permissionResolved)}>
        <p className={styles.permissionQuestion}>{payload.question}</p>
        <div className={styles.resolvedLabel}>
          Resolved: {payload.resolved.option} ({payload.resolved.source})
        </div>
      </div>
    );
  }

  const handleOption = (optionId: string) => {
    setPrompt((p) => resolvePermission(startResponding(p, optionId), { source: "user", option: optionId }));
  };

  return (
    <div className={clsx(styles.permission, prompt.state === "resolved" && styles.permissionResolved)}>
      <p className={styles.permissionQuestion}>{prompt.title}</p>
      {prompt.state === "pending" && (
        <div className={styles.permissionOptions}>
          {prompt.options.map((opt) => (
            <Button key={opt.id} size="sm" variant={opt.variant === "primary" ? "default" : opt.variant === "danger" ? "destructive" : "ghost"} onClick={() => handleOption(opt.id)}>
              {opt.label}
            </Button>
          ))}
        </div>
      )}
      {prompt.state === "resolved" && (
        <div className={styles.resolvedLabel}>
          Resolved: {prompt.resolvedBy?.option}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Controlled permission prompt card (live-area, RPC-driven)
// ---------------------------------------------------------------------------

export interface PermissionPromptCardProps {
  requestId: string;
  title: string;
  description?: string;
  options: PermissionOption[];
  /** requestId currently submitting (spinner shown on its option). */
  respondingId?: string | null;
  resolved?: { option: string; source?: string };
  onRespond(requestId: string, optionId: string): void;
}

/**
 * A permission prompt whose state lives in the session store and whose
 * responses are submitted via RPC (through `usePermissionResponder`). Unlike
 * the local `PermissionRow`, this is fully controlled.
 */
export function PermissionPromptCard({
  requestId,
  title,
  description,
  options,
  respondingId,
  resolved,
  onRespond,
}: PermissionPromptCardProps) {
  const responding = respondingId === requestId;
  if (resolved) {
    return (
      <div className={clsx(styles.permission, styles.permissionResolved)}>
        <p className={styles.permissionQuestion}>{title}</p>
        <div className={styles.resolvedLabel}>
          Resolved: {resolved.option}{resolved.source ? ` (${resolved.source})` : ""}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.permission}>
      <p className={styles.permissionQuestion}>{title}</p>
      {description && <p className={styles.permissionDescription}>{description}</p>}
      <div className={styles.permissionOptions}>
        {options.map((opt) => (
          <Button
            key={opt.id}
            size="sm"
            disabled={responding}
            variant={opt.variant === "primary" ? "default" : opt.variant === "danger" ? "destructive" : "ghost"}
            onClick={() => onRespond(requestId, opt.id)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register renderers
// ---------------------------------------------------------------------------

registerRowRenderer("tool_call", ToolCallCard);
// Permission prompts may come as a tool_call sub-kind or a dedicated row kind
// For now we expose PermissionRow for manual registration/use

export { ToolCallCard, ToolCardView, ToolClusterView, DiffSection, PermissionRow };
