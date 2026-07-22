/**
 * Shared `FileTransferClient` accessor — one instance per daemon connection so every
 * transfer consumer (inline viewer downloads, save-to-disk downloads, uploads) shares the
 * single inbound-frame demuxer over the one WebSocket. Mirrors `TerminalPanel.tsx`'s
 * `routerFor` pattern.
 */

import type { DaemonClient } from "@av-pi-studio/client";
import { FileTransferClient } from "@av-pi-studio/client";

const transferByDaemon = new WeakMap<DaemonClient, FileTransferClient>();

export function transferFor(daemon: DaemonClient): FileTransferClient {
  let transfer = transferByDaemon.get(daemon);
  if (!transfer) {
    transfer = new FileTransferClient(daemon);
    transfer.start();
    transferByDaemon.set(daemon, transfer);
  }
  return transfer;
}
