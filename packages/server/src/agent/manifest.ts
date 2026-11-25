import type { ProviderDefinition } from "@av-pi-studio/protocol";

import { MOCK_CAPABILITIES } from "./providers/mock/mock-provider.js";
import { PI_CAPABILITIES } from "./providers/pi/agent.js";

/**
 * Provider manifest (features/agent-providers.md § Registration surface). UI scaffolding only —
 * actual models/features are discovered at runtime.
 */
export const PROVIDER_MANIFEST: Record<string, ProviderDefinition> = {
  pi: {
    id: "pi",
    label: "Pi",
    description: "The Pi coding agent (pi --mode rpc)",
    capabilities: PI_CAPABILITIES,
  },
  mock: {
    id: "mock",
    label: "Mock",
    description: "In-process test provider (dev/test only)",
    capabilities: MOCK_CAPABILITIES,
  },
};
