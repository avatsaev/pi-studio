/**
 * Recorder for the external-client wire fixtures (swe/architecture/external-client-fixtures.md).
 *
 * Boots the in-process dev daemon (mock provider, loopback, ephemeral port), runs the shared
 * fixture scenario (`src/test-support/external-fixtures-scenario.ts`, the same one the Layer B
 * contract test verifies) and prints the first captured frame per fixture variant. With
 * `--write <dir>` it also writes one candidate file per variant (`{ "frame": … }` only — the
 * metadata is authored by hand); an existing file is never overwritten without `--force`. Not run
 * in CI: the committed fixtures are the reviewed contract, this only prints a starting point.
 *
 *   npm run build:server
 *   node packages/server/scripts/record-external-fixtures.ts [--write <dir> [--force]]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { startDevDaemon } from "../dist/daemon/dev-bootstrap.js";
import { connectTestClient, listeningPort } from "../dist/test-support/daemon-test-client.js";
import {
  runExternalFixtureScenario,
  scenarioDaemonOptions,
} from "../dist/test-support/external-fixtures-scenario.js";

const args = process.argv.slice(2);
const writeIdx = args.indexOf("--write");
const writeDir = writeIdx >= 0 ? args[writeIdx + 1] : undefined;
const force = args.includes("--force");

const dev = startDevDaemon({
  host: "127.0.0.1",
  port: 0,
  ...scenarioDaemonOptions(),
});
const client = await connectTestClient(await listeningPort(dev.httpServer), {
  appVersion: "pistudiodashboard/0.1.0",
});

try {
  const captured = await runExternalFixtureScenario(dev, client);
  for (const [key, frame] of [...captured].toSorted(([a], [b]) => a.localeCompare(b))) {
    console.log(`── ${key}\n${JSON.stringify(frame)}`);
  }
  if (writeDir) {
    mkdirSync(writeDir, { recursive: true });
    for (const [key, frame] of captured) {
      const file = join(writeDir, `${key}.json`);
      if (existsSync(file) && !force) {
        console.error(`skip (exists, use --force): ${file}`);
        continue;
      }
      writeFileSync(file, `${JSON.stringify({ frame }, null, 2)}\n`);
    }
  }
} finally {
  await client.close();
  await dev.close();
}
