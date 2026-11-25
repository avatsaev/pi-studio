import { describe, expect, it } from "vitest";

import {
  agentCapabilityFlagsSchema,
  providerDefinitionSchema,
  providerIdSchema,
} from "./provider-manifest.js";

const flags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

describe("provider manifest types", () => {
  it("validates AgentCapabilityFlags (all four booleans required)", () => {
    expect(agentCapabilityFlagsSchema.safeParse(flags).success).toBe(true);
    const { supportsStreaming: _omit, ...partial } = flags;
    expect(agentCapabilityFlagsSchema.safeParse(partial).success).toBe(false);
  });

  it("accepts supportsExtensionUi: true, false, and absent", () => {
    expect(
      agentCapabilityFlagsSchema.safeParse({ ...flags, supportsExtensionUi: true }).success,
    ).toBe(true);
    expect(
      agentCapabilityFlagsSchema.safeParse({ ...flags, supportsExtensionUi: false }).success,
    ).toBe(true);
    expect(agentCapabilityFlagsSchema.safeParse(flags).success).toBe(true);
  });

  it("enforces the provider id pattern", () => {
    expect(providerIdSchema.safeParse("pi").success).toBe(true);
    expect(providerIdSchema.safeParse("my-fork-1").success).toBe(true);
    expect(providerIdSchema.safeParse("Pi").success).toBe(false);
    expect(providerIdSchema.safeParse("1pi").success).toBe(false);
  });

  it("validates a full provider definition with capabilities", () => {
    const def = {
      id: "pi",
      label: "Pi",
      description: "The Pi coding agent",
      capabilities: flags,
    };
    expect(providerDefinitionSchema.safeParse(def).success).toBe(true);
  });
});
