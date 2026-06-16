import { createHash } from "node:crypto";

/**
 * Generated service hostnames (features/service-proxy.md § Generated hostname). One combined
 * leftmost label `script--branch--project` keeps it single-level-wildcard friendly. The branch
 * segment is omitted for main/master. Over-63-char labels are truncated with a deterministic hash
 * suffix.
 */

const MAX_LABEL = 63;
const MAIN_BRANCHES = new Set(["main", "master"]);

/** Slug a hostname segment: lowercase, `[a-z0-9-]`, collapse + trim separators. */
export function slugSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  );
}

/** Build the combined leftmost label `script--branch--project` (branch omitted for main/master). */
export function serviceLabel(args: {
  script: string;
  branch?: string | null;
  project: string;
}): string {
  const script = slugSegment(args.script);
  const project = slugSegment(args.project);
  const branch = args.branch ? slugSegment(args.branch) : "";
  const omitBranch = !branch || MAIN_BRANCHES.has(branch);
  const label = omitBranch ? `${script}--${project}` : `${script}--${branch}--${project}`;
  return clampLabel(label);
}

/** Truncate an over-63-char label and append a deterministic 7-char hash suffix. */
function clampLabel(label: string): string {
  if (label.length <= MAX_LABEL) return label;
  const hash = createHash("sha256").update(label).digest("hex").slice(0, 7);
  const head = label.slice(0, MAX_LABEL - 8).replace(/-+$/, "");
  return `${head}-${hash}`;
}

/** Full localhost hostname for a service. */
export function serviceHostname(args: {
  script: string;
  branch?: string | null;
  project: string;
}): string {
  return `${serviceLabel(args)}.localhost`;
}

/** Public hostname alias built from a `publicBaseUrl` (the combined label becomes the subdomain). */
export function publicServiceHostname(
  args: { script: string; branch?: string | null; project: string },
  publicBaseUrl: string,
): string {
  const base = publicBaseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${serviceLabel(args)}.${base}`;
}
