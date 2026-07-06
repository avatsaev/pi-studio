/**
 * WorkspaceHeader — title, branch, actions (scripts, open-in-editor, explorer, focus).
 * workspace-ui.md § Primary header
 */

import { useMemo } from "react";
import { Menu, FolderOpen, Maximize, Code } from "lucide-react";
import styles from "./WorkspaceHeader.module.css";
import { Tooltip } from "../overlays/Tooltip.js";
import { Combobox } from "../primitives/Select.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../overlays/DropdownMenu.js";
import {
  workspaceHeaderModel,
  type HeaderInput,
  type HeaderAction,
} from "../../workspace/composition.js";

export interface WorkspaceBranchOption {
  name: string;
  isCurrent?: boolean;
}

export interface WorkspaceHeaderProps {
  input: HeaderInput;
  onMenuAction: (actionId: string) => void;
  onRightAction: (actionId: string) => void;
  onSidebarToggle?: () => void;
  /** Live git branches for the branch switcher Combobox. */
  branches?: readonly WorkspaceBranchOption[];
  onBranchSelect?: (branch: string) => void;
}

export function WorkspaceHeader({
  input,
  onMenuAction,
  onRightAction,
  onSidebarToggle,
  branches,
  onBranchSelect,
}: WorkspaceHeaderProps) {
  const model = useMemo(() => workspaceHeaderModel(input), [input]);

  return (
    <div className={styles.header}>
      {/* Left: sidebar toggle + title */}
      <div className={styles.left}>
        {model.left.sidebarToggle && onSidebarToggle && (
          <button className={styles.actionBtn} onClick={onSidebarToggle} aria-label="Toggle sidebar">
            <Menu size={16} />
          </button>
        )}
        <span className={styles.title}>{model.left.title || "Workspace"}</span>
        {model.left.subtitle && <span className={styles.subtitle}>{model.left.subtitle}</span>}
        {model.left.branch && branches && branches.length > 0 ? (
          <span className={styles.branchSwitcher}>
            <Combobox
              options={branches.map((b) => ({ value: b.name, label: b.name }))}
              value={model.left.branch}
              onSelect={(v) => onBranchSelect?.(v)}
              placeholder="Switch branch…"
            />
          </span>
        ) : (
          model.left.branch && <span className={styles.branch}>{model.left.branch}</span>
        )}

        {/* Menu (overflow actions) */}
        {model.menuItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={styles.actionBtn} aria-label="Workspace menu">
                <Code size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {model.menuItems.map((item) => (
                <DropdownMenuItem key={item.id} disabled={item.disabled} onSelect={() => onMenuAction(item.id)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Right: action cluster */}
      <div className={styles.right}>
        {model.right.map((action) => (
          <Tooltip key={action.id} content={action.label} side="bottom">
            <button
              className={styles.actionBtn}
              disabled={action.disabled}
              onClick={() => onRightAction(action.id)}
              aria-label={action.label}
              style={{ position: "relative" }}
            >
              <ActionIcon id={action.id} />
              {action.badge && <span className={styles.badge}>{action.badge}</span>}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function ActionIcon({ id }: { id: string }) {
  switch (id) {
    case "explorer":
    case "git-explorer":
      return <FolderOpen size={14} />;
    case "open-editor":
      return <Code size={14} />;
    case "focus":
      return <Maximize size={14} />;
    default:
      return <Code size={14} />;
  }
}
