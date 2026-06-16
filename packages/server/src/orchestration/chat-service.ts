import { randomUUID } from "node:crypto";

import type { ChatMessage, ChatRoom, ChatStore } from "../persistence/entity-schemas.js";
import { loadChat, saveChat } from "../persistence/entity-stores.js";

/**
 * Chat rooms for agent↔agent / human↔agent coordination (features/chat-rooms.md). Backed by the
 * shared `chat/rooms.json` store = `{ rooms, messages }` (persistence/entity-stores). Room names are
 * unique case-insensitively; `@mentions` in a posted body are parsed into `mentionAgentIds` (unknown
 * mentions dropped); reads are cursor based; waits block until a new message or timeout.
 */

export type { ChatMessage, ChatRoom, ChatStore } from "../persistence/entity-schemas.js";

const MENTION_RE = /@([A-Za-z0-9_.:-]+)/g;

/** Parse `@mentions` from a body into raw mention tokens (without the leading `@`). */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) {
    if (match[1]) out.add(match[1]);
  }
  return [...out];
}

export interface ChatServiceDeps {
  home: string;
  /** Resolve a mention token → agent id (null if unknown → dropped). Defaults to identity-if-exists. */
  resolveMention?: (token: string) => string | null;
  now?: () => string;
}

interface Waiter {
  roomId: string;
  sinceCursor: number;
  resolve: (messages: ChatMessage[]) => void;
}

export class ChatService {
  private readonly now: () => string;
  private store: ChatStore = { rooms: [], messages: [] };
  private loaded = false;
  private readonly waiters = new Set<Waiter>();

  constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.store = await loadChat(this.deps.home);
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await saveChat(this.deps.home, this.store);
  }

  /** Create a room. Rejects a duplicate name (case-insensitive). */
  async createRoom(input: { name: string; purpose?: string }): Promise<ChatRoom> {
    await this.ensureLoaded();
    const name = input.name.trim();
    if (!name) throw new Error("room name required");
    if (this.store.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("duplicate_room_name");
    }
    const ts = this.now();
    const room: ChatRoom = {
      id: randomUUID(),
      name,
      purpose: input.purpose,
      createdAt: ts,
      updatedAt: ts,
    };
    this.store.rooms.push(room);
    await this.persist();
    return room;
  }

  async listRooms(): Promise<ChatRoom[]> {
    await this.ensureLoaded();
    return [...this.store.rooms];
  }

  async inspectRoom(roomId: string): Promise<{ room: ChatRoom; messages: ChatMessage[] } | null> {
    await this.ensureLoaded();
    const room = this.store.rooms.find((r) => r.id === roomId);
    if (!room) return null;
    return { room, messages: this.messagesFor(roomId) };
  }

  /** Delete a room and all its messages. */
  async deleteRoom(roomId: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.store.rooms.length;
    this.store.rooms = this.store.rooms.filter((r) => r.id !== roomId);
    if (this.store.rooms.length === before) return false;
    this.store.messages = this.store.messages.filter((m) => m.roomId !== roomId);
    await this.persist();
    return true;
  }

  /** Post a message; parses + resolves `@mentions`; bumps room.updatedAt; notifies waiters. */
  async postMessage(input: {
    roomId: string;
    authorAgentId: string;
    body: string;
    replyToMessageId?: string;
  }): Promise<ChatMessage> {
    await this.ensureLoaded();
    const room = this.store.rooms.find((r) => r.id === input.roomId);
    if (!room) throw new Error("unknown_room");

    const resolve = this.deps.resolveMention ?? ((t) => t);
    const mentionAgentIds: string[] = [];
    for (const token of parseMentions(input.body)) {
      const resolved = resolve(token);
      if (resolved) mentionAgentIds.push(resolved);
    }

    const message: ChatMessage = {
      id: randomUUID(),
      roomId: input.roomId,
      authorAgentId: input.authorAgentId,
      body: input.body,
      replyToMessageId: input.replyToMessageId,
      mentionAgentIds,
      createdAt: this.now(),
    };
    this.store.messages.push(message);
    room.updatedAt = message.createdAt;
    await this.persist();
    this.notifyWaiters(input.roomId);
    return message;
  }

  /** Read messages after `cursor` (an index into the room's message list). */
  async readMessages(
    roomId: string,
    cursor = 0,
  ): Promise<{ messages: ChatMessage[]; cursor: number }> {
    await this.ensureLoaded();
    const all = this.messagesFor(roomId);
    const start = Math.max(0, cursor);
    const messages = all.slice(start);
    return { messages, cursor: all.length };
  }

  /**
   * Return new messages after `sinceCursor` immediately if any exist; otherwise block until a new
   * message arrives or `timeoutMs` elapses (then return whatever is available, possibly empty).
   */
  async waitForMessages(
    roomId: string,
    sinceCursor: number,
    timeoutMs = 30_000,
  ): Promise<{ messages: ChatMessage[]; cursor: number }> {
    await this.ensureLoaded();
    const immediate = this.messagesFor(roomId).slice(Math.max(0, sinceCursor));
    if (immediate.length > 0) {
      return { messages: immediate, cursor: this.messagesFor(roomId).length };
    }

    return new Promise((resolve) => {
      const waiter: Waiter = {
        roomId,
        sinceCursor,
        resolve: (messages) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve({ messages, cursor: this.messagesFor(roomId).length });
        },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        resolve({ messages: [], cursor: this.messagesFor(roomId).length });
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private messagesFor(roomId: string): ChatMessage[] {
    return this.store.messages.filter((m) => m.roomId === roomId);
  }

  private notifyWaiters(roomId: string): void {
    const roomMessages = this.messagesFor(roomId);
    // Collect ready waiters first; `resolve` mutates `this.waiters`, so don't resolve mid-iteration.
    const ready: Array<{ waiter: Waiter; fresh: ChatMessage[] }> = [];
    for (const waiter of this.waiters) {
      if (waiter.roomId !== roomId) continue;
      const fresh = roomMessages.slice(Math.max(0, waiter.sinceCursor));
      if (fresh.length > 0) ready.push({ waiter, fresh });
    }
    for (const { waiter, fresh } of ready) waiter.resolve(fresh);
  }
}
