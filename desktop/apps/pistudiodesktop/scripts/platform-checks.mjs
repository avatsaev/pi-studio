#!/usr/bin/env node
// Checks of the desktop app that a machine can make on a platform this repository's developers
// do not run: macOS (WKWebView) and Windows (WebView2). Started by
// `.github/workflows/desktop-platform-checks.yml`; see `desktop/docs/platform-checks.md`.
//
//   node scripts/platform-checks.mjs macos   --app <binary> --cli-entry <cli.js> --fake-cli <script>
//   node scripts/platform-checks.mjs windows --app <binary.exe> [--driver tauri-driver] [--native-driver msedgedriver.exe]
//
// macOS has no WebDriver: the app is started the way the dock starts it and driven through its
// control socket and its files. Windows is driven through tauri-driver and msedgedriver, which
// reach the page. The run prints one line per check, writes `summary.md` and `results.json` to
// `--out` beside the app's logs and the screenshots, appends the summary to the job summary
// (`GITHUB_STEP_SUMMARY`), and exits 1 when a check failed.

import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { arch, release } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseOptions, USAGE } from "./platform-checks/args.mjs";
import { MacosRun, runMacosChecks } from "./platform-checks/macos.mjs";
import { renderSummary, Report } from "./platform-checks/report.mjs";
import { runWindowsChecks, WindowsRun } from "./platform-checks/windows.mjs";

const execFileAsync = promisify(execFile);

const HEADINGS = {
  macos: "Desktop platform checks: macOS (control socket)",
  windows: "Desktop platform checks: Windows (WebDriver)",
  "rehearse-webdriver": "Desktop platform checks: Linux rehearsal (WebDriver, not a platform result)",
};

/** A tool's version line, or why it could not be read. */
async function versionOf(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 20_000 });
    return stdout.trim().split(/\r?\n/)[0];
  } catch (error) {
    return `not available (${error.code ?? error.message})`;
  }
}

async function environmentFacts(options, report) {
  const lines = [`${process.platform} ${release()} ${arch()}`, `node ${process.version}`, `app: ${path.resolve(options.app)}`];
  if (options.mode === "macos") lines.push(`macOS ${await versionOf("sw_vers", ["-productVersion"])}`);
  if (options.mode === "windows") {
    lines.push(`tauri-driver ${await versionOf(options.driver, ["--version"])}`);
    // msedgedriver prints its version with --version (157.0.4341.46 on the first runner).
    lines.push(`msedgedriver ${await versionOf(options.nativeDriver ?? "msedgedriver", ["--version"])}`);
  }
  report.fact("Environment", ...lines);
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`platform-checks: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  const outDir = path.resolve(options.out, options.mode);
  mkdirSync(outDir, { recursive: true });
  const report = new Report((line) => console.log(line));
  await environmentFacts(options, report);

  const common = { app: path.resolve(options.app), outDir, report };
  try {
    if (options.mode === "macos") {
      const run = new MacosRun({ ...common, cliEntry: options.cliEntry, fakeCli: path.resolve(options.fakeCli), shells: options.shells, quit: options.quit });
      await runMacosChecks(run);
    } else {
      const flavor = options.mode === "windows" ? "windows" : "rehearsal";
      const run = new WindowsRun({
        ...common,
        driverBin: options.driver,
        nativeDriver: options.nativeDriver,
        driverUrl: options.webdriverUrl ?? "http://127.0.0.1:4444",
        flavor,
      });
      await runWindowsChecks(run);
    }
  } catch (error) {
    // A bug of the script itself or an environment failure: a failed check of its own.
    await report.run("run", "the run itself", async () => {
      throw error;
    });
  }

  const summary = renderSummary(HEADINGS[options.mode], report);
  writeFileSync(path.join(outDir, "summary.md"), summary);
  writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify({ mode: options.mode, results: report.results, facts: report.facts }, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(`\n${summary}`);
  process.exit(report.failed ? 1 : 0);
}

await main();
