import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeBackend, sampleView } from "./test-support";

describe("App", () => {
  it("draws the view it is sent and nothing of its own", async () => {
    const fake = fakeBackend(sampleView());
    render(<App backend={fake.backend} />);
    expect(await screen.findByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1 of 2 left · edited");
    expect(document.documentElement.dataset.theme).toBe("dark");

    const next = sampleView();
    next.ui = { theme: "light", hideDone: true, status: "bad params: `text` is empty" };
    act(() => fake.emit(next));
    expect(await screen.findByText("bad params: `text` is empty")).toBeTruthy();
    expect(screen.queryByLabelText("eggs")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("turns a shortcut into the id of its command", async () => {
    const fake = fakeBackend(sampleView());
    render(<App backend={fake.backend} />);
    await screen.findByRole("heading", { name: "Today" });
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(fake.calls).toEqual([["invoke", "edit.undo"]]);
  });

  it("says so when there is no app behind the page", async () => {
    render(<App backend={fakeBackend(null).backend} />);
    expect(await screen.findByText("no view")).toBeTruthy();
  });
});
