import type { AgentStreamEvent } from "@av-pi-studio/protocol";

/**
 * Scripted tool-call trigger for the mock provider (sprint-058/task-004). Typing a `#tool ...`
 * prompt makes the mock run a shell tool call that streams ephemeral `partial: true` snapshots, so
 * the whole live-tool-output path (broadcast without `seq`, no timeline append, no history replay,
 * client live tail) is exercisable with no Pi and no credentials. Mirrors `#ui` / `#todo`
 * (`ui-script.ts`, `todo-script.ts`): a pure, cheap-prefix-checked parser, a `help` recipe, and
 * recognised-but-unknown input falling back to help rather than an ordinary echo.
 *
 * Grammar (also echoed verbatim by `#tool help`):
 *
 *   #tool shell   start row, 3 growing partial snapshots, completed row with the full output
 *   #tool empty   same, but the completed row carries an EMPTY output (terminal-authority edge)
 *   #tool help    this list
 *
 * A bare `#tool` runs the `shell` recipe; an unrecognised recipe shows help.
 */

export const TOOL_SCRIPT_RECIPES = ["shell", "empty", "help"] as const;

export type ToolScriptRecipe = (typeof TOOL_SCRIPT_RECIPES)[number];

const RECIPE_SET: ReadonlySet<string> = new Set(TOOL_SCRIPT_RECIPES);

const HELP_TEXT = `#tool script recipes:
  #tool shell   a shell tool call streaming 3 growing output snapshots, then completing
  #tool empty   the same, but the completed call carries an empty final output
  #tool help    this list`;

export function getToolScriptHelpText(): string {
  return HELP_TEXT;
}

/** Parses a `#tool ...` prompt into the recipe it names. Returns `null` when `prompt` is not a
 *  script. A bare `#tool` is the `shell` recipe; an unrecognised recipe returns `"help"`. */
export function parseToolScript(prompt: string): ToolScriptRecipe | null {
  const trimmed = prompt.trim();
  if (!/^#tool(\s|$)/i.test(trimmed)) return null;

  const rest = trimmed.slice("#tool".length).trim();
  if (rest === "") return "shell";
  return RECIPE_SET.has(rest) ? (rest as ToolScriptRecipe) : "help";
}

const SHELL_COMMAND = "npm test";
const OUTPUT_LINES = ["> running suite A", "> running suite B", "> running suite C"];

/** The `tool_call` events for a non-`help` recipe, in emission order: start row, 3 partial
 *  snapshots whose output ACCUMULATES (each contains all prior text, like bash's replace-semantics
 *  snapshots), then the terminal row. */
export function toolScriptEvents(
  recipe: Exclude<ToolScriptRecipe, "help">,
  callId: string,
): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [
    {
      kind: "tool_call",
      callId,
      status: "running",
      tool: { kind: "shell", command: SHELL_COMMAND },
    },
  ];
  for (let i = 1; i <= OUTPUT_LINES.length; i++) {
    events.push({
      kind: "tool_call",
      callId,
      status: "running",
      partial: true,
      tool: { kind: "shell", command: SHELL_COMMAND, output: OUTPUT_LINES.slice(0, i).join("\n") },
    });
  }
  events.push({
    kind: "tool_call",
    callId,
    status: "completed",
    tool: {
      kind: "shell",
      command: SHELL_COMMAND,
      output: recipe === "empty" ? "" : `${OUTPUT_LINES.join("\n")}\nall passed`,
    },
  });
  return events;
}
