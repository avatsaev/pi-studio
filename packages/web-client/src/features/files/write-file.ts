/**
 * Shared `file_write_request` caller for save flows (currently the molecule viewer's `onSave`,
 * `MoleculeViewer.tsx`) — one place for the wire call and the server error-code → user-facing
 * message mapping, structured the same way as the sibling `move-entry.ts`. Overwrite-only: the
 * daemon 404s `not_found` for a missing target (`FileExplorerService.writeFile`); there is no
 * create-on-write.
 */

import type { PiStudioClient } from "@av-pi-studio/client";

const ERROR_MESSAGES: Record<string, string> = {
  empty_path: "Nothing to save.",
  too_large: "File is too large to save (over 5 MiB).",
  not_found: "The file no longer exists.",
  unreadable: "The file could not be read.",
  not_a_file: "That path is not a file.",
};

/** Overwrite `path`'s content on disk. Throws an Error carrying a user-facing message on
 *  failure. */
export async function writeFile(
  client: PiStudioClient,
  path: string,
  content: string,
): Promise<void> {
  const response = await client.connection.request<{ ok: boolean; error?: string }>(
    "file_write_request",
    { path, content },
  );
  if (!response.ok) {
    const code = response.error ?? "";
    throw new Error(ERROR_MESSAGES[code] ?? code ?? "Failed to save");
  }
}
