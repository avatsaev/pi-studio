import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { replayEvents } from "../../../timeline/reducer.js";
import type { ErrorRow as ErrorRowModel } from "../../../timeline/row-model.js";
import { ErrorRow } from "./ErrorRow.js";

/** The error row a timeline of `events` ends in, drawn the way the chat draws it. */
function drawnFailure(events: AgentStreamEvent[]): { row: ErrorRowModel; markup: string } {
  const row = replayEvents(events.map((event) => ({ event }))).rows.at(-1);
  if (row?.kind !== "error") throw new Error("the timeline does not end in an error row");
  return { row, markup: renderToStaticMarkup(createElement(ErrorRow, { row, connector: false })) };
}

describe("a failed turn", () => {
  it("shows the reason the daemon recorded, after the user's message", () => {
    const { row, markup } = drawnFailure([
      { kind: "user_message", text: "hello", messageId: "m1" },
      { kind: "turn_failed", error: "401 No API key for provider anthropic" },
    ]);
    expect(row.text).toBe("401 No API key for provider anthropic");
    expect(markup).toContain("Error");
    expect(markup).toContain("401 No API key for provider anthropic");
  });

  it("draws the reason as text, never as markup", () => {
    const { markup } = drawnFailure([{ kind: "turn_failed", error: "<b>429</b> & slow down" }]);
    expect(markup).toContain("&lt;b&gt;429&lt;/b&gt; &amp; slow down");
    expect(markup).not.toContain("<b>");
  });

  it("says the turn failed when the daemon gave no reason", () => {
    const { row, markup } = drawnFailure([{ kind: "turn_failed" }]);
    expect(row.text).toBe("turn failed");
    expect(markup).toContain("turn failed");
  });
});
