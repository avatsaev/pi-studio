/**
 * What the connection store keeps of a failed connection: the message to show, and the SDK's
 * machine-readable reason when the failure came from the relay transport. The reason lets a caller
 * react to a cause (a relay entry's `wrong_key` means its pairing link no longer matches) without
 * parsing the message, which stays the one the SDK wrote.
 */

import { RelayConnectError, type RelayConnectReason } from "@av-pi-studio/client";

export interface ConnectFailure {
  error: string;
  /** Set only for a `RelayConnectError`; `null` for every other failure. */
  errorReason: RelayConnectReason | null;
}

export function connectFailure(error: unknown): ConnectFailure {
  return {
    error: error instanceof Error ? error.message : String(error),
    errorReason: error instanceof RelayConnectError ? error.reason : null,
  };
}
