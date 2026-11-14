import { describe, expect, it } from "vitest";
import {
  createDevWarnings,
  MISSING_STYLESHEET_MESSAGE,
  MULTIPLE_BOUNDARIES_MESSAGE,
  STYLESHEET_SENTINEL_VAR,
} from "./dev-warnings.js";

function harness() {
  const messages: string[] = [];
  return { messages, warnings: createDevWarnings((m) => void messages.push(m)) };
}

describe("stylesheet sentinel", () => {
  it("warns once, naming the import, when the sentinel property is empty", () => {
    const { messages, warnings } = harness();

    warnings.checkStylesheet(() => "");
    warnings.checkStylesheet(() => "  ");

    expect(messages).toEqual([MISSING_STYLESHEET_MESSAGE]);
    expect(MISSING_STYLESHEET_MESSAGE).toContain("@av-pi-studio/ui-library/styles.css");
  });

  it("stays silent when styles.css defined the sentinel", () => {
    const { messages, warnings } = harness();

    warnings.checkStylesheet((name) => (name === STYLESHEET_SENTINEL_VAR ? " 1" : ""));

    expect(messages).toEqual([]);
  });
});

describe("second ThemeBoundary", () => {
  it("warns once when a second boundary is live", () => {
    const { messages, warnings } = harness();

    warnings.registerBoundary();
    expect(messages).toEqual([]);
    warnings.registerBoundary();
    warnings.registerBoundary();

    expect(messages).toEqual([MULTIPLE_BOUNDARIES_MESSAGE]);
  });

  it("does not warn when a boundary is replaced (unmount, then mount)", () => {
    const { messages, warnings } = harness();

    const unregister = warnings.registerBoundary();
    unregister();
    unregister(); // idempotent: a double cleanup must not under-count
    warnings.registerBoundary();

    expect(messages).toEqual([]);
  });
});
