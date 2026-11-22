import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KEYCHAIN_STORE_ARG, SECRET_STORE_ARG } from "./app-process.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The scripts that launch the app (not their tests), as `[name, text]`. */
const scripts = readdirSync(HERE)
  .filter((file) => file.endsWith(".mjs") && !file.endsWith(".test.mjs"))
  .map((file) => [file, readFileSync(join(HERE, file), "utf8")]);

/** The only two launches that use a keychain, each with what removes its items. */
const KEYCHAIN_LAUNCHES = { "macos-keychain.mjs": "delete-generic-password", "windows-bridge.mjs": "/delete:" };

const code = (text) => text.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"));

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

describe("KEYCHAIN_STORE_ARG", () => {
  it("is one argument that asks for the keychain", () => {
    expect(KEYCHAIN_STORE_ARG).toBe("--secret-store=keychain");
    expect(KEYCHAIN_STORE_ARG).not.toContain(" ");
  });

  // The exception to "no automated launch writes a keychain" is two named launches on throwaway
  // runners; a third would have to be added here knowingly.
  it("is named by no script but the two keychain launches (and app-process.mjs, which defines it)", () => {
    const naming = scripts.filter(([file, text]) => code(text).some((line) => line.includes("KEYCHAIN_STORE_ARG")) && file !== "app-process.mjs").map(([file]) => file);
    expect(naming.sort()).toEqual(Object.keys(KEYCHAIN_LAUNCHES).sort());
  });

  it.each(Object.entries(KEYCHAIN_LAUNCHES))("is passed in %s only with a --config-dir, and the file deletes what it wrote (%s)", (file, deletion) => {
    const text = readFileSync(join(HERE, file), "utf8");
    const uses = code(text).filter((line) => line.includes("KEYCHAIN_STORE_ARG") && !line.startsWith("import") && !line.includes("from "));
    expect(uses).not.toHaveLength(0);
    expect(uses.filter((line) => !line.includes("--config-dir"))).toEqual([]);
    expect(text).toContain(deletion);
    // The deletion is in a `finally`: it also runs when a check failed.
    expect(text).toContain(".finally(");
  });
});
