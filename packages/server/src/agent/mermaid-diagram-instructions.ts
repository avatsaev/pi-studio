/**
 * Agent instruction for mermaid diagram markdown rendering.
 *
 * This instruction is bound at agent spawn time (when the creating client advertised the
 * `mermaid_diagram_markdown` capability). A session that resumes after a client disconnect will
 * retain it; one created from the CLI and later opened in a capable client will not have it,
 * because the CLI client does not advertise the capability at spawn. Same accepted asymmetry as
 * `inline-image-instructions.ts`/`file-link-instructions.ts` (see
 * swe/features/mermaid-diagram-rendering.md § Known Limitations).
 */

export const MERMAID_DIAGRAM_INSTRUCTIONS = `
You can render diagrams in your output using a fenced Mermaid code block: \`\`\`mermaid ... \`\`\`.

Use it for flowcharts, sequence diagrams, state machines, entity-relationship diagrams, class
diagrams, and Gantt charts — anything better shown as a diagram than described in prose.

Only emit valid Mermaid syntax. Invalid syntax renders as an error with the raw block shown
underneath, so double-check diagram type keywords and node/edge syntax before including one.
`.trim();
