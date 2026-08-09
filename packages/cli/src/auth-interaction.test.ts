import { describe, expect, it } from "vitest";

import {
  AuthPromptAbortedError,
  createTerminalInteraction,
  type TerminalIo,
} from "./auth-interaction.js";
import type { AuthEventLike, AuthPromptLike } from "./auth-runtime.js";
import type { OutputSink } from "./output.js";

/**
 * Terminal `AuthInteraction` tests (features/provider-auth-cli.md § Behavior & Algorithms). Covers
 * the observable contract: all four prompt kinds, all four event kinds, both abort paths, QR
 * fallback on failure, and the stderr-only guarantee — against a fake `TerminalIo` + recording
 * `OutputSink`, never a real TTY.
 */

/**
 * Recording `OutputSink` that also exposes `waitForErr(pred)` — resolves the moment a line matching
 * `pred` is written to `error()` (or immediately if one already was). `notify()` is fire-and-forget
 * per the `AuthInteraction` contract (its QR-rendering step is async), so tests await the specific
 * write they care about instead of guessing a flush duration.
 */
function recordingSink(): {
  sink: OutputSink;
  out: string[];
  err: string[];
  waitForErr: (pred: (line: string) => boolean) => Promise<void>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const watchers: Array<{ pred: (line: string) => boolean; resolve: () => void }> = [];
  const sink: OutputSink = {
    write: (l) => out.push(l),
    error: (l) => {
      err.push(l);
      for (let i = watchers.length - 1; i >= 0; i--) {
        const watcher = watchers[i]!;
        if (watcher.pred(l)) {
          watcher.resolve();
          watchers.splice(i, 1);
        }
      }
    },
  };
  const waitForErr = (pred: (line: string) => boolean): Promise<void> => {
    if (err.some(pred)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    watchers.push({ pred, resolve });
    return promise;
  };
  return { sink, out, err, waitForErr };
}

function interaction(opts: {
  io: TerminalIo;
  sink: OutputSink;
  signal?: AbortSignal;
  qr?: (text: string) => Promise<string>;
}) {
  return createTerminalInteraction({
    io: opts.io,
    sink: opts.sink,
    signal: opts.signal ?? new AbortController().signal,
    qr: opts.qr,
  });
}

/** A never-settling promise, for io methods a test never expects to resolve. */
function pendingForever<T>(): Promise<T> {
  return Promise.withResolvers<T>().promise;
}

/**
 * Drain the microtask queue a bounded number of times. Used only where `notify()`'s async QR step
 * produces no further observable write to await a condition on (the "qr rejects, nothing else
 * happens" case below) — purely microtask-based, zero real wall-clock cost, so it doesn't carry the
 * timing-dependent flakiness a `setTimeout`-based wait would.
 */
async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    queueMicrotask(resolve);
    await promise;
  }
}

/**
 * `TerminalIo` fake. Defaults never resolve to anything meaningful and record nothing — each test
 * overrides only the method it exercises, so an unexpected call to a *different* method shows up
 * as a wrong/empty answer rather than passing silently.
 */
function fakeIo(over: Partial<TerminalIo> = {}): TerminalIo {
  return {
    isTty: true,
    question: async () => "",
    secret: async () => "",
    select: async () => "",
    close: () => {},
    ...over,
  };
}

// ─── prompt kinds ───────────────────────────────────────────────────────────────────

describe("prompt — text/secret/manual_code", () => {
  it("text resolves with the entered value via io.question", async () => {
    const { sink } = recordingSink();
    const auth = interaction({ io: fakeIo({ question: async () => "hello" }), sink });
    await expect(auth.prompt({ type: "text", message: "Enter name" })).resolves.toBe("hello");
  });

  it("secret resolves with the entered value via io.secret, never io.question", async () => {
    const questions: string[] = [];
    const secrets: string[] = [];
    const io = fakeIo({
      question: async (q) => {
        questions.push(q);
        return "wrong-channel";
      },
      secret: async (q) => {
        secrets.push(q);
        return "sk-super-secret";
      },
    });
    const { sink, out, err } = recordingSink();
    const auth = interaction({ io, sink });
    await expect(auth.prompt({ type: "secret", message: "API key" })).resolves.toBe(
      "sk-super-secret",
    );
    expect(questions).toEqual([]);
    // The message is passed through verbatim — the prompt library owns separator/cursor chrome.
    expect(secrets).toEqual(["API key"]);
    // the secret value never appears in any sink output
    expect(out.join("\n")).not.toContain("sk-super-secret");
    expect(err.join("\n")).not.toContain("sk-super-secret");
  });

  it("manual_code resolves with the entered value via io.question, placeholder rendered as a hint", async () => {
    const questions: string[] = [];
    const io = fakeIo({
      question: async (q) => {
        questions.push(q);
        return "123456";
      },
    });
    const { sink } = recordingSink();
    const auth = interaction({ io, sink });
    const p: AuthPromptLike = {
      type: "manual_code",
      message: "Enter code",
      placeholder: "6 digits",
    };
    await expect(auth.prompt(p)).resolves.toBe("123456");
    expect(questions[0]).toContain("6 digits");
  });
});

describe("prompt — select", () => {
  const options = [
    { id: "anthropic", label: "Anthropic" },
    { id: "openai", label: "OpenAI", description: "GPT models" },
  ] as const;

  it("delegates to io.select with the message and full option list, and resolves with the chosen id", async () => {
    const calls: Array<{ message: string; ids: string[]; labels: string[] }> = [];
    const io = fakeIo({
      select: async (message, opts) => {
        calls.push({
          message,
          ids: opts.map((o) => o.id),
          labels: opts.map((o) => o.label),
        });
        return "openai";
      },
    });
    const { sink } = recordingSink();
    const auth = interaction({ io, sink });
    const p: AuthPromptLike = { type: "select", message: "Pick a provider", options: [...options] };
    await expect(auth.prompt(p)).resolves.toBe("openai");
    expect(calls).toEqual([
      {
        message: "Pick a provider",
        ids: ["anthropic", "openai"],
        labels: ["Anthropic", "OpenAI"],
      },
    ]);
  });

  it("never falls back to a typed numbered list — io.question is not used for a select", async () => {
    let questionCalls = 0;
    const io = fakeIo({
      question: async () => {
        questionCalls++;
        return "1";
      },
      select: async () => "anthropic",
    });
    const { sink, err } = recordingSink();
    const auth = interaction({ io, sink });
    const p: AuthPromptLike = { type: "select", message: "Pick a provider", options: [...options] };
    await expect(auth.prompt(p)).resolves.toBe("anthropic");
    expect(questionCalls).toBe(0);
    // The picker renders itself; the interaction layer must not also print its own option list.
    expect(err.some((l) => /^\s*\d+\)/.test(l))).toBe(false);
  });

  it("propagates a rejecting picker (e.g. the prompt library's own abort) unchanged", async () => {
    const io = fakeIo({
      select: async () => {
        throw new Error("picker exploded");
      },
    });
    const { sink } = recordingSink();
    const auth = interaction({ io, sink });
    const p: AuthPromptLike = { type: "select", message: "Pick a provider", options: [...options] };
    await expect(auth.prompt(p)).rejects.toThrow(/picker exploded/);
  });
});

// ─── event kinds ────────────────────────────────────────────────────────────────────

describe("notify — event rendering", () => {
  it("info renders message and links", async () => {
    const { sink, err } = recordingSink();
    const auth = interaction({ io: fakeIo(), sink });
    const e: AuthEventLike = {
      type: "info",
      message: "Heads up",
      links: [{ url: "https://example.com", label: "Docs" }],
    };
    auth.notify(e);
    await flushMicrotasks();
    expect(err.some((l) => l.includes("Heads up"))).toBe(true);
    expect(err.some((l) => l.includes("Docs") && l.includes("https://example.com"))).toBe(true);
  });

  it("progress renders a single status line", async () => {
    const { sink, err } = recordingSink();
    const auth = interaction({ io: fakeIo(), sink });
    auth.notify({ type: "progress", message: "Exchanging token..." });
    await flushMicrotasks();
    expect(err).toContain("Exchanging token...");
  });

  it("auth_url renders instructions, url, and a QR block", async () => {
    const { sink, err, waitForErr } = recordingSink();
    const auth = interaction({ io: fakeIo(), sink, qr: async (t) => `QR(${t})` });
    auth.notify({
      type: "auth_url",
      url: "https://auth.example.com/start",
      instructions: "Open this in your browser",
    });
    await waitForErr((l) => l === "QR(https://auth.example.com/start)");
    expect(err.some((l) => l.includes("Open this in your browser"))).toBe(true);
    expect(err.some((l) => l.includes("https://auth.example.com/start"))).toBe(true);
  });

  it("device_code renders userCode, verificationUri, QR, and expiry", async () => {
    const { sink, err, waitForErr } = recordingSink();
    const auth = interaction({ io: fakeIo(), sink, qr: async (t) => `QR(${t})` });
    auth.notify({
      type: "device_code",
      userCode: "ABCD-1234",
      verificationUri: "https://example.com/device",
      expiresInSeconds: 600,
    });
    await waitForErr((l) => l.includes("600"));
    expect(err.some((l) => l.includes("ABCD-1234"))).toBe(true);
    expect(err.some((l) => l.includes("https://example.com/device"))).toBe(true);
    expect(err.some((l) => l.includes("600"))).toBe(true);
  });

  it("a throwing qr degrades to URL-only output without failing the flow", async () => {
    const { sink, err } = recordingSink();
    const auth = interaction({
      io: fakeIo(),
      sink,
      qr: async () => {
        throw new Error("no terminal support");
      },
    });
    expect(() => auth.notify({ type: "auth_url", url: "https://example.com/oauth" })).not.toThrow();
    await flushMicrotasks();
    expect(err.some((l) => l.includes("https://example.com/oauth"))).toBe(true);
    expect(err.some((l) => l.startsWith("QR("))).toBe(false);
  });
});

// ─── notify/prompt ordering ─────────────────────────────────────────────────────────

describe("notify and prompt are serialized", () => {
  it("a prompt issued while a QR is still rendering waits for it — the QR never lands mid-prompt", async () => {
    // Regression: Pi fires notify({auth_url}) then prompt() back-to-back. notify() is
    // fire-and-forget and its QR step is async, so an unserialized prompt wrote its query first
    // and the QR's first row was appended onto that same line, wrecking the code (observed live
    // against a real OAuth flow).
    const { promise: qrGate, resolve: releaseQr } = Promise.withResolvers<void>();
    const order: string[] = [];
    const io = fakeIo({
      question: async () => {
        order.push("prompt");
        return "the-code";
      },
    });
    const { sink } = recordingSink();
    const auth = interaction({
      io,
      sink,
      qr: async (t) => {
        await qrGate;
        order.push("qr");
        return `QR(${t})`;
      },
    });

    auth.notify({ type: "auth_url", url: "https://example.com/oauth" });
    const answer = auth.prompt({ type: "manual_code", message: "Paste the code" });

    await flushMicrotasks();
    expect(order).toEqual([]); // prompt has not touched the terminal: it is waiting on the QR

    releaseQr();
    await expect(answer).resolves.toBe("the-code");
    expect(order).toEqual(["qr", "prompt"]);
  });

  it("queued notifies render in call order even when a later QR resolves first", async () => {
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const pending = [...gates];
    const { sink, err, waitForErr } = recordingSink();
    const auth = interaction({
      io: fakeIo(),
      sink,
      qr: async (t) => {
        await pending.shift()!.promise;
        return `QR(${t})`;
      },
    });

    auth.notify({ type: "auth_url", url: "https://example.com/first" });
    auth.notify({ type: "auth_url", url: "https://example.com/second" });

    // Release the *second* QR first: the queue must still emit first-then-second.
    gates[1]!.resolve();
    await flushMicrotasks();
    expect(err.some((l) => l.includes("second"))).toBe(false);

    gates[0]!.resolve();
    await waitForErr((l) => l === "QR(https://example.com/second)");
    const firstQr = err.indexOf("QR(https://example.com/first)");
    const secondQr = err.indexOf("QR(https://example.com/second)");
    expect(firstQr).toBeGreaterThanOrEqual(0);
    expect(secondQr).toBeGreaterThan(firstQr);
  });
});

// ─── abort paths ────────────────────────────────────────────────────────────────────

describe("abort handling", () => {
  it("flow-wide abort rejects a pending prompt with AuthPromptAbortedError", async () => {
    const controller = new AbortController();
    const io = fakeIo({ question: () => pendingForever<string>() });
    const { sink } = recordingSink();
    const auth = interaction({ io, sink, signal: controller.signal });
    const promise = auth.prompt({ type: "text", message: "Name" });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AuthPromptAbortedError);
  });

  it("per-prompt signal abort rejects only that prompt and prints the out-of-band note", async () => {
    const promptController = new AbortController();
    const io = fakeIo({ question: () => pendingForever<string>() });
    const { sink, err } = recordingSink();
    const auth = interaction({ io, sink });
    const promise = auth.prompt({ type: "text", message: "Code", signal: promptController.signal });
    promptController.abort();
    await expect(promise).rejects.toBeInstanceOf(AuthPromptAbortedError);
    expect(err.some((l) => l.toLowerCase().includes("browser"))).toBe(true);
  });

  it("a select aborts through the same path as a text prompt", async () => {
    const controller = new AbortController();
    const io = fakeIo({ select: () => pendingForever<string>() });
    const { sink } = recordingSink();
    const auth = interaction({ io, sink, signal: controller.signal });
    const promise = auth.prompt({
      type: "select",
      message: "Pick",
      options: [{ id: "a", label: "A" }],
    });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(AuthPromptAbortedError);
  });

  it("a prompt on a non-TTY io rejects immediately", async () => {
    const io = fakeIo({ isTty: false, question: () => pendingForever<string>() });
    const { sink } = recordingSink();
    const auth = interaction({ io, sink });
    await expect(auth.prompt({ type: "text", message: "Name" })).rejects.toBeInstanceOf(
      AuthPromptAbortedError,
    );
  });
});

// ─── stderr-only guarantee ──────────────────────────────────────────────────────────

describe("stdout stays clean", () => {
  it("prompt and notify never write to the sink's write() (stdout) channel", async () => {
    const io = fakeIo({
      question: async () => "answer",
      secret: async () => "shh",
      select: async () => "picked",
    });
    const { sink, out, waitForErr } = recordingSink();
    const auth = interaction({ io, sink, qr: async (t) => `QR(${t})` });
    await auth.prompt({ type: "text", message: "Name" });
    await auth.prompt({ type: "secret", message: "Key" });
    await auth.prompt({ type: "select", message: "Pick", options: [{ id: "picked", label: "P" }] });
    auth.notify({ type: "info", message: "hi" });
    auth.notify({ type: "auth_url", url: "https://example.com" });
    await waitForErr((l) => l === "QR(https://example.com)");
    expect(out).toEqual([]);
  });
});
