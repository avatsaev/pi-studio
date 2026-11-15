import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeBackend, sampleView } from "../test-support";
import { Items } from "./Items";

function show(hideDone = false, answer?: Parameters<typeof fakeBackend>[1]) {
  const fake = fakeBackend(null, answer);
  render(<Items document={sampleView().document} hideDone={hideDone} backend={fake.backend} />);
  return fake;
}

describe("Items", () => {
  it("dispatches item.add with what was typed and clears the field once it succeeded", async () => {
    const { calls } = show();
    const field = screen.getByLabelText("New item");
    await userEvent.type(field, "bread{Enter}");
    expect(calls).toEqual([["control", "engine.execute", { command: "item.add", params: { text: "bread" } }]]);
    await waitFor(() => expect(field).toHaveProperty("value", ""));
  });

  it("keeps the text when the command fails", async () => {
    const { calls } = show(false, () => ({ ok: false, error: "bad params: `text` is empty" }));
    const field = screen.getByLabelText("New item");
    await userEvent.type(field, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(calls).toHaveLength(1);
    expect(field).toHaveProperty("value", "   ");
  });

  it("asks for the change on a click and draws only the document", async () => {
    const { calls } = show();
    const milk = screen.getByLabelText("milk");
    await userEvent.click(milk);
    expect(calls).toEqual([["control", "engine.execute", { command: "item.setDone", params: { id: 1, done: true } }]]);
    expect(milk).toHaveProperty("checked", false);
    await userEvent.click(screen.getByRole("button", { name: "Delete eggs" }));
    expect(calls[1]).toEqual(["control", "engine.execute", { command: "item.delete", params: { id: 2 } }]);
  });

  it("hides completed items when the view says so", () => {
    show(true);
    expect(screen.queryByLabelText("eggs")).toBeNull();
    expect(screen.getByLabelText("milk")).toBeTruthy();
  });
});
