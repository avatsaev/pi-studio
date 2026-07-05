// ProjectIconView — deterministic colored avatar fallback.
// ui-components.md § Surfaces / badges / chips / avatars

// A small fixed palette of background colors for avatar fallbacks.
// Chosen to be distinct and accessible (sufficient contrast for white text).
const AVATAR_COLORS = [
  "#2563eb", // blue-600
  "#16a34a", // green-600
  "#9333ea", // purple-600
  "#dc2626", // red-600
  "#0d9488", // teal-600
  "#d97706", // amber-600
  "#db2777", // pink-600
  "#0891b2", // cyan-600
  "#ea580c", // orange-600
  "#4f46e5", // indigo-600
  "#059669", // emerald-600
  "#7c3aed", // violet-600
] as const;

/**
 * Deterministic avatar background color derived from a project key string.
 * The same key always produces the same color — stable across renders.
 */
export function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    hash = (hash * 31 + code) >>> 0; // unsigned 32-bit
  }
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  // AVATAR_COLORS has 12 entries; hash % 12 is always valid.
  return color ?? AVATAR_COLORS[0];
}

/**
 * Returns the initial letter to display in the avatar fallback.
 * Uses the first alphanumeric character of the key, uppercased.
 */
export function avatarInitial(key: string): string {
  const match = key.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "?";
}
