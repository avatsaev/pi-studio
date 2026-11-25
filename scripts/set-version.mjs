#!/usr/bin/env node
// Sets the one lockstep version of the npm packages (and, with it, the daemon's version).
//
//   npm run version:set -- minor        # 0.0.134 -> 0.1.0   (patch | minor | major | an explicit x.y.z)
//   npm run version:set -- next         # what release.yml runs on its runner: see below
//
// The version committed in packages/*/package.json is only a FLOOR. A release takes the patch after
// the highest version npm has for any published package, unless the floor is higher (then the floor
// is released as is). So a normal merge needs no version change and nothing is committed back;
// raise the floor (`minor`, `major` or an explicit version, which must be higher than the committed
// one) in a pull request for a minor or major release. The rules live in release/version.mjs.
//
// `next` asks the npm registry and FAILS when it cannot answer: guessing "nothing published" could
// reuse a version that exists.
//
// It rewrites, and leaves uncommitted:
//   - `version` of every lockstep package (the published five plus the private ui-library,
//     workbench and web-client; ui-gallery is private and not versioned in lockstep);
//   - the `@av-pi-studio/*` ranges of the PUBLISHED packages to `^<version>` (dependencies and
//     devDependencies; private packages keep their `*` ranges);
//   - the committed `src/version.generated.ts` of server, cli and relay (their build regenerates
//     them too; `version.generated.test.ts` fails on drift);
//   - package-lock.json.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { highest, nextRelease, resolveTarget } from "./release/version.mjs";

// Same sets as ALL_PACKAGES and PUBLISH_ORDER in publish.sh, which checks the lockstep before publishing.
const LOCKSTEP = [
  "protocol",
  "relay",
  "client",
  "server",
  "cli",
  "ui-library",
  "workbench",
  "web-client",
];
const PUBLISHED = ["protocol", "relay", "client", "server", "cli"];
const WITH_GENERATED_VERSION = ["server", "cli", "relay"];

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = (pkg) => `${root}packages/${pkg}/package.json`;
const readManifest = (pkg) => JSON.parse(readFileSync(manifestPath(pkg), "utf8"));

/** Every version of every published package, from the registry; throws when it cannot answer. */
const publishedVersions = () =>
  PUBLISHED.flatMap((pkg) => {
    const json = execFileSync("npm", ["view", `@av-pi-studio/${pkg}`, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const versions = JSON.parse(json);
    return Array.isArray(versions) ? versions : [versions];
  });

const arg = process.argv[2];
if (!arg || process.argv.length > 3) {
  console.error("Usage: set-version.mjs <patch|minor|major|MAJOR.MINOR.PATCH|next>");
  process.exit(1);
}

try {
  const current = readManifest("protocol").version;
  let next;
  if (arg === "next") {
    const published = publishedVersions();
    next = nextRelease({ floor: current, published });
    console.log(`floor ${current}, highest on npm ${highest(published) ?? "none"}`);
  } else {
    next = resolveTarget(arg, current);
  }
  console.log(`${current} -> ${next}`);

  for (const pkg of LOCKSTEP) {
    const manifest = readManifest(pkg);
    manifest.version = next;
    if (PUBLISHED.includes(pkg)) {
      for (const key of ["dependencies", "devDependencies"]) {
        for (const dep of Object.keys(manifest[key] ?? {})) {
          if (dep.startsWith("@av-pi-studio/")) manifest[key][dep] = `^${next}`;
        }
      }
    }
    writeFileSync(manifestPath(pkg), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  for (const pkg of WITH_GENERATED_VERSION) {
    execFileSync("node", [`${root}packages/${pkg}/scripts/gen-version.mjs`], { stdio: "inherit" });
  }

  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
    cwd: root,
    stdio: "ignore",
  });

  console.log(`Version set to ${next}.`);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
