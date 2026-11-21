/**
 * What the add/edit form's Save does against the host: check the form, call `add` or `update` with
 * only what the form decided, and say where a refusal goes. None throws.
 *
 * Plain functions over `HostDaemons`, unit-testable with the in-memory registry.
 */

import { type DaemonEntryView, type HostDaemons } from "../../host/types.js";
import { daemonFailureOf } from "./daemon-presentation.js";
import {
  buildNewDaemon,
  buildPatch,
  isEmptyPatch,
  needsReconnect,
  refusalErrors,
  type FormErrors,
  type FormFields,
} from "./daemon-form.js";

export type SubmitOutcome =
  /** Saved (or, for an edit with nothing changed, nothing to save). */
  | { status: "saved"; reconnect: boolean }
  /** Stopped in the form or refused by the host: the form stays open with these messages. */
  | { status: "refused"; errors: FormErrors };

/** Check, then add. The host is not called when the form fails its own checks. */
export async function submitAdd(daemons: HostDaemons, fields: FormFields): Promise<SubmitOutcome> {
  const built = buildNewDaemon(fields);
  if (!built.ok) return { status: "refused", errors: built.errors };
  try {
    await daemons.add(built.value);
    return { status: "saved", reconnect: false };
  } catch (error) {
    return { status: "refused", errors: refusalErrors(daemonFailureOf(error)) };
  }
}

/**
 * Check, then update with the changed fields only; nothing changed means no call. `reconnect` is
 * set when the saved entry is the current one and the change alters what is dialed.
 */
export async function submitEdit(
  daemons: HostDaemons,
  entry: DaemonEntryView,
  fields: FormFields,
): Promise<SubmitOutcome> {
  const built = buildPatch(entry, fields);
  if (!built.ok) return { status: "refused", errors: built.errors };
  if (isEmptyPatch(built.value)) return { status: "saved", reconnect: false };
  // Read before the call: the change itself must not decide which entry was current.
  const { currentId } = daemons.snapshot();
  try {
    await daemons.update(entry.id, built.value);
    return { status: "saved", reconnect: needsReconnect(entry, currentId, built.value) };
  } catch (error) {
    return { status: "refused", errors: refusalErrors(daemonFailureOf(error)) };
  }
}
