/**
 * InstallSkillDialog — the Settings → Skills toolbar's "Install skill…" flow (sprint-077/
 * task-007, last slice): source → (preview & pick for `skills_repo`/`local_path`) → running →
 * results, swe/features/skills-manager.md § Install dialog. `SkillsPanel.tsx` mounts this
 * component unconditionally (only the inner `<Dialog open>` toggles) so an in-flight
 * `useSkillInstall()` keeps running when the dialog is closed — see use-skills.ts's module
 * doc comment and § Install dialog: "closing does not cancel (queue continues; result arrives
 * via skills_changed)". The step itself is never stored — `installDialogStep` (skills-
 * presentation.ts) derives it purely from the two RPC hooks' in-flight/settled state.
 *
 * All server access goes through `useSkillPreview`/`useSkillInstall` (`previewSkillSource`/
 * `installSkills`) — never `client.connection.request` for this family. The live kind label next
 * to the source field uses the SDK's re-exported `detectSkillSource` (client-side convenience
 * only; the daemon always re-runs detection authoritatively on both RPCs).
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { detectSkillSource } from "@av-pi-studio/client";
import type { ItemResult, SkillsInstallResponse } from "@av-pi-studio/protocol";
import {
  Button,
  Checkbox,
  Dialog,
  Icon,
  Spinner,
  StatusBadge,
  TextInput,
} from "@pi-studio-ui/components/primitives/index.js";
import {
  buildPickRows,
  canAdvanceFromSource,
  detectedSourceLabel,
  installDialogStep,
  isPackageSourceKind,
  PACKAGE_SOURCE_NOTICE,
  pickedSkillsNeedReplace,
  resolvePickedSkillNames,
  type PickRowState,
} from "./skills-presentation.js";
import { useSkillInstall, useSkillPreview } from "./use-skills.js";
import styles from "./InstallSkillDialog.module.css";

export interface InstallSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstallSkillDialog({ open, onOpenChange }: InstallSkillDialogProps) {
  const preview = useSkillPreview();
  const install = useSkillInstall();
  const [source, setSource] = useState("");
  const [pickRows, setPickRows] = useState<PickRowState[]>([]);
  const wasOpen = useRef(false);

  const detected = detectSkillSource(source);
  const step = installDialogStep({
    previewPending: preview.pending,
    previewResult: preview.result,
    installPending: install.pending,
    installResult: install.result,
  });

  // A fresh open starts a new flow — UNLESS an install from a prior open is still running or has
  // already settled (reopening then shows its live running/results state instead of discarding
  // it; § class doc above).
  useEffect(() => {
    if (open && !wasOpen.current && !install.pending && !install.result) {
      setSource("");
      setPickRows([]);
      preview.reset();
    }
    wasOpen.current = open;
    // Only the open transition matters here, not every identity change of `preview`/`install`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (preview.result) setPickRows(buildPickRows(preview.result.skills));
  }, [preview.result]);

  async function handleNext() {
    if (!detected) return;
    if (isPackageSourceKind(detected.kind)) {
      await install.install({ source: detected.normalized });
      return;
    }
    await preview.preview(detected.normalized);
  }

  function updateRow(index: number, patch: Partial<PickRowState>) {
    setPickRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleInstallPicked() {
    const skillNames = resolvePickedSkillNames(pickRows);
    if (skillNames.length === 0) return;
    await install.install({
      source: preview.result?.source ?? detected?.normalized ?? source,
      skills: skillNames,
      replace: pickedSkillsNeedReplace(pickRows),
    });
  }

  function handleBackToSource() {
    preview.reset();
    setPickRows([]);
  }

  function handleDone() {
    install.reset();
    onOpenChange(false);
  }

  const effectiveSource = preview.result?.source ?? detected?.normalized ?? source;
  const pickedCount = resolvePickedSkillNames(pickRows).length;

  let body: ReactNode;
  let footer: ReactNode;

  if (step === "source") {
    body = (
      <div className={styles.sourceStep}>
        <TextInput
          autoFocus
          placeholder="npm:<name>, git:<url>, owner/repo, or a daemon-host path"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label="Install source"
        />
        <div className={styles.sourceLabel}>{detectedSourceLabel(detected)}</div>
        {detected && isPackageSourceKind(detected.kind) && (
          <div className={styles.notice}>
            <Icon icon={AlertTriangle} size="xs" />
            <span>{PACKAGE_SOURCE_NOTICE}</span>
          </div>
        )}
        {preview.error && <div className={styles.error}>{preview.error}</div>}
      </div>
    );
    footer = (
      <Button
        size="sm"
        disabled={!canAdvanceFromSource(detected)}
        loading={install.pending}
        onClick={() => void handleNext()}
      >
        Next
      </Button>
    );
  } else if (step === "previewing") {
    body = (
      <div className={styles.statusStep}>
        <Spinner size="sm" /> Looking up the source…
      </div>
    );
    footer = null;
  } else if (step === "pick") {
    body = (
      <div className={styles.pickStep}>
        {pickRows.length === 0 ? (
          <div className={styles.statusStep}>No installable skills found.</div>
        ) : (
          <div className={styles.pickRows}>
            {pickRows.map((row, index) => (
              <PickRow
                key={row.skill.relPath}
                row={row}
                onChange={(patch) => updateRow(index, patch)}
              />
            ))}
          </div>
        )}
        {install.error && <div className={styles.error}>{install.error}</div>}
      </div>
    );
    footer = (
      <>
        <Button
          size="sm"
          variant="ghost"
          className={styles.backButton}
          onClick={handleBackToSource}
        >
          ‹ Back
        </Button>
        <Button
          size="sm"
          disabled={pickedCount === 0}
          loading={install.pending}
          onClick={() => void handleInstallPicked()}
        >
          Install from {effectiveSource}
        </Button>
      </>
    );
  } else if (step === "running") {
    body = (
      <div className={styles.statusStep}>
        <Spinner size="sm" /> Installing… this may take several minutes
      </div>
    );
    footer = null;
  } else {
    body = install.result ? <ResultsList result={install.result} /> : null;
    footer = (
      <Button size="sm" onClick={handleDone}>
        Done
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && step === "results") {
          handleDone();
          return;
        }
        onOpenChange(next);
      }}
      title="Install skill…"
      width={480}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}

function PickRow({
  row,
  onChange,
}: {
  row: PickRowState;
  onChange: (patch: Partial<PickRowState>) => void;
}) {
  const { skill, checked, replace } = row;
  const disabled = !skill.valid;
  return (
    <div className={styles.pickRow} data-disabled={disabled || undefined}>
      <Checkbox
        checked={checked && skill.valid}
        disabled={disabled}
        onChange={(e) => onChange({ checked: e.target.checked })}
        aria-label={skill.name}
      />
      <div className={styles.pickRowMain}>
        <div className={styles.pickRowTop}>
          <span className={styles.pickRowName}>{skill.name}</span>
          {!skill.valid && <StatusBadge label="Invalid" variant="error" />}
          {skill.exists && <StatusBadge label="Already installed" variant="warning" />}
          {skill.warnings && skill.warnings.length > 0 && (
            <Icon
              icon={AlertTriangle}
              size="xs"
              color="var(--pi-color-statusWarning)"
              aria-label={skill.warnings.join("; ")}
            />
          )}
        </div>
        {skill.description && (
          <span className={styles.pickRowDescription}>{skill.description}</span>
        )}
        {skill.exists && skill.valid && (
          <Checkbox
            label="Already installed — replace"
            checked={replace}
            onChange={(e) => onChange({ replace: e.target.checked })}
          />
        )}
      </div>
    </div>
  );
}

function ResultsList({ result }: { result: SkillsInstallResponse }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  function toggleExpanded(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className={styles.results}>
      {result.results.map((item: ItemResult, index: number) => {
        const isExpanded = expanded.has(index);
        return (
          <div key={`${item.target}-${index}`} className={styles.resultRow}>
            <div className={styles.resultHeader}>
              <StatusBadge
                label={item.ok ? "Installed" : "Failed"}
                variant={item.ok ? "success" : "error"}
              />
              <span className={styles.resultTarget}>{item.target}</span>
              {item.error && <span className={styles.resultError}>{item.error}</span>}
              {item.stderr && (
                <button
                  type="button"
                  className={styles.resultToggle}
                  onClick={() => toggleExpanded(index)}
                >
                  {isExpanded ? "Hide details" : "Show details"}
                </button>
              )}
            </div>
            {isExpanded && item.stderr && <pre className={styles.resultStderr}>{item.stderr}</pre>}
          </div>
        );
      })}
    </div>
  );
}
