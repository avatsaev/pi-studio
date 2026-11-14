/**
 * Agent deep link (`#agent=<urlencoded agentId>`, swe/features/web-ui-agent-deep-link.md): pure
 * fragment grammar + URL cleanup, kept free of `window` so plain-Node vitest can prove every rule.
 */

const MAX_AGENT_ID_LENGTH = 256;

/** The first decoded `agent` value of a URL fragment; empty or over-long values are absent. */
export function parseAgentDeepLink(hash: string): string | undefined {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const value = new URLSearchParams(fragment).get("agent");
  if (!value || value.length > MAX_AGENT_ID_LENGTH) return undefined;
  return value;
}

/**
 * The same URL with every `agent` key removed from the fragment. Other fragment keys keep their
 * order and raw encoding, the query string is untouched, and an emptied fragment drops the `#`.
 */
export function stripAgentParam(href: string): string {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return href;
  const base = href.slice(0, hashIndex);
  const kept = href
    .slice(hashIndex + 1)
    .split("&")
    .filter((pair) => pair !== "" && new URLSearchParams(pair).keys().next().value !== "agent");
  return kept.length === 0 ? base : `${base}#${kept.join("&")}`;
}

/** Effects of applying a deep link, injected so Node tests can drive `applyAgentDeepLink`. */
export interface AgentDeepLinkDeps<S extends { id: string; cwd?: string }> {
  consume(): string | undefined;
  findByAgentId(agentId: string): S | undefined;
  select(session: S): void;
  notifyNotFound(agentId: string): void;
  replaceUrl(): void;
}

/** Consume the pending target and select it, or report it unknown; then clean the URL. */
export function applyAgentDeepLink<S extends { id: string; cwd?: string }>(
  deps: AgentDeepLinkDeps<S>,
): void {
  const agentId = deps.consume();
  if (!agentId) return;
  const session = deps.findByAgentId(agentId);
  if (session) deps.select(session);
  else deps.notifyNotFound(agentId);
  deps.replaceUrl();
}
