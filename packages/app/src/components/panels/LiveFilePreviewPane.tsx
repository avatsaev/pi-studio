/**
 * LiveFilePreviewPane — file preview wired to `file_explorer_request` (preview
 * mode) via useFileContent, mapped through buildFilePreviewState.
 *
 * clean-room-scope/features/file-explorer-transfer.md, features/feature-panels-ui.md
 */

import { FilePreviewPane } from "./FilePreview.js";
import { buildFilePreviewState, type FilePreviewState } from "../../panels/file-preview.js";
import { useFileContent } from "../../hooks/use-explorer-hooks.js";
import { useClient } from "../../hooks/client-context.js";

export interface LiveFilePreviewPaneProps {
  serverId: string;
  path: string;
}

export function LiveFilePreviewPane({ serverId, path }: LiveFilePreviewPaneProps) {
  const client = useClient();
  const { data, isLoading, error } = useFileContent(
    serverId,
    path,
    client as unknown as Parameters<typeof useFileContent>[2],
  );

  let state: FilePreviewState;
  if (isLoading) {
    state = { status: "loading" };
  } else if (error) {
    state = buildFilePreviewState({ path, error: error instanceof Error ? error.message : String(error) });
  } else if (data?.isBinary) {
    state = buildFilePreviewState({ path, size: data.size, content: undefined });
  } else {
    state = buildFilePreviewState({ path, content: data?.text ?? "", size: data?.size });
  }

  return <FilePreviewPane state={state} />;
}
