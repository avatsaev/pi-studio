import { RelayConnectError, type Transport } from "@av-pi-studio/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installHost, resetHostForTests } from "../../host/install.js";
import { createTestHost } from "../../test/test-host.js";
import { useConnectionStore } from "./connection-store.js";

function failingTransport(error: Error): Transport {
  return {
    isOpen: false,
    onMessage: null,
    onClose: null,
    onError: null,
    connect: async () => {
      throw error;
    },
    sendText: () => {},
    sendBinary: () => {},
    close: () => {},
  };
}

beforeEach(() => {
  resetHostForTests();
  useConnectionStore.getState().disconnect();
  useConnectionStore.setState({ error: null, errorReason: null });
});

afterEach(() => {
  useConnectionStore.getState().disconnect();
});

describe("the connection store's failure reason", () => {
  it("keeps wrong_key readable beside the message", async () => {
    const failure = new RelayConnectError("wrong_key");
    installHost(createTestHost({ createTransport: () => failingTransport(failure) }));

    await expect(useConnectionStore.getState().connect({ url: "box:6767" })).rejects.toThrow();

    expect(useConnectionStore.getState().errorReason).toBe("wrong_key");
    expect(useConnectionStore.getState().error).toBe(failure.message);
  });

  it("leaves the reason empty for another error, and clears it on the next attempt", async () => {
    useConnectionStore.setState({ error: "old", errorReason: "wrong_key" });
    installHost(
      createTestHost({ createTransport: () => failingTransport(new Error("refused by test")) }),
    );

    const attempt = useConnectionStore.getState().connect({ url: "box:6767" });
    expect(useConnectionStore.getState().errorReason).toBeNull();
    await expect(attempt).rejects.toThrow();

    expect(useConnectionStore.getState().errorReason).toBeNull();
    expect(useConnectionStore.getState().error).not.toBeNull();
  });

  it("keeps the reason when the transport factory throws a relay error", async () => {
    installHost(
      createTestHost({
        createTransport: () => {
          throw new RelayConnectError("daemon_offline");
        },
      }),
    );

    await expect(useConnectionStore.getState().connect({ url: "box:6767" })).rejects.toThrow();

    expect(useConnectionStore.getState().errorReason).toBe("daemon_offline");
  });
});
