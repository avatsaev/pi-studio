/**
 * NewWorkspaceScreen — /new route.
 * Provider/model selection, worktree options, initial prompt, launch.
 * app-navigation-screens.md § New-workspace
 */

import { useState, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import styles from "./NewWorkspaceScreen.module.css";
import { Button, TextInput, TextArea } from "../primitives/index.js";
import { Select } from "../primitives/Select.js";
import {
  parseNewWorkspaceParams,
  createAgentDefaults,
  submitNewWorkspace,
  worktreeCapableProjects,
  filterRefs,
  type CreateAgentPreferences,
  type NewWorkspaceClient,
  type ProjectPickerItem,
  type RefPickerItem,
} from "../../screens/new-workspace.js";

// ---------------------------------------------------------------------------
// Launch gate — surfaces human-readable reasons
// ---------------------------------------------------------------------------

export type LaunchBlocker = { blocked: true; reason: string } | { blocked: false };

export function launchGate(input: {
  serverId?: string;
  provider?: string;
}): LaunchBlocker {
  if (!input.serverId) return { blocked: true, reason: "No host selected" };
  if (!input.provider) return { blocked: true, reason: "Select a provider" };
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface NewWorkspaceScreenProps {
  client: NewWorkspaceClient;
  preferences?: CreateAgentPreferences;
  projects: readonly ProjectPickerItem[];
  refs: readonly RefPickerItem[];
  providers: { value: string; label: string }[];
}

export function NewWorkspaceScreen({
  client,
  preferences,
  projects,
  refs,
  providers,
}: NewWorkspaceScreenProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const params = useMemo(() => parseNewWorkspaceParams(searchParams.toString()), [searchParams]);
  const defaults = useMemo(() => createAgentDefaults(preferences), [preferences]);

  const [provider, setProvider] = useState(defaults.provider ?? providers[0]?.value ?? "");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState(params.projectId ?? "");
  const [refQuery, setRefQuery] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredRefs = useMemo(() => filterRefs(refs, refQuery), [refs, refQuery]);
  const wtProjects = useMemo(() => worktreeCapableProjects(projects), [projects]);

  const gate = launchGate({ serverId: params.serverId, provider });

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (gate.blocked) return;
      setLoading(true);
      setError(null);

      const result = await submitNewWorkspace({
        params: { ...params, projectId: projectId || undefined },
        client,
        text: prompt,
        refId: selectedRef,
      });

      setLoading(false);
      if (result.ok) {
        navigate(result.route, { replace: true });
      } else {
        setError(result.error);
      }
    },
    [gate, params, projectId, client, prompt, selectedRef, navigate],
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>New Workspace</div>

      <form className={styles.form} onSubmit={handleSubmit}>
        {/* Provider */}
        <div className={styles.field}>
          <label className={styles.label}>Provider</label>
          <Select
            options={providers}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>

        {/* Project */}
        {wtProjects.length > 0 && (
          <div className={styles.field}>
            <label className={styles.label}>Project</label>
            <Select
              options={[{ value: "", label: "None (in-place)" }, ...wtProjects.map((p) => ({ value: p.projectId, label: p.name }))]}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
          </div>
        )}

        {/* Branch / Ref */}
        {refs.length > 0 && (
          <div className={styles.field}>
            <label className={styles.label}>Branch / PR</label>
            <TextInput
              value={refQuery}
              onChange={(e) => setRefQuery(e.target.value)}
              placeholder="Search refs…"
            />
            {refQuery && filteredRefs.length > 0 && (
              <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 12 }}>
                {filteredRefs.slice(0, 10).map((r) => (
                  <div
                    key={r.id}
                    style={{ padding: "4px 8px", cursor: "pointer", borderRadius: 3, background: selectedRef === r.id ? "var(--pi-color-surface2)" : undefined }}
                    onClick={() => { setSelectedRef(r.id); setRefQuery(r.label); }}
                  >
                    {r.label} <span style={{ opacity: 0.5 }}>({r.kind})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Initial prompt */}
        <div className={`${styles.field} ${styles.promptField}`}>
          <label className={styles.label}>Initial prompt (optional)</label>
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent work on?"
            rows={3}
          />
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <Button type="submit" loading={loading} disabled={gate.blocked || loading}>
            Create workspace
          </Button>
          {gate.blocked && <span className={styles.disabledReason}>{gate.reason}</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>
      </form>
    </div>
  );
}
