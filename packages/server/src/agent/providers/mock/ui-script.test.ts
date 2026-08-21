import { describe, expect, it } from "vitest";

import { getUiScriptHelpText, parseUiScript } from "./ui-script.js";

describe("parseUiScript", () => {
  it("returns null for an ordinary prompt", () => {
    expect(parseUiScript("what's the weather like")).toBeNull();
  });

  it("returns null for a prompt that merely mentions #ui later in the text", () => {
    expect(parseUiScript("please explain the #ui script grammar")).toBeNull();
  });

  it("returns null for a bare #ui with nothing after it", () => {
    expect(parseUiScript("#ui")).toBeNull();
    expect(parseUiScript("#ui   ")).toBeNull();
  });

  it("returns null for an unrecognised recipe", () => {
    expect(parseUiScript("#ui banana")).toBeNull();
  });

  it("#ui select produces a select dialog matching the wire field names", () => {
    const steps = parseUiScript("#ui select");
    expect(steps).toEqual([
      {
        method: "select",
        payload: {
          title: "Allow this extension to modify /etc/hosts?",
          options: ["Allow", "Block"],
        },
        expectsResponse: true,
        await: true,
      },
    ]);
  });

  it("#ui confirm produces a title+message confirm dialog", () => {
    const steps = parseUiScript("#ui confirm");
    expect(steps).toHaveLength(1);
    expect(steps![0]).toMatchObject({ method: "confirm", expectsResponse: true, await: true });
    expect(steps![0]!.payload).toEqual({
      title: "Clear session?",
      message: "All messages will be lost. The transcript can't be recovered afterwards.",
    });
  });

  it("#ui notify produces a transient (expectsResponse: false) info-level request", () => {
    const steps = parseUiScript("#ui notify");
    expect(steps).toEqual([
      {
        method: "notify",
        payload: { message: "Sync complete." },
        expectsResponse: false,
        await: true,
      },
    ]);
  });

  it("#ui notify:warning and #ui notify:error select the warning/error payloads", () => {
    expect(parseUiScript("#ui notify:warning")![0]!.payload).toEqual({
      message: "Rate limit approaching — 80% of quota used.",
      level: "warning",
    });
    expect(parseUiScript("#ui notify:error")![0]!.payload).toEqual({
      message: "Failed to reach the remote index.",
      level: "error",
    });
  });

  it("rejects timeout= on notify — transients have no deadline field on the wire", () => {
    expect(parseUiScript("#ui notify timeout=5")).toBeNull();
  });

  it("rejects an unrecognised notify variant", () => {
    expect(parseUiScript("#ui notify:bogus")).toBeNull();
  });

  it("#ui set_editor_text produces a transient (expectsResponse: false) request carrying only text", () => {
    const steps = parseUiScript("#ui set_editor_text");
    expect(steps).toEqual([
      {
        method: "set_editor_text",
        payload: { text: "retry the dns lookups with a 2s backoff" },
        expectsResponse: false,
        await: true,
      },
    ]);
  });

  it("rejects timeout= on set_editor_text — transients have no deadline field on the wire", () => {
    expect(parseUiScript("#ui set_editor_text timeout=5")).toBeNull();
  });

  it("rejects an unrecognised set_editor_text variant", () => {
    expect(parseUiScript("#ui set_editor_text:bogus")).toBeNull();
  });

  it("#ui input produces a placeholder field", () => {
    const steps = parseUiScript("#ui input");
    expect(steps![0]!.payload).toEqual({ title: "Enter a release tag", placeholder: "v2.4.1" });
  });

  it("#ui editor produces a prefilled multi-line field", () => {
    const steps = parseUiScript("#ui editor");
    expect(steps![0]!.method).toBe("editor");
    expect(steps![0]!.payload.prefill).toContain("fix: retry dns lookups with backoff");
  });

  it("#ui unknown raises an unrecognised method that still expects a response", () => {
    const steps = parseUiScript("#ui unknown");
    expect(steps).toEqual([
      {
        method: "pickRange",
        payload: { title: "Select a window", min: 0, max: 240 },
        expectsResponse: true,
        await: true,
      },
    ]);
  });

  it("#ui select:9 raises nine options", () => {
    const steps = parseUiScript("#ui select:9");
    expect((steps![0]!.payload.options as string[]).length).toBe(9);
  });

  it("#ui select:empty raises a real empty array, not an omitted field", () => {
    const steps = parseUiScript("#ui select:empty");
    expect(steps![0]!.payload).toHaveProperty("options");
    expect(steps![0]!.payload.options).toEqual([]);
  });

  it("#ui select:long raises self-numbered options captured verbatim", () => {
    const steps = parseUiScript("#ui select:long");
    expect(steps![0]!.payload).toEqual({
      title: "[Color] Which color do you pick?",
      options: [
        "1. Red — Pick the color red.",
        "2. Blue — Pick the color blue.",
        "3. Type something.",
      ],
    });
  });

  it("#ui input:multiline carries a hard break and a bracketed prefix verbatim", () => {
    const steps = parseUiScript("#ui input:multiline");
    expect(steps![0]!.payload.title).toBe("[Color] Which color do you pick?\n\nType your answer:");
  });

  it("timeout= is honoured for select/confirm/input", () => {
    expect(parseUiScript("#ui select timeout=30")![0]!.timeoutMs).toBe(30_000);
    expect(parseUiScript("#ui confirm timeout=5")![0]!.timeoutMs).toBe(5_000);
    expect(parseUiScript("#ui input timeout=1")![0]!.timeoutMs).toBe(1_000);
  });

  it("timeout= is rejected for editor (Pi's editor has no timeout on the wire)", () => {
    expect(parseUiScript("#ui editor timeout=5")).toBeNull();
  });

  it("#ui multi 3 raises three dialogs, none individually awaited", () => {
    const steps = parseUiScript("#ui multi 3");
    expect(steps).toHaveLength(3);
    for (const step of steps!) {
      expect(step.await).toBe(false);
      expect(step.expectsResponse).toBe(true);
    }
    expect(steps!.map((s) => s.payload.title)).toEqual([
      "Question 1 of 3",
      "Question 2 of 3",
      "Question 3 of 3",
    ]);
  });

  it("#ui multi 0 is rejected", () => {
    expect(parseUiScript("#ui multi 0")).toBeNull();
  });

  it("#ui help emits no dialog (empty step list)", () => {
    expect(parseUiScript("#ui help")).toEqual([]);
  });
});

describe("getUiScriptHelpText", () => {
  it("lists every documented recipe", () => {
    const text = getUiScriptHelpText();
    for (const recipe of [
      "#ui select",
      "#ui confirm",
      "#ui input",
      "#ui editor",
      "#ui unknown",
      "#ui select:9",
      "#ui select:empty",
      "#ui select:long",
      "#ui input:multiline",
      "#ui notify",
      "#ui set_editor_text",
      "#ui multi",
      "#ui help",
    ]) {
      expect(text).toContain(recipe);
    }
  });
});
