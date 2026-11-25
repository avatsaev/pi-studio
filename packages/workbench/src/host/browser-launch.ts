/**
 * The browser host's `launch`: the page URL is the launch intent.
 *  - `?pair=<url-encoded pairing link>` pre-fills and always connects (the link is its own
 *    credential). There is no address, password or auto-connect grammar.
 *  - A fragment carrying `offer=` means the page URL itself is a pairing link (`pi-studio daemon
 *    pair` used this origin as its `baseUrl`): connect to it immediately.
 *  - Developer switch (`devDirect`): with no pairing link, connect to the page's same-origin
 *    `/daemon-ws` proxy.
 *  - `#agent=<id>` is the agent deep link (swe/features/web-ui-agent-deep-link.md), re-read on
 *    `hashchange`; consuming it strips `agent=` from the fragment with `history.replaceState`.
 */

import { parseAgentDeepLink, stripAgentParam } from "../lib/agent-deep-link.js";
import { sameOriginDaemonUrl } from "./browser-connection.js";
import { type ConnectIntent, type HostLaunch } from "./types.js";

/** The pairing-link grammar as a pure function of the page location. */
export function parseBrowserConnectIntent(location: {
  href: string;
  search: string;
  hash: string;
}): ConnectIntent | null {
  if (location.hash.includes("offer=")) return { url: location.href, connect: true };
  const pair = new URLSearchParams(location.search).get("pair");
  return pair ? { url: pair, connect: true } : null;
}

export function createBrowserLaunch(options: { devDirect?: boolean } = {}): HostLaunch {
  return {
    initialConnect: () =>
      parseBrowserConnectIntent(window.location) ??
      (options.devDirect ? { url: sameOriginDaemonUrl(window.location), connect: true } : null),
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
