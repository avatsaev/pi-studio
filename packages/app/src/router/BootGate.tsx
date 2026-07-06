/**
 * BootGate — runs the boot resolver on app load and navigates accordingly.
 * Consumes the sprint-013 resolveBootRoute model.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  resolveBootRoute,
  StoreReadyLatch,
  type BootResolverInput,
} from "../runtime/boot-resolver.js";
import { type HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import { type KeyValueStore } from "../providers/kv-store.js";

export const LAST_WORKSPACE_KEY = "pi-studio-last-workspace";
// Generous enough to absorb dev StrictMode double-mount connection churn and
// reconnect backoff; a host coming online resolves immediately regardless.
const GAVE_UP_TIMEOUT_MS = 12000;

export interface BootGateProps {
  hosts: readonly HostRuntimeSnapshot[];
  kvStore: KeyValueStore;
  children: ReactNode;
}

/**
 * On first mount, resolves the boot route and navigates.
 * Shows a splash until resolved, then renders children.
 */
export function BootGate({ hosts, kvStore, children }: BootGateProps) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  // A stable key of the *online* hosts, so the effect re-runs when a host
  // transitions offline→online (host count alone never changes for the single
  // default/proxy host — the earlier bug that stranded users on onboarding).
  const onlineKey = hosts
    .filter((h) => h.status === "online")
    .map((h) => h.serverId ?? h.profile.serverId)
    .sort()
    .join(",");
  const splashErrorKey = hosts.some((h) => h.status === "error") ? "error" : "";

  useEffect(() => {
    const latch = new StoreReadyLatch();
    const hasOnline = hosts.some((h) => h.status === "online");

    function resolve(gaveUp: boolean) {
      let lastWorkspace: BootResolverInput["lastWorkspace"];
      const raw = kvStore.get(LAST_WORKSPACE_KEY);
      if (raw) {
        try {
          lastWorkspace = JSON.parse(raw);
        } catch {}
      }

      const result = resolveBootRoute({
        storeReady: true,
        gaveUp,
        hosts,
        lastWorkspace,
      });

      if (result.kind === "redirect") {
        navigate(result.to, { replace: true });
      }
      // splash/splash-error: stay on current route (root renders splash)
      setReady(true);
    }

    // A host is online now — resolve immediately (no waiting on the timer).
    if (hasOnline) {
      latch.update({ onlineHost: true, splashError: false, gaveUp: false });
      resolve(false);
      return;
    }

    // No host online yet: keep the splash up and only give up (→ onboarding)
    // after the timeout, in case the daemon is genuinely unreachable.
    const timer = setTimeout(() => {
      if (!latch.value) {
        latch.update({ onlineHost: false, splashError: false, gaveUp: true });
        resolve(true);
      }
    }, GAVE_UP_TIMEOUT_MS);

    return () => clearTimeout(timer);
    // Re-run whenever the set of online hosts (or error state) changes.
  }, [onlineKey, splashErrorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="pi-splash" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <p>Loading…</p>
      </div>
    );
  }

  return <>{children}</>;
}
