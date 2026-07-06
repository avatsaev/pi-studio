/**
 * AddHostForm — manual host entry (URL + optional password), validate & connect.
 * app-navigation-screens.md § Onboarding & pairing
 */

import { useState, useCallback } from "react";
import styles from "./AddHostForm.module.css";
import { TextInput, Button } from "../primitives/index.js";
import type { DirectHostProfile, HostProfile } from "../../runtime/host-profile.js";

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

export type AddHostValidation =
  | { valid: true; url: string }
  | { valid: false; error: string };

/**
 * Validates a user-typed host address (host:port or ws[s]://host:port).
 * Returns normalized WebSocket URL.
 */
export function validateHostAddress(raw: string): AddHostValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, error: "Host address is required" };

  // Reject non-ws protocols explicitly.
  if (/^https?:\/\//i.test(trimmed)) {
    return { valid: false, error: "Protocol must be ws:// or wss://" };
  }

  // Prepend ws:// if no protocol
  let urlStr = trimmed;
  if (!/^wss?:\/\//i.test(urlStr)) {
    urlStr = `ws://${urlStr}`;
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return { valid: false, error: "Protocol must be ws:// or wss://" };
    }
    if (!parsed.hostname) return { valid: false, error: "Invalid hostname" };
    // Reconstruct to preserve explicit port even if it's the default.
    const port = parsed.port ? `:${parsed.port}` : "";
    const url = `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    return { valid: true, url };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AddHostFormProps {
  /** Called to probe+connect. Should throw on failure. */
  onConnect: (profile: HostProfile) => Promise<void>;
  /** Called on successful connect. */
  onSuccess: (serverId: string) => void;
  /** Optional: show method chooser (manual vs scan). */
  onScanQR?: () => void;
}

export function AddHostForm({ onConnect, onSuccess, onScanQR }: AddHostFormProps) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const validation = validateHostAddress(address);
      if (!validation.valid) {
        setError(validation.error);
        return;
      }

      const profile: DirectHostProfile = {
        id: `direct:${validation.url}`,
        kind: "direct",
        label: new URL(validation.url).host,
        url: validation.url,
        createdAtMs: Date.now(),
      };

      setLoading(true);
      try {
        await onConnect(profile);
        onSuccess(profile.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Connection failed");
      } finally {
        setLoading(false);
      }
    },
    [address, onConnect, onSuccess],
  );

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label}>Host address</label>
        <TextInput
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="localhost:6767 or ws://host:port"
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Password (optional)</label>
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave blank if none"
        />
      </div>

      <div className={styles.error} role="alert">
        {error}
      </div>

      <Button type="submit" loading={loading} disabled={loading}>
        Connect
      </Button>

      {onScanQR && (
        <div className={styles.methodRow}>
          <Button variant="ghost" type="button" onClick={onScanQR}>
            Scan QR instead
          </Button>
        </div>
      )}
    </form>
  );
}
