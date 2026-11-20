// What to look at when msedgedriver cannot attach to the app's WebView2 ("DevToolsActivePort file
// doesn't exist"): does WebView2 honour a remote debugging port given through the environment, what
// command lines do its processes have, and where did any DevToolsActivePort file end up.

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { launch } from "./app-process.mjs";
import { killProcesses } from "./processes.mjs";
import { sleep } from "./wait.mjs";

const execFileAsync = promisify(execFile);
const PORT = 9333;

const POWERSHELL_PROCESSES =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'msedgewebview2|pistudiodesktop|msedgedriver' } | " +
  "Select-Object Name,ProcessId,ParentProcessId,CommandLine | Format-List | Out-String -Width 4000";
const POWERSHELL_FILES =
  "Get-ChildItem -Recurse -Force -Filter DevToolsActivePort -Path $env:LOCALAPPDATA,$env:TEMP,$env:APPDATA -ErrorAction SilentlyContinue | " +
  "Select-Object FullName,LastWriteTime | Format-List | Out-String -Width 4000";

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
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
      return `HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`;
    } catch (error) {
      last = error.message;
    }
    await sleep(1000);
  }
  return `nothing answered on ${PORT} within ${timeoutMs / 1000} s (${last})`;
}

/**
 * Start the app by itself with a remote debugging port in `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
 * (what msedgedriver does for a WebView2 app), look, and end it. Returns lines for the report; they
 * are also written to `webview2-diagnostics.txt` in `outDir`.
 */
export async function diagnoseWebView2({ app, imageName, configDir, outDir }) {
  const lines = [];
  const launched = launch(
    app,
    [`--config-dir=${configDir}`],
    { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    path.join(outDir, "webview2-diagnostics-app.log"),
  );
  try {
    lines.push(`debug endpoint with the argument in the environment: ${await debugEndpoint(30_000)}`);
    lines.push(`the app is still running: ${launched.running()}`);
    lines.push(`processes:\n${await powershell(POWERSHELL_PROCESSES)}`);
    lines.push(`DevToolsActivePort files:\n${(await powershell(POWERSHELL_FILES)) || "none"}`);
    lines.push(`the app's own output:\n${launched.log().slice(-1500) || "(empty)"}`);
  } finally {
    await killProcesses(imageName);
  }
  writeFileSync(path.join(outDir, "webview2-diagnostics.txt"), lines.join("\n\n"));
  return lines;
}
