import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { useTransferActivityStore } from "../../stores/transfer-activity-store.js";
import { ActivityLinesView } from "./ActivityLines.js";

const store = () => useTransferActivityStore.getState();
const noop = (): void => undefined;

const html = (): string =>
  renderToStaticMarkup(createElement(ActivityLinesView, { activities: store().activities }));
const cancelNames = (markup: string): string[] =>
  [...markup.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1] ?? "");

beforeEach(() => {
  useTransferActivityStore.setState({ activities: [], lastResult: null });
});

describe("ActivityLines", () => {
  it("draws nothing without activities", () => {
    expect(html()).toBe("");
  });

  it("draws a line with its own Cancel for two saves and a batch", () => {
    store().add({ kind: "save", label: "Downloading a.bin", cancel: noop, percent: 10 });
    store().add({ kind: "save", label: "Downloading b.bin", cancel: noop, state: "waiting" });
    store().add({ kind: "upload", label: "Uploading 3 files", cancel: noop });
    const markup = html();
    expect(cancelNames(markup)).toEqual([
      "Cancel: Downloading a.bin",
      "Cancel: Downloading b.bin",
      "Cancel: Uploading 3 files",
    ]);
    expect(markup).toContain("Downloading a.bin… 10%");
    expect(markup).toContain("Downloading b.bin… waiting for the connection");
    expect(markup).toContain("Uploading 3 files…");
    expect(markup).not.toContain("more");
  });

  it("keeps a Cancel name while the percentage moves", () => {
    const id = store().add({ kind: "save", label: "Downloading a.bin", cancel: noop });
    store().update(id, { percent: 55 });
    expect(cancelNames(html())).toEqual(["Cancel: Downloading a.bin"]);
    expect(html()).toContain("Downloading a.bin… 55%");
  });

  it("draws four lines and `and 2 more` for six activities", () => {
    for (let i = 1; i <= 6; i++) {
      store().add({ kind: "save", label: `Downloading f${i}`, cancel: noop });
    }
    const markup = html();
    expect(cancelNames(markup)).toEqual([
      "Cancel: Downloading f1",
      "Cancel: Downloading f2",
      "Cancel: Downloading f3",
      "Cancel: Downloading f4",
    ]);
    expect(markup).toContain("and 2 more");
    expect(markup).not.toContain("f5");
  });
});
