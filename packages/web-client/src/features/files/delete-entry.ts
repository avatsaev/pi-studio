/**
 * Shared `file_delete_request` caller — one place for the wire call and the server error-code →
 * user-facing message mapping, structured the same way as its siblings `create-entry.ts`,
 * `write-file.ts` and `move-entry.ts`.
 *
 * Recursive and unconfirmed server-side (`FileExplorerService.deleteFile`): confirming a
 * destructive delete with the user is the caller's job, not this module's.
 *
 * Callers own their own cache invalidation and tab cleanup — those differ per call site (the
 * context menu closes every tab under the deleted prefix; the polymer build is rolling back a file
 * no tab ever saw).
 */

import type { PiStudioClient } from "@av-pi-studio/client";

const ERROR_MESSAGES: Record<string, string> = {
  empty_path: "Nothing to delete.",
  not_found: "That item no longer exists.",
};

/** Delete the file or directory at `path`. Throws an Error carrying a user-facing message on
 *  failure. */
export async function deleteEntry(client: PiStudioClient, path: string): Promise<void> {
  const response = await client.connection.request<{ ok: boolean; error?: string }>(
    "file_delete_request",
    { path },
  );
  if (!response.ok) {
    const code = response.error ?? "";
    throw new Error(ERROR_MESSAGES[code] ?? code ?? "Failed to delete");
  }
}
