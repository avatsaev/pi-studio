/**
 * The public shell regions (`swe/architecture/workbench-package.md` § Root entry: components). Each
 * wraps the internal component and first checks it is inside `WorkbenchProvider`, so a custom
 * layout that forgets the provider gets a message naming it rather than a store or theme error.
 */

import { lazy } from "react";
import { ConnectionBar as ConnectionBarImpl } from "../features/connection/ConnectionBar.js";
import { RightSidebar as RightSidebarImpl } from "../features/files/RightSidebar.js";
import { SessionList as SessionListImpl } from "../features/sessions/SessionList.js";
import { OpenWorkspaceDialog as OpenWorkspaceDialogImpl } from "../features/workspace-picker/OpenWorkspaceDialog.js";
import { StatusBar as StatusBarImpl } from "../features/workspace/StatusBar.js";
import { TabPanelHost } from "../features/workspace/TabPanelHost.js";
import { type SettingsDialogProps } from "../features/settings/SettingsDialog.js";
import { useRequireWorkbench } from "./context.js";

export function ConnectionBar() {
  useRequireWorkbench("ConnectionBar");
  return <ConnectionBarImpl />;
}

export function SessionList() {
  useRequireWorkbench("SessionList");
  return <SessionListImpl />;
}

/** The split-pane and tab area. */
export function PaneArea() {
  useRequireWorkbench("PaneArea");
  return <TabPanelHost />;
}

export function RightSidebar() {
  useRequireWorkbench("RightSidebar");
  return <RightSidebarImpl />;
}

export function StatusBar() {
  useRequireWorkbench("StatusBar");
  return <StatusBarImpl />;
}

/** The workspace picker. Opens itself from the UI store (`ui-store`'s workspace-picker state). */
export function OpenWorkspaceDialog() {
  useRequireWorkbench("OpenWorkspaceDialog");
  return <OpenWorkspaceDialogImpl />;
}

/** Lazy, so the settings chunk loads only when the dialog is first rendered. Render it inside
 *  `<Suspense>`; drive `open`/`onOpenChange` from `useSettingsDialog()`. */
const SettingsDialogImpl = lazy(() =>
  import("../features/settings/SettingsDialog.js").then((m) => ({ default: m.SettingsDialog })),
);

export function SettingsDialog(props: SettingsDialogProps) {
  useRequireWorkbench("SettingsDialog");
  return <SettingsDialogImpl {...props} />;
}

export type { SettingsDialogProps };
