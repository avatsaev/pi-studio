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
import {
  type DaemonEntryView,
  type DaemonPatch,
  type NewDaemon,
  type SshHostSuggestion,
} from "../../host/types.js";
import { isDialableTarget } from "../connection/connection-presentation.js";
import { daemonErrorView, type DaemonFailure } from "./daemon-presentation.js";

/** What a form is for: a new entry (of a kind the user picks) or an existing one. */
export type FormMode = { type: "add" } | { type: "edit"; entry: DaemonEntryView };

export type FormKind = "direct" | "relay" | "ssh";

/** Where a message is drawn: next to a field, or at the form. */
export type FormField =
  | "name"
  | "address"
  | "password"
  | "link"
  | "host"
  | "user"
  | "port"
  | "identityFile"
  | "jump"
  | "daemonPort"
  | "sshPassword"
  | "passphrase"
  | "form";

export type FormErrors = Partial<Record<FormField, string>>;

/** The daemon's port on its host when none is given. */
export const DEFAULT_DAEMON_PORT = 6767;
const MAX_PORT = 65535;

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
  /** SSH: the host or alias, and what is typed for the optional connection fields ("" = none). */
  host: string;
  user: string;
  /** Typed text; checked to be a port when saved. */
  port: string;
  identityFile: string;
  jump: string;
  /** Typed text; empty means the default. */
  daemonPort: string;
  /** SSH: what is typed; never a stored value. */
  sshPassword: string;
  clearSshPassword: boolean;
  passphrase: string;
  clearPassphrase: boolean;
}

export const NAME_BLANK = "Give this daemon a name.";
export const ADDRESS_BLANK = "Enter the daemon's address.";
export const ADDRESS_IS_LINK = "This is a pairing link. Add it as a relay daemon instead.";
export const LINK_BLANK = "Paste the pairing link.";
export const SAVE_FAILED = "This daemon could not be saved.";
export const HOST_BLANK = "Enter the host.";

const SSH_BLANKS = {
  host: "",
  user: "",
  port: "",
  identityFile: "",
  jump: "",
  daemonPort: "",
  sshPassword: "",
  clearSshPassword: false,
  passphrase: "",
  clearPassphrase: false,
};

export function initialAddFields(kind: FormKind = "direct"): FormFields {
  return {
    kind,
    name: "",
    address: "",
    password: "",
    clearPassword: false,
    pairingLink: "",
    ...SSH_BLANKS,
  };
}

/** Name and address (or SSH settings) as saved; secrets and link empty, whatever is stored. */
export function initialEditFields(entry: DaemonEntryView): FormFields {
  const ssh = entry.ssh;
  return {
    ...initialAddFields(entry.kind === "relay" || entry.kind === "ssh" ? entry.kind : "direct"),
    name: entry.name,
    address: entry.address ?? "",
    ...(ssh === undefined
      ? {}
      : {
          host: ssh.host,
          user: ssh.user ?? "",
          port: ssh.port === undefined ? "" : String(ssh.port),
          identityFile: ssh.identityFile ?? "",
          jump: ssh.jump ?? "",
          daemonPort: String(ssh.daemonPort),
        }),
  };
}

/** Choosing a host of `~/.ssh/config`: it becomes the host, and the name when that is empty. */
export function chooseSshHost(fields: FormFields, alias: string): FormFields {
  return { ...fields, host: alias, name: fields.name.trim() === "" ? alias : fields.name };
}

export interface SshPlaceholders {
  user: string;
  port: string;
  identityFile: string;
  jump: string;
}

/** What the config says about the typed host, shown where the form's own value is empty. */
export function sshPlaceholders(
  host: string,
  suggestions: readonly SshHostSuggestion[],
): SshPlaceholders {
  const match = suggestions.find((suggestion) => suggestion.alias === host.trim());
  return {
    user: match?.user ?? "Optional",
    port: match?.port === undefined ? "Optional" : String(match.port),
    identityFile: match?.identityFile ?? "Optional",
    jump: match?.jump ?? "Optional",
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
  showSsh: boolean;
  sshPassword: PasswordFieldView;
  passphrase: PasswordFieldView;
}

export const KIND_OPTIONS: { value: FormKind; label: string }[] = [
  { value: "direct", label: "Address" },
  { value: "relay", label: "Relay (pairing link)" },
  { value: "ssh", label: "SSH" },
];

function secretView(stored: boolean, clearing: boolean): PasswordFieldView {
  if (!stored) {
    return {
      saved: false,
      marker: null,
      placeholder: "Optional",
      canClear: false,
      canUndoClear: false,
    };
  }
  if (clearing) {
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
  const entry = mode.type === "edit" ? mode.entry : undefined;
  return {
    title: editing ? `Edit ${mode.entry.name}` : "Add daemon",
    submitLabel: editing ? "Save" : "Add",
    showKind: !editing,
    showAddress: kind === "direct",
    showPassword: kind !== "relay",
    showLink: kind === "relay",
    linkLabel: editing ? "Replace link" : "Pairing link",
    linkPlaceholder: editing ? "Leave empty to keep the saved link" : "Paste the pairing link",
    password: secretView(entry?.hasPassword === true, fields.clearPassword),
    showSsh: kind === "ssh",
    sshPassword: secretView(entry?.ssh?.hasSshPassword === true, fields.clearSshPassword),
    passphrase: secretView(entry?.ssh?.hasPassphrase === true, fields.clearPassphrase),
  };
}

/** The host field's message, or `undefined` when it is filled (the host judges the rest). */
export function hostProblem(host: string): string | undefined {
  return host.trim() === "" ? HOST_BLANK : undefined;
}

/** The port field's message, or `undefined` when it is empty or a port. */
export function portProblem(port: string): string | undefined {
  const text = port.trim();
  if (text === "") return undefined;
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < 1 || value > MAX_PORT) {
    return daemonErrorView("invalid_port").message;
  }
  return undefined;
}

/** The port typed, `undefined` for an empty field; call after `portProblem` found nothing. */
function portOf(port: string): number | undefined {
  const text = port.trim();
  return text === "" ? undefined : Number(text);
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
  if (fields.kind === "ssh") return buildNewSsh(fields, name);
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

function buildNewSsh(fields: FormFields, name: string): BuildResult<NewDaemon> {
  const errors = problems([
    ["name", nameProblem(fields.name)],
    ["host", hostProblem(fields.host)],
    ["port", portProblem(fields.port)],
    ["daemonPort", portProblem(fields.daemonPort)],
  ]);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const user = fields.user.trim();
  const identityFile = fields.identityFile.trim();
  const jump = fields.jump.trim();
  const port = portOf(fields.port);
  const daemonPort = portOf(fields.daemonPort);
  return {
    ok: true,
    value: {
      kind: "ssh",
      name,
      host: fields.host.trim(),
      ...(user === "" ? {} : { user }),
      ...(port === undefined ? {} : { port }),
      ...(identityFile === "" ? {} : { identityFile }),
      ...(jump === "" ? {} : { jump }),
      ...(daemonPort === undefined ? {} : { daemonPort }),
      ...(fields.password === "" ? {} : { password: fields.password }),
      ...(fields.sshPassword === "" ? {} : { sshPassword: fields.sshPassword }),
      ...(fields.passphrase === "" ? {} : { passphrase: fields.passphrase }),
    },
  };
}

/**
 * Check an edit form and build the patch: only what changed. A field the entry's kind does not
 * have is never sent. A password typed wins over a pending clear.
 */
export function buildPatch(entry: DaemonEntryView, fields: FormFields): BuildResult<DaemonPatch> {
  if (entry.kind === "ssh" && entry.ssh !== undefined) {
    return buildSshPatch(entry, entry.ssh, fields);
  }
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

/** The patch of an optional text: empty clears what was saved, equal to what was saved is absent. */
function optionalText(typed: string, saved: string | undefined): string | null | undefined {
  const text = typed.trim();
  if (text === (saved ?? "")) return undefined;
  return text === "" ? null : text;
}

/** A secret: typed wins over a pending clear; a clear counts only when something is saved. */
function secretPatch(typed: string, clearing: boolean, saved: boolean): string | null | undefined {
  if (typed !== "") return typed;
  return clearing && saved ? null : undefined;
}

function buildSshPatch(
  entry: DaemonEntryView,
  ssh: NonNullable<DaemonEntryView["ssh"]>,
  fields: FormFields,
): BuildResult<DaemonPatch> {
  const name = fields.name.trim();
  const host = fields.host.trim();
  const nameChanged = name !== entry.name;
  const hostChanged = host !== ssh.host;
  const portChanged = fields.port.trim() !== (ssh.port === undefined ? "" : String(ssh.port));
  const daemonPortText = fields.daemonPort.trim();
  const daemonPortChanged =
    daemonPortText !== String(ssh.daemonPort) &&
    !(daemonPortText === "" && ssh.daemonPort === DEFAULT_DAEMON_PORT);

  const errors = problems([
    ["name", nameChanged ? nameProblem(fields.name) : undefined],
    ["host", hostChanged ? hostProblem(fields.host) : undefined],
    ["port", portChanged ? portProblem(fields.port) : undefined],
    ["daemonPort", daemonPortChanged ? portProblem(fields.daemonPort) : undefined],
  ]);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: DaemonPatch = {};
  if (nameChanged) patch.name = name;
  if (hostChanged) patch.host = host;
  const user = optionalText(fields.user, ssh.user);
  if (user !== undefined) patch.user = user;
  if (portChanged) patch.port = portOf(fields.port) ?? null;
  const identityFile = optionalText(fields.identityFile, ssh.identityFile);
  if (identityFile !== undefined) patch.identityFile = identityFile;
  const jump = optionalText(fields.jump, ssh.jump);
  if (jump !== undefined) patch.jump = jump;
  if (daemonPortChanged) patch.daemonPort = portOf(fields.daemonPort) ?? DEFAULT_DAEMON_PORT;
  const password = secretPatch(fields.password, fields.clearPassword, entry.hasPassword);
  if (password !== undefined) patch.password = password;
  const sshPassword = secretPatch(fields.sshPassword, fields.clearSshPassword, ssh.hasSshPassword);
  if (sshPassword !== undefined) patch.sshPassword = sshPassword;
  const passphrase = secretPatch(fields.passphrase, fields.clearPassphrase, ssh.hasPassphrase);
  if (passphrase !== undefined) patch.passphrase = passphrase;
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
 * change alters what is dialed (anything but the name). A rename does not.
 */
export function needsReconnect(
  entry: Pick<DaemonEntryView, "id">,
  currentId: string | null,
  patch: DaemonPatch,
): boolean {
  if (entry.id !== currentId) return false;
  return Object.keys(patch).some((key) => key !== "name");
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
    case "invalid_host":
      return { host: message };
    case "invalid_user":
      return { user: message };
    case "invalid_port":
      return { port: message };
    case "invalid_path":
      return { identityFile: message };
    case "invalid_jump":
      return { jump: message };
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
