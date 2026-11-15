// Shared by the component tests: a view like the shell sends, and a backend that records what
// the frontend asked for instead of running it.

import type { Backend, MenuItem, Reply, View } from "./lib/types";

function item(id: string, label: string, more: Partial<MenuItem> = {}): MenuItem {
  return { id, label, shortcut: null, enabled: true, reason: null, checked: null, ...more };
}

export function sampleView(): View {
  return {
    ui: { theme: "dark", hideDone: false, status: "" },
    document: {
      title: "Today",
      items: [
        { id: 1, text: "milk", done: false },
        { id: 2, text: "eggs", done: true },
      ],
      revision: 2,
      path: null,
      dirty: true,
      undo: "Add Item",
      redo: null,
    },
    menus: [
      {
        label: "Edit",
        items: [
          item("edit.undo", "Undo", { shortcut: { text: "Cmd+Z", cmd: true, ctrl: false, shift: false, alt: false, key: "z" } }),
          item("edit.redo", "Redo", {
            shortcut: { text: "Cmd+Shift+Z", cmd: true, ctrl: false, shift: true, alt: false, key: "z" },
            enabled: false,
            reason: "nothing to redo",
          }),
        ],
      },
      { label: "View", items: [item("view.hideDone", "Hide Completed", { checked: false })] },
    ],
    shellCommands: [{ id: "view.hideDone", label: "Hide Completed", checked: false }],
  };
}

export type Call = ["control", string, Record<string, unknown> | undefined] | ["invoke", string];

export function fakeBackend(view: View | null, answer: (method: string) => Reply = () => ({ ok: true, result: null })) {
  const calls: Call[] = [];
  let draw: (view: View) => void = () => {};
  const backend: Backend = {
    control: async (method, params) => {
      if (method === "ui.inspect") {
        return view ? { ok: true, result: view } : { ok: false, error: "no view" };
      }
      calls.push(["control", method, params]);
      return answer(method);
    },
    invoke: async (command) => {
      calls.push(["invoke", command]);
      return { ok: true, result: null };
    },
    onView: async (listener) => {
      draw = listener;
      return () => {};
    },
  };
  return { backend, calls, emit: (next: View) => draw(next) };
}
