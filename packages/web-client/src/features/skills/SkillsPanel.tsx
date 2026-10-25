/**
 * SkillsPanel — the Settings dialog's Skills category (sprint-075/task-006, slice 1: list +
 * toggle only). Lists every global skill `useSkillsQuery()` resolves, grouped/ordered by
 * `skills-presentation.ts#buildSkillGroups`, with a client-side search box and a per-row toggle
 * wired through `use-skills.ts#useSkillToggle`. Remove/Update all/Install are out of scope here
 * (sprints 076–077) — this panel renders no such controls.
 *
 * All server access goes through the task-005 SDK methods (`listSkills`/`setSkillEnabled`/
 * `onSkillsChanged`) — never `client.connection.request` for this family.
 *
 * swe/features/skills-manager.md § Panel, § Toggle, § Error handling.
 */

import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { SkillInfo } from "@av-pi-studio/protocol";
import {
  EmptyState,
  Icon,
  Spinner,
  StatusBadge,
  Switch,
  TextInput,
} from "@pi-studio-ui/components/primitives/index.js";
import {
  buildSkillGroups,
  filterSkillGroups,
  packageHeaderBadges,
  requiresCuratedConfirm,
  skillErrorMessage,
  type SkillRowState,
} from "./skills-presentation.js";
import { useSkillsQuery, useSkillToggle } from "./use-skills.js";
import styles from "./SkillsPanel.module.css";

export function SkillsPanel() {
  const { data, isLoading, isError, error } = useSkillsQuery();
  const { rowErrors, pending, toggle, clearRowError } = useSkillToggle();
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  // Session-local: packageSources already confirmed for a curated first toggle, so repeat
  // toggles on the same package's skills don't re-prompt (swe/features/skills-manager.md §
  // Toggle: "First toggle on a curated package's skill shows an inline confirm").
  const [confirmedCurated, setConfirmedCurated] = useState<Set<string>>(() => new Set());

  function toggleGroupCollapsed(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  if (isLoading) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading skills…
      </EmptyState>
    );
  }

  if (isError) {
    return (
      <EmptyState className={styles.errorState}>
        {error instanceof Error ? error.message : "Failed to load skills."}
      </EmptyState>
    );
  }

  if (!data) return null;

  if (!data.ok) {
    return (
      <EmptyState className={styles.errorState}>
        {skillErrorMessage(data.error, data.message) ?? "Could not load skills."}
      </EmptyState>
    );
  }

  const groups = filterSkillGroups(buildSkillGroups(data.skills, data.packages), query);

  function handleRowToggle(skill: SkillInfo, enabled: boolean) {
    if (enabled && skill.packageSource && requiresCuratedConfirm(skill, data!.packages)) {
      if (!confirmedCurated.has(skill.packageSource)) {
        if (!window.confirm("Pi-Studio will stop managing this package's updates.")) return;
        setConfirmedCurated((prev) => new Set(prev).add(skill.packageSource!));
      }
    }
    void toggle(skill, enabled);
  }

  return (
    <div className={styles.panel}>
      <TextInput
        className={styles.search}
        placeholder="Search skills…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search skills"
      />
      {groups.length === 0 ? (
        <EmptyState>{query ? "No skills match your search." : "No skills found."}</EmptyState>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id);
            return (
              <div key={group.id} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHeader}
                  onClick={() => toggleGroupCollapsed(group.id)}
                  aria-expanded={!isCollapsed}
                >
                  <Icon
                    icon={ChevronRight}
                    size="xs"
                    className={!isCollapsed ? styles.chevronExpanded : undefined}
                  />
                  <span className={styles.groupLabel}>{group.label}</span>
                  {group.packageInfo && (
                    <span className={styles.groupBadges}>
                      {packageHeaderBadges(group.packageInfo).map((badge) => (
                        <StatusBadge
                          key={badge.label}
                          label={badge.label}
                          variant={badge.variant}
                        />
                      ))}
                    </span>
                  )}
                  <span className={styles.groupCount}>{group.rows.length}</span>
                </button>
                {!isCollapsed && (
                  <div className={styles.rows}>
                    {group.rows.map((row) => (
                      <SkillRow
                        key={row.skill.path}
                        row={row}
                        error={rowErrors[row.skill.path]}
                        pending={Boolean(pending[row.skill.path])}
                        onToggle={(enabled) => handleRowToggle(row.skill, enabled)}
                        onDismissError={() => clearRowError(row.skill.path)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className={styles.footnote}>Changes apply to newly started agent sessions.</p>
    </div>
  );
}

interface SkillRowProps {
  row: SkillRowState;
  error: string | undefined;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onDismissError: () => void;
}

function SkillRow({ row, error, pending, onToggle, onDismissError }: SkillRowProps) {
  const { skill, muted, toggleDisabled, badges, warnings, sharedPatternTooltip } = row;
  return (
    <div className={styles.row} title={sharedPatternTooltip ?? undefined}>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={muted ? styles.nameMuted : styles.name}>{skill.name}</span>
          {warnings.length > 0 && (
            <Icon
              icon={AlertTriangle}
              size="xs"
              color="var(--pi-color-statusWarning)"
              aria-label={warnings.join("; ")}
            />
          )}
          {badges.map((badge) => (
            <StatusBadge
              key={badge.label}
              label={badge.label}
              variant={badge.variant}
              className={styles.badge}
            />
          ))}
        </div>
        {skill.description && (
          <span className={muted ? styles.descriptionMuted : styles.description}>
            {skill.description}
          </span>
        )}
        {error && (
          <button type="button" className={styles.rowError} onClick={onDismissError}>
            {error}
          </button>
        )}
      </div>
      <Switch
        checked={skill.enabled}
        disabled={toggleDisabled || pending}
        onCheckedChange={onToggle}
        aria-label={skill.name}
      />
    </div>
  );
}
