import { agentStatusEnum, isoTimestampSchema, uuidSchema } from "@av-pi-studio/protocol";
import { z } from "zod";

/**
 * Zod schemas for every persisted daemon entity (architecture/persistence.md § Data shapes,
 * MAIN-SCOPE.md §5). All schemas `.passthrough()` and use optional/default fields so unknown or
 * future fields are tolerated on load with no migration framework.
 */

// ===========================================================================
// Agent record  →  agents/{sanitized-cwd}/{id}.json
// ===========================================================================

export const agentSelectOptionSchema = z
  .object({
    value: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

/** Provider feature toggle/select (discriminated on `type`). */
export const agentFeatureSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("toggle"),
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    tooltip: z.string().optional(),
    icon: z.string().optional(),
    value: z.boolean(),
  }),
  z.object({
    type: z.literal("select"),
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
    tooltip: z.string().optional(),
    icon: z.string().optional(),
    value: z.string().nullable(),
    options: z.array(agentSelectOptionSchema),
  }),
]);
export type AgentFeature = z.infer<typeof agentFeatureSchema>;

export const serializableConfigSchema = z
  .object({
    title: z.string().nullable().optional(),
    model: z.string().optional(),
    /** The picked model's own LLM provider — see `agentSessionConfigSchema`'s field of the same
     * name (`@av-pi-studio/protocol`) for why this must travel with `model`. */
    modelProvider: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    featureValues: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    systemPrompt: z.string().optional(),
  })
  .passthrough();

export const runtimeInfoSchema = z
  .object({
    provider: z.string().optional(),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const persistenceHandleSchema = z
  .object({
    provider: z.string().optional(),
    sessionId: z.string().optional(),
    nativeHandle: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const agentRecordSchema = z
  .object({
    id: uuidSchema,
    provider: z.string(),
    cwd: z.string(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    lastActivityAt: isoTimestampSchema.optional(),
    lastUserMessageAt: isoTimestampSchema.optional(),
    title: z.string().optional(),
    labels: z.record(z.string(), z.string()).default({}),
    lastStatus: agentStatusEnum,
    config: serializableConfigSchema.optional(),
    runtimeInfo: runtimeInfoSchema.optional(),
    features: z.array(agentFeatureSchema).optional(),
    persistence: persistenceHandleSchema.optional(),
    lastError: z.string().nullable().optional(),
    internal: z.boolean().optional(),
    archivedAt: isoTimestampSchema.optional(),
  })
  .passthrough();
export type AgentRecord = z.infer<typeof agentRecordSchema>;

// ===========================================================================
// Project + workspace registries  →  projects/{projects,workspaces}.json
// ===========================================================================

export const projectRecordSchema = z
  .object({
    projectId: z.string(),
    rootPath: z.string(),
    kind: z.enum(["git", "non_git"]),
    displayName: z.string(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    archivedAt: isoTimestampSchema.nullable().default(null),
  })
  .passthrough();
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectRegistrySchema = z.array(projectRecordSchema);
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;

export const workspaceRecordSchema = z
  .object({
    workspaceId: z.string(),
    projectId: z.string(),
    cwd: z.string(),
    kind: z.enum(["local_checkout", "worktree", "directory"]),
    displayName: z.string(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    archivedAt: isoTimestampSchema.nullable().default(null),
  })
  .passthrough();
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

export const workspaceRegistrySchema = z.array(workspaceRecordSchema);
export type WorkspaceRegistry = z.infer<typeof workspaceRegistrySchema>;
