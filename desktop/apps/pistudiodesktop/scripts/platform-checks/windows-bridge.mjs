// The Windows job's checks of milestone 2 (spec `swe/features/desktop-transport-bridge.md` § 7, the
// Bridge and Secrets criteria): the page's connection through Rust, the resume signal, and the
// Credential Manager. No daemon runs on Windows (the daemon is POSIX-only), so a small stand-in
// answers the page (`stand-in-daemon.mjs`, no dependency).
//
//  - `bridgeChecks`: the app runs under WebDriver (file secret store, a scratch `--config-dir`) with
//    its control socket on a port chosen here. A direct entry with a password is added through the
//    control socket, the page is pointed at it with the switcher, and the checks read
//    `ui.inspect` (one open transport with frames in), the page (the connection bar says
//    connected), and the stand-in (it was sent the page's `hello` and the bearer password). Then
//    the app's processes (the webview's too) are suspended for 15 s and continued, as a sleep does
//    to them: `resumeSignals.wake` has to rise and the session to be connected again.
//  - `keychainCheck`: the one Windows launch that uses the keychain (`--secret-store keychain`, a
//    scratch `--config-dir`): a direct entry with a password is added, edited and removed over the
//    control socket and `cmdkey /list` shows its credential after the add and not after the remove.
//    The runner is thrown away after the run; the credential is deleted all the same.
//
// The same page checks run in the Linux rehearsal (`rehearse-webdriver`): the wake and the
// Credential Manager are skipped there, with their reasons.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { KEYCHAIN_STORE_ARG, launch } from "./app-process.mjs";
import {
  barShowsConnected,
  cmdkeyTargets,
  connectControl,
  KEYCHAIN_CALL_MS,
  keychainSkipReason,
  logTail,
  PROBE_ENTRY_ID,
  stopAndContinue,
  SWITCHER_TITLES_SCRIPT,
  waitForOpenTransport,
} from "./bridge.mjs";
import { freePort } from "./net.mjs";
import { chooseInSwitcher, closeDialogs } from "./page-ui.mjs";
import { killProcesses } from "./processes.mjs";
import { Skip } from "./report.mjs";
import { StandInDaemon } from "./stand-in-daemon.mjs";
import { windowsSuspend } from "./suspend.mjs";
import { waitFor } from "./wait.mjs";

const execFileAsync = promisify(execFile);

const ENTRY_NAME = "Stand-in daemon";
/** How long the app's processes are suspended: a wake is 10 s or more unaccounted for. */
const SUSPEND_MS = 15_000;

const BRIDGE_CHECKS = [
  { id: "bridge.windows.transport-open", title: "the page connects to a direct entry with a password; ui.inspect shows one open transport with frames in" },
  { id: "bridge.windows.bar-connected", title: "the connection bar shows the entry as connected" },
  { id: "bridge.windows.stand-in", title: "the stand-in was sent the page's hello and the bearer password, and no control answer holds the password" },
  { id: "bridge.windows.wake", title: "the app's processes suspended for 15 s and resumed: resumeSignals.wake rises, the session is connected again without a reload" },
];

/** Wait until the page's connection bar shows `name` as connected; the error names the tooltips it saw. */
async function waitForBarConnected(session, name, timeoutMs) {
  let seen = [];
  try {
    await waitFor(
      `the connection bar to show ${name} as connected`,
      async () => {
        seen = await session.execute(SWITCHER_TITLES_SCRIPT);
        return barShowsConnected(seen, name);
      },
      { timeoutMs, intervalMs: 500 },
    );
  } catch (error) {
    throw new Error(`${error.message}; the switcher's tooltips were ${JSON.stringify(seen)}`);
  }
}

/** `cmdkey /list`'s text. */
async function cmdkeyList(exec) {
  const { stdout } = await exec("cmdkey", ["/list"], { timeout: 30_000 });
  return stdout;
}

/** The Credential Manager targets that name `entryId`. */
export async function credentialTargets(entryId, { exec = execFileAsync } = {}) {
  return cmdkeyTargets(await cmdkeyList(exec), entryId);
}

/** Delete credentials by the target `cmdkey /list` showed; a target that is not there is not an error. */
export async function deleteCredentials(targets, { exec = execFileAsync } = {}) {
  for (const target of targets) {
    // `cmdkey /list` prefixes a generic credential's name with `LegacyGeneric:target=`; the delete
    // takes the whole string, and the bare name where that is not accepted.
    const names = [target, target.replace(/^LegacyGeneric:target=/i, "")];
    for (const name of new Set(names)) await exec("cmdkey", [`/delete:${name}`], { timeout: 30_000 }).catch(() => {});
  }
}

/** The four bridge checks. The app is ended and the stand-in stopped at the end, whatever failed. */
export async function bridgeChecks(run) {
  const [transportCheck, barCheck, standInCheck, wakeCheck] = BRIDGE_CHECKS;
  const configDir = run.scratch("config-bridge");
  const tokenFile = path.join(run.scratch("control-bridge"), "token");
  const port = await freePort();
  const password = `platform-check-${randomBytes(8).toString("hex")}`;
  const standIn = await StandInDaemon.start({ password });
  let opened = null;
  let control = null;
  try {
    try {
      opened = await run.openApp(configDir, { args: [`--control=${port}`, `--control-token-file=${tokenFile}`] });
      control = await connectControl({ port, read: () => readFileSync(tokenFile, "utf8") });
    } catch (error) {
      await run.report.run(transportCheck.id, transportCheck.title, async () => {
        throw error;
      });
      run.report.skipAll(BRIDGE_CHECKS.slice(1), "the app did not start with its control socket");
      return;
    }
    const { session } = opened;
    let entry;
    let connection;
    const connected = await run.report.run(transportCheck.id, transportCheck.title, async ({ note }) => {
      try {
        // The Daemons screen opens by itself when the local daemon is not usable (Windows has none).
        await closeDialogs(session);
        entry = await control.execute("daemon.add", { kind: "direct", name: ENTRY_NAME, address: standIn.url, password });
        if (entry.hasPassword !== true) throw new Error(`the new entry says hasPassword = ${JSON.stringify(entry.hasPassword)}`);
        await chooseInSwitcher(session, "This machine", ENTRY_NAME);
        const began = Date.now();
        connection = await waitForOpenTransport(control, { entryId: entry.id, timeoutMs: 60_000 });
        const [transport] = connection.transports;
        note(`open ${((Date.now() - began) / 1000).toFixed(1)} s after the switch: framesIn ${transport.framesIn}, framesOut ${transport.framesOut}; secretStore ${connection.secretStore}; lastError ${connection.lastError?.code ?? "none"}`);
        run.report.fact(
          `The page's connection to the stand-in through Rust (${run.flavor === "windows" ? "Windows, WebView2" : "Linux rehearsal, WebKitGTK"})`,
          `transport ${transport.state}: framesIn ${transport.framesIn}, bytesIn ${transport.bytesIn}, framesOut ${transport.framesOut}, bytesOut ${transport.bytesOut}, peakHeldIn ${transport.peakHeldIn}, peakHeldOut ${transport.peakHeldOut}`,
          `connection.secretStore ${connection.secretStore} (the checks pass --secret-store=file)`,
        );
      } catch (error) {
        await session.screenshot(run.shot("bridge-failed")).catch(() => {});
        throw error;
      }
    });
    if (!connected) {
      run.report.skipAll(BRIDGE_CHECKS.slice(1), "no transport opened");
      return;
    }

    await run.report.run(barCheck.id, barCheck.title, async () => {
      await waitForBarConnected(session, ENTRY_NAME, 30_000);
      await session.screenshot(run.shot("05-bridge-connected"));
    });

    await run.report.run(standInCheck.id, standInCheck.title, async ({ note }) => {
      if (!standIn.upgrades.some((upgrade) => upgrade.authorized && upgrade.offeredBearer)) {
        throw new Error(`the stand-in saw no upgrade with the bearer password: ${JSON.stringify(standIn.upgrades)}`);
      }
      const [hello] = standIn.hellos;
      if (!hello) throw new Error("the stand-in was sent no hello");
      const leaked = control.replies.filter((line) => line.includes(password));
      if (leaked.length > 0) throw new Error(`${leaked.length} control answer(s) contain the password`);
      note(`hello: clientType ${hello.clientType}, platform ${hello.platform}, protocolVersion ${hello.protocolVersion}; ${standIn.upgrades.length} upgrade(s); ${standIn.pings} ping(s); ${standIn.unanswered} other frame(s) left unanswered`);
      run.report.fact("What the page sent the stand-in", `hello: clientType ${hello.clientType}, platform ${hello.platform}, protocolVersion ${hello.protocolVersion}`, `${standIn.unanswered} frame(s) after the hello (requests the stand-in does not answer)`);
    });

    await run.report.run(wakeCheck.id, wakeCheck.title, async ({ note }) => {
      if (run.flavor !== "windows") throw new Skip("the Linux rehearsal stops processes with signals, not with the Windows suspend this check is for");
      const [before] = (await control.inspect()).connection.transports;
      const pingsBefore = standIn.pings;
      let suspended = null;
      const result = await stopAndContinue({
        control,
        stop: async () => {
          suspended = await windowsSuspend(run.imageName, "suspend");
        },
        resume: () => windowsSuspend(run.imageName, "resume"),
        holdMs: SUSPEND_MS,
      });
      const resumed = await waitForOpenTransport(control, { entryId: entry.id, timeoutMs: 30_000 });
      await waitForBarConnected(session, ENTRY_NAME, 30_000);
      const [after] = resumed.transports;
      const probed = await waitFor("the page's ping to reach the stand-in", async () => (standIn.pings > pingsBefore ? true : null), { timeoutMs: 12_000, intervalMs: 500 }).catch(() => false);
      await session.screenshot(run.shot("06-bridge-after-wake"));
      note(`suspended ${suspended.count} process(es) for ${(result.heldMs / 1000).toFixed(1)} s; wake ${result.before} -> ${result.after}, counted ${(result.countedAfterMs / 1000).toFixed(1)} s after the resume; the bar shows connected; transport ${after.state}, framesIn ${before.framesIn} -> ${after.framesIn}; the page's ping reached the stand-in: ${probed ? "yes" : "no"}`);
      run.report.fact(
        "Resume signal (Windows, the app's processes and the webview's suspended 15 s)",
        `resumeSignals.wake ${result.before} -> ${result.after} (${(result.countedAfterMs / 1000).toFixed(1)} s after the resume)`,
        `${suspended.count} process(es) suspended; the connection bar shows connected again; the page's ping answered by the stand-in: ${probed ? "yes" : "no"}`,
      );
    });
  } finally {
    control?.close();
    if (opened) await run.closeApp(opened.session);
    await standIn.close();
  }
}

/** The check: `keychain.windows.credential`. Run when no other app of the job is running (single instance). */
export async function keychainCheck(run) {
  const id = "keychain.windows.credential";
  const title = "--secret-store keychain, scratch --config-dir: a direct entry's password appears in the Credential Manager on add (cmdkey /list) and is gone on remove, unattended";
  if (run.flavor !== "windows") {
    await run.report.run(id, title, async () => {
      throw new Skip("the Linux rehearsal has no Credential Manager");
    });
    return;
  }
  const configDir = run.scratch("config-keychain");
  const tokenFile = path.join(run.scratch("control-keychain"), "token");
  const port = await freePort();
  const outcome = { verdict: "not run", lines: [] };
  const skip = (reason) => {
    outcome.verdict = `no, this runner cannot use the Credential Manager unattended: ${reason}`;
    throw new Skip(reason);
  };
  let app = null;
  let control = null;
  let entryId = null;
  const passed = await run.report.run(id, title, async ({ note }) => {
    const args = [`--config-dir=${configDir}`, KEYCHAIN_STORE_ARG, `--control=${port}`, `--control-token-file=${tokenFile}`];
    app = launch(run.app, args, { ...process.env }, path.join(run.outDir, "app-keychain.log"));
    const call = (command, params) => control.call("engine.execute", { command, params }, { timeoutMs: KEYCHAIN_CALL_MS });
    const skipIfExited = async (error) => {
      if (app.running()) return;
      const ended = await app.exited;
      skip(`the app exited at launch with --secret-store keychain (${ended.signal ?? `code ${ended.code}`}; ${logTail(app.log()) || "no output"}); the error was: ${error.message.split("\n")[0]}`);
    };

    // The launch: with `--secret-store keychain` an app that cannot use the keychain exits, naming the option.
    try {
      control = await connectControl({ port, read: () => readFileSync(tokenFile, "utf8"), timeoutMs: 60_000, ended: () => (app.running() ? null : "the app exited") });
    } catch (error) {
      await skipIfExited(error);
      throw error;
    }
    let view;
    try {
      view = await control.inspect();
    } catch (error) {
      await skipIfExited(error);
      throw error;
    }
    const kind = view.connection?.secretStore;
    if (kind !== "keychain") skip(`the app reports secretStore ${JSON.stringify(kind)}, not "keychain"`);
    note('secretStore is "keychain": the app wrote and deleted its throwaway credential at launch');

    // Add.
    const began = Date.now();
    let entry;
    try {
      entry = await call("daemon.add", { kind: "direct", name: "Keychain box", address: "ws://127.0.0.1:9", password: "platform-check-keychain-secret" });
    } catch (error) {
      const reason = keychainSkipReason(error);
      if (reason) skip(`daemon.add: ${reason}`);
      throw error;
    }
    entryId = entry.id;
    const addMs = Date.now() - began;
    const added = await credentialTargets(entry.id);
    if (added.length === 0) throw new Error(`daemon.add answered, but cmdkey /list shows no credential that names the entry ${entry.id}`);
    note(`added: cmdkey /list shows ${added.length} credential(s): ${added.join("; ")}; daemon.add took ${(addMs / 1000).toFixed(1)} s`);

    // Edit: cmdkey does not show a value, so this only shows that the credential is still there.
    try {
      await call("daemon.update", { id: entry.id, password: "platform-check-keychain-secret-edited" });
    } catch (error) {
      const reason = keychainSkipReason(error);
      if (reason) skip(`daemon.update: ${reason}`);
      throw error;
    }
    const edited = await credentialTargets(entry.id);
    if (edited.length !== added.length) throw new Error(`after the edit cmdkey /list shows ${edited.length} credential(s), it showed ${added.length}`);
    note("edited: the credential is still there (cmdkey shows no value, so the change itself is not shown by this check)");

    // Remove.
    const removed = await call("daemon.remove", { id: entry.id });
    if (removed.notices?.length) throw new Error(`daemon.remove reported ${JSON.stringify(removed.notices)}`);
    await waitFor("the credential to be gone", async () => ((await credentialTargets(entry.id)).length === 0 ? true : null), { timeoutMs: 10_000, intervalMs: 500 });
    note("removed: cmdkey /list shows no credential for the entry");

    const leaked = control.replies.filter((line) => line.includes("platform-check-keychain-secret"));
    if (leaked.length > 0) throw new Error(`${leaked.length} control answer(s) contain the password`);
    outcome.verdict = `yes: add, edit and remove went through without a prompt (daemon.add ${(addMs / 1000).toFixed(1)} s)`;
    outcome.lines.push(`credential targets as cmdkey /list names them: ${added.join("; ")}`);
  }).finally(async () => {
    control?.close();
    await killProcesses(run.imageName);
    // What the app did not remove (a failed or skipped run).
    for (const needle of [entryId, PROBE_ENTRY_ID]) {
      if (needle) await deleteCredentials(await credentialTargets(needle).catch(() => []));
    }
  });
  if (!passed && outcome.verdict === "not run") outcome.verdict = "undecided: the check failed for another reason (see its row)";
  run.report.fact("Windows Credential Manager on this runner, --secret-store keychain with a scratch --config-dir: unattended?", outcome.verdict, ...outcome.lines);
}
