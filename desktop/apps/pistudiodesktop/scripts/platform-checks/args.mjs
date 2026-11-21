import { parseArgs } from "node:util";

export const MODES = ["macos", "windows", "rehearse-webdriver"];

export const USAGE = `usage: node scripts/platform-checks.mjs <macos|windows|rehearse-webdriver> --app <binary> [options]

  --app FILE            the built app (desktop/target/debug/pistudiodesktop[.exe])
  --out DIR             where logs, screenshots and the summary go (default platform-checks-out)

  macos:
  --cli-entry FILE      the repository's built CLI (packages/cli/dist/cli.js)
  --fake-cli FILE       desktop/crates/shell/tests/fixtures/fake-pi-studio.sh
  --shells LIST         login shells to try, comma separated (default zsh,bash)
  --quit METHOD         applescript (Command-Q, the default on macOS) or sigterm

  windows:
  --driver FILE         tauri-driver (default: found on PATH)
  --native-driver FILE  msedgedriver (default: tauri-driver finds it on PATH)

  rehearse-webdriver (Linux; the same checks against a WebKitWebDriver already listening):
  --webdriver-url URL   e.g. http://127.0.0.1:4444
`;

/** The options of a run, or a thrown Error that names what is wrong. */
export function parseOptions(argv, platform = process.platform) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      app: { type: "string" },
      out: { type: "string", default: "platform-checks-out" },
      "cli-entry": { type: "string" },
      "fake-cli": { type: "string" },
      shells: { type: "string", default: "zsh,bash" },
      quit: { type: "string" },
      driver: { type: "string", default: "tauri-driver" },
      "native-driver": { type: "string" },
      "webdriver-url": { type: "string" },
    },
  });
  const [mode] = positionals;
  if (!MODES.includes(mode) || positionals.length !== 1) throw new Error(`the mode is one of ${MODES.join(", ")}`);
  if (!values.app) throw new Error("--app is required");
  const options = {
    mode,
    app: values.app,
    out: values.out,
    cliEntry: values["cli-entry"],
    fakeCli: values["fake-cli"],
    shells: values.shells.split(",").map((s) => s.trim()).filter(Boolean),
    quit: values.quit ?? (platform === "darwin" ? "applescript" : "sigterm"),
    driver: values.driver,
    nativeDriver: values["native-driver"],
    webdriverUrl: values["webdriver-url"],
  };
  if (!["applescript", "sigterm"].includes(options.quit)) throw new Error("--quit is applescript or sigterm");
  if (mode === "macos") {
    if (!options.cliEntry || !options.fakeCli) throw new Error("macos needs --cli-entry and --fake-cli");
    const unknown = options.shells.filter((s) => s !== "zsh" && s !== "bash");
    if (unknown.length > 0 || options.shells.length === 0) throw new Error("--shells is a list of zsh and bash");
  }
  if (mode === "rehearse-webdriver" && !options.webdriverUrl) throw new Error("rehearse-webdriver needs --webdriver-url");
  return options;
}
