import { type Transport } from "@av-pi-studio/client";
import { type KeyValueStore } from "@av-pi-studio/ui-library";

/** Shown in the connection bar. Static for the lifetime of the page. */
export interface AppIdentity {
  title: string;
  version: string;
  /**
   * Sent as `hello.platform` so the daemon can tell what kind of client this is (`"desktop"` for the
   * Tauri app). Omit in a plain browser. Informational: nothing branches on it.
   */
  platform?: string;
  /**
   * The oldest daemon version this app expects. A connected daemon below it (or reporting none)
   * gets a one-time notice. Set by the desktop host; a browser host omits it.
   */
  minDaemonVersion?: string;
}

/** A registry entry without its secrets (`password`, `pairingLink`, `sshPassword`, `passphrase`). */
export interface DaemonEntryView {
  id: string;
  kind: "local" | "direct" | "relay" | "ssh";
  name: string;
  /** `direct` entries only, as typed. */
  address?: string;
  /** `ssh` entries only. */
  ssh?: SshEntryView;
  hasPassword: boolean;
}

/** What an `ssh` entry stores, without its secrets. */
export interface SshEntryView {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  jump?: string;
  daemonPort: number;
  hasSshPassword: boolean;
  hasPassphrase: boolean;
}

/** A `Host` of `~/.ssh/config` without a wildcard, with what the config says about it. */
export interface SshHostSuggestion {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  jump?: string;
}

/** The local daemon's state, as the host last probed or drove it. */
export type LocalDaemonState =
  /** Until the first probe after launch has finished. */
  | { state: "checking" }
  /** Windows: no local daemon. */
  | { state: "unsupported" }
  /** No CLI found. Carries the configured path when one was set and is not an executable file. */
  | { state: "cli_missing"; path?: string }
  /** A CLI too old for `--json daemon start`. */
  | { state: "cli_outdated"; version: string }
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "stopping" }
  | { state: "running"; host: string; port: number }
  | { state: "failed"; reason: "not_healthy" | "timeout" | "bad_output" | "spawn_failed" };

/**
 * The daemon behind the current `ssh` entry, as the host last probed or drove it. In memory; reset
 * when another entry is opened.
 */
export type RemoteDaemonState =
  | { state: "unknown" | "checking" | "running" | "stopped" | "not_installed" | "starting" }
  /** The host's `pi-studio` is older than the minimum the desktop app drives. */
  | { state: "cli_outdated"; version: string }
  | {
      state: "failed";
      reason: "not_healthy" | "timeout" | "bad_output" | "exec_failed" | "no_shell";
    };

export type NewDaemon =
  | { kind: "direct"; name: string; address: string; password?: string }
  | { kind: "relay"; name: string; pairingLink: string }
  | {
      kind: "ssh";
      name: string;
      host: string;
      user?: string;
      port?: number;
      identityFile?: string;
      jump?: string;
      daemonPort?: number;
      /** The daemon's own password. */
      password?: string;
      sshPassword?: string;
      passphrase?: string;
    };

/**
 * Fields to change; an absent field is unchanged. `null` clears an optional field or a secret.
 * `wrong_kind` for a field the entry's kind does not have.
 */
export interface DaemonPatch {
  name?: string;
  address?: string;
  password?: string | null;
  pairingLink?: string;
  host?: string;
  user?: string | null;
  port?: number | null;
  identityFile?: string | null;
  jump?: string | null;
  daemonPort?: number;
  sshPassword?: string | null;
  passphrase?: string | null;
}

export type DaemonErrorCode =
  | "invalid_name"
  | "name_taken"
  | "invalid_address"
  | "invalid_link"
  | "too_many"
  | "not_found"
  | "wrong_kind"
  | "local_not_removable"
  | "unsupported"
  | "cli_missing"
  | "cli_outdated"
  | "busy"
  | "no_current"
  | "local_stopped"
  | "not_healthy"
  | "timeout"
  | "bad_output"
  | "spawn_failed"
  | "secret_missing"
  | "secret_unavailable"
  | "secret_store_failed"
  | "invalid_host"
  | "invalid_user"
  | "invalid_port"
  | "invalid_path"
  | "invalid_jump"
  | "not_installed"
  | "ssh_config";

/**
 * What a `HostDaemons` call rejects with: an `Error` whose `code` says why and whose message is the
 * code. An interface, so the package exports no runtime value for it; narrow with `"code" in e`.
 */
export interface DaemonError extends Error {
  readonly code: DaemonErrorCode;
}

export interface DaemonSettings {
  /** Opening the local entry starts its daemon when it is stopped. */
  autoStartLocalDaemon: boolean;
  /** An explicit path of the `pi-studio` executable; `null` means "find it". */
  cliPath: string | null;
}

/**
 * Optional. The daemon registry of a host that owns one (the desktop app). Absent: the workbench
 * keeps its address and password fields.
 */
export interface HostDaemons {
  /** Synchronous: the host keeps it in memory. Never contains a password or a pairing link. */
  snapshot(): {
    currentId: string | null;
    entries: DaemonEntryView[];
    local: LocalDaemonState;
    /** The state of the current entry's daemon when that entry is `ssh`; otherwise `null`. */
    remote: RemoteDaemonState | null;
    settings: DaemonSettings;
    /**
     * Optional. Where the host keeps passwords and pairing links: `file` is a file only this user
     * can read (no keychain is available), and the Daemons screen says so. `keychain` or absent:
     * nothing is said.
     */
    secretStore?: "keychain" | "file";
  };
  /** Fires after any change to the registry, the settings or the local daemon's state. */
  subscribe(listener: () => void): () => void;
  /**
   * What to dial for the current entry; starts the local daemon when it is stopped and
   * `autoStartLocalDaemon` is on. Rejects with a `DaemonError`.
   */
  resolveCurrent(): Promise<ConnectIntent>;
  add(input: NewDaemon): Promise<DaemonEntryView>;
  update(id: string, patch: DaemonPatch): Promise<DaemonEntryView>;
  /** Rejects `local_not_removable` for the local entry. */
  remove(id: string): Promise<void>;
  /** Opens another entry. The page is reloaded; the promise does not resolve on success. */
  switchTo(id: string): Promise<void>;
  setSettings(patch: Partial<DaemonSettings>): Promise<void>;
  /** Each resolves once the action is accepted; the outcome arrives as a state change. */
  local: {
    start(): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    refresh(): Promise<void>;
  };
  /**
   * The current `ssh` entry's daemon. Rejects `wrong_kind` for any other entry, `busy`, and (start)
   * `not_installed` or `cli_outdated`.
   */
  remote: {
    start(): Promise<void>;
    refresh(): Promise<void>;
  };
  /** The hosts of `~/.ssh/config`. Rejects `ssh_config` when the file does not parse. */
  sshHosts(): Promise<SshHostSuggestion[]>;
  /** Fires when the native menu asks for the Daemons screen. Returns the unsubscribe. */
  onManageRequest(listener: () => void): () => void;
}

/** Blocking questions to the user. Each resolves when the user answers. */
export interface HostDialogs {
  /** Resolves `false` on dismissal. */
  confirm(message: string): Promise<boolean>;
  alert(message: string): Promise<void>;
}

export interface HostClipboard {
  /** Rejects on failure; callers report the failure to the user. */
  writeText(text: string): Promise<void>;
}

export interface HostLinks {
  /**
   * Optional. When present, activating an external link calls it and the default navigation is
   * suppressed. When absent, the anchor behaves natively (`target="_blank"`).
   */
  openExternal?(url: string): void;
}

/**
 * What the shell was launched to connect to. `url` is a daemon address or a pairing link; every
 * field is a pre-fill for the connection bar. `connect: true` connects immediately (a pairing link
 * always does).
 */
export interface ConnectIntent {
  url?: string;
  password?: string;
  cwd?: string;
  connect: boolean;
}

/** A source of "open this agent" requests (`#agent=<id>` in a browser, an OS deep link natively). */
export interface AgentDeepLinkSource {
  /** The pending agent id at boot, or `null`. */
  current(): string | null;
  /** Fires for each later request while the app is open. Returns the unsubscribe. */
  subscribe(listener: (agentId: string) => void): () => void;
  /** Called after a target was applied or rejected, so it is not applied again. */
  consume(): void;
}

export interface HostLaunch {
  /** Read once at boot. `null` means no intent: show the connection fields, do not connect. */
  initialConnect(): ConnectIntent | null;
  agentDeepLink: AgentDeepLinkSource;
}

/**
 * Where `connect()` dials, decided from what the user typed or pasted: a direct daemon address, or
 * a relay-routed pairing link with the daemon's public key.
 */
export type ConnectTarget =
  | { mode: "direct"; url: string }
  | { mode: "relay"; url: string; daemonPublicKey: Uint8Array };

/** `setTimeout`/`clearTimeout` equivalents for the SDK's `ReconnectionManager`. */
export interface HostTimers {
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface HostConnection {
  /**
   * The transport `DaemonClient` uses for one `connect()`, or `undefined` for the SDK's default
   * WebSocket. A foreign transport (e.g. a Rust-owned socket) MUST deliver frames in wire order and
   * binary frames as `ArrayBuffer`. Throwing fails that `connect()` with the error.
   */
  createTransport(target: ConnectTarget, options: { password?: string }): Transport | undefined;
  /** Passed to `ReconnectionManager`. Must keep firing while the window is hidden. */
  timers: HostTimers;
  /**
   * Fires when a stale connection may need checking (window visible again, network back, machine
   * woke). The workbench decides what to do. Returns the unsubscribe.
   */
  onResume(listener: () => void): () => void;
}

/**
 * Something to upload. Opaque to the workbench, which reads only `name` (the target file name) and
 * `size`. The browser's `File` satisfies it. Sources the workbench creates itself (a generated
 * structure file) are always `File`s, so every host must accept a `Blob`; a native host may also
 * accept its own kind (e.g. a local path from its file picker).
 */
export interface UploadSource {
  readonly name: string;
  readonly size?: number;
}

/** A daemon file a viewer can display by URL. */
export interface ViewableFile {
  /** Loadable by `<img>`, `<video>`, `fetch()` and pdf.js. */
  url: string;
  mimeType?: string;
  fileName?: string;
  /** Frees whatever backs `url`. Idempotent; the workbench calls it once the URL is unused. */
  release(): void;
}

/** Where a transfer is, as the host reports it. A host that never reports one is `"running"`. */
export type TransferState = "queued" | "running" | "waiting";

/**
 * What the workbench passes to `files.upload` and `files.saveToDisk`. A host may ignore every
 * member, but then its transfers show no progress and cannot be cancelled.
 */
export interface TransferOptions {
  /**
   * Bytes done so far, and the total when known. Called as the transfer runs (monotonic, possibly
   * many times per second); the explorer turns it into a percentage. After a `"waiting"` state it
   * restarts from 0. A save calls it only once the user has chosen a destination.
   */
  onProgress?(done: number, total?: number): void;
  /** Where the transfer is. A host that never calls it is `"running"`. */
  onStateChange?(state: TransferState): void;
  /** Aborting stops the transfer and rejects it with an error named `AbortError`. */
  signal?: AbortSignal;
}

/**
 * Where a saved daemon file goes when the shell supplies the destination. The workbench calls
 * `write` for each chunk in file order and awaits it, then `finish` once; on any failure it calls
 * `discard` once instead (never `finish`) and rejects with the original error.
 */
export interface SaveTarget {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  discard(): Promise<void>;
}

export interface HostFiles {
  /**
   * Upload `source` to `<dir>/<source.name>` on the daemon. Resolves only once the daemon has
   * confirmed the file is written (with a daemon that advertises `fileTransferAck`; an older daemon
   * resolves when the bytes have left the machine). Rejects with the daemon's reason on failure.
   */
  upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void>;
  /**
   * Copy the daemon file at `path` to the user's machine (save dialog, downloads folder). Neither
   * callback of `options` runs before the user has chosen a destination; when the user cancels the
   * dialog this resolves and neither has run.
   */
  saveToDisk(path: string, options?: TransferOptions): Promise<void>;
  /** Make the daemon file at `path` displayable by URL. */
  openForView(path: string): Promise<ViewableFile>;
  /** Optional native picker. Absent: the workbench uses an `<input type="file">`. */
  pickUploads?(): Promise<UploadSource[]>;
}

/**
 * pdf.js runtime pieces only an application bundle can provide: a worker built from the
 * application's own `pdfjs-dist` (same version as the workbench's), and the URL its data
 * directories are served from (`@av-pi-studio/workbench/vite`'s `pdfjsAssetsPlugin`).
 */
export interface HostPdf {
  createWorker(): Worker;
  /** Where `cmaps/`, `standard_fonts/`, `wasm/` and `iccs/` live. Relative URLs resolve against
   *  the document; a trailing slash is optional. */
  assetBaseUrl: string;
}

/**
 * Where the HTML viewer's document is loaded from. `origin`: the viewer hands the assembled
 * document to `mount` and loads the frame from the returned `url` (same sandbox tokens) instead
 * of `srcdoc`; it calls `release` once a newer document replaces it and when the viewer unmounts.
 * A `mount` that rejects shows the viewer's error state. `inert`: scripts cannot run on this
 * host; the viewer keeps `srcdoc` and says so.
 */
export type HostPreview =
  | { kind: "origin"; mount(html: string): Promise<{ url: string; release(): void }> }
  | { kind: "inert" };

/**
 * The one object an embedding shell supplies to the workbench for everything browser-bound
 * (`swe/architecture/workbench-host-adapter.md`). `web-client` passes `createBrowserHost(...)`; a
 * desktop shell passes its own implementation. Members are added as the call sites move behind it.
 */
export interface WorkbenchHost {
  app: AppIdentity;
  /**
   * **Synchronous** by contract: stores read it during initialisation. Never throws; a failed
   * write is dropped. A host with asynchronous storage loads into memory before the first render
   * and writes behind.
   */
  storage: KeyValueStore;
  clipboard: HostClipboard;
  dialogs: HostDialogs;
  links: HostLinks;
  launch: HostLaunch;
  connection: HostConnection;
  files: HostFiles;
  /**
   * Optional. The PDF viewer's runtime. Absent: opening a PDF shows the viewer's error state with
   * its Download action.
   */
  pdf?: HostPdf;
  /**
   * Optional. Where the HTML viewer loads its document from. Absent: the `srcdoc` frame, unchanged.
   */
  preview?: HostPreview;
  /**
   * Optional. The daemon registry. Absent: the connection bar's address and password fields,
   * unchanged. Consumed from sprint-110.
   */
  daemons?: HostDaemons;
}
