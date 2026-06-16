import { describe, expect, it } from "vitest";

import {
  agentCapabilityFlagsSchema,
  colorTierSchema,
  providerDefinitionSchema,
  providerIdSchema,
  providerModeSchema,
} from "./provider-manifest.js";

const flags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
};

describe("provider manifest types", () => {
  it("accepts the four colorTier values and rejects others", () => {
    for (const tier of ["safe", "moderate", "dangerous", "planning"]) {
      expect(colorTierSchema.safeParse(tier).success).toBe(true);
    }
    expect(colorTierSchema.safeParse("nuclear").success).toBe(false);
  });

  it("expresses a mode with id + colorTier", () => {
    expect(
      providerModeSchema.safeParse({ id: "plan", icon: "Compass", colorTier: "planning" }).success,
    ).toBe(true);
    expect(providerModeSchema.safeParse({ id: "plan", colorTier: "??" }).success).toBe(false);
  });

  it("validates AgentCapabilityFlags (all six booleans required)", () => {
    expect(agentCapabilityFlagsSchema.safeParse(flags).success).toBe(true);
    const { supportsStreaming: _omit, ...partial } = flags;
    expect(agentCapabilityFlagsSchema.safeParse(partial).success).toBe(false);
  });

  it("enforces the provider id pattern", () => {
    expect(providerIdSchema.safeParse("pi").success).toBe(true);
    expect(providerIdSchema.safeParse("my-fork-1").success).toBe(true);
    expect(providerIdSchema.safeParse("Pi").success).toBe(false);
    expect(providerIdSchema.safeParse("1pi").success).toBe(false);
  });

  it("validates a full provider definition with modes + capabilities", () => {
    const def = {
      id: "pi",
      label: "Pi",
      description: "The Pi coding agent",
      modes: [
        { id: "default", colorTier: "moderate" },
        { id: "full-access", colorTier: "dangerous" },
        { id: "plan", colorTier: "planning" },
      ],
      capabilities: flags,
    };
    expect(providerDefinitionSchema.safeParse(def).success).toBe(true);

    // A custom Pi-compatible profile may declare `extends`.
    expect(
      providerDefinitionSchema.safeParse({ ...def, id: "my-fork", extends: "pi" }).success,
    ).toBe(true);
  });
});
