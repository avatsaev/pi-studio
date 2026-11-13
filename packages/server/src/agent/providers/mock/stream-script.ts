import type { AgentStreamEvent } from "@av-pi-studio/protocol";

/**
 * Scripted stream-event trigger for the mock provider (sprint-083/task-002). The normal mock turn
 * only ever emits `turn_started` / `assistant_message` / `turn_completed`; typing a `#stream ...`
 * prompt makes the mock emit the event kinds it otherwise never produces, so the whole wire family
 * is exercisable (and fixturable) with no Pi and no credentials. Mirrors `#ui` / `#todo` / `#tool`:
 * a pure, cheap-prefix-checked parser, a `help` recipe, and recognised-but-unknown input falling
 * back to help rather than an ordinary echo.
 *
 * Grammar (also echoed verbatim by `#stream help`):
 *
 *   #stream reasoning   a `reasoning` block, then the usual echo and `turn_completed`
 *   #stream fail        `turn_failed` instead of `turn_completed` (agent status becomes `error`)
 *   #stream error       an `error` event, then `turn_failed`
 *   #stream help        this list
 *
 * A bare `#stream` shows help.
 */

export const STREAM_SCRIPT_RECIPES = ["reasoning", "fail", "error", "help"] as const;

export type StreamScriptRecipe = (typeof STREAM_SCRIPT_RECIPES)[number];

const RECIPE_SET: ReadonlySet<string> = new Set(STREAM_SCRIPT_RECIPES);

const HELP_TEXT = `#stream script recipes:
  #stream reasoning   a reasoning block, then the echo and turn_completed
  #stream fail        turn_failed instead of turn_completed (agent status becomes error)
  #stream error       an error event, then turn_failed
  #stream help        this list`;

export function getStreamScriptHelpText(): string {
  return HELP_TEXT;
}

/** Parses a `#stream ...` prompt into the recipe it names. Returns `null` when `prompt` is not a
 *  script. A bare `#stream` or an unrecognised recipe returns `"help"`. */
export function parseStreamScript(prompt: string): StreamScriptRecipe | null {
  const trimmed = prompt.trim();
  if (!/^#stream(\s|$)/i.test(trimmed)) return null;

  const rest = trimmed.slice("#stream".length).trim();
  return RECIPE_SET.has(rest) ? (rest as StreamScriptRecipe) : "help";
}

/** The events a non-`help` recipe emits after `turn_started`, in emission order. Every recipe ends
 *  on a terminal turn event so `AgentSession.run` resolves. */
export function streamScriptEvents(
  recipe: Exclude<StreamScriptRecipe, "help">,
  turnId: string,
  messageId: string,
): AgentStreamEvent[] {
  switch (recipe) {
    case "reasoning":
      return [
        { kind: "reasoning", text: "mock reasoning" },
        { kind: "reasoning", final: true },
        { kind: "assistant_message", messageId, text: "echo: #stream reasoning", final: true },
        { kind: "turn_completed", turnId },
      ];
    case "fail":
      return [{ kind: "turn_failed", turnId, error: "mock turn failure" }];
    case "error":
      return [
        { kind: "error", message: "mock stream error" },
        { kind: "turn_failed", turnId, error: "mock stream error" },
      ];
  }
}
