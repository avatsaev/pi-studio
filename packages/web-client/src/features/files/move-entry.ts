/**
 * Shared `file_move_request` caller for the explorer's drag-and-drop move (`FileExplorer.tsx`) —
 * one place for the wire call and the server error-code → user-facing message mapping, structured
 * the same way as the sibling `create-entry.ts`.
 */

import type { PiStudioClient } from "@av-pi-studio/client";

const ERROR_MESSAGES: Record<string, string> = {
  empty_path: "Nothing to move.",
  invalid_name: "Invalid name for the destination.",
  exists: "An item with that name already exists in the destination folder.",
  not_found: "That item or destination folder no longer exists.",
  not_a_directory: "The destination is not a folder.",
  same_path: "That item is already in this folder.",
  into_descendant: "A folder cannot be moved into itself.",
  cross_device: "Cannot move across filesystems.",
};

/** Move or rename `path` to `destination`; returns the resolved destination path. Throws an
 *  Error carrying a user-facing message on failure. */
export async function moveEntry(
  client: PiStudioClient,
  path: string,
  destination: string,
): Promise<string> {
  const response = await client.connection.request<{
    ok: boolean;
    destination?: string;
    error?: string;
  }>("file_move_request", { path, destination });
  if (!response.ok) {
    const code = response.error ?? "";
    throw new Error(ERROR_MESSAGES[code] ?? code ?? "Failed to move");
  }
  return response.destination ?? destination;
}
