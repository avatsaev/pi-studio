// Onboarding + device pairing helpers.
// app-navigation-screens.md § Onboarding & pairing, relay-e2ee.md § Pairing

import { z } from "zod";
import type { HostProfile } from "../runtime/host-profile.js";
import { routes } from "../runtime/route-grammar.js";

export type PairingSource = "settings" | "onboarding";

export const PairingOfferSchema = z.object({
  v: z.number().int().positive().default(1),
  kind: z.literal("relay-offer").default("relay-offer"),
  label: z.string().min(1).optional(),
  relayUrl: z.string().min(1),
  sessionId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  serverId: z.string().min(1).optional(),
});

export type PairingOffer = z.infer<typeof PairingOfferSchema>;

export type PairingDecodeResult =
  | { ok: true; offer: PairingOffer }
  | { ok: false; error: string };

/** Extract the `#offer=` URL-fragment value from a deep link or QR payload. */
export function extractOfferFragment(urlOrFragment: string): string | null {
  const raw = urlOrFragment.trim();
  if (raw.startsWith("offer=")) return raw.slice("offer=".length);
  if (raw.startsWith("#offer=")) return raw.slice("#offer=".length);
  const hashIndex = raw.indexOf("#");
  if (hashIndex === -1) return null;
  const fragment = raw.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);
  return params.get("offer");
}

/**
 * Decode and validate the encrypted connection offer carried in `#offer=`.
 * Exact upstream encoding remains TODO(verify), so this accepts either:
 * - URL-encoded JSON, or
 * - base64url-encoded UTF-8 JSON.
 */
export function decodePairingOffer(urlOrFragment: string): PairingDecodeResult {
  const fragment = extractOfferFragment(urlOrFragment);
  if (!fragment) return { ok: false, error: "Missing #offer fragment" };

  const candidates = [decodeURIComponent(fragment), base64UrlDecodeUtf8Safe(fragment)].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = PairingOfferSchema.safeParse(parsed);
      if (result.success) return { ok: true, offer: result.data };
      return { ok: false, error: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") };
    } catch {
      // try next candidate
    }
  }

  return { ok: false, error: "Invalid offer encoding" };
}

export type PairingProbe = (offer: PairingOffer) => Promise<{ serverId: string; label?: string }>;
export type PairingUpsert = (profile: HostProfile) => Promise<void> | void;

export type ImportPairingResult =
  | { ok: true; serverId: string; route: string; profile: HostProfile }
  | { ok: false; error: string };

export async function importPairingOffer(input: {
  urlOrFragment: string;
  source: PairingSource;
  probe: PairingProbe;
  upsert: PairingUpsert;
  nowMs?: number;
}): Promise<ImportPairingResult> {
  const decoded = decodePairingOffer(input.urlOrFragment);
  if (!decoded.ok) return decoded;

  try {
    const probe = await input.probe(decoded.offer);
    const serverId = probe.serverId || decoded.offer.serverId;
    if (!serverId) return { ok: false, error: "Probe did not return a serverId" };

    const profile: HostProfile = {
      id: `relay:${serverId}`,
      kind: "relay",
      label: probe.label ?? decoded.offer.label ?? serverId,
      relayUrl: decoded.offer.relayUrl,
      offerId: decoded.offer.sessionId,
      serverId,
      createdAtMs: input.nowMs ?? Date.now(),
    };
    await input.upsert(profile);

    const route = input.source === "settings" ? routes.hostSettingsSection(serverId, "connections") : routes.hostRoot(serverId);
    return { ok: true, serverId, route, profile };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function pairScanAvailability(platform: "web" | "native" | "desktop"): "camera" | "unsupported" {
  return platform === "native" ? "camera" : "unsupported";
}

function base64UrlDecodeUtf8Safe(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes: number[] = [];
    for (let i = 0; i < padded.length; i += 4) {
      const c1 = table.indexOf(padded[i] ?? "");
      const c2 = table.indexOf(padded[i + 1] ?? "");
      const c3 = padded[i + 2] === "=" ? -1 : table.indexOf(padded[i + 2] ?? "");
      const c4 = padded[i + 3] === "=" ? -1 : table.indexOf(padded[i + 3] ?? "");
      if (c1 < 0 || c2 < 0 || (padded[i + 2] !== "=" && c3 < 0) || (padded[i + 3] !== "=" && c4 < 0)) return null;
      const triple = (c1 << 18) | (c2 << 12) | ((c3 < 0 ? 0 : c3) << 6) | (c4 < 0 ? 0 : c4);
      bytes.push((triple >> 16) & 255);
      if (c3 >= 0) bytes.push((triple >> 8) & 255);
      if (c4 >= 0) bytes.push(triple & 255);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
