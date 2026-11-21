import { describe, expect, it } from "vitest";

import { countTasklistRows } from "./processes.mjs";

describe("countTasklistRows", () => {
  const row = (name, pid) => `"${name}","${pid}","Console","1","52,000 K"`;

  it("counts the rows of the image, case-insensitively", () => {
    const output = [row("pistudiodesktop.exe", 100), row("PiStudioDesktop.exe", 200), row("msedgewebview2.exe", 300)].join("\r\n");
    expect(countTasklistRows(output, "pistudiodesktop.exe")).toBe(2);
  });

  it("is zero when there are no tasks", () => {
    expect(countTasklistRows("INFO: No tasks are running which match the specified criteria.\r\n", "pistudiodesktop.exe")).toBe(0);
  });
});
