/**
 * ProvidersDetail — the App → Providers detail pane. Placeholder card: registering LLM
 * providers (API keys, models) needs daemon-side endpoints that do not exist yet — the
 * daemon reads `config.json` once at boot and never writes it, and Pi authenticates on
 * the daemon host itself. Lands with the daemon config-API ticket.
 */

import { Surface } from "@pi-studio-ui/components/primitives/Surface.js";
import { SettingsRow, SettingsSection } from "./settings-ui.js";

export function ProvidersDetail() {
  return (
    <SettingsSection label="Providers" flush>
      <Surface>
        <SettingsRow
          title="Provider registration"
          hint="Registering LLM providers (API keys, models) requires daemon config endpoints that don't exist yet — the daemon reads its config once at boot and offers no config or credential API, and Pi authenticates on the daemon host itself. This section lands with the daemon config-API ticket."
        />
      </Surface>
    </SettingsSection>
  );
}
