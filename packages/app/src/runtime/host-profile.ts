// Host profiles saved client-side by the app.
// client-app-runtime.md § App runtime concepts, app-navigation-screens.md § Routing ↔ runtime wiring

export type HostProfileKind = "direct" | "relay" | "ssh-gateway" | "local-embedded";

export type BaseHostProfile = {
  id: string;
  label: string;
  kind: HostProfileKind;
  /** Optional stable daemon server id after successful hello/status. */
  serverId?: string;
  /** Creation order is used to choose earliest-online host. */
  createdAtMs: number;
};

export type DirectHostProfile = BaseHostProfile & {
  kind: "direct";
  url: string;
};

export type RelayHostProfile = BaseHostProfile & {
  kind: "relay";
  relayUrl: string;
  offerId?: string;
};

export type SshGatewayHostProfile = BaseHostProfile & {
  kind: "ssh-gateway";
  sshHost: string;
  sshPort: number;
  username: string;
  remoteDaemonHost: string;
  remoteDaemonPort: number;
  passwordSecretRef?: string;
  privateKeySecretRef?: string;
  passphraseSecretRef?: string;
};

export type LocalEmbeddedHostProfile = BaseHostProfile & {
  kind: "local-embedded";
  localUrl: string;
};

export type HostProfile =
  | DirectHostProfile
  | RelayHostProfile
  | SshGatewayHostProfile
  | LocalEmbeddedHostProfile;

export function hostProfileSortKey(profile: HostProfile): number {
  return profile.createdAtMs;
}
