/**
 * Shared workspace-path resolution — join a possibly-relative path against a workspace `base`
 * (a cwd, an explorer root, …). Lifted out of the file tab live-refresh hook's own resolver
 * (task-007/step 1 there) because a second consumer (inline chat images, task-002) needs the exact
 * same join/trailing-slash contract, and a second copy would reintroduce the tilde/absolute
 * duplicate-path bug this function exists to prevent.
 */

/**
 * Absolute target for a possibly-relative `path` joined against `base`. A leading `/` or `~` is
 * returned as-is — for `~`, deliberately unexpanded: the daemon expands `~` server-side
 * (root `AGENTS.md` invariant 7), and callers that need `~` expanded for their OWN purposes (e.g.
 * a client-side cache key) go through `normalizeCwd` instead, which is a different concern from
 * what the daemon receives.
 */
export function resolveWorkspacePath(path: string, base: string): string | null {
  if (!path) return null;
  if (path.startsWith("/") || path.startsWith("~")) return path;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${path}`;
}

/** Parent directory of an absolute path — `"/foo/bar"` → `"/foo"`, `"/foo"` → `"/"`. */
export function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "/";
}

/** `path` relative to `root` (both absolute) — strips the root prefix and any leading slash.
 * Returns `path` unchanged if it isn't nested under `root`. */
export function relativeToRoot(path: string, root: string): string {
  if (!root || !path.startsWith(root)) return path;
  return path.slice(root.length).replace(/^\/+/, "");
}
