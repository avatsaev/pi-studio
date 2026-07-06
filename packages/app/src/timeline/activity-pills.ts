// Activity-log pill summarization: collapse individual file/git/terminal
// activity events into compact summary pills.
//
// clean-room-scope/features/timeline-rendering.md § Activity log pill,
// task-003 § Activity log pills

export type ActivityKind = "file" | "git" | "terminal" | "system" | "info" | "success" | "error" | "artifact";

export interface ActivityEvent {
  kind: ActivityKind;
  message: string;
  /** Optional metadata: file path, commit sha, command, tab target, etc. */
  metadata?: Record<string, unknown>;
}

export type PillTone = "info" | "success" | "error" | "neutral";

export interface ActivityPill {
  kind: ActivityKind;
  /** Summary label, e.g. "3 files edited", "committed abc1234", "ran npm test". */
  label: string;
  tone: PillTone;
  /** The individual events this pill summarizes (for the expanded view). */
  items: ActivityEvent[];
  /** Optional tab target to open when clicked (file preview / terminal). */
  linkTarget?: { type: "file" | "terminal"; value: string };
}

/**
 * Summarize a flat list of activity events into pills. File events group into a
 * single "N files edited" pill; git/terminal events each become their own pill.
 */
export function summarizeActivity(events: readonly ActivityEvent[]): ActivityPill[] {
  const pills: ActivityPill[] = [];
  const fileEvents: ActivityEvent[] = [];

  for (const ev of events) {
    if (ev.kind === "file") {
      fileEvents.push(ev);
    } else if (ev.kind === "git") {
      pills.push(gitPill(ev));
    } else if (ev.kind === "terminal") {
      pills.push(terminalPill(ev));
    } else {
      pills.push(genericPill(ev));
    }
  }

  if (fileEvents.length > 0) {
    pills.push(fileGroupPill(fileEvents));
  }
  return pills;
}

function fileGroupPill(events: ActivityEvent[]): ActivityPill {
  const n = events.length;
  const pill: ActivityPill = {
    kind: "file",
    label: `${n} file${n === 1 ? "" : "s"} edited`,
    tone: "info",
    items: events,
  };
  if (n === 1) {
    const path = events[0]!.metadata?.["path"];
    if (typeof path === "string") pill.linkTarget = { type: "file", value: path };
  }
  return pill;
}

function gitPill(ev: ActivityEvent): ActivityPill {
  const sha = ev.metadata?.["sha"];
  const label = typeof sha === "string" ? `committed ${sha.slice(0, 7)}` : ev.message;
  return { kind: "git", label, tone: "success", items: [ev] };
}

function terminalPill(ev: ActivityEvent): ActivityPill {
  const command = ev.metadata?.["command"];
  const label = typeof command === "string" ? `ran ${command}` : ev.message;
  const pill: ActivityPill = { kind: "terminal", label, tone: "neutral", items: [ev] };
  const tabId = ev.metadata?.["terminalTabId"];
  if (typeof tabId === "string") pill.linkTarget = { type: "terminal", value: tabId };
  return pill;
}

function genericPill(ev: ActivityEvent): ActivityPill {
  return { kind: ev.kind, label: ev.message, tone: toneOf(ev.kind), items: [ev] };
}

function toneOf(kind: ActivityKind): PillTone {
  switch (kind) {
    case "success": return "success";
    case "error": return "error";
    case "info": case "artifact": return "info";
    default: return "neutral";
  }
}
