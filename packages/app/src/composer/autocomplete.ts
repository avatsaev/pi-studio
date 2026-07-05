// Slash-command and @file mention autocomplete.
// clean-room-scope/features/composer-ui.md § Slash-command & file-mention autocomplete

export type AutocompleteMode = "command" | "file" | "none";

export type SlashCommandOption = {
  name: string;
  description: string;
  argumentHint?: string;
  isClientCommand?: boolean;
};

export type FileOption = {
  path: string;
  kind: "file" | "directory";
  label: string;
};

export type AutocompleteOption = SlashCommandOption | FileOption;

export type ActiveToken = {
  mode: AutocompleteMode;
  token: string;
  startIndex: number;
  endIndex: number;
  isLineLead: boolean;
};

export function detectActiveToken(text: string, cursorPos: number): ActiveToken {
  const upToCursor = text.slice(0, cursorPos);
  const lastNl = upToCursor.lastIndexOf("\n");
  const lineStart = lastNl + 1;
  const lineText = upToCursor.slice(lineStart);

  // File mode: @token wins over slash
  const atMatch = /(?:^|\s)@(\S*)$/.exec(lineText);
  if (atMatch) {
    const token = atMatch[1]!;
    const startIndex = cursorPos - token.length - 1; // -1 for @
    return { mode: "file", token, startIndex, endIndex: cursorPos, isLineLead: false };
  }

  // Command mode: /token at line start or mid-text
  const slashMatch = /(?:^|\s)(\/\S*)$/.exec(lineText);
  if (slashMatch) {
    const token = slashMatch[1]!;
    const startIndex = cursorPos - token.length;
    const isLineLead = slashMatch[0]!.trimStart() === token;
    return { mode: "command", token, startIndex, endIndex: cursorPos, isLineLead };
  }

  return { mode: "none", token: "", startIndex: cursorPos, endIndex: cursorPos, isLineLead: false };
}

export function applyCommandInsertion(text: string, token: ActiveToken, option: SlashCommandOption): { text: string; cursorPos: number } {
  const insertion = `/${option.name} `;
  const next = text.slice(0, token.startIndex) + insertion + text.slice(token.endIndex);
  return { text: next, cursorPos: token.startIndex + insertion.length };
}

export function applyFileInsertion(text: string, token: ActiveToken, option: FileOption): { text: string; cursorPos: number } {
  const insertion = option.path + " ";
  // Replace from the @ character
  const start = Math.max(0, token.startIndex);
  const next = text.slice(0, start) + insertion + text.slice(token.endIndex);
  return { text: next, cursorPos: start + insertion.length };
}

// Built-in client slash commands (non-provider)
export const CLIENT_SLASH_COMMANDS: SlashCommandOption[] = [
  { name: "exit", description: "Archive the current agent", argumentHint: undefined, isClientCommand: true },
  { name: "clear", description: "Archive and start a fresh draft", argumentHint: undefined, isClientCommand: true },
];

export function filterCommands(options: readonly SlashCommandOption[], token: string): SlashCommandOption[] {
  const q = token.replace(/^\//, "").toLowerCase();
  if (!q) return options.slice();
  return options.filter((opt) => opt.name.toLowerCase().startsWith(q) || opt.description.toLowerCase().includes(q));
}

export type AutocompleteState = {
  active: boolean;
  mode: AutocompleteMode;
  options: AutocompleteOption[];
  selectedIndex: number;
  token: ActiveToken;
};

export const AUTOCOMPLETE_CLOSED: AutocompleteState = {
  active: false,
  mode: "none",
  options: [],
  selectedIndex: 0,
  token: { mode: "none", token: "", startIndex: 0, endIndex: 0, isLineLead: false },
};

export function openAutocomplete(mode: AutocompleteMode, options: AutocompleteOption[], token: ActiveToken): AutocompleteState {
  return { active: true, mode, options, selectedIndex: 0, token };
}

export function navigateAutocomplete(state: AutocompleteState, direction: "up" | "down"): AutocompleteState {
  if (!state.active || state.options.length === 0) return state;
  const delta = direction === "down" ? 1 : -1;
  const next = (state.selectedIndex + delta + state.options.length) % state.options.length;
  return { ...state, selectedIndex: next };
}
