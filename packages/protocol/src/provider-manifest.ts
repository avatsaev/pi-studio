import { z } from "zod";

/**
 * Provider manifest types (features/agent-providers.md § Registration surface, § Capability flags).
 *
 * The manifest is UI scaffolding only — actual models/modes/features are discovered at runtime via
 * the provider RPC. These types express provider definitions, mode metadata (icon + colorTier), and
 * the `AgentCapabilityFlags` shape.
 */

/** Provider ids must match `/^[a-z][a-z0-9-]*$/` (agent-providers.md). */
export const providerIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, "invalid provider id");

/** Mode danger/intent tier driving UI color. */
export const colorTierSchema = z.enum(["safe", "moderate", "dangerous", "planning"]);
export type ColorTier = z.infer<typeof colorTierSchema>;

/** Per-provider capability flags. */
export const agentCapabilityFlagsSchema = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
  // Rewind capability flags (features/rewind.md) — additive, optional, old clients ignore.
  supportsRewindConversation: z.boolean().optional(),
  supportsRewindFiles: z.boolean().optional(),
  supportsRewindBoth: z.boolean().optional(),
  // Steering capability (features/agent-sessions.md § Steering) — additive, optional. When true,
  // the provider accepts `steer`/`follow_up` messages injected into a live turn.
  supportsSteering: z.boolean().optional(),
}).passthrough();
export type AgentCapabilityFlags = z.infer<typeof agentCapabilityFlagsSchema>;

/** UI metadata for a provider mode (plan/default/full-access/...). */
export const providerModeSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorTier: colorTierSchema,
});
export type ProviderMode = z.infer<typeof providerModeSchema>;

/** A provider manifest definition. `extends` marks a custom Pi-compatible profile. */
export const providerDefinitionSchema = z.object({
  id: providerIdSchema,
  label: z.string(),
  description: z.string().optional(),
  extends: z.string().optional(),
  modes: z.array(providerModeSchema),
  capabilities: agentCapabilityFlagsSchema,
});
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;
