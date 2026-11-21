import { RelayConnectError } from "@av-pi-studio/client";
import { describe, expect, it } from "vitest";
import { connectFailure } from "./connect-failure.js";

describe("connectFailure", () => {
  it("keeps a relay failure's reason beside its unchanged message", () => {
    const error = new RelayConnectError("wrong_key");
    expect(connectFailure(error)).toEqual({ error: error.message, errorReason: "wrong_key" });
  });

  it("leaves the reason empty for any other error", () => {
    expect(connectFailure(new Error("refused"))).toEqual({
      error: "refused",
      errorReason: null,
    });
    expect(connectFailure("text")).toEqual({ error: "text", errorReason: null });
  });
});
