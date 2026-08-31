import { beforeEach, describe, expect, it } from "vitest";
import { useForkStore } from "./fork-store.js";
import type { ForkTarget } from "@pi-studio-ui/features/chat/fork-correlation.js";

function target(id: string, text = `text-${id}`): ForkTarget {
  return { entryId: id, text };
}

// A stand-in for a real DOM node — the store only stores/forwards the reference, so identity is
// all a "node" environment test needs (no jsdom dependency for this file).
const fakeElement = {} as HTMLElement;

beforeEach(() => {
  useForkStore.setState({ dialog: { status: "closed" } });
});

describe("openConfirm", () => {
  it("opens the confirm step directly with backTo null (no picker to return to)", () => {
    useForkStore.getState().openConfirm("a1", target("e1"), null);
    const { dialog } = useForkStore.getState();
    expect(dialog).toEqual({
      status: "confirm",
      agentId: "a1",
      target: target("e1"),
      pending: false,
      backTo: null,
      triggerElement: null,
    });
  });

  it("carries the caller-captured triggerElement for later focus return", () => {
    useForkStore.getState().openConfirm("a1", target("e1"), fakeElement);
    expect(useForkStore.getState().dialog).toMatchObject({ triggerElement: fakeElement });
  });
});

describe("openPicker", () => {
  it("opens the picker step with the given message list", () => {
    const messages = [target("e1"), target("e2")];
    useForkStore.getState().openPicker("a1", messages, null);
    expect(useForkStore.getState().dialog).toEqual({
      status: "picker",
      agentId: "a1",
      messages,
      triggerElement: null,
    });
  });
});

describe("selectFromPicker (two-step transition)", () => {
  it("swaps from picker to confirm, carrying the picker's list as backTo", () => {
    const messages = [target("e1"), target("e2")];
    useForkStore.getState().openPicker("a1", messages, null);
    useForkStore.getState().selectFromPicker(messages[1]!);
    expect(useForkStore.getState().dialog).toEqual({
      status: "confirm",
      agentId: "a1",
      target: messages[1],
      pending: false,
      backTo: messages,
      triggerElement: null,
    });
  });

  it("carries triggerElement through from the picker unchanged", () => {
    useForkStore.getState().openPicker("a1", [target("e1")], fakeElement);
    useForkStore.getState().selectFromPicker(target("e1"));
    expect(useForkStore.getState().dialog).toMatchObject({ triggerElement: fakeElement });
  });

  it("is a no-op when the dialog is not currently showing the picker", () => {
    useForkStore.getState().openConfirm("a1", target("e1"), null);
    const before = useForkStore.getState().dialog;
    useForkStore.getState().selectFromPicker(target("e2"));
    expect(useForkStore.getState().dialog).toEqual(before);
  });
});

describe("backToPicker", () => {
  it("returns to the exact same list without needing a second fetch", () => {
    const messages = [target("e1"), target("e2")];
    useForkStore.getState().openPicker("a1", messages, null);
    useForkStore.getState().selectFromPicker(messages[0]!);
    useForkStore.getState().backToPicker();
    expect(useForkStore.getState().dialog).toEqual({
      status: "picker",
      agentId: "a1",
      messages,
      triggerElement: null,
    });
  });

  it("is a no-op when reached directly (backTo null)", () => {
    useForkStore.getState().openConfirm("a1", target("e1"), null);
    const before = useForkStore.getState().dialog;
    useForkStore.getState().backToPicker();
    expect(useForkStore.getState().dialog).toEqual(before);
  });

  it("is a no-op outside the confirm step", () => {
    useForkStore.getState().openPicker("a1", [target("e1")], null);
    const before = useForkStore.getState().dialog;
    useForkStore.getState().backToPicker();
    expect(useForkStore.getState().dialog).toEqual(before);
  });
});

describe("setPending (single-flight guard support)", () => {
  it("flips the confirm step's pending flag", () => {
    useForkStore.getState().openConfirm("a1", target("e1"), null);
    useForkStore.getState().setPending(true);
    expect(useForkStore.getState().dialog).toMatchObject({ status: "confirm", pending: true });
  });

  it("is a no-op outside the confirm step", () => {
    useForkStore.getState().openPicker("a1", [target("e1")], null);
    const before = useForkStore.getState().dialog;
    useForkStore.getState().setPending(true);
    expect(useForkStore.getState().dialog).toEqual(before);
  });
});

describe("close", () => {
  it("resets to closed from either step", () => {
    useForkStore.getState().openPicker("a1", [target("e1")], null);
    useForkStore.getState().close();
    expect(useForkStore.getState().dialog).toEqual({ status: "closed" });
  });
});
