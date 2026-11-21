// What to look at when msedgedriver cannot attach to the app's WebView2 ("DevToolsActivePort file
// doesn't exist"). msedgedriver starts the app with a remote debugging port and a user data folder
// in the environment (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, WEBVIEW2_USER_DATA_FOLDER) and waits
// for the port file in that folder. The probes here start the app the same way without
// msedgedriver and read the browser process's command line, then ask msedgedriver directly
// (no tauri-driver) with a verbose log.

import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { launch, SECRET_STORE_ARG } from "./app-process.mjs";
import { killProcesses } from "./processes.mjs";
import { sleep, waitFor } from "./wait.mjs";
import { ready, Session } from "./webdriver.mjs";

const execFileAsync = promisify(execFile);
const DEBUG_PORT = 9333;
const DRIVER_PORT = 4446;
/** A switch with no effect on the checks: whether it reaches the browser says whether the environment's arguments do. */
const MARKER_SWITCH = "--disable-gpu";

/** The app and the WebView2 browser process (the one without `--type=`), with their command lines. */
const POWERSHELL_PROCESSES =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pistudiodesktop.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -notmatch '--type=') } | " +
  "ForEach-Object { $_.Name + ' pid ' + $_.ProcessId + ' parent ' + $_.ParentProcessId + ': ' + $_.CommandLine } | Out-String -Width 8000";
const POWERSHELL_PORT_FILES =
  "Get-ChildItem -Recurse -Force -Filter DevToolsActivePort -Path $env:LOCALAPPDATA,$env:TEMP,$env:APPDATA -ErrorAction SilentlyContinue | " +
  "ForEach-Object { $_.FullName } | Out-String -Width 8000";
const POWERSHELL_POLICIES =
  "foreach ($key in 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge','HKCU:\\SOFTWARE\\Policies\\Microsoft\\Edge','HKLM:\\SOFTWARE\\Policies\\Microsoft\\EdgeWebView','HKCU:\\SOFTWARE\\Policies\\Microsoft\\EdgeWebView') { " +
  "if (Test-Path $key) { $key; Get-ChildItem -Recurse $key -ErrorAction SilentlyContinue | Out-String -Width 8000; Get-ItemProperty $key | Out-String -Width 8000 } else { $key + ': absent' } }";

async function powershell(script) {
  try {
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], { timeout: 60_000, maxBuffer: 4_000_000 });
    return stdout.trim();
  } catch (error) {
    return `powershell failed: ${error.message}`;
  }
}

/** Ask `http://127.0.0.1:<port>/json/version` until it answers or `timeoutMs` passes. */
async function debugEndpoint(timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last = "no answer";
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
      return `answers (HTTP ${response.status})`;
    } catch (error) {
      last = error.message;
    }
    await sleep(1000);
  }
  return `no answer on ${DEBUG_PORT} within ${timeoutMs / 1000} s (${last})`;
}

/** Start the app alone with `extraEnv`, look at the browser process, end it. */
async function probe({ name, app, imageName, configDir, outDir, extraEnv }) {
  await killProcesses(imageName);
  const launched = launch(app, [`--config-dir=${configDir}`, SECRET_STORE_ARG], { ...process.env, ...extraEnv }, path.join(outDir, `webview2-probe-${name}.log`));
  try {
    const endpoint = await debugEndpoint(20_000);
    const processes = await powershell(POWERSHELL_PROCESSES);
    const portFiles = (await powershell(POWERSHELL_PORT_FILES)) || "none";
    const summary = [
      `debug port ${endpoint}`,
      `--remote-debugging-port on the browser's command line: ${processes.includes("--remote-debugging-port")}`,
      `${MARKER_SWITCH} on it: ${processes.includes(MARKER_SWITCH)}`,
      `user data folder from the environment used: ${extraEnv.WEBVIEW2_USER_DATA_FOLDER ? processes.toLowerCase().includes(extraEnv.WEBVIEW2_USER_DATA_FOLDER.toLowerCase()) : "not set"}`,
      `the app still runs: ${launched.running()}`,
    ].join("; ");
    return { summary: `${name}: ${summary}`, detail: `## ${name}\nenvironment: ${JSON.stringify(extraEnv)}\n${summary}\n\nprocesses:\n${processes}\n\nDevToolsActivePort files:\n${portFiles}\n\nthe app's output:\n${launched.log().slice(-1500) || "(empty)"}` };
  } finally {
    await killProcesses(imageName);
  }
}

/** A session asked of msedgedriver itself (no tauri-driver), with its verbose log in `outDir`. */
async function directSession({ app, imageName, configDir, outDir, nativeDriver, name, webviewOptions }) {
  await killProcesses(imageName);
  const base = `http://127.0.0.1:${DRIVER_PORT}`;
  const out = openSync(path.join(outDir, `msedgedriver-${name}.out.log`), "w");
  const driver = spawn(nativeDriver ?? "msedgedriver", [`--port=${DRIVER_PORT}`, "--verbose", `--log-path=${path.join(outDir, `msedgedriver-${name}.log`)}`], { stdio: ["ignore", out, out] });
  closeSync(out);
  let result;
  try {
    await waitFor("msedgedriver to answer /status", () => ready(base), { timeoutMs: 30_000, intervalMs: 500 });
    const capabilities = {
      capabilities: { alwaysMatch: { browserName: "webview2", "ms:edgeChromium": true, "ms:edgeOptions": { binary: app, args: [`--config-dir=${configDir}`, SECRET_STORE_ARG], webviewOptions } } },
    };
    const session = await Session.open(base, capabilities);
    const href = await session.execute("return location.href").catch((error) => `execute failed: ${error.message}`);
    result = `a session was made; the page is at ${href}`;
    await session.close().catch(() => {});
  } catch (error) {
    result = `no session: ${error.message.replaceAll(/\s+/g, " ").slice(0, 300)}`;
  } finally {
    driver.kill();
    await killProcesses(imageName);
  }
  return { summary: `msedgedriver directly, webviewOptions ${JSON.stringify(webviewOptions)}: ${result}`, detail: `## msedgedriver directly (${name})\n${result}\nverbose log: msedgedriver-${name}.log` };
}

/**
 * Run the probes. Returns one line per probe for the report; the details are written to
 * `webview2-diagnostics.txt` in `outDir`, next to each probe's log.
 */
export async function diagnoseWebView2({ app, imageName, root, outDir, nativeDriver }) {
  const scratch = (name) => {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const browserArguments = `--remote-debugging-port=${DEBUG_PORT} ${MARKER_SWITCH}`;
  const common = { app, imageName, outDir };
  const steps = [
    () => probe({ ...common, name: "arguments", configDir: scratch("diag-config-1"), extraEnv: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments } }),
    () => probe({ ...common, name: "arguments-and-folder", configDir: scratch("diag-config-2"), extraEnv: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArguments, WEBVIEW2_USER_DATA_FOLDER: scratch("diag-user-data") } }),
    () => directSession({ ...common, nativeDriver, name: "default", configDir: scratch("diag-config-3"), webviewOptions: {} }),
    () => directSession({ ...common, nativeDriver, name: "folder", configDir: scratch("diag-config-4"), webviewOptions: { userDataFolder: scratch("diag-driver-user-data") } }),
  ];
  const results = [];
  for (const step of steps) {
    results.push(await step().catch((error) => ({ summary: `a probe failed: ${error.message}`, detail: `a probe failed: ${error.stack}` })));
  }
  const policies = await powershell(POWERSHELL_POLICIES);
  writeFileSync(path.join(outDir, "webview2-diagnostics.txt"), [...results.map((r) => r.detail), `## policies\n${policies}`].join("\n\n"));
  return [...results.map((r) => r.summary), `Edge policy keys: ${policies.replaceAll(/\s+/g, " ").slice(0, 400)}`];
}
