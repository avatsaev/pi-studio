/**
 * OnboardingPage — /welcome route: branded onboarding + direct-connection form.
 *
 * Composes the real `WelcomeScreen` (sprint-019) with the real `AddHostForm`
 * (toggled inline for the "direct connection" flow). QR/pairing-link flows
 * route to `/pair-scan`, which renders the real `PairScanScreen` with stub
 * relay probe/upsert functions — full relay pairing is sprint-032
 * (relay-e2ee), not yet implemented.
 *
 * clean-room-scope/features/app-navigation-screens.md § Onboarding & pairing
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { WelcomeScreen } from "../components/screens/WelcomeScreen.js";
import { AddHostForm } from "../components/screens/AddHostForm.js";
import { PairScanScreen } from "../components/screens/PairScanScreen.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { connectionToHostSnapshots } from "./shell-adapters.js";
import { getIsElectron } from "../platform/gating.js";
import { routes } from "../runtime/route-grammar.js";
import type { OnboardingPlatform } from "../onboarding/welcome.js";
import type { HostProfile } from "../runtime/host-profile.js";

export function OnboardingPage() {
  const navigate = useNavigate();
  const connection = useConnectionStatus();
  const [showAddHost, setShowAddHost] = useState(false);

  const hosts = connectionToHostSnapshots(connection);
  const platform: OnboardingPlatform = getIsElectron() ? "desktop" : "web";

  async function handleConnect(profile: HostProfile) {
    if (profile.kind !== "direct") {
      throw new Error("Only direct connections are supported in this dev build.");
    }
    connection.setAddress(profile.url);
  }

  if (showAddHost) {
    return (
      <div style={{ padding: 24, maxWidth: 480 }}>
        <AddHostForm
          onConnect={handleConnect}
          onSuccess={() => navigate(routes.root(), { replace: true })}
          onScanQR={() => navigate(routes.pairScan("onboarding"))}
        />
      </div>
    );
  }

  return (
    <WelcomeScreen
      platform={platform}
      hosts={hosts}
      onAddHost={() => setShowAddHost(true)}
      onPasteLink={() => navigate(routes.pairScan("onboarding"))}
    />
  );
}

/**
 * PairScanPage — /pair-scan route. Relay/QR pairing (sprint-032) is not yet
 * implemented; probe/upsert are stubs so the route renders the real
 * "unsupported, use manual entry" fallback UI on web instead of crashing.
 */
export function PairScanPage() {
  const navigate = useNavigate();
  const platform: OnboardingPlatform = getIsElectron() ? "desktop" : "web";

  return (
    <PairScanScreen
      platform={platform}
      probe={async () => {
        throw new Error("Relay pairing is not yet implemented (sprint-032).");
      }}
      upsert={() => {
        /* Relay pairing is not yet implemented (sprint-032). */
      }}
      onManualEntry={() => navigate(routes.welcome())}
    />
  );
}
