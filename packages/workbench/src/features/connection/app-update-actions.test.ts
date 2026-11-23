import { describe, expect, it } from "vitest";
import { createTestUpdates } from "../../test/test-updates.js";
import { runAppUpdateCommand } from "./app-update-actions.js";

describe("runAppUpdateCommand", () => {
  it("runs the host command of each action", async () => {
    const updates = createTestUpdates();

    await runAppUpdateCommand(updates, { kind: "install" });
    await runAppUpdateCommand(updates, { kind: "restart" });
    await runAppUpdateCommand(updates, { kind: "check" });

    expect(updates.calls).toEqual(["install", "restart", "check"]);
  });

  it("drops a rejection: the host shows the failure through its state", async () => {
    const updates = createTestUpdates();
    updates.install = async () => {
      throw new Error("refused");
    };

    await expect(runAppUpdateCommand(updates, { kind: "install" })).resolves.toBeUndefined();
  });
});
