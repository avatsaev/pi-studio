import { z } from "zod";

/**
 * `daemon-updates/latest.json`, what a binary daemon (and `pi-studio update` on a binary) reads
 * (swe/features/single-binary-daemon.md § 1, swe/features/self-update.md § Check). A fixed address
 * on GitHub, never the API (no rate limit).
 */

/** The release page: where a binary that cannot update itself is downloaded by hand. */
export const RELEASES_PAGE = "https://github.com/avatsaev/pi-studio/releases";

/** The production manifest. `PI_STUDIO_DAEMON_UPDATE_URL` replaces it. */
export const DAEMON_UPDATE_URL =
  "https://github.com/avatsaev/pi-studio/releases/download/daemon-updates/latest.json";

/**
 * Replaces the manifest address. For tests and self-hosted mirrors only; the release pipeline never
 * sets it.
 */
export const DAEMON_UPDATE_URL_ENV = "PI_STUDIO_DAEMON_UPDATE_URL";

/** How long the manifest request may take. */
export const MANIFEST_TIMEOUT_MS = 15_000;

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

const manifestSchema = z.object({
  version: z.string().regex(PLAIN_VERSION),
  assets: z.record(z.unknown()),
});

const assetSchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  size: z.number().int().nonnegative(),
});

/** One downloadable archive of a version. */
export interface BinaryAsset {
  url: string;
  /** Lower-case hex SHA-256 of the archive. */
  sha256: string;
  size: number;
}

/** The slice of `latest.json` the daemon uses; the asset entries are read per target. */
export interface BinaryManifest {
  version: string;
  assets: Readonly<Record<string, unknown>>;
}

/** What reading the manifest found. */
export type ManifestFetch =
  | { kind: "ok"; manifest: BinaryManifest }
  | { kind: "offline" }
  | { kind: "bad_answer" };

/** The manifest's address: the override when set and non-empty, else the release's. */
export function daemonUpdateUrl(env: NodeJS.ProcessEnv): string {
  const override = env[DAEMON_UPDATE_URL_ENV];
  return override !== undefined && override.trim() !== "" ? override.trim() : DAEMON_UPDATE_URL;
}

/** The release target of a platform and architecture, `null` when no binary is built for it. */
export function binaryTarget(platform: NodeJS.Platform, arch: string): string | null {
  const cpu = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
  if (cpu === null) return null;
  if (platform === "linux") return `linux-${cpu}`;
  if (platform === "darwin") return `darwin-${cpu}`;
  return null;
}

/** Parses the manifest text; `null` when it is not JSON or has no plain `x.y.z` version. */
export function parseBinaryManifest(text: string): BinaryManifest | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = manifestSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** The archive of `target`, `null` when the manifest has none or its entry is malformed. */
export function assetFor(manifest: BinaryManifest, target: string): BinaryAsset | null {
  if (!Object.hasOwn(manifest.assets, target)) return null;
  const parsed = assetSchema.safeParse(manifest.assets[target]);
  if (!parsed.success) return null;
  const { url, sha256, size } = parsed.data;
  if (!/^https?:$/.test(new URL(url).protocol)) return null;
  return { url, sha256: sha256.toLowerCase(), size };
}

/**
 * GET the manifest. A request that fails, times out or answers a non-2xx status is `offline`; a body
 * that is not a manifest is `bad_answer`.
 */
export async function fetchBinaryManifest(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = MANIFEST_TIMEOUT_MS,
): Promise<ManifestFetch> {
  let text: string;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { kind: "offline" };
    text = await res.text();
  } catch {
    return { kind: "offline" };
  }
  const manifest = parseBinaryManifest(text);
  return manifest ? { kind: "ok", manifest } : { kind: "bad_answer" };
}
