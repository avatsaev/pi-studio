// Desktop tab strip width/menu helpers.
// clean-room-scope/features/workspace-ui.md § Desktop tab strip, § Tab operations

import type { WorkspaceTab } from "./tabs.js";

export const TAB_ICON_MIN_WIDTH = 44;
export const TAB_MAX_WIDTH = 200;

export type TabWidthLayout = { widths: number[]; scroll: boolean };

export function distributeTabWidths(tabCount: number, availableWidth: number): TabWidthLayout {
  if (tabCount <= 0) return { widths: [], scroll: false };
  const maxNeeded = tabCount * TAB_MAX_WIDTH;
  if (availableWidth >= maxNeeded) return { widths: Array.from({ length: tabCount }, () => TAB_MAX_WIDTH), scroll: false };
  const minNeeded = tabCount * TAB_ICON_MIN_WIDTH;
  if (availableWidth < minNeeded) return { widths: Array.from({ length: tabCount }, () => TAB_ICON_MIN_WIDTH), scroll: true };
  const width = Math.floor(availableWidth / tabCount);
  return { widths: Array.from({ length: tabCount }, () => Math.max(TAB_ICON_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, width))), scroll: false };
}

export type TabMenuItem = { id: string; label: string; disabled?: boolean };

export function tabContextMenu(input: { tab: WorkspaceTab; tabs: readonly WorkspaceTab[]; index: number; formFactor: "desktop" | "mobile" }): TabMenuItem[] {
  const agent = input.tab.target.kind === "agent";
  const terminal = input.tab.target.kind === "terminal";
  const rename = agent || terminal;
  const orientation = input.formFactor === "mobile" ? ["above", "below"] : ["left", "right"];
  return [
    ...(agent ? [
      { id: "copy-resume", label: "Copy resume command" },
      { id: "copy-agent-id", label: "Copy agent id" },
      { id: "reload-agent", label: "Reload agent" },
    ] : []),
    ...(rename ? [{ id: "rename", label: "Rename" }] : []),
    { id: `close-${orientation[0]}`, label: `Close to the ${orientation[0]}`, disabled: input.index === 0 },
    { id: `close-${orientation[1]}`, label: `Close to the ${orientation[1]}`, disabled: input.index >= input.tabs.length - 1 },
    { id: "close-others", label: "Close other tabs", disabled: input.tabs.length <= 1 },
    { id: "close", label: "Close" },
  ];
}

export type TrailingTabAction = { id: "new-agent" | "new-terminal" | "new-browser" | "split-right" | "split-down"; disabled?: boolean; tooltip: string };

export function trailingTabActions(input: { terminalCreating: boolean; electron: boolean; splitsSupported: boolean }): TrailingTabAction[] {
  return [
    { id: "new-agent", tooltip: "New agent" },
    { id: "new-terminal", disabled: input.terminalCreating, tooltip: "New terminal" },
    ...(input.electron ? [{ id: "new-browser" as const, tooltip: "New browser" }] : []),
    ...(input.splitsSupported ? [
      { id: "split-right" as const, tooltip: "Split right" },
      { id: "split-down" as const, tooltip: "Split down" },
    ] : []),
  ];
}

export function tabTooltip(tab: WorkspaceTab, label: string): string {
  return `${label} • ${tab.tabId}`;
}
