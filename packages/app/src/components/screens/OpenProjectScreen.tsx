/**
 * OpenProjectScreen — /open-project (global) and /h/:serverId/open-project.
 * Project/directory picker with recent projects + browse.
 * app-navigation-screens.md § Open-project
 */

import { useState, useMemo } from "react";
import styles from "./OpenProjectScreen.module.css";
import { TextInput, Button } from "../primitives/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecentProject = {
  projectId: string;
  name: string;
  path: string;
  lastOpenedMs: number;
};

export type OpenProjectValidation =
  | { valid: true; path: string }
  | { valid: false; error: string };

export function validateProjectPath(raw: string): OpenProjectValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, error: "Directory path is required" };
  if (!trimmed.startsWith("/") && !trimmed.startsWith("~")) {
    return { valid: false, error: "Path must be absolute (start with / or ~)" };
  }
  return { valid: true, path: trimmed };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface OpenProjectScreenProps {
  /** Recent projects sorted by lastOpened desc. */
  recentProjects: readonly RecentProject[];
  /** Optional serverId to scope to a host. */
  serverId?: string;
  /** Called when a project/path is selected. */
  onSelect: (opts: { projectId?: string; path: string; serverId?: string }) => void;
  /** Called to open the OS file browser (desktop only). */
  onBrowse?: () => void;
}

export function OpenProjectScreen({
  recentProjects,
  serverId,
  onSelect,
  onBrowse,
}: OpenProjectScreenProps) {
  const [manualPath, setManualPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sortedRecent = useMemo(
    () => [...recentProjects].sort((a, b) => b.lastOpenedMs - a.lastOpenedMs),
    [recentProjects],
  );

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateProjectPath(manualPath);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    setError(null);
    onSelect({ path: validation.path, serverId });
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>Open Project</div>

      {/* Recent projects */}
      {sortedRecent.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Recent</span>
          <div className={styles.projectList}>
            {sortedRecent.map((project) => (
              <div
                key={project.projectId}
                className={styles.projectRow}
                onClick={() => onSelect({ projectId: project.projectId, path: project.path, serverId })}
                role="button"
                tabIndex={0}
              >
                <span className={styles.projectName}>{project.name}</span>
                <span className={styles.projectPath}>{project.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sortedRecent.length === 0 && (
        <div className={styles.empty}>No recent projects. Enter a path or browse below.</div>
      )}

      {/* Manual path entry */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Or enter path</span>
        <form onSubmit={handleManualSubmit} className={styles.browseRow}>
          <TextInput
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="/home/user/project"
            style={{ flex: 1 }}
          />
          <Button type="submit" size="sm">Open</Button>
          {onBrowse && (
            <Button type="button" variant="ghost" size="sm" onClick={onBrowse}>Browse</Button>
          )}
        </form>
        {error && <span style={{ fontSize: 12, color: "var(--pi-color-statusDanger)" }}>{error}</span>}
      </div>
    </div>
  );
}
