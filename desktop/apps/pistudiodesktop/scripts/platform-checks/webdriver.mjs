// A minimal W3C WebDriver client: plain HTTP + JSON (https://www.w3.org/TR/webdriver2/), so the
// scripts need no dependency. `tauri-driver` (Windows) and WebKitWebDriver (the Linux rehearsal)
// both speak it.

import { writeFileSync } from "node:fs";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

/**
 * New-session capabilities for `tauri-driver`, which turns `tauri:options` into the native
 * driver's (`ms:edgeOptions` for msedgedriver). `args` are the app's own command-line arguments.
 */
export function tauriCapabilities({ application, args }) {
  return { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application, args } } } };
}

/** New-session capabilities for WebKitWebDriver used directly (the Linux rehearsal). */
export function webkitCapabilities({ application, args }) {
  return { capabilities: { alwaysMatch: { browserName: "wry", "webkitgtk:browserOptions": { binary: application, args } } } };
}

export class WebDriverError extends Error {
  constructor(error, message, status) {
    super(`${error}: ${message}`);
    this.name = "WebDriverError";
    this.error = error;
    this.status = status;
  }
}

/** One request; resolves with the response's `value`. */
async function send(base, method, route, body, timeoutMs = 60_000) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON: reported below
  }
  if (!response.ok || json === null) {
    const value = json?.value;
    throw new WebDriverError(value?.error ?? `http ${response.status}`, value?.message ?? text.slice(0, 300), response.status);
  }
  return json.value;
}

/** Whether a WebDriver server answers `/status` at `base`. */
export async function ready(base) {
  try {
    await send(base, "GET", "/status", undefined, 3000);
    return true;
  } catch {
    return false;
  }
}

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  static async open(base, capabilities) {
    // The driver starts the app and waits for its webview before it answers.
    const value = await send(base, "POST", "/session", capabilities, 120_000);
    const session = new Session(base, value.sessionId);
    await session.#post("/timeouts", { script: 30_000, pageLoad: 30_000, implicit: 0 });
    return session;
  }

  #route(suffix) {
    return `/session/${this.id}${suffix}`;
  }

  #post(suffix, body) {
    return send(this.base, "POST", this.#route(suffix), body);
  }

  /** Run `script` in the page; `args` are its `arguments`. */
  execute(script, args = []) {
    return this.#post("/execute/sync", { script, args });
  }

  /** Run `script` in the page; it calls `arguments[arguments.length - 1]` with its answer. */
  executeAsync(script, args = []) {
    return this.#post("/execute/async", { script, args });
  }

  /**
   * Call one of the app's commands from the page, as the workbench does. Resolves with
   * `{ ok: true, value }` or `{ ok: false, error }`: a refusal is an answer, not an exception.
   */
  invoke(command, args) {
    return this.executeAsync(INVOKE_SCRIPT, [command, args ?? {}]);
  }

  async url() {
    return send(this.base, "GET", this.#route("/url"));
  }

  /** A PNG of the window, written to `file`. */
  async screenshot(file) {
    const base64 = await send(this.base, "GET", this.#route("/screenshot"));
    writeFileSync(file, Buffer.from(base64, "base64"));
  }

  /** The elements matching a CSS selector, as references. */
  async findAll(selector) {
    const found = await this.#post("/elements", { using: "css selector", value: selector });
    return found.map((element) => element[ELEMENT_KEY]);
  }

  /**
   * The first element of `selector` whose `textContent` contains `text`, as a reference, or null.
   * `textContent`, not the driver's element text: WebKitWebDriver leaves out text a stylesheet
   * clips with an ellipsis, which is how the switcher draws a long name.
   */
  async findByText(selector, text) {
    const found = await this.execute(FIND_BY_TEXT_SCRIPT, [selector, text]);
    return found ? found[ELEMENT_KEY] : null;
  }

  async click(element) {
    await this.#post(`/element/${element}/click`, {});
  }

  /** Ends the session; the driver then ends the app it started. */
  async close() {
    await send(this.base, "DELETE", `/session/${this.id}`, undefined, 30_000).catch(() => {});
  }
}

const FIND_BY_TEXT_SCRIPT = `
  return Array.from(document.querySelectorAll(arguments[0])).find((element) => element.textContent.includes(arguments[1])) || null;`;

/**
 * The script behind `invoke`. `__TAURI_INTERNALS__` is what `@tauri-apps/api` calls; the page
 * has no other way to the app. An error is a string or an Error.
 */
export const INVOKE_SCRIPT = `
  const [command, args, done] = [arguments[0], arguments[1], arguments[arguments.length - 1]];
  window.__TAURI_INTERNALS__.invoke(command, args).then(
    (value) => done({ ok: true, value }),
    (error) => done({ ok: false, error: typeof error === "string" ? error : (error && error.message) || String(error) }),
  );
`;
