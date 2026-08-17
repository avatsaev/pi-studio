import { CLIENT_CAPS } from "@av-pi-studio/protocol";
import { FILE_LINK_INSTRUCTIONS } from "./file-link-instructions.js";
import { INLINE_IMAGE_INSTRUCTIONS } from "./inline-image-instructions.js";
import { MERMAID_DIAGRAM_INSTRUCTIONS } from "./mermaid-diagram-instructions.js";

/**
 * Ordered, stable list of capability-gated instruction blocks. The declared order
 * (image, then file-link, then mermaid) is the single source of composition order — call-site
 * iteration order of capabilities must never leak into output order.
 */
export const CAPABILITY_INSTRUCTIONS = [
  [CLIENT_CAPS.inline_image_markdown, INLINE_IMAGE_INSTRUCTIONS],
  [CLIENT_CAPS.file_link_markdown, FILE_LINK_INSTRUCTIONS],
  [CLIENT_CAPS.mermaid_diagram_markdown, MERMAID_DIAGRAM_INSTRUCTIONS],
] as const;

/**
 * Composes a caller-supplied prompt with zero or more capability-gated instruction blocks.
 *
 * Returns the caller prompt unchanged (including `undefined`) when no advertised capability
 * has an instruction. Otherwise joins the caller prompt (always first) and the matching
 * instruction blocks with a blank-line separator, never reordering or replacing the caller prompt.
 *
 * @param callerPrompt The original system prompt from the agent config, or `undefined`
 * @param supports A function that returns true if a given capability flag is advertised
 * @returns The composed prompt, or `undefined` if no capability-gated blocks were added
 */
export function composeSystemPrompt(
  callerPrompt: string | undefined,
  supports: (flag: string) => boolean,
): string | undefined {
  const blocks: string[] = [];

  for (const [flag, instructionText] of CAPABILITY_INSTRUCTIONS) {
    if (supports(flag)) {
      blocks.push(instructionText);
    }
  }

  if (blocks.length === 0) {
    return callerPrompt;
  }

  if (!callerPrompt) {
    return blocks.join("\n\n");
  }

  return [callerPrompt, ...blocks].join("\n\n");
}
