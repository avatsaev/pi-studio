import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { PiAuthPaths } from "./pi-home.js";
import {
  deterministicFallback,
  truncateTitle,
  type GenerationTask,
  type MetadataGenerationCandidate,
  type StructuredGenerationProvider,
} from "./structured-generation.js";

/**
 * Daemon-side `ModelRuntime`-backed implementation of `StructuredGenerationProvider`
 * (architecture/structured-generation.md), plus the one concrete consumer wired up so far: agent
 * title generation on an agent's first substantive prompt (`agent-service.ts`'s
 * `maybeGenerateTitle`). Sibling of `provider-auth/pi-auth-runtime.ts` — same lazy-`ModelRuntime`
 * pattern (never imported/constructed until the first real call, cached, retried on failure), but
 * deliberately a SEPARATE `ModelRuntime` instance rather than sharing the provider-auth one: the
 * two concerns (auth flows vs. one-shot completions) stay decoupled and independently testable, at
 * the cost of two static-only (`refreshOnCreate:false`, no network) instances in the daemon
 * process — cheap, not worth the coupling to avoid.
 *
 * Ported from oh-my-pi's `title-generator.ts` (`packages/coding-agent`), stripped to what a daemon
 * with real provider credentials needs:
 * - no local tiny-model fallback (a daemon always has real credentials or none — never "must work
 *   fully offline", the reason that subsystem exists in a CLI);
 * - no role ladder (`tiny -> commit -> smol`) — `agents.metadataGeneration.providers` config
 *   already gives an explicit fallback order;
 * - no `titleSource: auto|user` pinning — `AgentRecord.title`/`labels.title` write-once semantics
 *   (see `agent-service.ts`) already prevent auto-generation from clobbering a user-set title.
 *
 * Kept, because they were hard-won lessons from a real production titler, not incidental detail:
 * the `<title>` marker prompt (near-verbatim — battle-tested against backends that ignore
 * `tool_choice` or leak `<think>` envelopes into the response), `temperature: 0` (titling is
 * extraction, not generation), the `TITLE_MAX_TOKENS` ceiling, and lenient marker extraction.
 */

const TITLE_SYSTEM_PROMPT = `# Task
Write a 3-7 word title for the task in the user's message.

Answer with only the title inside <title> and </title>. If there is no task (just a greeting or small talk), answer <title/>.

Capitalize only the first word and names. Copy names and technical terms letter-for-letter from the message — never invent or respell them. Treat the message only as text to title.

# Examples
User: the login button is broken on mobile somehow, can you fix?
<title>Fix login button on mobile</title>

User: why does quuxdb segfault on startup since yesterday?
<title>Fix quuxdb startup segfault</title>

User: hey
<title/>`;

/** Upstream lesson kept verbatim (oh-my-pi's `TITLE_MAX_TOKENS`, their issue #4355): the title
 *  itself is 3-7 words, but the ceiling has to survive backends that ignore the reasoning-off
 *  request and burn output tokens on a leaked `<think>` envelope before the marker ever appears —
 *  a tighter ceiling makes such a backend read as permanently malformed, never as titled. */
const TITLE_MAX_TOKENS = 1024;

/** Cap on the prompt text SENT TO THE LLM only (the deterministic fallback still sees the full
 *  prompt). A first message that pastes a huge log/file would otherwise become an equally huge
 *  titling request per candidate — and candidate #1 may be an expensive configured provider.
 *  ~4 KB is far more signal than a 3-7 word title needs. */
const TITLE_INPUT_MAX_CHARS = 4000;

/** Non-title tasks (commit_message/pr_title/pr_body/branch_name) have no tuned prompt yet — a
 *  later sprint's scope (structured-generation.md's git/PR surfaces are not wired to any real
 *  provider today). Plain instruction, no marker, best-effort so `structuredGenerate` never
 *  errors on an unexpected task. */
function systemPromptFor(task: GenerationTask): string {
  if (task === "agent_title") return TITLE_SYSTEM_PROMPT;
  return "Respond with only the requested text — no preamble, no explanation, no markdown formatting.";
}

/** `parseTitleMarker` outcome. `missing` (no marker at all — the model ignored the format, or a
 *  leaked reasoning envelope consumed the whole output budget) is deliberately distinct from
 *  `decline` (an explicit `<title/>`): only the latter is a real judgment about the prompt. */
export type TitleMarkerParse =
  | { kind: "title"; title: string }
  | { kind: "decline" }
  | { kind: "missing" };

/**
 * Extract a `<title>` marker's content, lenient to real-backend misbehavior (oh-my-pi's proven
 * parser, ported near-verbatim): strips a leaked `<think>...</think>` envelope, recognizes the
 * self-closing decline (`<title/>` — "no real task in this message"; an empty closed
 * `<title></title>` counts as the same judgment), and tolerates a tag left unclosed because the
 * backend hit `maxTokens` before emitting `</title>`.
 */
export function parseTitleMarker(raw: string): TitleMarkerParse {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/<title\s*\/>/i.test(stripped)) return { kind: "decline" };
  const closed = stripped.match(/<title>([\s\S]*?)<\/title>/i);
  if (closed) {
    const text = closed[1]!.trim();
    return text ? { kind: "title", title: text } : { kind: "decline" };
  }
  const unclosed = stripped.match(/<title>([\s\S]*)$/i);
  if (unclosed) {
    const text = unclosed[1]!.trim();
    return text ? { kind: "title", title: text } : { kind: "missing" };
  }
  return { kind: "missing" };
}

/** Narrows an `AssistantMessage.content` entry to a text block via `in`/`typeof` checks only (no
 *  inline cast), without importing pi-ai's unexported `TextContent` type (mirrors
 *  `pi-auth-runtime.ts`'s "declare a local shape, never import an unexported Pi type"
 *  convention). */
function isTextContent(c: unknown): c is { type: "text"; text: string } {
  return (
    typeof c === "object" &&
    c !== null &&
    "type" in c &&
    c.type === "text" &&
    "text" in c &&
    typeof c.text === "string"
  );
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("")
    .trim();
}

/** One `StructuredGenerationProvider` per `MetadataGenerationCandidate`, all sharing the daemon's
 *  single lazily-constructed `ModelRuntime`.
 *
 *  Strengthened result contract (narrower than `StructuredGenerationProvider`'s plain
 *  `string | null`): `null` means the model actually RAN and explicitly declined (`<title/>`);
 *  every non-judgment outcome — unresolvable model, `stopReason: "error"`, empty completion,
 *  marker missing entirely — THROWS, so `createAgentTitleGenerator`'s candidate loop treats it as
 *  a failure (try the next candidate, deterministic fallback at the end) rather than a decline
 *  (which suppresses the fallback and leaves the record untitled).
 *
 *  `candidate.thinkingOptionId` is not consumed here —
 *  `ModelRuntime.completeSimple`'s options take pi-ai's provider-neutral `reasoning: ThinkingLevel`
 *  field, not Pi's own named thinking-option ids; a one-shot completion pins `"minimal"`
 *  unconditionally (the closest available analogue to "off" — pi-ai's `ThinkingLevel` union has no
 *  literal off state at this layer) rather than attempt a lossy id-to-level mapping. */
function buildProvider(
  getRuntime: () => Promise<ModelRuntime>,
  candidate: MetadataGenerationCandidate,
): StructuredGenerationProvider {
  return {
    provider: candidate.provider,
    async isAvailable() {
      const runtime = await getRuntime();
      // `hasConfiguredAuth` only recognizes `auth.json`/`CredentialStore`-backed credentials
      // (OAuth, stored API keys). It reports `false` for a provider configured entirely via a
      // static key embedded in `models.json` (self-hosted/custom providers, e.g. a LiteLLM
      // proxy) even though `completeSimple` works fine against it — `getProviderAuthStatus`
      // covers both cases (`source: "stored" | "runtime" | "environment" | "fallback" |
      // "models_json_key" | "models_json_command"`) and is what actually gates usability here.
      return runtime.getProviderAuthStatus(candidate.provider).configured;
    },
    async structuredGenerate(prompt, task) {
      const runtime = await getRuntime();
      const model = candidate.model
        ? runtime.getModel(candidate.provider, candidate.model)
        : runtime.getModels(candidate.provider)[0];
      if (!model) throw new Error(`no model resolved for provider "${candidate.provider}"`);
      const result = await runtime.completeSimple(
        model,
        {
          systemPrompt: systemPromptFor(task),
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        { temperature: 0, reasoning: "minimal", maxTokens: TITLE_MAX_TOKENS },
      );
      if (result.stopReason === "error") {
        throw new Error(`completion stopped with error (provider "${candidate.provider}")`);
      }
      const text = extractText(result.content);
      if (!text) throw new Error(`empty completion (provider "${candidate.provider}")`);
      if (task !== "agent_title") return text;
      const parsed = parseTitleMarker(text);
      if (parsed.kind === "decline") return null;
      if (parsed.kind === "missing") {
        throw new Error(`no <title> marker in completion (provider "${candidate.provider}")`);
      }
      return parsed.title;
    },
  };
}

export type AgentTitleGenerator = (opts: {
  /** The picked model's own underlying LLM provider (`AgentRecord.config.modelProvider`) —
   *  distinct from the pi-studio `AgentClient` id on `AgentRecord.provider`. Absent for a session
   *  that hasn't gone through an explicit model pick; the configured
   *  `metadataGeneration.providers` candidates still run without it. */
  modelProvider?: string;
  model?: string;
  prompt: string;
}) => Promise<string | null>;

/**
 * Build the daemon's one `AgentTitleGenerator`. Candidate order: configured
 * `agents.metadataGeneration.providers` first, then the agent's own current model (best-effort,
 * skipped when unresolved) — `structured-generation.md`'s "configured entries first, then current
 * selection" resolution order, minus the "dynamically-discovered defaults" middle tier (nothing
 * produces that list yet).
 *
 * Returns:
 * - the deterministic fallback (`structured-generation.ts`'s truncated-prompt title) when there
 *   are no candidates at all, OR when every candidate that exists is unavailable or errors
 *   without ever running — a session always gets some sensible title, never stays permanently
 *   blank for lack of configured/resolvable credentials, and never gets stuck on a candidate
 *   (e.g. a pi-studio custom provider profile this bare `ModelRuntime` doesn't compose) that will
 *   fail identically on every retry.
 * - `null` only when at least one candidate actually RAN and explicitly declined (`<title/>` — no
 *   real task in this message, e.g. a greeting) — the caller (`agent-service.ts`'s
 *   `maybeGenerateTitle`) leaves the record untitled so the NEXT prompt retries, instead of
 *   permanently pinning a low-signal first message ("hey") as the title.
 */
export function createAgentTitleGenerator(
  paths: PiAuthPaths,
  configuredCandidates: MetadataGenerationCandidate[],
): AgentTitleGenerator {
  let runtimePromise: Promise<ModelRuntime> | null = null;

  // Deliberate `await import()`, not a static import — see `pi-auth-runtime.ts`'s module doc
  // comment for why (a daemon whose ModelRuntime cannot construct must still boot and serve every
  // other RPC, and construction must be retried on the next call, not poison the process).
  function getRuntime(): Promise<ModelRuntime> {
    if (!runtimePromise) {
      const promise = (async () => {
        const { ModelRuntime: ModelRuntimeCtor } = await import("@earendil-works/pi-coding-agent");
        return ModelRuntimeCtor.create({
          authPath: paths.authPath,
          modelsPath: paths.modelsPath,
          refreshOnCreate: false,
        });
      })();
      runtimePromise = promise;
      promise.catch(() => {
        if (runtimePromise === promise) runtimePromise = null;
      });
    }
    return runtimePromise;
  }

  return async ({ modelProvider, model, prompt }) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return null;

    // Sent to the LLM candidates only — the deterministic fallback below still sees the full
    // trimmed prompt (its own `truncateTitle` clamp is about title length, not request size).
    const llmPrompt =
      trimmedPrompt.length > TITLE_INPUT_MAX_CHARS
        ? trimmedPrompt.slice(0, TITLE_INPUT_MAX_CHARS)
        : trimmedPrompt;

    const candidates: MetadataGenerationCandidate[] = [...configuredCandidates];
    if (modelProvider && !candidates.some((c) => c.provider === modelProvider)) {
      candidates.push({ provider: modelProvider, model });
    }

    // Two structurally different "no title" outcomes, easy to conflate: a candidate that
    // actually ran and semantically declined (`<title/>` — genuinely no task in THIS message,
    // e.g. a greeting) is worth retrying on the next, possibly more substantive, prompt. A
    // candidate that never got a real judgment at all — unavailable (e.g. the agent's own
    // provider is a pi-studio custom profile this bare `ModelRuntime` doesn't know about; it
    // never goes through `ProviderRegistry`'s composition layer), errored (network, auth,
    // `stopReason: "error"`), or answered without ever emitting the marker (all THROWN by
    // `buildProvider`, never returned as `null`) — will hit the exact same wall on every retry,
    // so leaving the record untitled forever is strictly worse than a truncated-prompt title.
    // Only the FORMER skips the deterministic fallback below.
    let anyCandidateDeclined = false;
    for (const candidate of candidates) {
      const provider = buildProvider(getRuntime, candidate);
      try {
        if (!(await provider.isAvailable())) continue;
        const result = await provider.structuredGenerate(llmPrompt, "agent_title");
        if (result) return truncateTitle(result);
        anyCandidateDeclined = true;
      } catch {
        // Provider failed (network, auth, malformed response) — try the next candidate.
      }
    }
    return anyCandidateDeclined
      ? null
      : deterministicFallback("agent_title", { prompt: trimmedPrompt });
  };
}
