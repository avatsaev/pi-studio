import type * as InquirerPrompts from "@inquirer/prompts";

import type { AuthEventLike, AuthInteractionLike, AuthPromptLike } from "./auth-runtime.js";
import type { OutputSink } from "./output.js";
import { renderQrToTerminal } from "./qr.js";

/**
 * Terminal `AuthInteraction` (features/provider-auth-cli.md § Behavior & Algorithms — terminal
 * interaction mapping table, § Error Handling). This is the entire UI adaptation layer over Pi's
 * login contract: Pi owns all provider flow logic (API-key entry, OAuth, device codes, token
 * exchange); this module only supplies `prompt`/`notify`. All prompt/notify output goes to
 * **stderr** so `--json`-style stdout stays clean for scripting.
 *
 * Interactive rendering is `@inquirer/prompts` (arrow-key selects, type-to-filter search for long
 * lists, masked password input) — lazy-imported inside `createTerminalIo()` so its module graph
 * loads only when an interactive login actually begins, never for `--api-key`, `--help`, or any
 * non-auth command.
 */

/** Rejects a pending/attempted prompt. `reason` distinguishes the two abort sources. */
export class AuthPromptAbortedError extends Error {
  readonly reason: "flow" | "prompt" | "non-tty";

  constructor(reason: "flow" | "prompt" | "non-tty") {
    super(
      reason === "flow"
        ? "Login cancelled."
        : reason === "prompt"
          ? "Prompt resolved out of band."
          : "Cannot prompt: not a TTY.",
    );
    this.name = "AuthPromptAbortedError";
    this.reason = reason;
  }
}

/** Minimal terminal I/O seam so prompt/notify rendering is testable without a real TTY. */
export interface TerminalIo {
  /** Echoed line input. */
  question(query: string, signal?: AbortSignal): Promise<string>;
  /** Masked input — the typed value is never echoed to the output stream. */
  secret(query: string, signal?: AbortSignal): Promise<string>;
  /** Interactive single-choice picker; resolves with the chosen option's `id`. */
  select(
    message: string,
    options: readonly { id: string; label: string; description?: string }[],
    signal?: AbortSignal,
  ): Promise<string>;
  isTty: boolean;
  close(): void;
}

/** Above this many options, `select()` upgrades to a type-to-filter search prompt. */
const SEARCH_THRESHOLD = 8;
/** Visible rows in select/search lists before scrolling. */
const PAGE_SIZE = 12;

/**
 * Default `TerminalIo`: `@inquirer/prompts` on `process.stdin`/`process.stderr`. Built on
 * **stderr**, not stdout — prompt chrome and typed echo must never leak onto the channel `--json`
 * scripting relies on staying clean (inquirer's `Context.output` carries every rendered byte).
 *
 * Takes the flow's own `AbortController` because inquirer traps Ctrl+C itself while a prompt is
 * live (raw mode) — a process-level `'SIGINT'` listener never fires there. Inquirer surfaces it as
 * an `ExitPromptError` rejection instead; `run()` below maps that to `controller.abort()` (so
 * `runAuthLogin`'s authoritative `controller.signal.aborted` check reports a cancellation, not a
 * failure) + `AuthPromptAbortedError("flow")`. Between prompts, `runAuthLogin`'s own
 * `process.once("SIGINT", ...)` covers the gap. Programmatic aborts flow the other way: the merged
 * per-prompt signal is threaded into inquirer's `Context.signal`, which tears the live prompt down
 * (restoring the terminal) and rejects with its own `AbortPromptError` — `raceAbort()` outraces
 * that with the correctly-tagged `AuthPromptAbortedError` either way.
 */
export function createTerminalIo(controller: AbortController): TerminalIo {
  const output = process.stderr;
  const run = async <T>(
    work: (
      p: typeof InquirerPrompts,
      ctx: { output: NodeJS.WritableStream; signal?: AbortSignal },
    ) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    try {
      // Deliberate `await import()`, not a static import: this module is loaded (via
      // auth-commands.ts → program.ts) on every CLI start, and `@inquirer/prompts`'s dep tree
      // belongs only on the interactive-login path — never on `--api-key`, `--help`, or any
      // non-auth command. Same convention as auth-runtime.ts's deferred Pi import.
      return await work(await import("@inquirer/prompts"), { output, signal });
    } catch (error) {
      if ((error as Error | null)?.name === "ExitPromptError") {
        controller.abort();
        throw new AuthPromptAbortedError("flow");
      }
      throw error;
    }
  };

  return {
    isTty: process.stdin.isTTY === true,
    question: (query, signal) => run((p, ctx) => p.input({ message: query }, ctx), signal),
    secret: (query, signal) =>
      run((p, ctx) => p.password({ message: query, mask: "*" }, ctx), signal),
    select: (message, options, signal) =>
      run((p, ctx) => {
        const choices = options.map((o) => ({
          name: o.label,
          value: o.id,
          description: o.description,
        }));
        if (choices.length <= SEARCH_THRESHOLD) {
          return p.select({ message, choices, pageSize: PAGE_SIZE, loop: false }, ctx);
        }
        // Long lists (e.g. the ~40-provider picker): type-to-filter over label and id.
        return p.search(
          {
            message,
            pageSize: PAGE_SIZE,
            source: (term) => {
              if (!term) return choices;
              const needle = term.toLowerCase();
              return choices.filter(
                (c) =>
                  c.name.toLowerCase().includes(needle) || c.value.toLowerCase().includes(needle),
              );
            },
          },
          ctx,
        );
      }, signal),
    // Each inquirer prompt attaches to stdin only for its own lifetime and restores the terminal
    // on settle (including abort via ctx.signal) — there is no persistent interface to release.
    close: () => {},
  };
}

/**
 * Build a terminal-backed `AuthInteractionLike` for `AuthRuntime.login()`. `qr` defaults to
 * `renderQrToTerminal`; overridable for tests (and so a failure never breaks the flow — QR
 * rendering always degrades to URL-only output on error).
 *
 * `notify` is serialized through a queue and `prompt` awaits it before touching the terminal: Pi
 * fires `notify({type:"auth_url"})` and `prompt(...)` back-to-back, and QR rendering is async —
 * without this ordering the prompt query lands first and the QR splats onto the same line
 * (observed live against a real OAuth flow).
 */
export function createTerminalInteraction(opts: {
  io: TerminalIo;
  sink: OutputSink;
  signal: AbortSignal;
  qr?: (text: string) => Promise<string>;
}): AuthInteractionLike {
  const { io, sink, signal, qr = renderQrToTerminal } = opts;
  let notifyQueue: Promise<void> = Promise.resolve();
  return {
    signal,
    prompt: async (p) => {
      await notifyQueue;
      return promptFor(io, sink, signal, p);
    },
    notify: (e) => {
      // notify() is synchronous per the AuthInteraction contract; rendering is async, so the queue
      // is intentionally fire-and-forget. notifyFor() already contains its own error handling for
      // QR failures — the catch is only a final safety net against an unhandled rejection.
      notifyQueue = notifyQueue.then(() => notifyFor(sink, qr, e)).catch(() => {});
    },
  };
}

/**
 * Prefilled `AuthInteractionLike` for `auth login --api-key` (task-005, headless/scripted setup —
 * CI, Dockerfiles, provisioning). A `secret` prompt resolves with `apiKey` immediately, with no
 * terminal I/O and no echo; any other prompt kind means the provider needs real interactive login
 * (e.g. OAuth device flow), which `--api-key` cannot satisfy — rejects with a clear message rather
 * than hanging or silently misbehaving. `notify` events still render (progress/errors stay
 * visible) via the same serialized `notifyFor` queue the terminal interaction uses.
 */
export function createApiKeyInteraction(opts: {
  apiKey: string;
  sink: OutputSink;
  signal: AbortSignal;
  qr?: (text: string) => Promise<string>;
}): AuthInteractionLike {
  const { apiKey, sink, signal, qr = renderQrToTerminal } = opts;
  let notifyQueue: Promise<void> = Promise.resolve();
  return {
    signal,
    async prompt(p) {
      if (p.type === "secret") return apiKey;
      throw new Error("provider requires interactive login; run without --api-key");
    },
    notify: (e) => {
      notifyQueue = notifyQueue.then(() => notifyFor(sink, qr, e)).catch(() => {});
    },
  };
}

async function promptFor(
  io: TerminalIo,
  sink: OutputSink,
  flowSignal: AbortSignal,
  p: AuthPromptLike,
): Promise<string> {
  if (!io.isTty) throw new AuthPromptAbortedError("non-tty");

  const ioSignal = mergeSignals(flowSignal, p.signal);
  try {
    if (p.type === "select") {
      return await raceAbort(io.select(p.message, p.options, ioSignal), flowSignal, p.signal);
    }
    const query = p.placeholder ? `${p.message} (${p.placeholder})` : p.message;
    const answer = p.type === "secret" ? io.secret(query, ioSignal) : io.question(query, ioSignal);
    return await raceAbort(answer, flowSignal, p.signal);
  } catch (error) {
    if (error instanceof AuthPromptAbortedError && error.reason === "prompt") {
      sink.error("(resolved in the browser — continuing)");
    }
    throw error;
  }
}

/**
 * A signal that aborts the moment either input aborts — threaded into the underlying
 * `io` call so the live prompt reliably tears down (inquirer aborts via `Context.signal`).
 * `raceAbort` below independently races the same two signals directly and always wins with the
 * correctly-tagged reason, so this merged signal's own abort "reason" is never actually observed
 * by a caller.
 */
function mergeSignals(a: AbortSignal, b: AbortSignal | undefined): AbortSignal {
  if (!b) return a;
  const controller = new AbortController();
  if (a.aborted || b.aborted) {
    controller.abort();
  } else {
    a.addEventListener("abort", () => controller.abort(), { once: true });
    b.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/**
 * Race `work` against both the flow-wide `flowSignal` and an optional per-prompt `promptSignal`,
 * rejecting with `AuthPromptAbortedError` (tagged by which signal fired) the moment either aborts.
 * `work` (an `io.question()`/`io.secret()`/`io.select()` call) is itself already wired to the
 * same signals via `mergeSignals()` above, so it settles promptly on abort rather than dangling —
 * this just races the (correctly-tagged) rejection reason ahead of whatever `work` eventually
 * settles with.
 */
async function raceAbort<T>(
  work: Promise<T>,
  flowSignal: AbortSignal,
  promptSignal: AbortSignal | undefined,
): Promise<T> {
  if (flowSignal.aborted) throw new AuthPromptAbortedError("flow");
  if (promptSignal?.aborted) throw new AuthPromptAbortedError("prompt");

  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const cleanups: Array<() => void> = [];
  const settle = (run: () => void): void => {
    for (const cleanup of cleanups) cleanup();
    run();
  };
  const onFlowAbort = (): void => settle(() => reject(new AuthPromptAbortedError("flow")));
  const onPromptAbort = (): void => settle(() => reject(new AuthPromptAbortedError("prompt")));

  flowSignal.addEventListener("abort", onFlowAbort, { once: true });
  cleanups.push(() => flowSignal.removeEventListener("abort", onFlowAbort));
  if (promptSignal) {
    promptSignal.addEventListener("abort", onPromptAbort, { once: true });
    cleanups.push(() => promptSignal.removeEventListener("abort", onPromptAbort));
  }

  work.then(
    (value) => settle(() => resolve(value)),
    (error: unknown) => settle(() => reject(error as Error)),
  );

  return promise;
}

async function notifyFor(
  sink: OutputSink,
  qr: (text: string) => Promise<string>,
  e: AuthEventLike,
): Promise<void> {
  switch (e.type) {
    case "info":
      sink.error(e.message);
      for (const link of e.links ?? []) {
        sink.error(link.label ? `  ${link.label}: ${link.url}` : `  ${link.url}`);
      }
      return;
    case "auth_url":
      if (e.instructions) sink.error(e.instructions);
      sink.error(e.url);
      await printQr(sink, qr, e.url);
      return;
    case "device_code":
      sink.error(`Code: ${e.userCode}`);
      sink.error(`Visit: ${e.verificationUri}`);
      await printQr(sink, qr, e.verificationUri);
      if (e.expiresInSeconds !== undefined) sink.error(`Expires in ${e.expiresInSeconds}s.`);
      return;
    case "progress":
      sink.error(e.message);
      return;
  }
}

async function printQr(
  sink: OutputSink,
  qr: (text: string) => Promise<string>,
  text: string,
): Promise<void> {
  try {
    const rendered = await qr(text);
    // Leading blank line: keep the QR's top row clear of any preceding text for scannability.
    sink.error("");
    sink.error(rendered);
  } catch {
    // QR rendering must never break a flow: fall back to the URL already printed above.
  }
}
