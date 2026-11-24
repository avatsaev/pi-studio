import { describe, expect, it } from "vitest";

import { SERVER_FEATURES } from "./client-capabilities.js";
import {
  daemonUpdateApplyRequestSchema,
  daemonUpdateApplyResponseSchema,
  daemonUpdateCheckRequestSchema,
  daemonUpdateCheckResponseSchema,
  daemonUpdateSetAutoCheckRequestSchema,
  daemonUpdateSetAutoCheckResponseSchema,
  daemonUpdateStateSchema,
  daemonUpdateStatusPushSchema,
  daemonUpdateStatusRequestSchema,
  daemonUpdateStatusResponseSchema,
  daemonUpdateStatusSchema,
  sessionMessageSchema,
} from "./messages.js";

const base = { currentVersion: "0.0.129", installKind: "npm-global", autoCheck: true } as const;

const states = [
  { kind: "idle" },
  { kind: "checking" },
  { kind: "available", version: "0.0.130" },
  { kind: "installing", version: "0.0.130" },
  { kind: "updating_extensions", version: "0.0.130" },
  { kind: "restarting", version: "0.0.130" },
  { kind: "failed", version: "0.0.130", code: "install", message: "boom" },
  { kind: "failed", version: "0.0.130", code: "timeout" },
  { kind: "cannot_update", reason: "docker", command: "docker compose pull" },
  { kind: "cannot_update", reason: "source", version: "0.0.130", command: "git pull" },
] as const;

const status = { ...base, state: { kind: "idle" } } as const;

describe("daemon_update_* family", () => {
  it("round-trips every state kind inside a full status", () => {
    for (const state of states) {
      const full = {
        ...base,
        checkedAt: 1,
        checkError: "offline",
        state,
        lastResult: { from: "0.0.128", to: "0.0.129", outcome: "rolled_back", at: 2, message: "m" },
      };
      expect(daemonUpdateStateSchema.parse(state)).toEqual(state);
      expect(daemonUpdateStatusSchema.parse(full)).toEqual(full);
    }
  });

  it("round-trips every message and finds each in the session union", () => {
    const cases = [
      [daemonUpdateStatusRequestSchema, { type: "daemon_update_status_request", requestId: "r" }],
      [
        daemonUpdateStatusResponseSchema,
        { type: "daemon_update_status_response", requestId: "r", status },
      ],
      [daemonUpdateCheckRequestSchema, { type: "daemon_update_check_request", requestId: "r" }],
      [
        daemonUpdateCheckResponseSchema,
        { type: "daemon_update_check_response", requestId: "r", status },
      ],
      [daemonUpdateApplyRequestSchema, { type: "daemon_update_apply_request", requestId: "r" }],
      [
        daemonUpdateApplyResponseSchema,
        { type: "daemon_update_apply_response", requestId: "r", ok: true },
      ],
      [
        daemonUpdateApplyResponseSchema,
        { type: "daemon_update_apply_response", requestId: "r", ok: false, error: "in_progress" },
      ],
      [
        daemonUpdateSetAutoCheckRequestSchema,
        { type: "daemon_update_set_auto_check_request", requestId: "r", enabled: false },
      ],
      [
        daemonUpdateSetAutoCheckResponseSchema,
        { type: "daemon_update_set_auto_check_response", requestId: "r", status },
      ],
      [daemonUpdateStatusPushSchema, { type: "daemon_update_status", status }],
    ] as const;
    for (const [schema, message] of cases) {
      expect(sessionMessageSchema.safeParse(message).success, message.type).toBe(true);
      expect(schema.parse(message)).toEqual(message);
      const result = schema.safeParse({ ...message, fromTheFuture: "kept" });
      expect(result.success, message.type).toBe(true);
      if (result.success) expect(result.data).toHaveProperty("fromTheFuture", "kept");
    }
  });

  it("rejects an unknown state.kind and a missing version", () => {
    expect(daemonUpdateStateSchema.safeParse({ kind: "rebooting", version: "1" }).success).toBe(
      false,
    );
    expect(daemonUpdateStateSchema.safeParse({ kind: "available" }).success).toBe(false);
    expect(
      sessionMessageSchema.safeParse({
        type: "daemon_update_status",
        status: { ...base, state: { kind: "rebooting" } },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown installKind and a non-boolean enabled", () => {
    expect(daemonUpdateStatusSchema.safeParse({ ...status, installKind: "snap" }).success).toBe(
      false,
    );
    expect(
      daemonUpdateSetAutoCheckRequestSchema.safeParse({
        type: "daemon_update_set_auto_check_request",
        requestId: "r",
        enabled: "yes",
      }).success,
    ).toBe(false);
  });

  it("advertises the daemonUpdate feature", () => {
    expect(SERVER_FEATURES.daemonUpdate).toBe("daemonUpdate");
  });
});
