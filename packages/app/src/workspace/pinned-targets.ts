// Pinned quick-launch targets.
// clean-room-scope/features/workspace-ui.md § Pinned quick-launch targets

import type { LayoutStorage } from "./layout-store.js";
import type { WorkspaceTabTarget } from "./tabs.js";

export type PinnedTabTarget =
  | { kind: "draft" }
  | { kind: "terminal" }
  | { kind: "browser" }
  | { kind: "profile"; profileId: string };

export type PinnedTargetsState = { version: 1; targets: PinnedTabTarget[] };

export const PINNED_TARGETS_KEY = "pinned-tab-targets";
export const DEFAULT_PINNED_TARGETS: readonly PinnedTabTarget[] = [{ kind: "terminal" }, { kind: "browser" }];

export function pinnedTargetKey(target: PinnedTabTarget): string {
  return target.kind === "profile" ? `profile:${target.profileId}` : target.kind;
}

export function migratePinnedTargets(value: unknown): PinnedTargetsState {
  if (isPinnedState(value)) return withDefaults(dedupePinned(value.targets));
  if (Array.isArray(value)) return withDefaults(dedupePinned(value.filter(isPinnedTarget)));
  return { version: 1, targets: [...DEFAULT_PINNED_TARGETS] };
}

export function togglePinnedTarget(targets: readonly PinnedTabTarget[], target: PinnedTabTarget): PinnedTabTarget[] {
  const key = pinnedTargetKey(target);
  return targets.some((item) => pinnedTargetKey(item) === key)
    ? targets.filter((item) => pinnedTargetKey(item) !== key)
    : [...targets, target];
}

export function pinnedMenuItem(targets: readonly PinnedTabTarget[], target: PinnedTabTarget): { id: string; label: "Pin" | "Unpin"; target: PinnedTabTarget } {
  const pinned = targets.some((item) => pinnedTargetKey(item) === pinnedTargetKey(target));
  return { id: `${pinned ? "unpin" : "pin"}:${pinnedTargetKey(target)}`, label: pinned ? "Unpin" : "Pin", target };
}

export type QuickLaunchButton = { key: string; label: string; target: PinnedTabTarget; tabTarget: WorkspaceTabTarget };

export function quickLaunchButtons(targets: readonly PinnedTabTarget[], input: { nextDraftId: string; nextTerminalId: string; nextBrowserId: string; profileCwd?: string }): QuickLaunchButton[] {
  return targets.map((target) => ({ key: pinnedTargetKey(target), label: quickLaunchLabel(target), target, tabTarget: tabTargetForPinned(target, input) }));
}

export function tabTargetForPinned(target: PinnedTabTarget, input: { nextDraftId: string; nextTerminalId: string; nextBrowserId: string; profileCwd?: string }): WorkspaceTabTarget {
  switch (target.kind) {
    case "draft":
      return { kind: "draft", draftId: input.nextDraftId };
    case "terminal":
      return { kind: "terminal", terminalId: input.nextTerminalId };
    case "browser":
      return { kind: "browser", browserId: input.nextBrowserId };
    case "profile":
      return { kind: "draft", draftId: input.nextDraftId, setup: { provider: target.profileId, cwd: input.profileCwd ?? "" } };
  }
}

export class PinnedTargetsStore {
  constructor(private readonly storage: LayoutStorage) {}

  load(): PinnedTargetsState {
    const raw = this.storage.getItem(PINNED_TARGETS_KEY);
    if (!raw) return { version: 1, targets: [...DEFAULT_PINNED_TARGETS] };
    try {
      return migratePinnedTargets(JSON.parse(raw));
    } catch {
      return { version: 1, targets: [...DEFAULT_PINNED_TARGETS] };
    }
  }

  save(state: PinnedTargetsState): void {
    this.storage.setItem(PINNED_TARGETS_KEY, JSON.stringify(migratePinnedTargets(state)));
  }

  toggle(target: PinnedTabTarget): PinnedTargetsState {
    const next = { version: 1 as const, targets: togglePinnedTarget(this.load().targets, target) };
    this.save(next);
    return next;
  }
}

function quickLaunchLabel(target: PinnedTabTarget): string {
  switch (target.kind) {
    case "draft": return "New agent";
    case "terminal": return "New terminal";
    case "browser": return "New browser";
    case "profile": return `Profile ${target.profileId}`;
  }
}

function withDefaults(targets: readonly PinnedTabTarget[]): PinnedTargetsState {
  return { version: 1, targets: dedupePinned([...DEFAULT_PINNED_TARGETS, ...targets]) };
}

function dedupePinned(targets: readonly PinnedTabTarget[]): PinnedTabTarget[] {
  const seen = new Set<string>();
  const result: PinnedTabTarget[] = [];
  for (const target of targets) {
    const key = pinnedTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function isPinnedState(value: unknown): value is PinnedTargetsState {
  return typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1 && Array.isArray((value as { targets?: unknown }).targets);
}

function isPinnedTarget(value: unknown): value is PinnedTabTarget {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "draft" || kind === "terminal" || kind === "browser" || (kind === "profile" && typeof (value as { profileId?: unknown }).profileId === "string");
}
