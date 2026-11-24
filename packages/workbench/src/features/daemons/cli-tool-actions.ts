/**
 * What the command-line tool block of the Daemons screen does against the host: look at the tool, install
 * it, look again. None throws: the component only sets state.
 *
 * The state is not part of the registry snapshot (the host looks at the file system and the login shell
 * when asked), so the screen reads it when it opens and after each call.
 */

import { type CliToolState, type HostDaemons } from "../../host/types.js";
import { cliToolFailureText, type CliToolCall } from "./cli-tool-presentation.js";

/** The state a call reached, or the words the person reads under the block. */
export type CliToolOutcome = { state: CliToolState } | { failure: string };

/**
 * The tool's state for the screen that just opened. A host that cannot say is as good as `unavailable`:
 * nothing is drawn, and nothing is reported (the block is an extra, not the screen's business).
 */
export async function readCliTool(daemons: HostDaemons): Promise<CliToolState> {
  try {
    return await daemons.cliTool.state();
  } catch {
    return { state: "unavailable" };
  }
}

/** `install` (which also checks again over the app's own link) or `state`. */
export async function runCliTool(daemons: HostDaemons, call: CliToolCall): Promise<CliToolOutcome> {
  try {
    return { state: await daemons.cliTool[call]() };
  } catch (error) {
    return { failure: cliToolFailureText(error) };
  }
}
