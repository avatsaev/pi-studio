/**
 * SkillsPanel — the Settings dialog's Skills category (sprint-075/task-006 slice 1: list +
 * toggle; sprint-076/task-007 slice 2: remove, remove package, update all). Lists every global
 * skill `useSkillsQuery()` resolves, grouped/ordered by `skills-presentation.ts#buildSkillGroups`,
 * with a client-side search box, a per-row toggle (`use-skills.ts#useSkillToggle`), a per-row
 * Remove shown only when `removable` and a package header Remove package
 * (`use-skills.ts#useSkillRemove`), and a toolbar Update all (`use-skills.ts#useSkillUpdateAll`)
 * rendering two per-engine result rows. Install is out of scope here (sprint 077) — this panel
 * renders no install control.
 *
 * All server access goes through the task-005/006 SDK methods (`listSkills`/`setSkillEnabled`/
 * `removeSkill`/`updateAllSkills`/`onSkillsChanged`) — never `client.connection.request` for this
 * family. Remove/update-all responses **replace** the cached list wholesale (never optimistic,
 * unlike toggle) — swe/features/skills-manager.md § Data flow.
 *
 * "Queued…" simplification: the spec names a "Queued…" state for a second mutation observed
 * while one is already in flight (cross-window `skills_changed`-driven), but leaves its exact
 * trigger ambiguous for remove/update-all (it's spelled out only for the install dialog's two-
 * installs-at-once case, out of scope here). Each control here only disables and busies itself
 * while its own request is in flight ("Working…"/spinner) — simple and honest per the task
 * brief, and the daemon's own FIFO queueing (§ Acceptance) means a second click from this same
 * window while one request is pending is simply not possible (the control is disabled).
 *
 * swe/features/skills-manager.md § Panel, § Toggle, § Remove, § Update all, § Error handling.
 */

import { useState } from "react";
import { AlertTriangle, ChevronRight, Trash2 } from "lucide-react";
import type { PiPackageInfo, SkillInfo, SkillsUpdateAllResponse } from "@av-pi-studio/protocol";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Spinner,
  StatusBadge,
  Switch,
  TextInput,
} from "@pi-studio-ui/components/primitives/index.js";
import {
  buildSkillGroups,
  filterSkillGroups,
  packageHeaderBadges,
  removePackageConfirmText,
  requiresCuratedConfirm,
  skillErrorMessage,
  skillRemoveConfirmText,
  UPDATE_ALL_CONFIRM_TEXT,
  updateAllTargetLabel,
  type SkillRowState,
} from "./skills-presentation.js";
import { useSkillRemove, useSkillsQuery, useSkillToggle, useSkillUpdateAll } from "./use-skills.js";
import styles from "./SkillsPanel.module.css";

export function SkillsPanel() {
  const { data, isLoading, isError, error } = useSkillsQuery();
  const { rowErrors, pending, toggle, clearRowError } = useSkillToggle();
  const removeSkills = useSkillRemove();
  const updateAll = useSkillUpdateAll();
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

  function handleRemoveSkill(skill: SkillInfo) {
    if (!window.confirm(skillRemoveConfirmText(skill))) return;
    void removeSkills.removeSkill(skill);
  }

  function handleRemovePackage(pkg: PiPackageInfo) {
    if (!window.confirm(removePackageConfirmText(pkg))) return;
    void removeSkills.removePackage(pkg);
  }

  function handleUpdateAll() {
    if (!window.confirm(UPDATE_ALL_CONFIRM_TEXT)) return;
    void updateAll.updateAll();
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <TextInput
          className={styles.search}
          placeholder="Search skills…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search skills"
        />
        <Button size="sm" variant="outline" loading={updateAll.pending} onClick={handleUpdateAll}>
          Update all
        </Button>
      </div>
      {updateAll.error && (
        <button
          type="button"
          className={styles.rowError}
          onClick={() => updateAll.updateAll().catch(() => {})}
        >
          {updateAll.error}
        </button>
      )}
      {updateAll.result && (
        <UpdateAllResults result={updateAll.result} onDismiss={updateAll.clearResult} />
      )}
      {groups.length === 0 ? (
        <EmptyState>{query ? "No skills match your search." : "No skills found."}</EmptyState>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id);
            const pkg = group.packageInfo;
            const pkgKey = pkg ? `package:${pkg.source}` : undefined;
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
                  {pkg && (
                    <span className={styles.groupBadges}>
                      {packageHeaderBadges(pkg).map((badge) => (
                        <StatusBadge
                          key={badge.label}
                          label={badge.label}
                          variant={badge.variant}
                        />
                      ))}
                    </span>
                  )}
                  <span className={styles.groupCount}>{group.rows.length}</span>
                  {pkg && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className={styles.removePackageBtn}
                      loading={pkgKey ? Boolean(removeSkills.pending[pkgKey]) : false}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePackage(pkg);
                      }}
                    >
                      Remove package
                    </Button>
                  )}
                </button>
                {pkgKey && removeSkills.errors[pkgKey] && (
                  <button
                    type="button"
                    className={styles.rowError}
                    onClick={() => removeSkills.clearError(pkgKey)}
                  >
                    {removeSkills.errors[pkgKey]}
                  </button>
                )}
                {!isCollapsed && (
                  <div className={styles.rows}>
                    {group.rows.map((row) => (
                      <SkillRow
                        key={row.skill.path}
                        row={row}
                        error={rowErrors[row.skill.path]}
                        pending={Boolean(pending[row.skill.path])}
                        removeError={removeSkills.errors[row.skill.path]}
                        removePending={Boolean(removeSkills.pending[row.skill.path])}
                        onToggle={(enabled) => handleRowToggle(row.skill, enabled)}
                        onDismissError={() => clearRowError(row.skill.path)}
                        onRemove={() => handleRemoveSkill(row.skill)}
                        onDismissRemoveError={() => removeSkills.clearError(row.skill.path)}
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

function UpdateAllResults({
  result,
  onDismiss,
}: {
  result: SkillsUpdateAllResponse;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleExpanded(target: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }

  return (
    <div className={styles.updateAllResults}>
      {result.results.map((item) => {
        const isExpanded = expanded.has(item.target);
        return (
          <div key={item.target} className={styles.updateAllResultRow}>
            <div className={styles.updateAllResultHeader}>
              <StatusBadge
                label={item.ok ? "Succeeded" : "Failed"}
                variant={item.ok ? "success" : "error"}
              />
              <span className={styles.updateAllResultLabel}>
                {updateAllTargetLabel(item.target)}
              </span>
              {item.error && <span className={styles.updateAllResultError}>{item.error}</span>}
              {item.stderr && (
                <button
                  type="button"
                  className={styles.updateAllResultToggle}
                  onClick={() => toggleExpanded(item.target)}
                >
                  {isExpanded ? "Hide details" : "Show details"}
                </button>
              )}
            </div>
            {isExpanded && item.stderr && (
              <pre className={styles.updateAllResultStderr}>{item.stderr}</pre>
            )}
          </div>
        );
      })}
      <button type="button" className={styles.rowError} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

interface SkillRowProps {
  row: SkillRowState;
  error: string | undefined;
  pending: boolean;
  removeError: string | undefined;
  removePending: boolean;
  onToggle: (enabled: boolean) => void;
  onDismissError: () => void;
  onRemove: () => void;
  onDismissRemoveError: () => void;
}

function SkillRow({
  row,
  error,
  pending,
  removeError,
  removePending,
  onToggle,
  onDismissError,
  onRemove,
  onDismissRemoveError,
}: SkillRowProps) {
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
        {removeError && (
          <button type="button" className={styles.rowError} onClick={onDismissRemoveError}>
            {removeError}
          </button>
        )}
      </div>
      <div className={styles.rowActions}>
        <Switch
          checked={skill.enabled}
          disabled={toggleDisabled || pending}
          onCheckedChange={onToggle}
          aria-label={skill.name}
        />
        {skill.removable && (
          <IconButton
            aria-label={`Remove ${skill.name}`}
            disabled={removePending}
            onClick={onRemove}
          >
            {removePending ? <Spinner size="xs" /> : <Icon icon={Trash2} size="xs" />}
          </IconButton>
        )}
      </div>
    </div>
  );
}
