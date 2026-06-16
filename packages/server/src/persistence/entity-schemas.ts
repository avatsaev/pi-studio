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
    modeId: z.string().optional(),
    model: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    featureValues: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    systemPrompt: z.string().optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const runtimeInfoSchema = z
  .object({
    provider: z.string().optional(),
    sessionId: z.string().optional(),
    model: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    modeId: z.string().optional(),
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
    lastModeId: z.string().optional(),
    config: serializableConfigSchema.optional(),
    runtimeInfo: runtimeInfoSchema.optional(),
    features: z.array(agentFeatureSchema).optional(),
    persistence: persistenceHandleSchema.optional(),
    lastError: z.string().nullable().optional(),
    internal: z.boolean().optional(),
    archivedAt: isoTimestampSchema.optional(),
    // One file per agent holds the record AND its timeline rows (row shapes land in sprint-006).
    timeline: z.array(z.unknown()).default([]),
  })
  .passthrough();
export type AgentRecord = z.infer<typeof agentRecordSchema>;

// ===========================================================================
// Schedule  →  schedules/{id}.json   (id = 8 hex)
// ===========================================================================

export const scheduleIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}$/, "schedule id must be 8 hex chars");

export const cadenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("every"), everyMs: z.number() }),
  z.object({ type: z.literal("cron"), expression: z.string(), timezone: z.string().optional() }),
]);

export const newAgentConfigSchema = z
  .object({
    provider: z.string(),
    cwd: z.string(),
    modeId: z.string().optional(),
    model: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    title: z.string().optional(),
    approvalPolicy: z.string().optional(),
    sandboxMode: z.string().optional(),
    networkAccess: z.boolean().optional(),
    webSearch: z.boolean().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    systemPrompt: z.string().optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const scheduleTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent"), agentId: z.string() }),
  z.object({ type: z.literal("new-agent"), config: newAgentConfigSchema }),
]);

export const scheduleRunSchema = z
  .object({
    id: z.string(),
    scheduledFor: isoTimestampSchema,
    startedAt: isoTimestampSchema,
    endedAt: isoTimestampSchema.optional(),
    status: z.enum(["running", "succeeded", "failed"]),
    agentId: z.string().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const scheduleSchema = z
  .object({
    id: scheduleIdSchema,
    name: z.string().optional(),
    prompt: z.string(),
    cadence: cadenceSchema,
    target: scheduleTargetSchema,
    status: z.enum(["active", "paused", "completed"]),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    nextRunAt: isoTimestampSchema.optional(),
    lastRunAt: isoTimestampSchema.optional(),
    pausedAt: isoTimestampSchema.optional(),
    expiresAt: isoTimestampSchema.optional(),
    maxRuns: z.number().optional(),
    runs: z.array(scheduleRunSchema).default([]),
  })
  .passthrough();
export type Schedule = z.infer<typeof scheduleSchema>;

// ===========================================================================
// Loop  →  loops/loops.json   (array, non-atomic queued)
// ===========================================================================

export const loopStatusEnum = z.enum(["running", "succeeded", "failed", "stopped"]);
export type LoopStatus = z.infer<typeof loopStatusEnum>;

export const loopRecordSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    prompt: z.string(),
    cwd: z.string(),
    provider: z.string(),
    model: z.string().optional(),
    modeId: z.string().optional(),
    // worker/verifier overrides (features/loops.md § Data shape).
    workerProvider: z.string().optional(),
    workerModel: z.string().optional(),
    verifierProvider: z.string().optional(),
    verifierModel: z.string().optional(),
    verifierModeId: z.string().optional(),
    verifyPrompt: z.string().optional(),
    verifyChecks: z.array(z.string()).default([]),
    archive: z.boolean().optional(),
    sleepMs: z.number().optional(),
    maxIterations: z.number().optional(),
    maxTimeMs: z.number().optional(),
    status: loopStatusEnum,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema.optional(),
    startedAt: isoTimestampSchema.optional(),
    completedAt: isoTimestampSchema.optional(),
    stopRequestedAt: isoTimestampSchema.optional(),
    iterations: z.array(z.unknown()).default([]),
    logs: z.array(z.unknown()).default([]),
    nextLogSeq: z.number().default(0),
    activeIteration: z.unknown().optional(),
    activeWorkerAgentId: z.string().optional(),
    activeVerifierAgentId: z.string().optional(),
  })
  .passthrough();
export type LoopRecord = z.infer<typeof loopRecordSchema>;

export const loopStoreSchema = z.array(loopRecordSchema);
export type LoopStore = z.infer<typeof loopStoreSchema>;

// ===========================================================================
// Chat  →  chat/rooms.json
// ===========================================================================

export const chatRoomSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    purpose: z.string().optional(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .passthrough();

export const chatMessageSchema = z
  .object({
    id: uuidSchema,
    roomId: z.string(),
    authorAgentId: z.string(),
    body: z.string(),
    replyToMessageId: z.string().optional(),
    mentionAgentIds: z.array(z.string()).default([]),
    createdAt: isoTimestampSchema,
  })
  .passthrough();

export type ChatRoom = z.infer<typeof chatRoomSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatStoreSchema = z.object({
  rooms: z.array(chatRoomSchema).default([]),
  messages: z.array(chatMessageSchema).default([]),
});
export type ChatStore = z.infer<typeof chatStoreSchema>;

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
