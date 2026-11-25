/**
 * privacy-view — the Settings → Privacy panel's wording and decisions, pure
 * (`swe/features/desktop-usage-data.md` § 2, § 7). The list below is § 2's properties in plain
 * words: none omitted, none added.
 */

import type { UsageBlockedReason, UsageDataView } from "../../host/types.js";

/** The public "Usage data" page (the docs site, `fern/docs.yml`). */
export const USAGE_DATA_DOCS_URL = "https://pi-studio.docs.buildwithfern.com/usage-data";

/** What is sent, in plain words. */
export const USAGE_DATA_SENT: readonly string[] = [
  "Three events: the app started, once a day while it runs, and the app closed (with how many seconds it ran).",
  "Your system: Windows, macOS or Linux, and the CPU type (x86_64 or aarch64).",
  "The app version and how it was installed (AppImage, deb, rpm, app, nsis, msi).",
  "Your system language, such as en-US, when the system reports one.",
  "How many daemon entries you keep of each kind: local, direct, relay and SSH. Counts only.",
  "A random anonymous ID, the same on every event, so people are counted once.",
  "Your country, derived by PostHog from the connection. Your IP address is not stored.",
];

/** Where it goes. */
export const USAGE_DATA_DESTINATION = "Events go straight to PostHog, in the EU.";

/** What is never sent. */
export const USAGE_DATA_NEVER =
  "Never sent: daemon names or addresses, paths, projects, agents, models, or anything you type.";

const BLOCKED_TEXT: Record<UsageBlockedReason, string> = {
  build: "this build is not a published release",
  do_not_track: "DO_NOT_TRACK is set",
  ci: "CI is set",
  scripted: "the app was started by a script",
};

export interface PrivacyView {
  /** The switch's state. */
  checked: boolean;
  /** Why this run sends nothing, or null when it can. */
  blockedLine: string | null;
  /** "Your anonymous ID: …", or null before one was made. */
  idLine: string | null;
}

export function privacyView(view: UsageDataView): PrivacyView {
  return {
    checked: view.enabled,
    blockedLine:
      view.blocked === undefined ? null : `This run sends nothing: ${BLOCKED_TEXT[view.blocked]}.`,
    idLine: view.id ? `Your anonymous ID: ${view.id}` : null,
  };
}
