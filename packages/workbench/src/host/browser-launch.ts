/**
 * The browser host's `launch`: the page URL is the launch intent.
 *  - `?host=&password=&cwd=&connect=1` pre-fills the connection bar; connects only with `connect=1`.
 *  - `?pair=<url-encoded pairing link>` pre-fills and always connects (the link is its own
 *    credential).
 *  - A fragment carrying `offer=` means the page URL itself is a pairing link (`pi-studio daemon
 *    pair` used this origin as its `baseUrl`): connect to it immediately.
 *  - `#agent=<id>` is the agent deep link (swe/features/web-ui-agent-deep-link.md), re-read on
 *    `hashchange`; consuming it strips `agent=` from the fragment with `history.replaceState`.
 */

import { parseAgentDeepLink, stripAgentParam } from "../lib/agent-deep-link.js";
import { type ConnectIntent, type HostLaunch } from "./types.js";

/** Today's URL grammar as a pure function of the page location. */
export function parseBrowserConnectIntent(location: {
  href: string;
  search: string;
  hash: string;
}): ConnectIntent | null {
  if (location.hash.includes("offer=")) return { url: location.href, connect: true };

  const qs = new URLSearchParams(location.search);
  const pair = qs.get("pair");
  const host = qs.get("host");
  const password = qs.get("password");
  const cwd = qs.get("cwd");
  const url = pair ?? host;
  const connect = pair !== null || qs.get("connect") === "1";
  if (!url && !password && !cwd && !connect) return null;
  return {
    ...(url ? { url } : {}),
    ...(password ? { password } : {}),
    ...(cwd ? { cwd } : {}),
    connect,
  };
}

export function createBrowserLaunch(): HostLaunch {
  return {
    initialConnect: () => parseBrowserConnectIntent(window.location),
    agentDeepLink: {
      current: () => parseAgentDeepLink(window.location.hash) ?? null,
      subscribe(listener) {
        const onHashChange = (): void => {
          const id = parseAgentDeepLink(window.location.hash);
          if (id) listener(id);
        };
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
      },
      consume() {
        window.history.replaceState(null, "", stripAgentParam(window.location.href));
      },
    },
  };
}
