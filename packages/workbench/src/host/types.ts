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
}

/** Blocking questions to the user. Each resolves when the user answers. */
export interface HostDialogs {
  /** Resolves `false` on dismissal. */
  confirm(message: string): Promise<boolean>;
  alert(message: string): Promise<void>;
  /** Resolves `null` on dismissal. */
  prompt(message: string, initial?: string): Promise<string | null>;
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

/** Optional extras the workbench passes to `files.upload`. A host may ignore them. */
export interface UploadOptions {
  /**
   * Bytes handed to the transport so far, and the source's total when known. Called as the upload
   * runs (monotonic, possibly many times per second); the explorer turns it into a percentage.
   */
  onProgress?(sent: number, total?: number): void;
}

export interface HostFiles {
  /**
   * Upload `source` to `<dir>/<source.name>` on the daemon. Resolves only once the daemon has
   * confirmed the file is written (with a daemon that advertises `fileTransferAck`; an older daemon
   * resolves when the bytes have left the machine). Rejects with the daemon's reason on failure.
   */
  upload(dir: string, source: UploadSource, options?: UploadOptions): Promise<void>;
  /** Copy the daemon file at `path` to the user's machine (save dialog, downloads folder). */
  saveToDisk(path: string): Promise<void>;
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
}
