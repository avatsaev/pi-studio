/**
 * The popover button's state, as a pure priority table (sprint-074): compacting beats everything
 * (the button becomes Cancel), then the reasons Compact now is unavailable, then available.
 */

export type CompactAction =
  | { kind: "cancel"; note?: undefined }
  | { kind: "disabled"; note: string }
  | { kind: "compact"; note?: undefined };

export function compactAction(input: {
  compacting: boolean;
  running: boolean;
  hasAgent: boolean;
  connected: boolean;
}): CompactAction {
  if (input.compacting) return { kind: "cancel" };
  if (!input.connected) return { kind: "disabled", note: "Not connected" };
  if (!input.hasAgent) return { kind: "disabled", note: "Nothing to compact yet" };
  if (input.running) return { kind: "disabled", note: "Wait for the agent to finish" };
  return { kind: "compact" };
}
