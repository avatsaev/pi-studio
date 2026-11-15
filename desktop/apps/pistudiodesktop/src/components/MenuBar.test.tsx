import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { sampleView } from "../test-support";
import { MenuBar } from "./MenuBar";

describe("MenuBar", () => {
  it("draws the generated menus and reports the chosen id", async () => {
    const onInvoke = vi.fn<(id: string) => void>();
    render(<MenuBar menus={sampleView().menus} mac={false} onInvoke={onInvoke} />);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const undo = screen.getByRole("menuitem", { name: /Undo/ });
    expect(undo.textContent).toContain("Ctrl+Z");
    await userEvent.click(undo);
    expect(onInvoke).toHaveBeenCalledWith("edit.undo");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a click elsewhere and on Escape", async () => {
    render(<MenuBar menus={sampleView().menus} mac={false} onInvoke={vi.fn<(id: string) => void>()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables what cannot run now and says why", async () => {
    const onInvoke = vi.fn<(id: string) => void>();
    render(<MenuBar menus={sampleView().menus} mac={false} onInvoke={onInvoke} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const redo = screen.getByRole("menuitem", { name: /Redo/ });
    expect(redo).toHaveProperty("disabled", true);
    expect(redo.getAttribute("title")).toBe("nothing to redo");
    await userEvent.click(redo);
    expect(onInvoke).not.toHaveBeenCalled();
  });

  it("shows toggles with their state", async () => {
    const menus = sampleView().menus;
    menus[1].items[0].checked = true;
    render(<MenuBar menus={menus} mac={false} onInvoke={vi.fn<(id: string) => void>()} />);
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Hide Completed/ }).getAttribute("aria-checked")).toBe("true");
  });
});
