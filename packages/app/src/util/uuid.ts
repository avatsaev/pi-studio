/**
 * Portable UUID generator — uses crypto.randomUUID when available, falls back to
 * a timestamp + random hex suffix for older environments.
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: not RFC4122 compliant but unique enough for tab/pane IDs.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
