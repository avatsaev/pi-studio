import { describe, expect, it, vi } from "vitest";
import { SessionSubscriptions } from "./session-subscriptions.js";
import type { Session } from "./session.js";

/** SessionSubscriptions only ever uses a Session as an opaque WeakMap key — it calls no methods
 *  on it — so an opaque token cast to the type is a faithful fake for these tests. */
function fakeSession(): Session {
  return {} as unknown as Session;
}

describe("SessionSubscriptions", () => {
  it("disposeSession calls the disposer registered via add exactly once", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    const unsub = vi.fn();
    subs.add(session, "key-a", unsub);
    subs.disposeSession(session);
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("add-ing the same key twice disposes the first subscription before registering the second", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    const firstUnsub = vi.fn();
    const secondUnsub = vi.fn();
    subs.add(session, "key-a", firstUnsub);
    subs.add(session, "key-a", secondUnsub);
    expect(firstUnsub).toHaveBeenCalledTimes(1);
    expect(secondUnsub).not.toHaveBeenCalled();

    subs.disposeSession(session);
    expect(firstUnsub).toHaveBeenCalledTimes(1); // not disposed a second time
    expect(secondUnsub).toHaveBeenCalledTimes(1);
  });

  it("remove is a no-op for an unknown key (no session, and a session with other keys)", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    expect(() => subs.remove(session, "nope")).not.toThrow();

    const unsub = vi.fn();
    subs.add(session, "key-a", unsub);
    subs.remove(session, "key-b"); // unrelated key on a session that does have subscriptions
    expect(unsub).not.toHaveBeenCalled();
  });

  it("remove disposes exactly the named key and leaves siblings untouched", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    subs.add(session, "key-a", unsubA);
    subs.add(session, "key-b", unsubB);
    subs.remove(session, "key-a");
    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(unsubB).not.toHaveBeenCalled();

    subs.disposeSession(session);
    expect(unsubA).toHaveBeenCalledTimes(1); // still just once
    expect(unsubB).toHaveBeenCalledTimes(1);
  });

  it("disposeSession is safe to call twice", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    const unsub = vi.fn();
    subs.add(session, "key-a", unsub);
    subs.disposeSession(session);
    expect(() => subs.disposeSession(session)).not.toThrow();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("a throwing disposer does not prevent its siblings from running", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const clean = vi.fn();
    subs.add(session, "key-a", throwing);
    subs.add(session, "key-b", clean);
    expect(() => subs.disposeSession(session)).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(clean).toHaveBeenCalledTimes(1);
  });

  it("a throwing disposer during add's replace-on-resubscribe still lets the new one register", () => {
    const subs = new SessionSubscriptions();
    const session = fakeSession();
    const throwingFirst = vi.fn(() => {
      throw new Error("boom");
    });
    const second = vi.fn();
    subs.add(session, "key-a", throwingFirst);
    expect(() => subs.add(session, "key-a", second)).not.toThrow();
    subs.disposeSession(session);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("subscriptions are isolated per session", () => {
    const subs = new SessionSubscriptions();
    const sessionA = fakeSession();
    const sessionB = fakeSession();
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    subs.add(sessionA, "key-a", unsubA);
    subs.add(sessionB, "key-a", unsubB);
    subs.disposeSession(sessionA);
    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(unsubB).not.toHaveBeenCalled();
  });
});
