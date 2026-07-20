/**
 * useConnectToServer — one-click connect shared by the connect screen and the Settings
 * servers list. Seeds the ui-store toolbar fields (so the visible connection surface in
 * the workspace stays consistent with what is actually connected), connects, and navigates
 * to the workspace on success. Failures stay on the current route with the message carried
 * by `connection-store.error`, so the user can fix and retry.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useConnectionStore } from "./connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";

export interface ConnectTarget {
  url: string;
  password?: string;
}

export function useConnectToServer(): (target: ConnectTarget) => Promise<void> {
  const navigate = useNavigate();

  return useCallback(
    async (target) => {
      const ui = useUiStore.getState();
      ui.setHost(target.url);
      ui.setPassword(target.password ?? "");

      try {
        await useConnectionStore
          .getState()
          .connect({ url: target.url, password: target.password || undefined });
      } catch {
        return; // connection-store.error carries the message.
      }
      navigate("/");
    },
    [navigate],
  );
}
