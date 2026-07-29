import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The daemon's single home-expansion helper (root `AGENTS.md` invariant 7: "`~` in `cwd` is
 * expanded server-side"). Every RPC handler that accepts a client-supplied path must route it
 * through this function instead of re-deriving the same `~`/`~/` check inline — six call sites
 * duplicated it verbatim before this module existed, one of them (`file_download_token_request`)
 * with no expansion at all.
 *
 * Only a bare `~` or a `~/`-prefixed path is expanded, matching the shell's own rule: `~otheruser/x`
 * is a different (unsupported) shell feature, not `$HOME/otheruser/x`, and is passed through as-is.
 */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
