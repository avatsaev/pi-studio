#!/usr/bin/env node
/**
 * `pi-studio` CLI entrypoint. Parses argv (skipping `node` + script), runs the program, and exits
 * with the resolved code.
 */
import { run } from "./program.js";

const argv = process.argv.slice(2);
run(argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
