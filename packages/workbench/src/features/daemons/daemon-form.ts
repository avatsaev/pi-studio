/**
 * The add/edit form of the Daemons screen as decisions: which fields a form shows, what is checked
 * before the host is called, the entry or patch it sends, and which field a host refusal lands on
 * (`swe/features/desktop-daemon-registry.md` § Public contract 4 "Edit form", § Adding, editing,
 * removing).
 *
 * A stored secret is never an input here: `DaemonEntryView` has none, the edit form starts with an
 * empty password and an empty "Replace link", and an untouched field is absent from the patch.
 *
 * Pure — no React, no host access — so it is unit-testable in the node env.
 */

import { parsePairingUrl } from "@av-pi-studio/client";
import { type DaemonEntryView, type DaemonPatch, type NewDaemon } from "../../host/types.js";
import { isDialableTarget } from "../connection/connection-presentation.js";
import { daemonErrorView, type DaemonFailure } from "./daemon-presentation.js";

/** What a form is for: a new entry (of a kind the user picks) or an existing one. */
export type FormMode = { type: "add" } | { type: "edit"; entry: DaemonEntryView };

export type FormKind = "direct" | "relay";

/** Where a message is drawn: next to a field, or at the form. */
export type FormField = "name" | "address" | "password" | "link" | "form";

export type FormErrors = Partial<Record<FormField, string>>;

export interface FormFields {
  /** Add only; an edit keeps the entry's kind. */
  kind: FormKind;
  name: string;
  address: string;
  /** What is typed; never a stored value. */
  password: string;
  /** Edit: the user asked to remove the saved password. */
  clearPassword: boolean;
  /** Add relay: the link. Edit relay: the replacement, empty to keep the link. */
  pairingLink: string;
}

export const NAME_BLANK = "Give this daemon a name.";
export const ADDRESS_BLANK = "Enter the daemon's address.";
export const ADDRESS_IS_LINK = "This is a pairing link. Add it as a relay daemon instead.";
export const LINK_BLANK = "Paste the pairing link.";
export const SAVE_FAILED = "This daemon could not be saved.";

export function initialAddFields(kind: FormKind = "direct"): FormFields {
  return { kind, name: "", address: "", password: "", clearPassword: false, pairingLink: "" };
}

/** Name and address as saved; password and link empty, whatever is stored. */
export function initialEditFields(entry: DaemonEntryView): FormFields {
  return {
    kind: entry.kind === "relay" ? "relay" : "direct",
    name: entry.name,
    address: entry.address ?? "",
    password: "",
    clearPassword: false,
    pairingLink: "",
  };
}

export interface PasswordFieldView {
  /** A password is saved (and not marked for removal). */
  saved: boolean;
  /** The "saved" marker text; `null` when nothing is saved. */
  marker: string | null;
  placeholder: string;
  /** Offer "Clear". */
  canClear: boolean;
  /** Offer "Keep" (a clear is pending). */
  canUndoClear: boolean;
}

export interface FormView {
  title: string;
  submitLabel: string;
  /** Add only: the kind choice. */
  showKind: boolean;
  showAddress: boolean;
  showPassword: boolean;
  showLink: boolean;
  linkLabel: string;
  linkPlaceholder: string;
  password: PasswordFieldView;
}

export const KIND_OPTIONS: { value: FormKind; label: string }[] = [
  { value: "direct", label: "Address" },
  { value: "relay", label: "Relay (pairing link)" },
];

function passwordView(mode: FormMode, fields: FormFields): PasswordFieldView {
  const stored = mode.type === "edit" && mode.entry.hasPassword;
  if (!stored) {
    return {
      saved: false,
      marker: null,
      placeholder: "Optional",
      canClear: false,
      canUndoClear: false,
    };
  }
  if (fields.clearPassword) {
    return {
      saved: false,
      marker: "Will be removed",
      placeholder: "Leave empty to remove it",
      canClear: false,
      canUndoClear: true,
    };
  }
  return {
    saved: true,
    marker: "Saved",
    placeholder: "Leave empty to keep it",
    canClear: true,
    canUndoClear: false,
  };
}

export function formView(mode: FormMode, fields: FormFields): FormView {
  const kind = mode.type === "edit" ? mode.entry.kind : fields.kind;
  const editing = mode.type === "edit";
  return {
    title: editing ? `Edit ${mode.entry.name}` : "Add daemon",
    submitLabel: editing ? "Save" : "Add",
    showKind: !editing,
    showAddress: kind === "direct",
    showPassword: kind !== "relay",
    showLink: kind === "relay",
    linkLabel: editing ? "Replace link" : "Pairing link",
    linkPlaceholder: editing ? "Leave empty to keep the saved link" : "Paste the pairing link",
    password: passwordView(mode, fields),
  };
}

/** The address field's message, or `undefined` when the address can be saved. */
export function addressProblem(address: string): string | undefined {
  if (address.trim() === "") return ADDRESS_BLANK;
  if (parsePairingUrl(address) !== null) return ADDRESS_IS_LINK;
  if (!isDialableTarget(address)) return daemonErrorView("invalid_address").message;
  return undefined;
}

/** The link field's message, or `undefined` when the text is a pairing link. */
export function linkProblem(link: string): string | undefined {
  if (link.trim() === "") return LINK_BLANK;
  if (parsePairingUrl(link.trim()) === null) return daemonErrorView("invalid_link").message;
  return undefined;
}

function nameProblem(name: string): string | undefined {
  return name.trim() === "" ? NAME_BLANK : undefined;
}

function problems(entries: [FormField, string | undefined][]): FormErrors {
  const errors: FormErrors = {};
  for (const [field, message] of entries) if (message !== undefined) errors[field] = message;
  return errors;
}

export type BuildResult<T> = { ok: true; value: T } | { ok: false; errors: FormErrors };

/** Check an add form and build what `HostDaemons.add` takes. */
export function buildNewDaemon(fields: FormFields): BuildResult<NewDaemon> {
  const name = fields.name.trim();
  if (fields.kind === "relay") {
    const errors = problems([
      ["name", nameProblem(fields.name)],
      ["link", linkProblem(fields.pairingLink)],
    ]);
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: { kind: "relay", name, pairingLink: fields.pairingLink.trim() },
    };
  }
  const errors = problems([
    ["name", nameProblem(fields.name)],
    ["address", addressProblem(fields.address)],
  ]);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind: "direct",
      name,
      address: fields.address,
      ...(fields.password === "" ? {} : { password: fields.password }),
    },
  };
}

/**
 * Check an edit form and build the patch: only what changed. A field the entry's kind does not
 * have is never sent. A password typed wins over a pending clear.
 */
export function buildPatch(entry: DaemonEntryView, fields: FormFields): BuildResult<DaemonPatch> {
  const name = fields.name.trim();
  const nameChanged = name !== entry.name;
  const addressChanged = entry.kind === "direct" && fields.address !== (entry.address ?? "");
  const linkTyped = entry.kind === "relay" && fields.pairingLink.trim() !== "";

  const errors = problems([
    // An unchanged name is the saved one and is not re-checked.
    ["name", nameChanged ? nameProblem(fields.name) : undefined],
    ["address", addressChanged ? addressProblem(fields.address) : undefined],
    ["link", linkTyped ? linkProblem(fields.pairingLink) : undefined],
  ]);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: DaemonPatch = {};
  if (nameChanged) patch.name = name;
  if (addressChanged) patch.address = fields.address;
  if (entry.kind !== "relay") {
    if (fields.password !== "") patch.password = fields.password;
    else if (fields.clearPassword && entry.hasPassword) patch.password = null;
  }
  if (linkTyped) patch.pairingLink = fields.pairingLink.trim();
  return { ok: true, value: patch };
}

/** Whether saving this edit gives a relay entry a new pairing link. */
export function linkReplaced(entry: DaemonEntryView, fields: FormFields): boolean {
  return entry.kind === "relay" && fields.pairingLink.trim() !== "";
}

export function isEmptyPatch(patch: DaemonPatch): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * Whether a saved change to the entry calls for connecting again: it is the current entry and the
 * change alters what is dialed (address, password or link). A rename does not.
 */
export function needsReconnect(
  entry: Pick<DaemonEntryView, "id">,
  currentId: string | null,
  patch: DaemonPatch,
): boolean {
  if (entry.id !== currentId) return false;
  return (
    patch.address !== undefined || patch.password !== undefined || patch.pairingLink !== undefined
  );
}

/** Where a host refusal is drawn and what it says. */
export function refusalErrors(code: DaemonFailure): FormErrors {
  const message = code === "unexpected" ? SAVE_FAILED : daemonErrorView(code).message;
  switch (code) {
    case "name_taken":
    case "invalid_name":
      return { name: message };
    case "invalid_address":
      return { address: message };
    case "invalid_link":
      return { link: message };
    default:
      return { form: message };
  }
}

/** The fields without the message of one field, once the user edits it. */
export function withoutError(errors: FormErrors, field: FormField): FormErrors {
  if (errors[field] === undefined && errors.form === undefined) return errors;
  const next = { ...errors };
  delete next[field];
  delete next.form;
  return next;
}
