/**
 * Tab kind → panel component map (POC `createTabPanel` switch, POC_TO_APP_PLAN_UI.md §4.2).
 * Panels are lazy-loaded — the terminal (xterm) and diff/highlighter modules only pay their
 * bundle cost once a tab of that kind actually opens (§6 Performance strategy).
 */

import { lazy, type ComponentType } from "react";
import type { Tab } from "@pi-studio-ui/stores/tab-store.js";

export interface PanelProps {
  tab: Tab;
}

const ChatPanel = lazy(() =>
  import("../chat/ChatPanel.js").then((m) => ({ default: m.ChatPanel })),
);
const FilePanel = lazy(() =>
  import("../files/FilePanel.js").then((m) => ({ default: m.FilePanel })),
);
const TerminalPanel = lazy(() =>
  import("../terminal/TerminalPanel.js").then((m) => ({ default: m.TerminalPanel })),
);
const MoleculeViewerPanel = lazy(() =>
  import("../files/MoleculeViewerPanel.js").then((m) => ({ default: m.MoleculeViewerPanel })),
);

export const PANEL_BY_KIND: Record<Tab["kind"], ComponentType<PanelProps>> = {
  chat: ChatPanel,
  file: FilePanel,
  diff: FilePanel, // FilePanel handles both file/diff view toggle internally (POC §4.5)
  terminal: TerminalPanel,
  molecule: MoleculeViewerPanel,
};
