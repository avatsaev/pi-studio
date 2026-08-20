/**
 * Clipboard write helper (file-explorer "Copy Path" actions, task quick-wins-1; the login dialog's
 * "Copy link", sprint-065). Tries the async Clipboard API first, falling back to a hidden
 * `execCommand("copy")` textarea when it's unavailable — plain-http access to a self-hosted daemon
 * over a LAN is not a secure context, so `navigator.clipboard` is `undefined` there, a real
 * deployment condition for this app, not a hypothetical.
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
  // The scratch textarea MUST live inside whatever focus scope is currently active. Every caller
  // of this helper sits inside a Radix overlay (dialog, dropdown menu) and those trap focus:
  // appended to `document.body`, the trap synchronously pulls focus back out of the textarea on
  // `focus()`, which collapses its selection — and `execCommand("copy")` then returns **`true`**
  // having copied nothing, so the caller reports success while the clipboard stays empty
  // (observed: `activeElement` back on the button, selection `""`, return value `true`).
  const previouslyFocused = document.activeElement;
  const host =
    (previouslyFocused instanceof HTMLElement
      ? previouslyFocused.closest('[role="dialog"], [role="menu"]')
      : null) ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  host.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    // Checked rather than trusted, for the reason above: a successful return value alone does not
    // mean the requested text was what got copied. `window.getSelection()` is no use here — Chrome
    // does not expose a textarea's own selection through it — so the element's selection range is
    // what gets asserted.
    const selectionIntact =
      document.activeElement === textarea &&
      textarea.selectionStart === 0 &&
      textarea.selectionEnd === textarea.value.length;
    if (!document.execCommand("copy") || !selectionIntact) {
      throw new Error('execCommand("copy") did not copy the requested text');
    }
  } finally {
    textarea.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }
}
