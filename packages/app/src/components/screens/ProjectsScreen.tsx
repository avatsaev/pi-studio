/**
 * ProjectsScreen — /settings/projects list.
 * app-navigation-screens.md § Settings → Projects
 */

import styles from "./SettingsScreen.module.css";
import { Spinner } from "../primitives/index.js";
import {
  resolveProjectsListState,
  type ProjectsListInput,
  type ProjectListItem,
} from "../../screens/projects-settings.js";

export interface ProjectsScreenProps {
  input: ProjectsListInput;
  onSelect: (projectKey: string) => void;
}

export function ProjectsScreen({ input, onSelect }: ProjectsScreenProps) {
  const state = resolveProjectsListState(input);

  return (
    <div style={{ padding: 24 }}>
      <h2 className={styles.sectionTitle}>Projects</h2>

      {state.kind === "loading" && <Spinner />}

      {state.kind === "empty" && (
        <p style={{ fontSize: 13, color: "var(--pi-color-foregroundMuted)" }}>
          No projects yet. Open a project to get started.
        </p>
      )}

      {state.kind === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {state.projects.map((p) => (
            <button
              key={p.projectKey}
              className={styles.navItem}
              onClick={() => onSelect(p.projectKey)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {state.kind !== "loading" && state.errors.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--pi-color-statusDanger)" }}>
          {state.errors.map((e: { serverId: string; message: string }, i: number) => <div key={i}>{e.message}</div>)}
        </div>
      )}
    </div>
  );
}
