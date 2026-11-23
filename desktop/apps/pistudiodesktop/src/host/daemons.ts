import {
  type ConnectIntent,
  type DaemonEntryView,
  type DaemonError,
  type DaemonErrorCode,
  type DaemonSettings,
  type HostDaemons,
  type SshHostSuggestion,
} from "@av-pi-studio/workbench";

import { isRecord, parseDaemonsView, parseEntryView, type DaemonsView } from "./daemons-view.js";
import { type Ipc, type IpcEvents } from "./ipc.js";

/** The events the app emits (`desktop-daemon-registry.md`, `commands.rs`). */
const CHANGED_EVENT = "daemons_changed";
const MANAGE_EVENT = "daemons_manage";

/** Every code a `HostDaemons` call may reject with; the record keeps it equal to `DaemonErrorCode`. */
const CODES: Record<DaemonErrorCode, true> = {
  invalid_name: true,
  name_taken: true,
  invalid_address: true,
  invalid_link: true,
  too_many: true,
  not_found: true,
  wrong_kind: true,
  local_not_removable: true,
  unsupported: true,
  cli_missing: true,
  cli_outdated: true,
  busy: true,
  no_current: true,
  local_stopped: true,
  not_healthy: true,
  timeout: true,
  bad_output: true,
  spawn_failed: true,
  secret_missing: true,
  secret_unavailable: true,
  secret_store_failed: true,
  invalid_host: true,
  invalid_user: true,
  invalid_port: true,
  invalid_path: true,
  invalid_jump: true,
  not_installed: true,
  ssh_config: true,
};

/** What a `HostDaemons` call rejects with when the app answered with one of the spec's codes. */
export class HostDaemonError extends Error implements DaemonError {
  readonly code: DaemonErrorCode;

  constructor(code: DaemonErrorCode) {
    super(code);
    this.name = "DaemonError";
    this.code = code;
  }
}

function isCode(text: string): text is DaemonErrorCode {
  return Object.hasOwn(CODES, text);
}

/** A `DaemonError` for a command's error text when it is one of the codes, else a plain `Error`. */
function failureOf(error: unknown): Error {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
  if (text !== undefined && isCode(text)) return new HostDaemonError(text);
  if (error instanceof Error) return error;
  return new Error(text ?? "The app host refused the request.");
}

function entryOf(answer: unknown): DaemonEntryView {
  const entry = parseEntryView(answer);
  if (!entry) throw new Error("The app host answered with an unexpected entry.");
  return entry;
}

/** The settings, in the order they are written; `settings.set` changes one key per call. */
const SETTING_KEYS = ["autoStartLocalDaemon", "cliPath"] as const satisfies ReadonlyArray<keyof DaemonSettings>;

function isIntent(value: unknown): value is ConnectIntent {
  return isRecord(value) && typeof value.connect === "boolean";
}

/** Said once per removed entry whose saved password or pairing link the secret store would not delete. */
export const SECRET_NOT_REMOVED_TEXT =
  "The daemon was removed, but its saved password or pairing link could not be deleted from the secret store. It is still stored there.";

/**
 * The daemon registry for the workbench: the view held in memory from the boot snapshot, replaced
 * on each `daemons_changed`, and the app's commands behind every action. `settled` resolves when
 * every `storage_set` sent so far was answered; a switch waits for it. `tell` shows a message to
 * the person (a toast): the one thing an answer can say that no rejection does.
 *
 * The intent `resolveCurrent` returns holds no password: a local or direct entry's socket is
 * Rust's, which reads the password itself. For a relay entry its `url` is the pairing link: it is
 * handed over and kept nowhere here, and no log call receives it.
 */
export function createDesktopDaemons(
  initial: DaemonsView,
  ipc: Ipc & IpcEvents,
  settled: () => Promise<void>,
  log: (message: string, error: unknown) => void,
  tell: (text: string) => void,
): HostDaemons {
  let view = initial;
  /** Counts the events heard, so an answer that was asked for before one is not taken over it. */
  let heard = 0;
  const changeListeners = new Set<() => void>();
  const manageListeners = new Set<() => void>();

  const notify = (listeners: ReadonlySet<() => void>, what: string): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch (error) {
        log(`a ${what} listener threw`, error);
      }
    }
  };

  const call = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    try {
      return await ipc.invoke(command, args);
    } catch (error) {
      throw failureOf(error);
    }
  };
  const engine = (id: string, params?: Record<string, unknown>): Promise<unknown> =>
    call("engine_command", params === undefined ? { id } : { id, params });

  const accepted = async (id: string): Promise<void> => {
    await engine(id);
  };

  const onChanged = (payload: unknown): void => {
    const next = parseDaemonsView(payload);
    if (!next) {
      log("daemons_changed carried an unexpected shape", undefined);
      return;
    }
    heard += 1;
    view = next;
    notify(changeListeners, "daemons");
  };

  // An event sent between the boot snapshot and the listener's registration is lost, so the view is
  // read once more when the listener is in place (the local daemon's first probe is such a change).
  // The engine's answers do not name the secret store, which is fixed for the launch: it stays.
  const resync = async (): Promise<void> => {
    const before = heard;
    const [list, settings] = await Promise.all([engine("daemon.list"), engine("settings.get")]);
    if (heard !== before || !isRecord(list)) return;
    const next = parseDaemonsView({ secretStore: view.secretStore, ...list, settings });
    if (!next) throw new Error("The app host answered daemon.list with an unexpected shape.");
    if (JSON.stringify(next) === JSON.stringify(view)) return;
    view = next;
    notify(changeListeners, "daemons");
  };

  ipc
    .listen(CHANGED_EVENT, onChanged)
    .then(resync)
    .catch((error: unknown) => log("could not follow the daemon registry", error));
  ipc
    .listen(MANAGE_EVENT, () => notify(manageListeners, "manage request"))
    .catch((error: unknown) => log("could not listen for the Daemons menu", error));

  return {
    snapshot: () => view,
    subscribe(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },
    async resolveCurrent() {
      const intent = await call("daemon_resolve_current");
      if (!isIntent(intent)) throw new Error("The app host answered with an unexpected connect intent.");
      return intent;
    },
    async add(input) {
      return entryOf(await engine("daemon.add", { ...input }));
    },
    async update(id, patch) {
      return entryOf(await engine("daemon.update", { id, ...patch }));
    },
    async remove(id) {
      const answer = await engine("daemon.remove", { id });
      // The entry is gone either way; a secret the store would not delete is told to the person.
      if (isRecord(answer) && Array.isArray(answer.notices)) {
        for (const notice of answer.notices) {
          if (isRecord(notice) && notice.kind === "secret_not_removed") tell(SECRET_NOT_REMOVED_TEXT);
        }
      }
    },
    async switchTo(id) {
      await settled();
      if ((await call("daemon_switch", { id })) === "cancelled") return;
      // The page is reloaded: this promise is never settled.
      await new Promise<never>(() => undefined);
    },
    async setSettings(patch) {
      for (const key of SETTING_KEYS) {
        const value = patch[key];
        if (value !== undefined) await engine("settings.set", { key, value });
      }
    },
    local: {
      start: () => accepted("daemon.local.start"),
      stop: () => accepted("daemon.local.stop"),
      restart: () => accepted("daemon.local.restart"),
      refresh: () => accepted("daemon.local.refresh"),
    },
    remote: {
      start: () => accepted("daemon.remote.start"),
      refresh: () => accepted("daemon.remote.refresh"),
    },
    async sshHosts() {
      const answer = await call("ssh_config_hosts");
      if (!isRecord(answer) || !Array.isArray(answer.hosts)) {
        throw new Error("The app host answered ssh_config_hosts with an unexpected shape.");
      }
      return answer.hosts as SshHostSuggestion[];
    },
    onManageRequest(listener) {
      manageListeners.add(listener);
      return () => void manageListeners.delete(listener);
    },
  };
}
