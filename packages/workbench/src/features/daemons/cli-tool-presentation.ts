/**
 * What the Daemons screen says about the `pi-studio` command-line tool, a sentence per state
 * (`swe/features/single-binary-daemon.md` § The command-line tool). Pure: the component draws what
 * `cliToolView` returns. The app never edits a shell file, so for `not_on_path` the screen shows the
 * line to add and the person adds it.
 */

import { type CliToolState } from "../../host/types.js";

/** The heading of the block, in the local daemon's settings. */
export const CLI_TOOL_HEADING = "Command-line tool";

/** The button of `absent`. */
export const CLI_TOOL_INSTALL_LABEL = "Install the command-line tool";

/** The button that looks again; the label says what the person did meanwhile. */
export const CLI_TOOL_CHECK_LABEL = "Check again";

/** The folder of the link, as the person types it. */
export const CLI_TOOL_DIR = "~/.local/bin";

/** The link, as the person types it. */
export const CLI_TOOL_LINK = `${CLI_TOOL_DIR}/pi-studio`;

/** The line for the start-up file of a POSIX shell (`~/.zshrc`, `~/.bashrc`, `~/.profile`). */
export const CLI_TOOL_PATH_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

/**
 * What a button does: `install` makes the link, and over the app's own link makes nothing and reads the
 * login shell's `PATH` again (so it checks again after the person edited a start-up file); `state` only
 * looks (what was in the way may have been removed).
 */
export type CliToolCall = "install" | "state";

export interface CliToolView {
  /** `ok`: all is well; `warn`: it is not usable yet; `plain`: an offer. */
  tone: "ok" | "warn" | "plain";
  /** One or two sentences. */
  text: string;
  /** A line to copy (`not_on_path`). */
  command?: string;
  action?: { label: string; call: CliToolCall };
}

/**
 * `null` (nothing is drawn) before the first answer and for `unavailable`: no daemon binary is installed
 * yet, or this system has no command-line tool.
 */
export function cliToolView(state: CliToolState | null): CliToolView | null {
  if (state === null) return null;
  switch (state.state) {
    case "unavailable":
      return null;
    case "absent":
      return {
        tone: "plain",
        text: `Run pi-studio from any terminal. This links ${CLI_TOOL_LINK} to the daemon this app installs, so it follows every update.`,
        action: { label: CLI_TOOL_INSTALL_LABEL, call: "install" },
      };
    case "installed":
      return {
        tone: "ok",
        text: `The command-line tool is installed: a new terminal runs pi-studio from ${CLI_TOOL_LINK}.`,
      };
    case "not_on_path":
      return {
        tone: "warn",
        text: `The command-line tool is linked at ${CLI_TOOL_LINK}, but ${CLI_TOOL_DIR} is not on your PATH. Add this line to your shell's start-up file (for example ~/.zshrc or ~/.bashrc), then open a new terminal.`,
        command: CLI_TOOL_PATH_LINE,
        action: { label: CLI_TOOL_CHECK_LABEL, call: "install" },
      };
    case "shadowed":
      return {
        tone: "warn",
        text: `The command-line tool is linked at ${CLI_TOOL_LINK}, but a terminal runs another pi-studio first: ${state.path}. Remove it, or put ${CLI_TOOL_DIR} before its folder on your PATH.`,
        action: { label: CLI_TOOL_CHECK_LABEL, call: "install" },
      };
    case "occupied":
      return {
        tone: "warn",
        text: `A file that Pi Studio did not make is at ${CLI_TOOL_LINK}, so the command-line tool is not installed. Pi Studio never replaces it: move or remove it, then check again.`,
        action: { label: CLI_TOOL_CHECK_LABEL, call: "state" },
      };
  }
}

/** The text under the block when a call rejects: the host's words, else a plain sentence. */
export function cliToolFailureText(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error ? error.message : undefined;
  return typeof message === "string" && message.trim() !== ""
    ? message
    : "The command-line tool could not be set up.";
}
