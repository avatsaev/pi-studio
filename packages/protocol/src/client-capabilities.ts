import { COMPAT, type CompatTag } from "./validation.js";

/**
 * Capability flags — the per-feature compatibility layer (MAIN-SCOPE §9,
 * architecture/websocket-protocol.md § Capability flags / Compatibility rules).
 *
 * Two directions:
 *  - `CLIENT_CAPS` (client → daemon, advertised in `hello.capabilities`): the daemon stores these
 *    per connection so the wire boundary can ask one question, `supports(caps, flag)`. New wire
 *    enum values are gated through this so an old client never receives a value it didn't advertise.
 *  - `SERVER_FEATURES` (daemon → client, in `server_info.features.*`): new *features* advertise a
 *    flag; clients either run the feature or show "update the host." No degraded fallback path.
 */

// ---------------------------------------------------------------------------
// CLIENT_CAPS (client → daemon, hello.capabilities)
// ---------------------------------------------------------------------------

export const CLIENT_CAPS = {
  /** Client renders custom per-mode icons. */
  custom_mode_icons: "custom_mode_icons",
  /** Client understands the merged reasoning stream enum value. */
  reasoning_merge_enum: "reasoning_merge_enum",
  /** Client can consume a reflowable terminal snapshot payload. */
  terminal_reflowable_snapshot: "terminal_reflowable_snapshot",
  /** Client renders markdown images (`![alt](path)`) whose target is a local filesystem path. */
  inline_image_markdown: "inline_image_markdown",
  /** Client renders markdown links (`[label](path)`) whose target is a local filesystem path as an open-file action. */
  file_link_markdown: "file_link_markdown",
  /** Client renders `language-mermaid` fenced code blocks as a live diagram (flowcharts, sequence diagrams, etc.). */
  mermaid_diagram_markdown: "mermaid_diagram_markdown",
} as const;

export type ClientCapabilityKey = keyof typeof CLIENT_CAPS;
export type ClientCapability = (typeof CLIENT_CAPS)[ClientCapabilityKey];

// ---------------------------------------------------------------------------
// SERVER_FEATURES (daemon → client, server_info.features.*)
// ---------------------------------------------------------------------------

export const SERVER_FEATURES = {
  providersSnapshot: "providersSnapshot",
  checkoutGithubSetAutoMerge: "checkoutGithubSetAutoMerge",
  daemonStatusRpc: "daemonStatusRpc",
  "terminal-restore-modes": "terminal-restore-modes",
  rewind: "rewind",
  checkoutRefresh: "checkoutRefresh",
  extensionPacks: "extensionPacks",
} as const;

export type ServerFeatureKey = keyof typeof SERVER_FEATURES;
export type ServerFeature = (typeof SERVER_FEATURES)[ServerFeatureKey];

/**
 * COMPAT annotations for each server feature flag (version added + removal date). The removal dates
 * are placeholders to be confirmed against the live `ServerInfoStatusPayloadSchema`. Grep `COMPAT(`
 * to enumerate cleanup work.
 */
export const SERVER_FEATURE_COMPAT: Record<ServerFeatureKey, CompatTag> = {
  // COMPAT(providersSnapshot): added 0.0.0, remove by TBD
  providersSnapshot: COMPAT({ name: "providersSnapshot", addedIn: "0.0.0", removeBy: "TBD" }),
  // COMPAT(checkoutGithubSetAutoMerge): added 0.0.0, remove by TBD
  checkoutGithubSetAutoMerge: COMPAT({
    name: "checkoutGithubSetAutoMerge",
    addedIn: "0.0.0",
    removeBy: "TBD",
  }),
  // COMPAT(daemonStatusRpc): added 0.0.0, remove by TBD
  daemonStatusRpc: COMPAT({ name: "daemonStatusRpc", addedIn: "0.0.0", removeBy: "TBD" }),
  // COMPAT(terminal-restore-modes): added 0.0.0, remove by TBD
  "terminal-restore-modes": COMPAT({
    name: "terminal-restore-modes",
    addedIn: "0.0.0",
    removeBy: "TBD",
  }),
  // COMPAT(rewind): added 0.0.0, remove by TBD
  rewind: COMPAT({ name: "rewind", addedIn: "0.0.0", removeBy: "TBD" }),
  // COMPAT(checkoutRefresh): added 0.0.0, remove by TBD
  checkoutRefresh: COMPAT({ name: "checkoutRefresh", addedIn: "0.0.0", removeBy: "TBD" }),
  // COMPAT(extensionPacks): added 0.0.0, remove by TBD
  extensionPacks: COMPAT({ name: "extensionPacks", addedIn: "0.0.0", removeBy: "TBD" }),
};

// ---------------------------------------------------------------------------
// Gating helper (models daemon-side `session.supports(...)`)
// ---------------------------------------------------------------------------

/** The forms a stored capability set can take on the daemon session. */
export type CapabilitySet = Record<string, boolean> | readonly string[] | Set<string> | undefined;

/**
 * Returns true only if `flag` is advertised by `caps`. Used at serialization time to gate new wire
 * enum values: `if (session.supports(CLIENT_CAPS.reasoning_merge_enum)) emit(newValue) else emit(old)`.
 */
export function supports(caps: CapabilitySet, flag: string): boolean {
  if (!caps) return false;
  if (caps instanceof Set) return caps.has(flag);
  if (Array.isArray(caps)) return caps.includes(flag);
  return (caps as Record<string, boolean>)[flag] === true;
}
