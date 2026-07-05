import { describe, expect, it } from "vitest";
import {
  activeInputMode,
  applyCommandInsertion,
  applyFileInsertion,
  buildOptimisticMessage,
  cancelDictation,
  clearOnSent,
  CLIENT_SLASH_COMMANDS,
  clearSendError,
  completeDictation,
  CreateAgentPrefsStore,
  dequeueById,
  detectActiveToken,
  DraftStore,
  editQueuedMessage,
  enqueue,
  failSend,
  filterCommands,
  flushQueue,
  INITIAL_COMPOSER_STATE,
  INITIAL_DICTATION_STATE,
  INITIAL_VOICE_STATE,
  navigateAutocomplete,
  openAutocomplete,
  reinsertAtFront,
  resolveCreateOrContinue,
  resolveSubmitDecision,
  startDictation,
  startProcessing,
  startVoiceSession,
  toggleVoiceMute,
} from "../index.js";
import { createMemoryLayoutStorage } from "../workspace/layout-store.js";

// ─── Draft Store ────────────────────────────────────────────────────────────

describe("DraftStore", () => {
  it("starts empty and persists text + attachments", () => {
    const store = new DraftStore(createMemoryLayoutStorage());
    expect(store.load("d1").text).toBe("");
    const d = store.setText("d1", "hello");
    expect(d.text).toBe("hello");
    expect(new DraftStore(store["storage"]).load("d1").text).toBe("hello");
  });

  it("addAttachment, removeAttachment by index", () => {
    const store = new DraftStore(createMemoryLayoutStorage());
    store.addAttachment("d1", { kind: "image", storageKey: "k", mimeType: "image/png", name: "a.png" });
    const after = store.addAttachment("d1", { kind: "github_pr", number: 42, title: "Fix bug", url: "https://gh.test" });
    expect(after.attachments).toHaveLength(2);
    expect(store.removeAttachment("d1", 0).attachments).toHaveLength(1);
  });

  it("markSent clears text and attachments and sets lifecycle=sent", () => {
    const store = new DraftStore(createMemoryLayoutStorage());
    store.setText("d1", "message");
    store.markSent("d1");
    expect(store.load("d1").lifecycle).toBe("sent");
    expect(store.load("d1").text).toBe("");
  });
});

// ─── CreateAgentPrefsStore ──────────────────────────────────────────────────

describe("CreateAgentPrefsStore", () => {
  it("stores provider/model/mode/thinking and prefills defaults", () => {
    const store = new CreateAgentPrefsStore(createMemoryLayoutStorage());
    store.setProvider("proj1", "openai");
    store.setModel("proj1", "openai", "gpt-4o");
    store.setMode("proj1", "openai", "auto");
    store.setThinking("proj1", "openai", "gpt-4o", "high");
    const prefs = store.load("proj1");
    expect(prefs.provider).toBe("openai");
    const pp = store.prefillDefaults(prefs, "openai");
    expect(pp.model).toBe("gpt-4o");
    expect(pp.thinkingByModel?.["gpt-4o"]).toBe("high");
  });

  it("toggleFavoriteModel adds and removes favorite models", () => {
    const store = new CreateAgentPrefsStore(createMemoryLayoutStorage());
    store.toggleFavoriteModel("p", "openai", "gpt-4o");
    const prefs = store.load("p");
    expect(store.isFavorite(prefs, "openai", "gpt-4o")).toBe(true);
    store.toggleFavoriteModel("p", "openai", "gpt-4o");
    expect(store.isFavorite(store.load("p"), "openai", "gpt-4o")).toBe(false);
  });
});

// ─── Submit decision ────────────────────────────────────────────────────────

describe("submit decision", () => {
  it("returns noop when nothing to send", () => {
    expect(resolveSubmitDecision({ text: "", attachments: [], agentRunning: false, forceSubmit: false, canSubmit: true })).toBe("noop");
  });

  it("returns noop when canSubmit=false", () => {
    expect(resolveSubmitDecision({ text: "hi", attachments: [], agentRunning: false, forceSubmit: false, canSubmit: false })).toBe("noop");
  });

  it("queues when agent is running without force", () => {
    expect(resolveSubmitDecision({ text: "hello", attachments: [], agentRunning: true, forceSubmit: false, canSubmit: true })).toBe("queued");
  });

  it("submits when forced even while running", () => {
    expect(resolveSubmitDecision({ text: "hello", attachments: [], agentRunning: true, forceSubmit: true, canSubmit: true })).toBe("submitted");
  });

  it("submits normally when idle", () => {
    expect(resolveSubmitDecision({ text: "hello", attachments: [], agentRunning: false, forceSubmit: false, canSubmit: true })).toBe("submitted");
  });

  it("resolveCreateOrContinue prefers caller; falls back on agentId presence", () => {
    expect(resolveCreateOrContinue({ hasCaller: true, agentId: "a" })).toBe("create");
    expect(resolveCreateOrContinue({ hasCaller: false, agentId: "a" })).toBe("continue");
    expect(resolveCreateOrContinue({ hasCaller: false, agentId: undefined })).toBe("create");
  });

  it("composer state machine: startProcessing → clearOnSent / failSend", () => {
    const optimistic = buildOptimisticMessage("hi", [], "msg-1", 1000);
    const processing = startProcessing(INITIAL_COMPOSER_STATE, optimistic);
    expect(processing.processing).toBe("processing");
    expect(clearOnSent(processing).processing).toBe("idle");
    const failed = failSend(processing, "Network error");
    expect(failed.sendError?.message).toBe("Network error");
    expect(clearSendError(failed).sendError).toBeUndefined();
  });
});

// ─── Queue ──────────────────────────────────────────────────────────────────

describe("message queue", () => {
  const q = { agentId: "a1", messages: [] };
  const msg = { id: "m1", text: "queued", attachments: [] };

  it("enqueues and dequeues by id", () => {
    const q2 = enqueue(q, msg);
    expect(q2.messages).toHaveLength(1);
    const { queue: q3, removed } = dequeueById(q2, "m1");
    expect(q3.messages).toHaveLength(0);
    expect(removed?.id).toBe("m1");
  });

  it("editQueuedMessage removes from queue and returns text+attachments", () => {
    const q2 = enqueue(q, msg);
    const { queue: q3, text } = editQueuedMessage(q2, "m1");
    expect(text).toBe("queued");
    expect(q3.messages).toHaveLength(0);
  });

  it("reinsertAtFront puts message at the front on send-now failure", () => {
    const q2 = enqueue(enqueue(q, msg), { id: "m2", text: "second", attachments: [] });
    const q3 = reinsertAtFront(q2, msg);
    expect(q3.messages[0]!.id).toBe("m1");
  });

  it("flushQueue empties and returns all messages", () => {
    const { queue: q3, flushed } = flushQueue(enqueue(q, msg));
    expect(q3.messages).toHaveLength(0);
    expect(flushed).toHaveLength(1);
  });
});

// ─── Autocomplete ───────────────────────────────────────────────────────────

describe("autocomplete token detection", () => {
  it("detects slash command at line lead", () => {
    const t = detectActiveToken("/ex", 3);
    expect(t.mode).toBe("command");
    expect(t.token).toBe("/ex");
    expect(t.isLineLead).toBe(true);
  });

  it("detects file @mention", () => {
    const t = detectActiveToken("See @src/app", 12);
    expect(t.mode).toBe("file");
    expect(t.token).toBe("src/app");
  });

  it("returns none for normal text", () => {
    expect(detectActiveToken("hello world", 11).mode).toBe("none");
  });

  it("applyCommandInsertion replaces token with /name<space>", () => {
    const token = detectActiveToken("/ex", 3);
    const { text } = applyCommandInsertion("/ex", token, { name: "exit", description: "" });
    expect(text).toBe("/exit ");
  });

  it("applyFileInsertion replaces @token with file path", () => {
    const token = detectActiveToken("See @sr", 7);
    const { text } = applyFileInsertion("See @sr", token, { path: "src/app.ts", kind: "file", label: "app.ts" });
    expect(text).toContain("src/app.ts");
  });

  it("filterCommands narrows by prefix", () => {
    const opts = [...CLIENT_SLASH_COMMANDS];
    expect(filterCommands(opts, "/ex")).toHaveLength(1);
    expect(filterCommands(opts, "/").length).toBeGreaterThanOrEqual(2);
  });

  it("navigateAutocomplete wraps around", () => {
    const token = detectActiveToken("/", 1);
    let s = openAutocomplete("command", CLIENT_SLASH_COMMANDS, token);
    s = navigateAutocomplete(s, "down");
    expect(s.selectedIndex).toBe(1);
    s = navigateAutocomplete(s, "down");
    expect(s.selectedIndex).toBe(0); // wraps
  });
});

// ─── Voice / Dictation ──────────────────────────────────────────────────────

describe("voice and dictation state", () => {
  it("dictation lifecycle: idle → recording → complete", () => {
    let s = startDictation(INITIAL_DICTATION_STATE);
    expect(s.status).toBe("recording");
    s = completeDictation(s, "Hello world");
    expect(s.transcript).toBe("Hello world");
    expect(s.status).toBe("idle");
  });

  it("cancel and fail dictation", () => {
    expect(cancelDictation(startDictation(INITIAL_DICTATION_STATE)).status).toBe("canceled");
  });

  it("voice session start and mute toggle", () => {
    let v = startVoiceSession(INITIAL_VOICE_STATE);
    expect(v.phase).toBe("starting");
    v = toggleVoiceMute(v);
    expect(v.muted).toBe(true);
  });

  it("activeInputMode returns correct mode", () => {
    expect(activeInputMode(INITIAL_DICTATION_STATE, INITIAL_VOICE_STATE)).toBe("none");
    const recording = startDictation(INITIAL_DICTATION_STATE);
    expect(activeInputMode(recording, INITIAL_VOICE_STATE)).toBe("dictation");
    const voice = startVoiceSession(INITIAL_VOICE_STATE);
    expect(activeInputMode(recording, voice)).toBe("voice");
  });
});
