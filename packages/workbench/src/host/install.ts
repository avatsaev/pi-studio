/**
 * The installed host is a module-level singleton: most of its callers are not React code (zustand
 * stores, persistence helpers, the connection store), so they read it with `getHost()` at call
 * time. `WorkbenchProvider` installs it during its first render, before any child renders.
 */

import { createBrowserHost } from "./browser-host.js";
import { type WorkbenchHost } from "./types.js";

let installed: WorkbenchHost | null = null;
let fallback: WorkbenchHost | null = null;
let warnedSecondHost = false;
const installListeners = new Set<(host: WorkbenchHost) => void>();

/**
 * Install `host` as the current host. The first install wins: installing the same host again is a
 * no-op (StrictMode renders twice), and a different one is ignored with one development warning.
 */
export function installHost(host: WorkbenchHost): WorkbenchHost {
  if (installed) {
    if (installed !== host && !warnedSecondHost) {
      warnedSecondHost = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[workbench] A second, different host was passed after one was installed; it is ignored. Replacing the host is unsupported.",
        );
      }
    }
    return installed;
  }
  installed = host;
  for (const listener of installListeners) listener(host);
  return host;
}

/** The installed host, or a lazily created browser host when nothing is installed yet. */
export function getHost(): WorkbenchHost {
  if (installed) return installed;
  fallback ??= createBrowserHost();
  return fallback;
}

/**
 * Run `listener` when a host is installed. For module-level stores that read the host while the
 * module loads (before installation) and must re-read from the real host.
 */
export function onHostInstalled(listener: (host: WorkbenchHost) => void): () => void {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Test-only: forget the installed host and the warning latch. Listeners stay registered. */
export function resetHostForTests(): void {
  installed = null;
  fallback = null;
  warnedSecondHost = false;
}
