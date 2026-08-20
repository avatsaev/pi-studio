/**
 * The hand-off between `ModelProvidersPanel`'s `Log in`/`Re-login` action and `LoginDialog.tsx`
 * (task-004): this task's job stops at "the user picked a provider + auth method" — the SDK call
 * (`client.loginProvider`) and the flow-event rendering are task-004's job.
 *
 * `AbortController` lives here (not inside the login dialog) so *anything* can cancel a flow
 * already underway without needing a reference to whatever component is currently rendering it —
 * in particular `SettingsDialog`'s close handler, which must cancel a live flow rather than
 * abandon it silently.
 */

import { create } from "zustand";
import type { ProviderAuthType } from "@av-pi-studio/protocol";

export interface PendingProviderLogin {
  provider: string;
  /** Display name, for the login dialog's title only — never used for the RPC call (`provider`,
   *  the id, is). */
  providerName: string;
  authType: ProviderAuthType;
  controller: AbortController;
  /** Bumped by `retryLogin`. `LoginDialog` keys its inner flow component on
   *  `${provider}:${authType}:${attempt}` — a fresh mount is the reset mechanism for "a new login
   *  attempt starts with a different provider, auth type, or retry": no stale reducer state,
   *  resolver ref, or effect subscription ever survives into the new attempt. */
  attempt: number;
}

interface ProviderAuthUiState {
  /** Non-null while a login is requested/in flight. Exactly one at a time — mirrors the SDK's own
   *  one-flow-per-client rule at the UI level, so a second row can be disabled rather than let a
   *  click reach `loginProvider()` only to be rejected locally. */
  pendingLogin: PendingProviderLogin | null;
  requestLogin(provider: string, providerName: string, authType: ProviderAuthType): void;
  /** Aborts the in-flight flow (if any) and clears the pending request. */
  cancelLogin(): void;
  /** Clears the pending request without aborting — the flow already reached a terminal state. */
  clearLogin(): void;
  /** Starts a fresh attempt for the same provider/auth type: a new `AbortController`, `attempt`
   *  bumped so `LoginDialog` remounts its flow component from scratch. No-op if no login is
   *  pending (e.g. the dialog was already dismissed). */
  retryLogin(): void;
}

export const useProviderAuthUiStore = create<ProviderAuthUiState>()((set, get) => ({
  pendingLogin: null,

  requestLogin: (provider, providerName, authType) => {
    if (get().pendingLogin) return; // one flow at a time
    set({
      pendingLogin: {
        provider,
        providerName,
        authType,
        controller: new AbortController(),
        attempt: 0,
      },
    });
  },

  cancelLogin: () => {
    get().pendingLogin?.controller.abort();
    set({ pendingLogin: null });
  },

  clearLogin: () => set({ pendingLogin: null }),

  retryLogin: () => {
    const current = get().pendingLogin;
    if (!current) return;
    set({
      pendingLogin: {
        provider: current.provider,
        providerName: current.providerName,
        authType: current.authType,
        controller: new AbortController(),
        attempt: current.attempt + 1,
      },
    });
  },
}));
