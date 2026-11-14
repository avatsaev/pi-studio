/**
 * The one accessor the browser host uses to reach the live connection's file transfer, so the host
 * contract never mentions the connection store.
 */

import { type FileTransferClient } from "@av-pi-studio/client";
import { transferFor } from "../../hooks/file-transfer-instance.js";
import { useConnectionStore } from "./connection-store.js";

/** The live connection's shared `FileTransferClient`. Throws `"not connected"` without one. */
export function currentFileTransfer(): FileTransferClient {
  const { daemon } = useConnectionStore.getState();
  if (!daemon) throw new Error("not connected");
  return transferFor(daemon);
}
