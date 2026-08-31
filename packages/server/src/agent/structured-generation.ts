/**
 * Daemon-side LLM-backed metadata generation (architecture/structured-generation.md § Tasks,
 * § Provider selection, § Behavior). Drives agent-title generation, commit messages, PR text,
 * branch names without creating throwaway `AgentSession`s.
 */

export const MAX_EXPLICIT_AGENT_TITLE_CHARS = 80;

/** Supported metadata generation tasks. */
export type GenerationTask =
  | "agent_title"
  | "commit_message"
  | "pr_title"
  | "pr_body"
  | "branch_name";

/** A candidate provider entry from `agents.metadataGeneration.providers`. */
export interface MetadataGenerationCandidate {
  provider: string;
  model?: string;
  thinkingOptionId?: string;
}

/** Minimal provider RPC interface (no AgentSession created). */
export interface StructuredGenerationProvider {
  readonly provider: string;
  isAvailable(): boolean | Promise<boolean>;
  /** Top-level structured generation call. Returns `null` when output is invalid/unavailable. */
  structuredGenerate(prompt: string, task: GenerationTask): Promise<string | null>;
}

export interface GenerateOpts {
  /** Configured provider fallback order from `agents.metadataGeneration.providers`. */
  configuredCandidates?: MetadataGenerationCandidate[];
  /** Already-resolved providers to try (in order). */
  candidates?: StructuredGenerationProvider[];
  /** Context passed to the prompt builder. */
  context?: Record<string, unknown>;
}

/**
 * Build a simple deterministic fallback for each task type. Used when all providers fail.
 */
export function deterministicFallback(
  task: GenerationTask,
  context?: Record<string, unknown>,
): string {
  const prompt = (context?.prompt as string) ?? (context?.initialPrompt as string) ?? "";
  switch (task) {
    case "agent_title":
      return truncateTitle(prompt || "Untitled agent");
    case "commit_message":
      return truncateTitle(prompt || "Update");
    case "pr_title":
      return truncateTitle(prompt || "Changes");
    case "pr_body":
      return prompt ? `${prompt.slice(0, 200)}\n\n(Generated)` : "(No description)";
    case "branch_name": {
      const slug = (prompt || "update")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-{2,}/g, "-")
        .slice(0, 40)
        .replace(/-$/, "");
      return slug || "update";
    }
  }
}

export function truncateTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_EXPLICIT_AGENT_TITLE_CHARS
    ? `${cleaned.slice(0, MAX_EXPLICIT_AGENT_TITLE_CHARS - 1)}…`
    : cleaned;
}

/**
 * Try each candidate in order, returning the first valid result. Falls back to a
 * deterministic fallback if all providers fail. Never creates a throwaway `AgentSession`.
 */
export async function generate(task: GenerationTask, opts: GenerateOpts = {}): Promise<string> {
  const { candidates = [], context } = opts;

  for (const candidate of candidates) {
    try {
      const available = await candidate.isAvailable();
      if (!available) continue;
      const result = await candidate.structuredGenerate(buildPrompt(task, context), task);
      if (result && result.trim().length > 0) {
        return task === "agent_title" ? truncateTitle(result) : result;
      }
    } catch {
      // Provider failed → fall through to next.
    }
  }
  return deterministicFallback(task, context);
}

function buildPrompt(task: GenerationTask, context?: Record<string, unknown>): string {
  const ctx = context ?? {};
  const prompt = (ctx.prompt as string) ?? (ctx.initialPrompt as string) ?? "";
  const cwd = (ctx.cwd as string) ?? "";
  switch (task) {
    case "agent_title":
      return `Generate a short, descriptive title (≤${MAX_EXPLICIT_AGENT_TITLE_CHARS} chars) for an agent session started with: "${prompt}"`;
    case "commit_message":
      return `Write a concise Git commit message for: "${prompt}"${cwd ? ` in ${cwd}` : ""}`;
    case "pr_title":
      return `Write a short PR title for: "${prompt}"`;
    case "pr_body":
      return `Write a brief PR description for: "${prompt}"`;
    case "branch_name":
      return `Generate a short, slug-safe Git branch name for: "${prompt}"`;
  }
}
