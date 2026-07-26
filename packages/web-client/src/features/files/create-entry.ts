/**
 * Shared `file_create_request` caller for the two creation affordances (workspace-picker
 * "new folder" and the Files tree's inline "new file"/"new folder" draft row) — one place for
 * the wire call and the server error-code → user-facing message mapping.
 */

import type { PiStudioClient } from "@av-pi-studio/client";

export type CreateEntryKind = "file" | "directory";

const ERROR_MESSAGES: Record<string, string> = {
  empty_path: "Choose a folder first.",
  invalid_name: 'Invalid name — cannot be empty or contain "/".',
  exists: "An item with that name already exists here.",
  not_found: "That folder no longer exists.",
  not_a_directory: "That path is not a folder.",
  unreadable: "That folder is not readable.",
};

/** Create an empty file or a directory named `name` inside `parentPath`; returns its absolute path.
 *  Throws an Error carrying a user-facing message on failure. */
export async function createEntry(
  client: PiStudioClient,
  parentPath: string,
  name: string,
  kind: CreateEntryKind,
): Promise<string> {
  const response = await client.connection.request<{ ok: boolean; path?: string; error?: string }>(
    "file_create_request",
    { path: parentPath, name, kind },
  );
  if (!response.ok) {
    const code = response.error ?? "";
    throw new Error(ERROR_MESSAGES[code] ?? code ?? "Failed to create");
  }
  return (
    response.path ?? (parentPath.endsWith("/") ? `${parentPath}${name}` : `${parentPath}/${name}`)
  );
}
