import type { ProviderDefinition } from "@av-pi-studio/protocol";

import { MOCK_CAPABILITIES } from "./providers/mock/mock-provider.js";
import { PI_CAPABILITIES } from "./providers/pi/agent.js";

/**
 * Provider manifest (features/agent-providers.md § Registration surface). UI scaffolding only —
 * actual models/modes/features are discovered at runtime. Modes carry an `icon` + `colorTier`.
 */
export const PROVIDER_MANIFEST: Record<string, ProviderDefinition> = {
  pi: {
    id: "pi",
    label: "Pi",
    description: "The Pi coding agent (pi --mode rpc)",
    capabilities: PI_CAPABILITIES,
    modes: [
      { id: "plan", label: "Plan", icon: "Compass", colorTier: "planning" },
      { id: "default", label: "Default", icon: "Bot", colorTier: "moderate" },
      { id: "full-access", label: "Full access", icon: "ShieldAlert", colorTier: "dangerous" },
    ],
  },
  mock: {
    id: "mock",
    label: "Mock",
    description: "In-process test provider (dev/test only)",
    capabilities: MOCK_CAPABILITIES,
    modes: [{ id: "default", label: "Default", icon: "Bot", colorTier: "safe" }],
  },
};
