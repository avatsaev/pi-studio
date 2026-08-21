/**
 * Scripted UI-dialog trigger for the mock provider (sprint-068/task-001). Lets a browser-connected
 * client raise every `agent_ui_*` dialog state by typing a `#ui ...` prompt, so the extension-UI
 * dialog rendering shipped in this sprint can be visually signed off against a running dev daemon
 * with no real `pi` process and no real interactive extension.
 *
 * `parseUiScript` is a **pure** parser with a cheap prefix check: it returns `null` for the
 * overwhelmingly common case (an ordinary prompt, including one that merely mentions `#ui` later in
 * the text), and a list of `UiScriptStep`s to raise for a recognised `#ui ...` prompt. Wiring the
 * result into a turn — raising the dialogs, waiting for answers, echoing them as assistant text — is
 * `MockAgentSession`'s job, not this module's; this module only decides *what* to raise.
 *
 * Grammar (also echoed verbatim by `#ui help`):
 *
 *   #ui select                one dialog, two short options (Allow / Block)
 *   #ui confirm                title + message
 *   #ui input                  single-line field with a placeholder
 *   #ui editor                 multi-line field, prefilled
 *   #ui unknown                a method Pi has never defined, still answerable (Cancel only)
 *   #ui select:9               nine options — past the § 12 stacking+scroll threshold
 *   #ui select:empty           an empty `options` array
 *   #ui select:long            self-numbered options, captured verbatim from a live run
 *   #ui input:multiline        a title with a hard line break and a bracketed extension prefix
 *   #ui <method> timeout=<s>   adds a deadline in seconds (rejected for `editor` — see Notes)
 *   #ui multi <n>              raises `n` dialogs at once, none awaited individually
 *   #ui help                   no dialog — lists this grammar as assistant text
 *
 * Notes: `editor` has no `timeout` field on Pi's real wire (the visual spec's § 00 wire table lists
 * one in error — sprint-068/task-009 files the correction), so `#ui editor timeout=5` is rejected
 * (parses to `null`, falling through to an ordinary echoed turn) rather than emit a field Pi could
 * never actually send.
 */

/** One dialog to raise. `payload` field names match the visual spec's § 00 wire table exactly. */
export interface UiScriptStep {
  method: string;
  payload: Record<string, unknown>;
  expectsResponse: boolean;
  timeoutMs?: number;
  /** True: this dialog is raised and its answer is awaited before the turn can complete — the
   *  normal, single-dialog case. False: raised without individually waiting — used only by
   *  `#ui multi`, where every step is raised up front and the turn waits on all of them together. */
  await: boolean;
}

const SELECT_ALLOW_BLOCK: Record<string, unknown> = {
  title: "Allow this extension to modify /etc/hosts?",
  options: ["Allow", "Block"],
};

const CONFIRM_CLEAR_SESSION: Record<string, unknown> = {
  title: "Clear session?",
  message: "All messages will be lost. The transcript can't be recovered afterwards.",
};

const INPUT_RELEASE_TAG: Record<string, unknown> = {
  title: "Enter a release tag",
  placeholder: "v2.4.1",
};

const EDITOR_COMMIT_MESSAGE: Record<string, unknown> = {
  title: "Edit commit message before pushing",
  prefill:
    "fix: retry dns lookups with backoff\n\nAdds exponential backoff to the connectivity\ncheck skill after repeated timeouts.",
};

// Verbatim from the visual spec § 05 (unrecognised-method card) — a method Pi has never defined.
const UNKNOWN_METHOD_PAYLOAD: Record<string, unknown> = {
  title: "Select a window",
  min: 0,
  max: 240,
};

// Verbatim from § 12 "NINE OPTIONS · SCROLLS AT SIX".
const SELECT_NINE_OPTIONS: Record<string, unknown> = {
  title: "Pick a target",
  options: [
    "staging-eu",
    "staging-us",
    "prod-eu",
    "prod-us",
    "prod-apac",
    "canary-1",
    "canary-2",
    "local",
    "dry-run",
  ],
};

const SELECT_EMPTY_OPTIONS: Record<string, unknown> = {
  title: "Pick a window",
  options: [] as string[],
};

// Verbatim from § 03 "SELECT · STACKED, THE COMMON CASE" — a live capture: the extension numbered
// its own options and prefixed its own title. Never rewritten (§ 03/§ 12).
const SELECT_LONG_LABELS: Record<string, unknown> = {
  title: "[Color] Which color do you pick?",
  options: ["1. Red — Pick the color red.", "2. Blue — Pick the color blue.", "3. Type something."],
};

// Verbatim from § 03 "INPUT · HARD BREAK, BRACKETED PREFIX" — also a live capture.
const INPUT_MULTILINE: Record<string, unknown> = {
  title: "[Color] Which color do you pick?\n\nType your answer:",
};

const HELP_TEXT = `#ui script recipes:
  #ui select                one dialog, two short options (Allow / Block)
  #ui confirm                title + message
  #ui input                  single-line field with a placeholder
  #ui editor                 multi-line field, prefilled
  #ui unknown                a method Pi has never defined, still answerable (Cancel only)
  #ui select:9               nine options — past the stacking+scroll threshold
  #ui select:empty           an empty options array
  #ui select:long            self-numbered options, captured verbatim from a live run
  #ui input:multiline        a title with a hard break and a bracketed extension prefix
  #ui <method> timeout=<s>   adds a deadline in seconds (rejected for editor)
  #ui multi <n>              raises n dialogs at once, none awaited individually
  #ui help                   this list`;

export function getUiScriptHelpText(): string {
  return HELP_TEXT;
}

function buildStep(
  method: string,
  payload: Record<string, unknown>,
  timeoutMs: number | undefined,
): UiScriptStep {
  return {
    method,
    payload,
    expectsResponse: true,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    await: true,
  };
}

/** Parses a `#ui ...` prompt into the dialog(s) it describes. Returns `null` when `prompt` is not a
 *  recognised script — the overwhelmingly common case, kept a cheap prefix check. */
export function parseUiScript(prompt: string): UiScriptStep[] | null {
  const trimmed = prompt.trim();
  if (!/^#ui(\s|$)/i.test(trimmed)) return null;

  const rest = trimmed.slice(3).trim();
  if (rest === "") return null;
  if (rest === "help") return [];

  const multiMatch = /^multi\s+(\d+)$/.exec(rest);
  if (multiMatch) {
    const n = Number(multiMatch[1]);
    if (!Number.isInteger(n) || n < 1) return null;
    return Array.from({ length: n }, (_, i) => ({
      method: "select",
      payload: { title: `Question ${i + 1} of ${n}`, options: ["Allow", "Block"] },
      expectsResponse: true,
      await: false,
    }));
  }

  const tokens = rest.split(/\s+/);
  const recipe = tokens[0]!;
  const extraTokens = tokens.slice(1);
  if (extraTokens.some((t) => !/^timeout=\d+$/.test(t))) return null;
  const timeoutToken = extraTokens[0];
  const timeoutMs = timeoutToken ? Number(timeoutToken.slice("timeout=".length)) * 1000 : undefined;

  const [method, variant] = recipe.split(":");

  switch (method) {
    case "unknown":
      if (variant !== undefined || timeoutMs !== undefined) return null;
      return [buildStep("pickRange", UNKNOWN_METHOD_PAYLOAD, undefined)];

    case "editor":
      // Pi's editor has no `timeout` field on the real wire — reject rather than fabricate one.
      if (variant !== undefined || timeoutMs !== undefined) return null;
      return [buildStep("editor", EDITOR_COMMIT_MESSAGE, undefined)];

    case "select": {
      let payload = SELECT_ALLOW_BLOCK;
      if (variant === "9") payload = SELECT_NINE_OPTIONS;
      else if (variant === "empty") payload = SELECT_EMPTY_OPTIONS;
      else if (variant === "long") payload = SELECT_LONG_LABELS;
      else if (variant !== undefined) return null;
      return [buildStep("select", payload, timeoutMs)];
    }

    case "confirm":
      if (variant !== undefined) return null;
      return [buildStep("confirm", CONFIRM_CLEAR_SESSION, timeoutMs)];

    case "input": {
      let payload = INPUT_RELEASE_TAG;
      if (variant === "multiline") payload = INPUT_MULTILINE;
      else if (variant !== undefined) return null;
      return [buildStep("input", payload, timeoutMs)];
    }

    default:
      return null;
  }
}
