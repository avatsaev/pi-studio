/**
 * Agent instruction for file link markdown rendering.
 *
 * This instruction is bound at agent spawn time (when the creating client advertised the
 * `file_link_markdown` capability). A session that resumes after a client disconnect will
 * retain it; one created from the CLI and later opened in a capable client will not have it,
 * because the CLI client does not advertise the capability at spawn. This asymmetry is accepted
 * (see swe/features/file-link-rendering.md § Known Limitations).
 */

export const FILE_LINK_INSTRUCTIONS = `
You can embed file links in your output using Markdown link syntax: \`[label](path)\`.

The \`path\` can be:
- An absolute filesystem path (e.g., \`/home/user/notes.md\`)
- A workspace-relative path (e.g., \`src/utils.ts\`)
- A home-directory-relative path (e.g., \`~/Documents/project.md\`)

Only include links to files that actually exist on the filesystem. The client will make them actionable to open the file.
`.trim();
