import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

import {
  bearerFromSubprotocol,
  createPasswordAuth,
  isBcryptHash,
  resolvePasswordHash,
} from "./password-auth.js";

const PASSWORD = "hunter2";

describe("resolvePasswordHash", () => {
  it("hashes a plaintext secret and accepts an existing hash", () => {
    const fromPlain = resolvePasswordHash({ envPassword: PASSWORD });
    expect(fromPlain).toBeDefined();
    expect(isBcryptHash(fromPlain as string)).toBe(true);

    const existing = bcrypt.hashSync(PASSWORD, 10);
    expect(resolvePasswordHash({ configPassword: existing })).toBe(existing);
  });

  it("returns undefined when no password is configured", () => {
    expect(resolvePasswordHash({})).toBeUndefined();
  });

  it("lets env override config", () => {
    const hash = resolvePasswordHash({ configPassword: "ignored", envPassword: PASSWORD });
    expect(bcrypt.compareSync(PASSWORD, hash as string)).toBe(true);
    expect(bcrypt.compareSync("ignored", hash as string)).toBe(false);
  });
});

describe("createPasswordAuth", () => {
  it("when disabled allows everything", () => {
    const auth = createPasswordAuth(undefined);
    expect(auth.enabled).toBe(false);
    expect(auth.authenticateUpgrade({ headers: {} })).toBe(true);
  });

  it("verifies the WS bearer subprotocol", () => {
    const auth = createPasswordAuth(resolvePasswordHash({ envPassword: PASSWORD }));
    expect(
      auth.authenticateUpgrade({
        headers: { "sec-websocket-protocol": `pi-studio.bearer.${PASSWORD}` },
      }),
    ).toBe(true);
    expect(
      auth.authenticateUpgrade({
        headers: { "sec-websocket-protocol": "pi-studio.bearer.wrong" },
      }),
    ).toBe(false);
    expect(auth.authenticateUpgrade({ headers: {} })).toBe(false);
  });

  it("parses the bearer subprotocol from a multi-value list", () => {
    expect(bearerFromSubprotocol(`json, pi-studio.bearer.${PASSWORD}`)).toBe(PASSWORD);
    expect(bearerFromSubprotocol("json, other")).toBeUndefined();
  });
});
