/**
 * The command-line tool in the local daemon's settings: a sentence per state, the line to add to the
 * shell's start-up file when the folder is not on `PATH`, and the one button that state offers
 * (`cli-tool-presentation.ts` decides all of it; `cli-tool-actions.ts` calls the host). Draws nothing
 * until the state is read and for `unavailable`. The state is held by `DaemonsScreen`, which reads it
 * once per opening.
 */

import { useState } from "react";
import { Button, Spinner } from "@av-pi-studio/ui-library";
import { type CliToolState, type HostDaemons } from "../../host/types.js";
import { runCliTool } from "./cli-tool-actions.js";
import { CLI_TOOL_HEADING, cliToolView } from "./cli-tool-presentation.js";
import styles from "./DaemonsScreen.module.css";

export function CliToolBlock({
  daemons,
  state,
  onState,
  onCopy,
}: {
  daemons: HostDaemons;
  state: CliToolState | null;
  onState: (state: CliToolState) => void;
  /** Copies the line to add; its failure is the screen's banner. */
  onCopy: (command: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const view = cliToolView(state);
  if (!view) return null;

  async function run(call: "install" | "state"): Promise<void> {
    setBusy(true);
    setFailure(null);
    const outcome = await runCliTool(daemons, call);
    if ("state" in outcome) onState(outcome.state);
    else setFailure(outcome.failure);
    setBusy(false);
  }

  const { action } = view;
  return (
    <div className={styles.cliTool} role="group" aria-labelledby="daemons-cli-tool-heading">
      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id="daemons-cli-tool-heading">
          {CLI_TOOL_HEADING}
        </span>
        {action && (
          <Button
            size="xs"
            variant="secondary"
            disabled={busy}
            leftIcon={busy ? <Spinner size="xs" aria-label="Working" /> : undefined}
            onClick={() => void run(action.call)}
          >
            {action.label}
          </Button>
        )}
      </div>
      <div className={styles.notice} data-tone={view.tone}>
        <span>{view.text}</span>
        {view.command !== undefined && (
          <div className={styles.commandRow}>
            <code className={styles.command}>{view.command}</code>
            <Button size="xs" variant="secondary" onClick={() => onCopy(view.command ?? "")}>
              Copy
            </Button>
          </div>
        )}
      </div>
      {failure && (
        <div className={styles.settingError} role="alert">
          {failure}
        </div>
      )}
    </div>
  );
}
