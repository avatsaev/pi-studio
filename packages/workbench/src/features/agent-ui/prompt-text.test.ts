import { describe, expect, it } from "vitest";
import { confirmPromptParts, promptLines } from "./prompt-text.js";

describe("promptLines", () => {
  it("a plain single-line title is a single line", () => {
    expect(promptLines("Enter a release tag")).toEqual(["Enter a release tag"]);
  });

  // § 03 "INPUT · HARD BREAK, BRACKETED PREFIX" — captured verbatim from a live run.
  it("renders the live-captured multi-line input title: hard breaks, blank-line run collapsed, [Color] intact", () => {
    const title = "[Color] Which color do you pick?\n\nType your answer:";
    expect(promptLines(title)).toEqual([
      "[Color] Which color do you pick?",
      "",
      "Type your answer:",
    ]);
  });

  it("a run of several consecutive blank lines collapses to exactly one blank line", () => {
    expect(promptLines("first\n\n\n\nsecond")).toEqual(["first", "", "second"]);
  });

  it("a bracketed prefix is preserved verbatim, never parsed or stripped", () => {
    expect(promptLines("[skill: connectivity] Restart the language server?")).toEqual([
      "[skill: connectivity] Restart the language server?",
    ]);
  });

  it("leading and trailing blank lines are preserved as single blank lines, not trimmed away", () => {
    expect(promptLines("\ntext\n")).toEqual(["", "text", ""]);
  });

  it("an empty string yields a single empty line", () => {
    expect(promptLines("")).toEqual([""]);
  });
});

describe("confirmPromptParts", () => {
  it("title alone: message key is absent entirely, not an empty array", () => {
    const parts = confirmPromptParts("Restart the language server?");
    expect(parts.title).toEqual(["Restart the language server?"]);
    expect(parts).not.toHaveProperty("message");
  });

  it("title with a message: both returned as distinct line arrays", () => {
    const parts = confirmPromptParts(
      "Clear session?",
      "All messages will be lost. The transcript can't be recovered afterwards.",
    );
    expect(parts.title).toEqual(["Clear session?"]);
    expect(parts.message).toEqual([
      "All messages will be lost. The transcript can't be recovered afterwards.",
    ]);
  });

  it("an empty-string message is still a present message (distinct from omitted)", () => {
    const parts = confirmPromptParts("Proceed?", "");
    expect(parts.message).toEqual([""]);
  });
});
