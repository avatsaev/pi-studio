/**
 * Agent instruction for inline markdown image rendering.
 *
 * This instruction is bound at agent spawn time (when the creating client advertised the
 * `inline_image_markdown` capability). A session that resumes after a client disconnect will
 * retain it; one created from the CLI and later opened in a capable client will not have it,
 * because the CLI client does not advertise the capability at spawn. This asymmetry is accepted
 * (see clean-room-scope/features/inline-image-rendering.md § Known Limitations).
 */

export const INLINE_IMAGE_INSTRUCTIONS = `
You can embed images in your output using Markdown image syntax: \`![alt](path)\`.

The \`path\` can be:
- An absolute filesystem path (e.g., \`/home/user/screenshot.png\`)
- A workspace-relative path (e.g., \`src/diagram.svg\`)
- A home-directory-relative path (e.g., \`~/Pictures/output.jpg\`)

Only include images that actually exist on the filesystem. The client will fetch and display them inline.
`.trim();
