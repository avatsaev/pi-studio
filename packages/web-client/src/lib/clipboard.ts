/**
 * Clipboard write helper (file-explorer "Copy Path" actions, task quick-wins-1). Tries the async
 * Clipboard API first, falling back to a hidden `execCommand("copy")` textarea when it's
 * unavailable — plain-http access to a self-hosted daemon over a LAN is not a secure context, so
 * `navigator.clipboard` is `undefined` there, a real deployment condition for this app, not a
 * hypothetical.
 */

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the execCommand fallback below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error('execCommand("copy") failed');
  } finally {
    textarea.remove();
  }
}
