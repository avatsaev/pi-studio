// The Windows job: the app driven through WebDriver, as on Linux. `tauri-driver` starts
// `msedgedriver`, which starts the app with its WebView2 under automation; the page is then
// scripted, clicked and photographed.
//
// Native host (sprint-106/task-004): boot, the stored key, navigation, an unlisted command, the
// HTML preview probe, a second launch.
// Daemon registry (sprint-111/task-004): the local daemon is `unsupported`, switching between two
// entries, where daemons.json is.
//
// The same checks run on Linux in `rehearse-webdriver` mode against WebKitWebDriver, to try the
// script without a Windows machine; there the local daemon is `cli_missing` and the process
// checks are skipped.

// What the first runs on a runner showed (windows-latest, WebView2 157, 2026-11-20, pull request #59):
//  - `tauri:options.args` reaches msedgedriver as `ms:edgeOptions.args` and the app starts with them.
//    msedgedriver turns every entry into a browser switch, so the app is given one
//    `--config-dir=<dir>` entry. Deleting the session ends the app.
//  - A runner needs the machine policy the workflow writes (WebView2 150+ ignores the debugging
//    port from the environment when the app runs elevated); see the workflow and
//    `webview2-diagnostics.mjs`, which prints what to look at when no session can be made.
//  - WebView2 runs `execute/async` scripts that call `window.__TAURI_INTERNALS__.invoke`, shows the
//    Radix switcher and the Daemons dialog with the same attributes as WebKitGTK, runs
//    `on_navigation` for `location.href = ...` and keeps the page's script context after a refused
//    navigation.
//  - The second launch of the app exits on its own (single instance), within 15 s.
//  - The first boot took about a second; the 90 s and 120 s limits are far above that.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SECRET_STORE_ARG } from "./app-process.mjs";
import { bodyText, chooseInSwitcher, closeDialogs, dialogButtonTexts, showDaemonsScreen } from "./page-ui.mjs";
import { interpretProbe, PROBE_HTML, RUN_PROBE_SCRIPT } from "./probe.mjs";
import { countProcesses, killProcesses } from "./processes.mjs";
import { Skip } from "./report.mjs";
import { sleep, waitFor } from "./wait.mjs";
import { ready, Session, tauriCapabilities, webkitCapabilities } from "./webdriver.mjs";
import { diagnoseWebView2 } from "./webview2-diagnostics.mjs";

const KEY = "platform-check-key";
const LAYOUT_KEY = "platform-check-layout";
const APPEARANCE_KEY = "pi-studio-appearance";
// Not the default (dark): after a reload the page can only be light if the stored value was read.
const APPEARANCE = JSON.stringify({ mode: "light", settings: {} });
/** The stored key must be on disk this soon after the page set it (the app flushes after 1 s). */
const STORED_WITHIN_MS = 2000;

const DRAWN_SCRIPT = `
  const root = document.getElementById("root");
  return { children: root ? root.childElementCount : -1, text: document.body.innerText.trim().length };`;

/** What the page's `engine_command` is asked for. */
const engine = (id, params) => ({ id, ...(params === undefined ? {} : { params }) });

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** One run of the job: the driver, the scratch space, the apps it started. */
export class WindowsRun {
  /**
   * `flavor`: "windows" (tauri-driver is started here) or "rehearsal" (a WebKitWebDriver is
   * already listening at `driverUrl`; process checks are skipped).
   */
  constructor({ app, driverBin, nativeDriver, driverUrl, flavor, outDir, report }) {
    Object.assign(this, { app, driverBin, nativeDriver, driverUrl, flavor, outDir, report });
    this.root = mkdtempSync(path.join(tmpdir(), "pi-platform-checks-"));
    this.driver = null;
    this.sessions = [];
    this.imageName = path.basename(app);
  }

  get expectedLocal() {
    return this.flavor === "windows" ? "unsupported" : "cli_missing";
  }

  scratch(name) {
    const dir = path.join(this.root, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Start `tauri-driver` (which starts msedgedriver) and wait until it answers. */
  async startDriver() {
    if (this.flavor !== "windows") return;
    const args = ["--port", "4444", "--native-port", "4445", ...(this.nativeDriver ? ["--native-driver", this.nativeDriver] : [])];
    const log = openSync(path.join(this.outDir, "tauri-driver.log"), "w");
    this.driver = spawn(this.driverBin, args, { stdio: ["ignore", log, log] });
    closeSync(log);
    let startError = null;
    this.driver.once("error", (error) => {
      startError = error;
    });
    await waitFor(
      "tauri-driver to answer /status",
      async () => {
        if (startError) throw new Error(`tauri-driver did not start: ${startError.message}`);
        return ready(this.driverUrl);
      },
      { timeoutMs: 60_000, intervalMs: 500 },
    );
  }

  async stopDriver() {
    this.driver?.kill();
  }

  /** Once per run, when no session could be made on Windows: what WebView2 does without msedgedriver. */
  async diagnose() {
    if (this.flavor !== "windows" || this.diagnosed) return;
    this.diagnosed = true;
    const lines = await diagnoseWebView2({ app: this.app, imageName: this.imageName, root: this.root, outDir: this.outDir, nativeDriver: this.nativeDriver }).catch((error) => [`the diagnostics failed: ${error.message}`]);
    this.report.fact("WebView2 without msedgedriver (no session could be made)", ...lines);
  }

  /** The app in a new WebDriver session on `configDir`, once its page has booted. */
  async openApp(configDir) {
    // One `--flag=value` argument: msedgedriver turns every `args` entry into a browser switch (it
    // strips leading dashes and puts `--` back), so a separate value became `--c:\...` and the app
    // exited at once (first run on a runner, 2026-11-20).
    const spec = { application: this.app, args: [`--config-dir=${configDir}`, SECRET_STORE_ARG] };
    const capabilities = this.flavor === "windows" ? tauriCapabilities(spec) : webkitCapabilities(spec);
    let session;
    try {
      session = await Session.open(this.driverUrl, capabilities);
    } catch (error) {
      await this.diagnose();
      throw error;
    }
    this.sessions.push(session);
    // The first boot took about a second on a runner (2026-11-20).
    const boot = await waitFor("the page's boot command", async () => {
      const answer = await session.invoke("boot");
      return answer.ok ? answer.value : null;
    }, { timeoutMs: 90_000, intervalMs: 500 });
    return { session, boot };
  }

  /** End the session, wait until the app's process is gone, and end it if it is not. */
  async closeApp(session) {
    await session.close();
    if (this.flavor !== "windows") return;
    const gone = await waitFor("the app to end", async () => (await countProcesses(this.imageName)) === 0, { timeoutMs: 15_000, intervalMs: 500 }).catch(() => false);
    if (!gone) await killProcesses(this.imageName);
  }

  async cleanup() {
    for (const session of this.sessions) await session.close();
    if (this.flavor === "windows") await killProcesses(this.imageName);
    await this.stopDriver();
  }

  shot(name) {
    return path.join(this.outDir, `${name}.png`);
  }
}

// --- native host ---------------------------------------------------------------------------

/** Check 1: boot and the workbench drawn. */
async function bootCheck(run, session, boot) {
  await run.report.run("windows.boot", "the app boots and the workbench is drawn (screenshot)", async ({ note }) => {
    if (boot?.app?.platform !== "desktop") throw new Error(`boot says platform ${JSON.stringify(boot?.app?.platform)}`);
    const drawn = await waitFor("the workbench to draw", async () => {
      const state = await session.execute(DRAWN_SCRIPT);
      return state.children > 0 && state.text > 10 ? state : null;
    }, { timeoutMs: 30_000, intervalMs: 500 });
    await sleep(1000);
    await session.screenshot(run.shot("01-boot"));
    note(`app ${boot.app.version}, root has ${drawn.children} child(ren), ${drawn.text} characters of text; 01-boot.png`);
    run.report.fact("Boot", `title: ${boot.app.title}`, `version: ${boot.app.version}`, `preview kind: ${boot.preview}`, `local daemon state: ${boot.daemons?.local?.state}`);
  });
}

/** Registry 1: the local daemon is `unsupported` (Windows), the Daemons screen explains it and offers no Start. */
async function localStateCheck(run, session, boot) {
  const expected = run.expectedLocal;
  await run.report.run("registry.windows.local-unsupported", `the local entry is ${expected}, the Daemons screen explains it and has no Start`, async ({ note }) => {
    const state = boot.daemons?.local?.state;
    if (state !== expected) throw new Error(`boot says the local daemon is ${JSON.stringify(boot.daemons?.local)}, expected ${expected}`);
    await showDaemonsScreen(session, "This machine");
    const text = await bodyText(session);
    const wanted = expected === "unsupported" ? ["Not available on this system", "Running a daemon on this machine needs"] : ["The pi-studio CLI was not found"];
    const missing = wanted.filter((fragment) => !text.includes(fragment));
    if (missing.length > 0) throw new Error(`the Daemons screen does not say ${missing.map((m) => JSON.stringify(m)).join(", ")}; it says: ${text.slice(0, 400)}`);
    const buttons = await dialogButtonTexts(session);
    if (expected === "unsupported" && buttons.includes("Start")) throw new Error(`the Daemons screen has a Start button (buttons: ${buttons.join(", ")})`);
    await session.screenshot(run.shot("02-daemons-screen"));
    note(`the screen says ${wanted.map((w) => JSON.stringify(w)).join(" and ")}; buttons: ${buttons.filter(Boolean).join(", ")}; 02-daemons-screen.png`);
  });
}

/** Check 2a: a stored key set from the page is in `daemon-state/local.json` within 2 s. */
async function storedKeyCheck(run, session, configDir, value) {
  await run.report.run("windows.storage-persist", `a stored key set from the page is in daemon-state/local.json within ${STORED_WITHIN_MS / 1000} s`, async ({ note }) => {
    const file = path.join(configDir, "daemon-state", "local.json");
    const answer = await session.invoke("storage_set", { key: KEY, value });
    if (!answer.ok) throw new Error(`storage_set was refused: ${answer.error}`);
    const began = Date.now();
    const took = await waitFor(
      "the key in local.json",
      () => (readJson(file)?.keys?.[KEY] === value ? Date.now() - began : null),
      { timeoutMs: STORED_WITHIN_MS, intervalMs: 50 },
    ).catch(() => {
      throw new Error(`${file} did not hold the key within ${STORED_WITHIN_MS} ms (it holds ${JSON.stringify(readJson(file))})`);
    });
    note(`on disk after ${took} ms`);
  });
}

/** Check 3: a navigation to another origin leaves the window on the app. */
async function navigationCheck(run, session) {
  await run.report.run("windows.navigation-refused", "location.href = https://example.com from the page leaves the window on the app", async ({ note }) => {
    const before = await session.execute("return location.href");
    await session.execute('setTimeout(() => { location.href = "https://example.com"; }, 0); return null;');
    await sleep(4000);
    const after = await session.execute("return location.href");
    if (after !== before) throw new Error(`the window moved from ${before} to ${after}`);
    const alive = await session.invoke("boot");
    if (!alive.ok) throw new Error(`the page no longer answers: ${alive.error}`);
    note(`still ${before}`);
  });
}

/** Check 4: commands the page is not granted are refused. */
async function unlistedCommandCheck(run, session) {
  await run.report.run("windows.command-refused", "invoking a command the page is not granted is refused", async ({ note }) => {
    const attempts = [
      { what: "a name that is no command", command: "no_such_command", args: {} },
      { what: "a core window command (not in the capability)", command: "plugin:window|set_title", args: { label: "main", value: "platform-check" } },
      { what: "a core app command (not in the capability)", command: "plugin:app|version", args: {} },
      { what: "an engine command off the page's list", command: "engine_command", args: engine("daemon.switch", { id: "local" }) },
    ];
    const accepted = [];
    for (const { what, command, args } of attempts) {
      const answer = await session.invoke(command, args);
      if (answer.ok) accepted.push(what);
      else note(`${what}: refused (${answer.error.slice(0, 80)})`);
    }
    if (accepted.length > 0) throw new Error(`the page was allowed: ${accepted.join("; ")}`);
  });
}

/** Check 5: the HTML preview probe. The result is printed; nothing here is asserted but that the probe ran. */
async function previewProbeCheck(run, session, boot) {
  await run.report.run("windows.preview-probe", "the HTML preview probe: result printed, not asserted", async ({ note }) => {
    const mounted = await session.invoke("preview_mount", { html: PROBE_HTML });
    let findings;
    let how;
    if (mounted.ok) {
      const url = String(mounted.value?.url);
      how = `mounted at ${url.split("/").slice(0, 3).join("/")}`;
      findings = await session.executeAsync(RUN_PROBE_SCRIPT, [PROBE_HTML, url, false, 15_000]);
      await session.invoke("preview_release", { url });
    } else {
      // An inert platform refuses to mount: the page keeps a `srcdoc` frame under the window's
      // policy, whose scripts are off. That frame is what the probe runs in then.
      how = `preview_mount refused (${mounted.error.slice(0, 120)}); the probe ran in a srcdoc frame, as the page's inert fallback`;
      findings = await session.executeAsync(RUN_PROBE_SCRIPT, [PROBE_HTML, "", true, 8000]);
    }
    const { verdict, rows, leaks } = interpretProbe(findings);
    run.report.fact(
      "HTML preview probe",
      `app's preview kind: ${boot.preview}`,
      how,
      `verdict: ${verdict}${leaks.length > 0 ? ` (${leaks.join(", ")})` : ""}`,
      `origin seen by the document: ${findings?.origin ?? "n/a"}`,
      ...rows.map((row) => `${row.name}: ${row.answer}`),
    );
    note(`${how}; ${verdict}`);
  });
}

/** Check 6: a second launch leaves one process. */
async function secondLaunchCheck(run, configDir) {
  await run.report.run("windows.single-instance", "a second launch leaves one process", async ({ note }) => {
    if (run.flavor !== "windows") throw new Skip("the app runs in a container in the rehearsal, out of reach of a process count");
    const before = await countProcesses(run.imageName);
    if (before !== 1) throw new Error(`${before} ${run.imageName} processes before the second launch, expected 1`);
    const second = spawn(run.app, ["--config-dir", configDir, SECRET_STORE_ARG], { stdio: "ignore" });
    const ended = await Promise.race([new Promise((resolve) => second.once("exit", (code) => resolve(`exited with code ${code}`))), sleep(15_000).then(() => null)]);
    if (ended === null) second.kill();
    await sleep(1000);
    const after = await countProcesses(run.imageName);
    if (after !== 1) throw new Error(`${after} ${run.imageName} processes after the second launch, expected 1 (the second one ${ended ?? "was still running after 15 s"})`);
    note(`the second launch ${ended}`);
  });
}

/** Check 2b: the key is back after the app is restarted. */
async function restartCheck(run, boot, value) {
  await run.report.run("windows.storage-restart", "the stored key is back after the app is restarted", async ({ note }) => {
    const back = boot.storage?.[KEY];
    if (back !== value) throw new Error(`boot after the restart gives ${JSON.stringify(back)}, expected ${JSON.stringify(value)}`);
    note("boot() after a new launch on the same configuration directory returns the key");
  });
}

/** Everything one app session of the native-host part does, then the restart. */
async function nativeHostChecks(run) {
  const configDir = run.scratch("config-host");
  const value = `value-${Date.now()}`;
  let first;
  try {
    first = await run.openApp(configDir);
  } catch (error) {
    await run.report.run("windows.boot", "the app boots and the workbench is drawn (screenshot)", async () => {
      throw error;
    });
    run.report.skipAll(
      [
        { id: "registry.windows.local-unsupported", title: "the local entry's state and the Daemons screen" },
        { id: "windows.storage-persist", title: "a stored key set from the page is on disk within 2 s" },
        { id: "windows.navigation-refused", title: "a navigation to another origin is refused" },
        { id: "windows.command-refused", title: "invoking a command the page is not granted is refused" },
        { id: "windows.preview-probe", title: "the HTML preview probe" },
        { id: "windows.single-instance", title: "a second launch leaves one process" },
        { id: "windows.storage-restart", title: "the stored key is back after the app is restarted" },
      ],
      "the app did not start",
    );
    return;
  }
  const { session, boot } = first;
  try {
    await bootCheck(run, session, boot);
    await localStateCheck(run, session, boot);
    await storedKeyCheck(run, session, configDir, value);
    await navigationCheck(run, session);
    await unlistedCommandCheck(run, session);
    await previewProbeCheck(run, session, boot);
    await secondLaunchCheck(run, configDir);
  } finally {
    await run.closeApp(session);
  }
  try {
    const second = await run.openApp(configDir);
    try {
      await restartCheck(run, second.boot, value);
    } finally {
      await run.closeApp(second.session);
    }
  } catch (error) {
    await run.report.run("windows.storage-restart", "the stored key is back after the app is restarted", async () => {
      throw error;
    });
  }
}

// --- daemon registry -----------------------------------------------------------------------

/** The page's boot answer for the entry now current, once the page has reloaded (`marker` is gone). */
async function bootAfterReload(session, marker) {
  return waitFor(
    "the page to reload and boot",
    async () => {
      const still = await session.execute("return window.__platformCheckMarker === undefined ? null : window.__platformCheckMarker");
      if (still === marker) return null;
      const answer = await session.invoke("boot");
      return answer.ok ? answer.value : null;
    },
    { timeoutMs: 60_000, intervalMs: 500 },
  );
}

/** Wait until the entry `id`'s file holds `value` under `key`. */
function waitForEntryKey(configDir, id, key, value) {
  const file = path.join(configDir, "daemon-state", `${id}.json`);
  return waitFor(`${key} in ${id}.json`, () => readJson(file)?.keys?.[key] === value, { timeoutMs: 5000, intervalMs: 100 });
}

async function addEntry(session, name, address) {
  const answer = await session.invoke("engine_command", engine("daemon.add", { kind: "direct", name, address }));
  if (!answer.ok) throw new Error(`daemon.add ${name}: ${answer.error}`);
  return answer.value;
}

/** Page background colour: the theme as the eye sees it. */
const BACKGROUND = 'return getComputedStyle(document.body).backgroundColor';

/** Run `body`; when it throws, keep a screenshot of the window as `name`.png before rethrowing. */
async function withFailureShot(run, session, name, body) {
  try {
    await body();
  } catch (error) {
    await session.screenshot(run.shot(name)).catch(() => {});
    throw error;
  }
}

/** Registry 2: switch between two entries from the switcher; each keeps its layout, the theme is shared. */
async function switchingChecks(run) {
  const configDir = run.scratch("config-registry");
  const title = "two direct entries, switched from the switcher: each keeps its own stored layout, the theme is the same";
  let opened;
  try {
    opened = await run.openApp(configDir);
  } catch (error) {
    await run.report.run("registry.windows.switch", title, async () => {
      throw error;
    });
    return;
  }
  const { session } = opened;
  try {
    await run.report.run("registry.windows.switch", title, ({ note }) => withFailureShot(run, session, "registry-switch-failed", async () => {
      // The Daemons screen opens by itself when the local daemon is not usable; it covers the switcher.
      await closeDialogs(session);
      const [a, b] = [await addEntry(session, "Check A", "ws://127.0.0.1:1"), await addEntry(session, "Check B", "ws://127.0.0.1:2")];
      let marker = 0;
      const mark = async () => {
        marker += 1;
        await session.execute(`window.__platformCheckMarker = ${marker}; return null;`);
      };
      const switchTo = async (fromName, to) => {
        await mark();
        await chooseInSwitcher(session, fromName, to.name);
        const boot = await bootAfterReload(session, marker);
        if (boot.daemons.currentId !== to.id) throw new Error(`after choosing ${to.name} the page booted on ${boot.daemons.currentId}, expected ${to.id}`);
        return boot;
      };
      const setKeys = async (entry, layout) => {
        for (const [key, value] of [[LAYOUT_KEY, layout], [APPEARANCE_KEY, APPEARANCE]]) {
          const answer = await session.invoke("storage_set", { key, value });
          if (!answer.ok) throw new Error(`storage_set ${key}: ${answer.error}`);
        }
        await waitForEntryKey(configDir, entry.id, LAYOUT_KEY, layout);
      };

      // Local -> A: the page reloads on the entry; give A its layout and the app a theme.
      const background = async () => {
        await sleep(1500);
        return session.execute(BACKGROUND);
      };
      const before = await background();
      const bootA = await switchTo("This machine", a);
      if (bootA.storage?.[LAYOUT_KEY] !== undefined) throw new Error(`entry A starts with a stored layout: ${bootA.storage[LAYOUT_KEY]}`);
      await setKeys(a, "layout-of-A");
      await session.screenshot(run.shot("03-entry-A"));
      // A -> B: B has no layout of its own yet; the theme is the app's, so it is already there.
      const bootB = await switchTo("Check A", b);
      if (bootB.storage?.[LAYOUT_KEY] !== undefined) throw new Error(`entry B shows A's layout: ${bootB.storage[LAYOUT_KEY]}`);
      if (bootB.storage?.[APPEARANCE_KEY] !== APPEARANCE) throw new Error(`the theme did not carry over to B: ${bootB.storage?.[APPEARANCE_KEY]}`);
      const themeB = await background();
      if (themeB === before) throw new Error(`the stored light theme is not applied on B: the background is still ${before}`);
      await setKeys(b, "layout-of-B");
      await session.screenshot(run.shot("04-entry-B"));
      // B -> A: A's layout is back, B's is not shown.
      const backA = await switchTo("Check B", a);
      if (backA.storage?.[LAYOUT_KEY] !== "layout-of-A") throw new Error(`back on A the layout is ${JSON.stringify(backA.storage?.[LAYOUT_KEY])}, expected "layout-of-A"`);
      if (backA.storage?.[APPEARANCE_KEY] !== APPEARANCE) throw new Error(`the theme was lost back on A: ${backA.storage?.[APPEARANCE_KEY]}`);
      const themeA = await background();
      if (themeA !== themeB) throw new Error(`the page's background differs between B (${themeB}) and A (${themeA})`);
      note(`three switches, each reloaded the page; layouts layout-of-A / layout-of-B kept apart; the light theme (${APPEARANCE_KEY}) is shared; background ${before} -> ${themeA}`);
    }));
  } finally {
    await run.closeApp(session);
  }
  await run.report.run("registry.windows.daemons-json", "daemons.json exists in the configuration directory (location printed)", async ({ note }) => {
    const file = path.join(configDir, "daemons.json");
    const registry = readJson(file);
    if (!registry) throw new Error(`${file} does not exist`);
    const names = registry.entries.map((entry) => entry.name);
    run.report.fact("daemons.json location (the run's scratch configuration directory, set with --config-dir)", file);
    note(`${registry.entries.length} entries: ${names.join(", ")}`);
  });
}

/** Every Windows check. The driver and the app are ended whatever happened. */
export async function runWindowsChecks(run) {
  try {
    await run.startDriver();
    await nativeHostChecks(run);
    await switchingChecks(run);
  } finally {
    await run.cleanup();
  }
}
