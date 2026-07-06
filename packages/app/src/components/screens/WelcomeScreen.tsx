/**
 * WelcomeScreen — /welcome route.
 * Branded onboarding with platform-appropriate connect actions.
 * app-navigation-screens.md § Onboarding & pairing
 */

import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import styles from "./WelcomeScreen.module.css";
import { Button } from "../primitives/index.js";
import {
  welcomeActions,
  welcomeAutoRedirect,
  type WelcomeActionId,
  type OnboardingPlatform,
} from "../../onboarding/welcome.js";
import { routes } from "../../runtime/route-grammar.js";
import type { HostRuntimeSnapshot } from "../../runtime/host-runtime.js";

export interface WelcomeScreenProps {
  platform: OnboardingPlatform;
  hosts: readonly HostRuntimeSnapshot[];
  /** Called when "Direct connection" is chosen — opens the add-host form. */
  onAddHost: () => void;
  /** Called when "Paste pairing link" is chosen. */
  onPasteLink: () => void;
  /** Called on desktop when "Use this computer" is chosen. */
  onUseThisComputer?: () => void;
  /** App version for footer. */
  version?: string;
}

export function WelcomeScreen({
  platform,
  hosts,
  onAddHost,
  onPasteLink,
  onUseThisComputer,
  version,
}: WelcomeScreenProps) {
  const navigate = useNavigate();

  // Auto-redirect if a host is already online.
  useEffect(() => {
    const target = welcomeAutoRedirect(hosts);
    if (target) navigate(target, { replace: true });
  }, [hosts, navigate]);

  const actions = welcomeActions(platform);

  const handleAction = useCallback(
    (id: WelcomeActionId) => {
      switch (id) {
        case "direct-connection":
          onAddHost();
          break;
        case "paste-pairing-link":
          onPasteLink();
          break;
        case "scan-qr":
          navigate(routes.pairScan("onboarding"));
          break;
        case "use-this-computer":
          onUseThisComputer?.();
          break;
      }
    },
    [navigate, onAddHost, onPasteLink, onUseThisComputer],
  );

  return (
    <div className={styles.container}>
      <div className={styles.logo} aria-hidden>
        {/* Brand logo placeholder — injected from brand/theme */}
        <svg viewBox="0 0 64 64" width="64" height="64">
          <circle cx="32" cy="32" r="28" fill="var(--pi-color-accent, #20744a)" opacity="0.15" />
          <circle cx="32" cy="32" r="12" fill="var(--pi-color-accent, #20744a)" />
        </svg>
      </div>

      <h1 className={styles.title}>Pi Studio</h1>
      <p className={styles.subtitle}>
        A local-first AI coding agent you control. Connect a host to get started.
      </p>

      <div className={styles.actions}>
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={action.primary ? "default" : "ghost"}
            onClick={() => handleAction(action.id)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <div className={styles.footer}>
        <a href="/settings" className={styles.footerLink}>Settings</a>
        {version && <span>v{version}</span>}
      </div>
    </div>
  );
}
