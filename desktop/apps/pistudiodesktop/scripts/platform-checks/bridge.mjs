// What the runners read about the app's connections (milestone 2, `desktop/docs/control-protocol.md`
// § The connections) and about its keychain items. Pure functions, and the two waits that use the
// control socket; both jobs use them.

import { ControlClient } from "./control-client.mjs";
import { Abort, sleep, waitFor } from "./wait.mjs";

/** The keychain's service name for every item (`crates/secrets/src/keychain.rs`). */
export const KEYCHAIN_SERVICE = "com.avatsaev.pi-studio";

/** The entry id of the throwaway item the app writes and deletes at launch (`secret_choice.rs`). */
export const PROBE_ENTRY_ID = "00000000-0000-4000-8000-000000000000";

/** How long a control call that touches the keychain may take before it is taken for a prompt nobody can answer. */
export const KEYCHAIN_CALL_MS = 30_000;

/** Why a control call's failure means "this runner cannot use its keychain unattended" rather than "the app is wrong", or `null`. */
export function keychainSkipReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/no reply in \d+ ms/.test(message)) {
    return `the keychain did not answer within ${KEYCHAIN_CALL_MS / 1000} s: it is waiting for a person to answer a prompt (${message})`;
  }
  if (/secret_(unavailable|store_failed)|denied/.test(message)) return `the keychain refused the item (${message})`;
  return null;
}

/** The last lines of an app's log, on one line, for a message. */
export const logTail = (text, lines = 4) => text.trim().split("\n").slice(-lines).join(" / ");

/**
 * The connection bar's daemon switcher is a button whose tooltip is `<entry name> · <state>`
 * (`daemon-switcher-presentation.ts`: "Bravo · connected"). This script returns the tooltips of every
 * menu button of the page, for `barShowsConnected`.
 */
export const SWITCHER_TITLES_SCRIPT = `return Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).map((button) => button.getAttribute("title") || "");`;

/**
 * Whether one of the switcher's tooltips says the entry `name` is connected: `<name> · connected`,
 * or `<name> · <host> · connected` when the bar names the host as well.
 */
export function barShowsConnected(titles, name) {
  return titles.some((title) => title.startsWith(`${name} · `) && title.endsWith(" · connected"));
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x00000100000001b3n;

/**
 * The scope of a launch's keychain items: 16 hexadecimal digits of the FNV-1a 64 hash of the
 * `--config-dir` as it was given to the app (`Scope::for_config_dir`, pinned there by a test).
 */
export function keychainScope(configDir) {
  let hash = FNV_OFFSET;
  for (const byte of Buffer.from(configDir, "utf8")) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV_PRIME);
  return hash.toString(16).padStart(16, "0");
}

/** The keychain account of an entry's secret: `<scope>/<entry id>/<kind>` (`password` or `pairingLink`). */
export function keychainAccount(scope, entryId, kind = "password") {
  return `${scope}/${entryId}/${kind}`;
}

const connectionOf = (view) => view?.connection ?? null;

/** `connection.resumeSignals.wake` of a `ui.inspect` view, or `null` when the view has none. */
export function wakeCount(view) {
  const wake = connectionOf(view)?.resumeSignals?.wake;
  return typeof wake === "number" ? wake : null;
}

/** One line about the connection part of a view, for a failure message and the summary. No address, no secret. */
export function describeConnection(view) {
  const connection = connectionOf(view);
  if (!connection) return "ui.inspect has no `connection` (an app older than milestone 2?)";
  const transports = (connection.transports ?? []).map((t) => `${t.entryId}:${t.state} in=${t.framesIn}/${t.bytesIn}B out=${t.framesOut}/${t.bytesOut}B peak=${t.peakHeldIn}/${t.peakHeldOut}`);
  const error = connection.lastError ? `${connection.lastError.code}` : "none";
  const signals = connection.resumeSignals ?? {};
  return `transports [${transports.join("; ")}], lastError ${error}, secretStore ${connection.secretStore}, wake ${signals.wake}, network ${signals.network}`;
}

/**
 * Whether the view shows exactly one transport, open, for `entryId`, with at least `minFramesIn`
 * frames from the daemon. `detail` says what was seen either way.
 */
export function openTransport(view, entryId, minFramesIn = 1) {
  const connection = connectionOf(view);
  const detail = describeConnection(view);
  if (!connection) return { ok: false, detail };
  const transports = connection.transports ?? [];
  if (transports.length !== 1) return { ok: false, detail: `${transports.length} transports, expected one: ${detail}` };
  const [transport] = transports;
  if (transport.entryId !== entryId) return { ok: false, detail: `the transport is for another entry: ${detail}` };
  if (transport.state !== "open") return { ok: false, detail: `the transport is ${transport.state}: ${detail}` };
  if (!(transport.framesIn >= minFramesIn)) return { ok: false, detail: `framesIn is ${transport.framesIn}, expected at least ${minFramesIn}: ${detail}` };
  return { ok: true, detail };
}

/**
 * Wait until `ui.inspect` shows one open transport for `entryId` with frames in; returns the view's
 * `connection`. The error of a timeout says what was last seen.
 */
export async function waitForOpenTransport(control, { entryId, minFramesIn = 1, timeoutMs = 45_000 }) {
  let seen = "no answer from ui.inspect yet";
  try {
    return await waitFor(
      `one open transport for ${entryId}`,
      async () => {
        const view = await control.inspect();
        const found = openTransport(view, entryId, minFramesIn);
        seen = found.detail;
        return found.ok ? view.connection : null;
      },
      { timeoutMs, intervalMs: 500 },
    );
  } catch (error) {
    throw new Error(`${error.message}; last seen: ${seen}`);
  }
}

/**
 * Stop the app, hold it `holdMs`, continue it, and report `resumeSignals.wake` before and after.
 * `stop` and `resume` do the platform's part (SIGSTOP and SIGCONT, or the suspend script); `resume`
 * runs whatever happened, so the app is never left stopped. The app's 2 s tick counts a wake when
 * it finds 10 s unaccounted for, so a hold of 15 s is one wake. Throws when the count did not rise
 * within `waitMs` of the continue.
 */
export async function stopAndContinue({ control, stop, resume, holdMs = 15_000, waitMs = 20_000 }) {
  const before = wakeCount(await control.inspect());
  if (before === null) throw new Error("ui.inspect has no connection.resumeSignals.wake");
  let stoppedAt = Date.now();
  let continuedAt;
  try {
    await stop();
    stoppedAt = Date.now();
    await sleep(holdMs);
  } finally {
    // Also after a stop that failed half way: whatever was stopped is continued.
    await resume();
    continuedAt = Date.now();
  }
  const heldMs = continuedAt - stoppedAt;
  let after = before;
  try {
    await waitFor(
      `resumeSignals.wake to rise above ${before}`,
      async () => {
        after = wakeCount(await control.inspect());
        return after !== null && after > before;
      },
      { timeoutMs: waitMs, intervalMs: 250 },
    );
  } catch (error) {
    throw new Error(`${error.message}; stopped ${heldMs} ms, wake was ${before} and is ${after}`);
  }
  return { before, after, heldMs, countedAfterMs: Date.now() - continuedAt };
}

/** What the control token file holds once the app has written a token (64 hex characters). */
export const TOKEN = /^[0-9a-f]{64}$/;

/**
 * Connect to a control socket on a port chosen beforehand, once the app has bound it and written
 * the token file (`read` returns its text, or throws when it is not there yet). `ended` answers why
 * the app is gone, or `null` while it runs: the wait ends at once then.
 */
export async function connectControl({ port, read, timeoutMs = 60_000, ended = () => null }) {
  return waitFor(
    "the app's control socket",
    async () => {
      const why = ended();
      if (why) throw new Abort(why);
      const token = read().trim();
      if (!TOKEN.test(token)) return null;
      return ControlClient.connect({ port, token });
    },
    { timeoutMs, intervalMs: 300 },
  );
}

/** The attributes `security find-generic-password` prints for an item: its account and its dates. */
export function parseSecurityItem(output) {
  const text = (name) => new RegExp(`"${name}"<blob>="([^"]*)"`).exec(output)?.[1] ?? null;
  const date = (name) => new RegExp(`"${name}"<timedate>=\\S+\\s+"([^"\\\\]*)`).exec(output)?.[1] ?? null;
  return { service: text("svce"), account: text("acct"), created: date("cdat"), modified: date("mdat") };
}

/**
 * The `Target:` names in `cmdkey /list` output that contain `needle` (an entry id; case does not
 * matter), without the `Target:` label.
 */
export function cmdkeyTargets(output, needle) {
  const wanted = needle.toLowerCase();
  return output
    .split(/\r?\n/)
    .map((line) => /^\s*Target:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((target) => target !== undefined && target.toLowerCase().includes(wanted));
}
