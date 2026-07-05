// Dictation and realtime voice agent state models.
// clean-room-scope/features/composer-ui.md § Dictation, § Realtime voice agent

export type DictationStatus = "idle" | "recording" | "processing" | "failed" | "canceled";

export type DictationState = {
  status: DictationStatus;
  volume: number;
  durationMs: number;
  transcript?: string;
  error?: string;
};

export const INITIAL_DICTATION_STATE: DictationState = { status: "idle", volume: 0, durationMs: 0 };

export function startDictation(state: DictationState): DictationState {
  return { ...state, status: "recording", volume: 0, durationMs: 0, error: undefined, transcript: undefined };
}

export function cancelDictation(state: DictationState): DictationState {
  return { ...state, status: "canceled" };
}

export function failDictation(state: DictationState, error: string): DictationState {
  return { ...state, status: "failed", error };
}

export function completeDictation(state: DictationState, transcript: string): DictationState {
  return { ...state, status: "idle", transcript };
}

export function tickDictation(state: DictationState, volume: number, durationMs: number): DictationState {
  return { ...state, volume, durationMs };
}

export type RealtimeVoicePhase =
  | "disabled"
  | "starting"
  | "listening"
  | "submitting"
  | "waiting"
  | "playing"
  | "stopping";

export type RealtimeVoiceState = {
  phase: RealtimeVoicePhase;
  muted: boolean;
  volume: number;
  speaking: boolean;
  error?: string;
};

export const INITIAL_VOICE_STATE: RealtimeVoiceState = { phase: "disabled", muted: false, volume: 0, speaking: false };

export function startVoiceSession(state: RealtimeVoiceState): RealtimeVoiceState {
  return { ...state, phase: "starting", error: undefined };
}

export function stopVoiceSession(state: RealtimeVoiceState): RealtimeVoiceState {
  return { ...state, phase: "stopping" };
}

export function setVoicePhase(state: RealtimeVoiceState, phase: RealtimeVoicePhase): RealtimeVoiceState {
  return { ...state, phase };
}

export function toggleVoiceMute(state: RealtimeVoiceState): RealtimeVoiceState {
  return { ...state, muted: !state.muted };
}

export function isVoiceActive(state: RealtimeVoiceState): boolean {
  return state.phase !== "disabled" && state.phase !== "stopping";
}

export type DictationOrVoiceMode = "none" | "dictation" | "voice";

export function activeInputMode(dictation: DictationState, voice: RealtimeVoiceState): DictationOrVoiceMode {
  if (isVoiceActive(voice)) return "voice";
  if (dictation.status === "recording" || dictation.status === "processing") return "dictation";
  return "none";
}
