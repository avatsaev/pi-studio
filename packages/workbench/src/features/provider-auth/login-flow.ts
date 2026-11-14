/**
 * Pure `(LoginFlowState, ProviderAuthFlowUiEvent) → LoginFlowState` reducer for the provider-auth
 * login dialog. Every step/ordering decision the dialog needs lives here, so the component
 * (task-004) stays a renderer — the established split in this codebase (`timeline/reducer.ts`
 * beside `Timeline.tsx`, `ui/combobox.ts` beside `Select.tsx`).
 *
 * swe/features/provider-auth-ui.md § Behavior & Algorithms, § Web UI surface.
 */

import type { ProviderAuthType } from "@av-pi-studio/protocol";
import type { ProviderAuthFlowUiEvent, ProviderAuthPromptUi } from "@av-pi-studio/client";

/** One line of the flow's presentation log. `progress` lines are a single rolling "current status"
 *  entry — see `applyLoginFlowEvent`'s `progress` case; `info` lines accumulate permanently. */
export interface StatusLine {
  kind: "info" | "progress";
  message: string;
  links?: readonly { url: string; label?: string }[];
}

export interface AuthUrlPresentation {
  url: string;
  instructions?: string;
}

export interface DeviceCodePresentation {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

export interface LoginFlowResult {
  ok: boolean;
  error?: string;
}

export interface LoginFlowState {
  provider: string;
  authType: ProviderAuthType;
  /** `"starting"` until the first presentation event; `"prompt"` while a question is live;
   *  `"done"` is terminal — no later event ever mutates state again. */
  phase: "starting" | "waiting" | "prompt" | "done";
  statusLines: StatusLine[];
  authUrl?: AuthUrlPresentation;
  deviceCode?: DeviceCodePresentation;
  prompt?: ProviderAuthPromptUi;
  result?: LoginFlowResult;
}

/** Build the state a fresh login dialog opens with, before any flow event has arrived. */
export function initialLoginFlowState(
  provider: string,
  authType: ProviderAuthType,
): LoginFlowState {
  return {
    provider,
    authType,
    phase: "starting",
    statusLines: [],
  };
}

function onInfo(
  state: LoginFlowState,
  message: string,
  links: readonly { url: string; label?: string }[] | undefined,
): LoginFlowState {
  return {
    ...state,
    phase: state.phase === "starting" ? "waiting" : state.phase,
    statusLines: [...state.statusLines, { kind: "info", message, links }],
  };
}

/** `progress` replaces the current progress line rather than accumulating — at most one exists in
 *  `statusLines` at a time, always positioned after every `info` line seen so far. */
function onProgress(state: LoginFlowState, message: string): LoginFlowState {
  const withoutCurrentProgress = state.statusLines.filter((line) => line.kind !== "progress");
  return {
    ...state,
    phase: state.phase === "starting" ? "waiting" : state.phase,
    statusLines: [...withoutCurrentProgress, { kind: "progress", message }],
  };
}

function onAuthUrl(
  state: LoginFlowState,
  url: string,
  instructions: string | undefined,
): LoginFlowState {
  // Phase deliberately untouched: a `manual_code` prompt may already be live alongside this url
  // (OAuth's click-through and paste-a-code paths are designed to coexist), and this event alone
  // must never demote/promote whatever phase the flow is already in.
  return { ...state, authUrl: { url, instructions } };
}

function onDeviceCode(
  state: LoginFlowState,
  userCode: string,
  verificationUri: string,
  intervalSeconds: number | undefined,
  expiresInSeconds: number | undefined,
): LoginFlowState {
  return { ...state, deviceCode: { userCode, verificationUri, intervalSeconds, expiresInSeconds } };
}

function onPrompt(state: LoginFlowState, prompt: ProviderAuthPromptUi): LoginFlowState {
  return { ...state, phase: "prompt", prompt };
}

function onPromptCancelled(state: LoginFlowState, promptId: string): LoginFlowState {
  if (state.prompt?.promptId !== promptId) return state; // stale/non-matching id — no-op
  return { ...state, phase: "waiting", prompt: undefined };
}

function onDone(state: LoginFlowState, ok: boolean, error: string | undefined): LoginFlowState {
  return { ...state, phase: "done", result: { ok, error } };
}

/**
 * Apply one flow event to login-dialog state. Pure — no mutation of the input, no timers, no DOM,
 * no `Date.now()` (a device-code countdown is a view concern; only the daemon-sent expiry is
 * stored). `done` is terminal: once `phase === "done"`, every later event is a no-op.
 */
export function applyLoginFlowEvent(
  state: LoginFlowState,
  event: ProviderAuthFlowUiEvent,
): LoginFlowState {
  if (state.phase === "done") return state;

  switch (event.kind) {
    case "info":
      return onInfo(state, event.message, event.links);
    case "progress":
      return onProgress(state, event.message);
    case "auth_url":
      return onAuthUrl(state, event.url, event.instructions);
    case "device_code":
      return onDeviceCode(
        state,
        event.userCode,
        event.verificationUri,
        event.intervalSeconds,
        event.expiresInSeconds,
      );
    case "prompt":
      return onPrompt(state, event);
    case "prompt_cancelled":
      return onPromptCancelled(state, event.promptId);
    case "done":
      return onDone(state, event.ok, event.error);
  }
  // No `default` — `ProviderAuthFlowUiEvent`'s union is closed over `kind`, so an unhandled future
  // kind fails typecheck here ("not all code paths return a value") rather than falling through
  // silently. See `ui/combobox.ts`'s `comboboxReducer` for the same convention in this codebase.
}
