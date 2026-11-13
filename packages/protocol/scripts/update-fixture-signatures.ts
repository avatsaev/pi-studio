/**
 * Regenerates `fixtures/external-clients/.signatures.json` from the current fixtures:
 *
 *   npm run fixtures:update -w @av-pi-studio/protocol
 *
 * Refuses to record a breaking change (removed/retyped leaf) unless `manifest.formatVersion` was
 * bumped and `CHANGELOG.md` names the file — otherwise regenerating would silently defeat the
 * guard in `src/external-fixtures.test.ts`. Additive changes always regenerate.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeSignatures,
  FIXTURE_DIR,
  guardProblems,
  loadChangelog,
  loadManifest,
  readJson,
  SIGNATURES_FILE,
  type Signatures,
} from "./external-fixtures-support.ts";

const current = computeSignatures(loadManifest());
if (existsSync(join(FIXTURE_DIR, SIGNATURES_FILE))) {
  const problems = guardProblems(readJson<Signatures>(SIGNATURES_FILE), current, loadChangelog());
  if (problems.length > 0) {
    console.error(`Refusing to update ${SIGNATURES_FILE}:\n${problems.join("\n")}`);
    console.error("Bump formatVersion in manifest.json and add a CHANGELOG.md entry (see README).");
    process.exit(1);
  }
}
writeFileSync(join(FIXTURE_DIR, SIGNATURES_FILE), `${JSON.stringify(current, null, 2)}\n`);
console.log(`wrote ${SIGNATURES_FILE} (formatVersion ${current.formatVersion})`);
