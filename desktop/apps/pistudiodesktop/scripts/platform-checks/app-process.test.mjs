import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SECRET_STORE_ARG } from "./app-process.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("SECRET_STORE_ARG", () => {
  it("is one argument that keeps secrets in a file, as msedgedriver needs", () => {
    expect(SECRET_STORE_ARG).toBe("--secret-store=file");
    expect(SECRET_STORE_ARG).not.toContain(" ");
  });

  // A launch without it would, on a machine that has a keychain, write a runner's or a developer's
  // keychain: the scripts that start the app all name `--config-dir` on the line that builds its arguments.
  it.each(["macos.mjs", "windows.mjs", "webview2-diagnostics.mjs"])("is passed wherever %s starts the app", (file) => {
    const launches = readFileSync(join(HERE, file), "utf8")
      .split("\n")
      .filter((line) => /--config-dir/.test(line) && /args|launch\(|spawn\(/.test(line) && !line.trim().startsWith("//"));
    expect(launches).not.toHaveLength(0);
    // The lines that lack it, so a failure shows which launch.
    expect(launches.filter((line) => !line.includes("SECRET_STORE_ARG"))).toEqual([]);
  });
});
