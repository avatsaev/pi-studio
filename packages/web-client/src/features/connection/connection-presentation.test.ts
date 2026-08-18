import { describe, expect, it } from "vitest";
import { statusDotColor } from "@pi-studio-ui/ui/status-dot.js";
import {
  connectionBarView,
  connectionDot,
  isDialableTarget,
  shortConnectionReason,
} from "./connection-presentation.js";

const LOCAL = "ws://127.0.0.1:6767";

describe("connectionBarView", () => {
  it("collapses to a host pill and a single Disconnect action once open", () => {
    const view = connectionBarView({ status: "open", error: null, url: LOCAL });

    expect(view.kind).toBe("connected");
    expect(view.statusLabel).toBe("connected");
    expect(view.hostLabel).toBe(LOCAL);
    expect(view.showFields).toBe(false);
    expect(view.action).toEqual({ label: "Disconnect", variant: "outline", disabled: false });
  });

  it("names the dialed ws url even when the user typed a bare host:port", () => {
    const view = connectionBarView({ status: "open", error: null, url: "127.0.0.1:6767" });

    expect(view.hostLabel).toBe(LOCAL);
    expect(view.title).toBe(`${LOCAL} · connected`);
  });

  it("freezes the fields and disables the action while connecting", () => {
    const view = connectionBarView({ status: "connecting", error: null, url: LOCAL });

    expect(view.kind).toBe("connecting");
    expect(view.showFields).toBe(true);
    expect(view.fieldsFrozen).toBe(true);
    expect(view.action).toEqual({ label: "Connecting…", variant: "default", disabled: true });
  });

  it("shows editable fields and an enabled Connect when idle with a dialable url", () => {
    const view = connectionBarView({ status: "idle", error: null, url: LOCAL });

    expect(view.kind).toBe("disconnected");
    expect(view.hostLabel).toBeNull();
    expect(view.fieldsFrozen).toBe(false);
    expect(view.action).toEqual({ label: "Connect", variant: "default", disabled: false });
  });

  it("disables Connect when the url field is empty or undialable", () => {
    expect(connectionBarView({ status: "idle", error: null, url: "" }).action.disabled).toBe(true);
    expect(
      connectionBarView({ status: "closed", error: null, url: "ftp://nope" }).action.disabled,
    ).toBe(true);
  });

  it("turns a failed attempt into a Retry action labelled with the short reason", () => {
    const view = connectionBarView({
      status: "closed",
      error: "connect ECONNREFUSED 127.0.0.1:6767",
      url: LOCAL,
    });

    expect(view.kind).toBe("error");
    expect(view.statusLabel).toBe("connection refused");
    expect(view.showFields).toBe(true);
    expect(view.action).toEqual({ label: "Retry", variant: "default", disabled: false });
  });

  it("keeps the untruncated error in the tooltip", () => {
    const error = "connect ECONNREFUSED 127.0.0.1:6767";
    const view = connectionBarView({ status: "closed", error, url: LOCAL });

    expect(view.title).toBe(error);
  });

  // Regression: a browser WebSocket failure rejects with an `Event`, which the store stringifies
  // to "[object Event]". That leaked into the pill (and its tooltip) verbatim.
  it("never shows a stringified Event as the reason", () => {
    const view = connectionBarView({ status: "closed", error: "[object Event]", url: LOCAL });

    expect(view.kind).toBe("error");
    expect(view.statusLabel).toBe("connection failed");
    expect(view.title).toBe("connection failed");
  });

  it("treats an empty-string error as no error", () => {
    expect(connectionBarView({ status: "closed", error: "", url: LOCAL }).kind).toBe(
      "disconnected",
    );
  });

  it("renders closing as the connected shape with a disabled action", () => {
    const view = connectionBarView({ status: "closing", error: null, url: LOCAL });

    expect(view.kind).toBe("closing");
    expect(view.statusLabel).toBe("disconnecting…");
    expect(view.hostLabel).toBe(LOCAL);
    expect(view.showFields).toBe(false);
    expect(view.action.disabled).toBe(true);
  });

  it("prefers the live status over a stale error once reconnected", () => {
    const view = connectionBarView({ status: "open", error: "timed out", url: LOCAL });

    expect(view.kind).toBe("connected");
  });
});

function dotColor(kind: Parameters<typeof connectionDot>[0]): string | null {
  const dot = connectionDot(kind);
  return dot === null ? null : statusDotColor(dot);
}

describe("connectionDot", () => {
  it("maps each flat state onto the colour § 08 asks for", () => {
    expect(dotColor("connected")).toBe("statusSuccess");
    expect(dotColor("error")).toBe("statusDanger");
    expect(dotColor("disconnected")).toBe("foregroundMuted");
    expect(dotColor("closing")).toBe("foregroundMuted");
  });

  it("yields no dot for connecting, which renders a spinner instead", () => {
    expect(connectionDot("connecting")).toBeNull();
  });
});

describe("shortConnectionReason", () => {
  it("maps refused/timeout/auth failures onto their short reasons", () => {
    expect(shortConnectionReason("connect ECONNREFUSED 127.0.0.1:6767")).toBe("connection refused");
    expect(shortConnectionReason("Handshake timed out after 10000ms")).toBe("timed out");
    expect(shortConnectionReason("Unexpected server response: 401")).toBe("auth failed");
    expect(shortConnectionReason("unauthorized")).toBe("auth failed");
  });

  it("falls back to the first line, length-capped", () => {
    expect(shortConnectionReason("something odd broke\nstack frame\nstack frame")).toBe(
      "something odd broke",
    );

    const long = shortConnectionReason(`${"x".repeat(80)}`);
    expect(long).toHaveLength(40);
    expect(long.endsWith("…")).toBe(true);
  });

  it("never yields an empty reason", () => {
    expect(shortConnectionReason("")).toBe("connection failed");
    expect(shortConnectionReason("   \n  ")).toBe("connection failed");
  });
});

describe("isDialableTarget", () => {
  it("accepts every input form connect() actually supports", () => {
    expect(isDialableTarget(LOCAL)).toBe(true);
    expect(isDialableTarget("wss://relay.molagent.ai:6767")).toBe(true);
    expect(isDialableTarget("127.0.0.1:6767")).toBe(true);
    expect(isDialableTarget("http://localhost:6767")).toBe(true);
    expect(isDialableTarget("https://localhost:6767")).toBe(true);
  });

  it("rejects empty input and unknown schemes", () => {
    expect(isDialableTarget("")).toBe(false);
    expect(isDialableTarget("   ")).toBe(false);
    expect(isDialableTarget("ftp://localhost:6767")).toBe(false);
  });
});
