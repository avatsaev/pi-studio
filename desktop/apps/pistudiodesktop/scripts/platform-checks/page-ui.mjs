// Driving the workbench's own screens through WebDriver: reading text, opening the Daemons
// screen, choosing an entry in the daemon switcher.

import { sleep, waitFor } from "./wait.mjs";

/** `innerText`: what the user reads, so a heading drawn in capitals by CSS is in capitals here. */
export const bodyText = (session) => session.execute("return document.body.innerText");

const SAVED_DAEMONS = /saved daemons/i;

/**
 * Open the switcher (the button of the connection bar that names `currentName`) and click the
 * entry named `entry`. A click that lands while a dialog is still closing is not "interactable":
 * it is tried again.
 */
export async function chooseInSwitcher(session, currentName, entry) {
  const item = await waitFor(
    `"${entry}" in the daemon switcher`,
    async () => {
      const open = await session.findByText('[role="menuitem"]', entry);
      if (open) return open;
      const trigger = await session.findByText('button[aria-haspopup="menu"]', currentName);
      if (trigger) {
        await session.click(trigger);
        await sleep(400);
      }
      return null;
    },
    { timeoutMs: 30_000, intervalMs: 300 },
  );
  await waitFor("the switcher entry to be clicked", async () => (await session.click(item), true), { timeoutMs: 10_000 });
}

/** Make the Daemons screen (a dialog) the one on show, opening it from the switcher when it is not. */
export async function showDaemonsScreen(session, currentName) {
  if (SAVED_DAEMONS.test(await bodyText(session))) return;
  await chooseInSwitcher(session, currentName, "Manage daemons");
  await waitFor("the Daemons screen", async () => SAVED_DAEMONS.test(await bodyText(session)), { timeoutMs: 10_000 });
}

/**
 * Close any dialog, so the page behind it can be clicked. The Daemons screen opens by itself
 * when the local daemon is not usable, a moment after boot answers: closing is done once no
 * dialog has shown for two seconds.
 */
export async function closeDialogs(session) {
  let quiet = 0;
  await waitFor(
    "the dialogs to close",
    async () => {
      const [close] = await session.findAll('[role="dialog"] button[aria-label="Close"]');
      if (close === undefined) {
        quiet += 1;
        return quiet >= 4;
      }
      quiet = 0;
      await session.click(close);
      return false;
    },
    { timeoutMs: 30_000, intervalMs: 500 },
  );
}

/** The text of every button of the dialog on show. */
export async function dialogButtonTexts(session) {
  return session.execute('return Array.from(document.querySelectorAll(\'[role="dialog"] button\')).map((b) => b.textContent.trim())');
}
