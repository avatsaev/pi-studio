// The macOS keychain check (spec `swe/features/desktop-transport-bridge.md`, Secrets criterion and
// the TODO(verify) "whether a GitHub runner can use a keychain unattended").
//
// The app is started with `--secret-store keychain` and a scratch `--config-dir` (the items'
// account starts with the hash of that path, so no item of a person's is read or written), a direct
// entry with a password is added, edited and removed through the control socket, and the item is
// looked for with `security find-generic-password` after each step. Nothing reads a secret back
// (`-w` or `-g`): the app is unsigned, so the item's access list names only the app, and `security`
// would ask the person at the keyboard, which a runner does not have. The edit is seen as a change
// of the item's modification date instead.
//
// Whether a runner can do this unattended is the result, not an assumption: when the keychain asks
// (a control call that waits for it never answers), refuses, or cannot be reached, the check is
// SKIPPED with that reason and a fact says "no". The app, its item and any item it left are removed
// in the `finally`, whatever happened.

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { KEYCHAIN_STORE_ARG, launch, waitForControlPort, waitForExit } from "./app-process.mjs";
import { KEYCHAIN_CALL_MS, KEYCHAIN_SERVICE, keychainAccount, keychainScope, keychainSkipReason, logTail, parseSecurityItem, PROBE_ENTRY_ID } from "./bridge.mjs";
import { ControlClient } from "./control-client.mjs";
import { Skip } from "./report.mjs";
import { sleep, waitFor } from "./wait.mjs";

const execFileAsync = promisify(execFile);

/** `security` itself is given this long before it is taken for waiting on a prompt. */
const SECURITY_MS = 20_000;

/**
 * Run `security` and answer `{ code, stdout, stderr, timedOut }`; a non-zero exit is an answer, not a throw.
 * `code` 44 is "the specified item could not be found".
 */
export async function security(args, { exec = execFileAsync, timeoutMs = SECURITY_MS } = {}) {
  try {
    const { stdout } = await exec("security", args, { timeout: timeoutMs });
    return { code: 0, stdout, stderr: "", timedOut: false };
  } catch (error) {
    return { code: typeof error.code === "number" ? error.code : null, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? error.message), timedOut: error.killed === true };
  }
}

/** The item of `account` as `parseSecurityItem` reads it, or `null` when there is none. Throws when `security` did not answer or failed. */
export async function findItem(account, options) {
  const answer = await security(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account], options);
  if (answer.code === 0) return parseSecurityItem(answer.stdout);
  if (answer.code === 44) return null;
  if (answer.timedOut) throw new Error(`security find-generic-password did not answer in ${SECURITY_MS / 1000} s (a prompt?)`);
  throw new Error(`security find-generic-password exited ${answer.code}: ${answer.stderr.trim().slice(0, 200)}`);
}

/**
 * The account of an item of this app that names `entryId`, from a listing of the keychain's
 * attributes (`security dump-keychain`, no secrets): the way to find an item whose scope differs from
 * the one computed here. `null` when there is none.
 */
export async function findAccountByEntry(entryId, options) {
  const answer = await security(["dump-keychain"], { ...options, timeoutMs: 60_000 });
  if (answer.code !== 0) return null;
  const matches = answer.stdout.matchAll(/"acct"<blob>="([^"]*)"/g);
  for (const [, account] of matches) if (account.includes(entryId)) return account;
  return null;
}

/** One line per tool of the machine's keychain setup, for the summary. Nothing here can prompt. */
async function keychainSetup() {
  const lines = [];
  for (const args of [["default-keychain"], ["list-keychains"]]) {
    const answer = await security(args);
    lines.push(`security ${args.join(" ")}: ${answer.code === 0 ? answer.stdout.trim().replace(/\s+/g, " ") : `exit ${answer.code} ${answer.stderr.trim()}`}`);
  }
  return lines;
}

/** The check: `keychain.macos.item`. Run when no other app of the job is running (single instance). */
export async function keychainCheck(run) {
  const configDir = run.scratch("config-keychain");
  writeFileSync(path.join(configDir, "settings.json"), JSON.stringify({ version: 1, autoStartLocalDaemon: false }));
  const tokenFile = path.join(run.scratch("control", "keychain"), "token");
  const scope = keychainScope(configDir);
  const accounts = new Set([keychainAccount(scope, PROBE_ENTRY_ID)]);
  const outcome = { verdict: "not run", lines: [] };
  const skip = (reason) => {
    outcome.verdict = `no, this runner cannot use the keychain unattended: ${reason}`;
    throw new Skip(reason);
  };
  let app = null;
  let control = null;
  const passed = await run.report.run(
    "keychain.macos.item",
    "--secret-store keychain, scratch --config-dir: a direct entry's password appears in the keychain on add, changes on edit and is gone on remove (security find-generic-password), unattended",
    async ({ note }) => {
      outcome.lines.push(...(await keychainSetup()));
      const args = ["--control", "0", "--control-token-file", tokenFile, KEYCHAIN_STORE_ARG, "--config-dir", configDir];
      app = launch(run.app, args, { ...process.env }, path.join(run.outDir, "app-keychain.log"));
      run.apps.push(app);
      const call = (command, params) => control.call("engine.execute", { command, params }, { timeoutMs: KEYCHAIN_CALL_MS });

      // The launch: with `--secret-store keychain` an app that cannot use the keychain exits, naming the option.
      try {
        const port = await waitForControlPort(app, 60_000);
        control = await ControlClient.connect({ port, token: readFileSync(tokenFile, "utf8").trim() });
      } catch (error) {
        if (!app.running()) skip(`the app exited at launch with --secret-store keychain (${logTail(app.log())})`);
        throw error;
      }
      let view;
      try {
        view = await control.inspect();
      } catch (error) {
        if (!app.running()) skip(`the app exited at launch with --secret-store keychain (${logTail(app.log())})`);
        throw error;
      }
      const kind = view.connection?.secretStore;
      if (kind !== "keychain") skip(`the app reports secretStore ${JSON.stringify(kind)}, not "keychain"`);
      note('secretStore is "keychain": the app wrote and deleted its throwaway item at launch without a prompt');

      // Add.
      const began = Date.now();
      let entry;
      try {
        entry = await call("daemon.add", { kind: "direct", name: "Keychain box", address: "ws://127.0.0.1:9", password: "platform-check-keychain-secret" });
      } catch (error) {
        const reason = keychainSkipReason(error);
        if (reason) skip(`daemon.add: ${reason}`);
        throw error;
      }
      const addMs = Date.now() - began;
      const account = keychainAccount(scope, entry.id);
      accounts.add(account);
      let item = await findItem(account);
      if (!item) {
        // The scope computed here may differ from the app's (a path form): look for the entry itself.
        const found = await findAccountByEntry(entry.id);
        if (!found) throw new Error(`daemon.add answered, but no item of ${KEYCHAIN_SERVICE} names the entry (looked for account ${account}, then in the keychain's listing)`);
        accounts.add(found);
        item = await findItem(found);
        outcome.lines.push(`the item's account is ${found}, not the computed ${account}`);
      }
      note(`added: found in ${item.service ?? "?"} as ${item.account}; daemon.add took ${(addMs / 1000).toFixed(1)} s`);
      const itemAccount = item.account ?? account;

      // Edit: the item stays, its modification date moves (one-second resolution: wait before editing).
      await sleep(1200);
      try {
        await call("daemon.update", { id: entry.id, password: "platform-check-keychain-secret-edited" });
      } catch (error) {
        const reason = keychainSkipReason(error);
        if (reason) skip(`daemon.update: ${reason}`);
        throw error;
      }
      const edited = await findItem(itemAccount);
      if (!edited) throw new Error("the item is gone after the password was edited");
      const moved = edited.modified !== item.modified;
      note(moved ? `edited: modification date ${item.modified} -> ${edited.modified}` : `edited: the item is there; its modification date did not move (${item.modified}), so the edit is not shown by this check`);
      outcome.lines.push(`modification date after the edit: ${moved ? "moved" : "did not move"} (${item.modified} -> ${edited.modified})`);

      // Remove.
      const removed = await call("daemon.remove", { id: entry.id });
      if (removed.notices?.length) throw new Error(`daemon.remove reported ${JSON.stringify(removed.notices)}`);
      await waitFor("the item to be gone", async () => (await findItem(itemAccount)) === null, { timeoutMs: 10_000, intervalMs: 500 });
      note("removed: security find-generic-password finds nothing");

      const leaked = control.replies.filter((line) => line.includes("platform-check-keychain-secret"));
      if (leaked.length > 0) throw new Error(`${leaked.length} control answer(s) contain the password`);
      outcome.verdict = `yes: add, edit and remove went through without a prompt (daemon.add ${(addMs / 1000).toFixed(1)} s)`;
    },
  ).finally(async () => {
    control?.close();
    if (app?.running()) {
      app.child.kill("SIGTERM");
      await waitForExit(app, 10_000);
    }
    // What the app did not remove (a failed or skipped run): ignore what is not there.
    for (const account of accounts) await security(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account], { timeoutMs: 15_000 });
  });
  if (!passed && outcome.verdict === "not run") outcome.verdict = "undecided: the check failed for another reason (see its row)";
  run.report.fact("macOS keychain on this runner, --secret-store keychain with a scratch --config-dir: unattended?", outcome.verdict, ...outcome.lines);
}
