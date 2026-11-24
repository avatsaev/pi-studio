#!/usr/bin/env node
// Live check of the daemon self-update (swe/features/self-update.md § Acceptance criteria): a real
// `npm i -g` install in a container updates itself over the RPC from N to N+1, rolls a broken N+2
// back, and refuses or fails cleanly where the install folder is not writable. Everything runs in
// containers named `<prefix>-*` against a LOCAL registry (verdaccio); nothing reaches the real one.
//
//   node scripts/daemon-update-check/run.mjs --repo /path/to/clean-built-checkout
//
// See README.md for the flags, what each scenario proves and how to read the output.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  PUBLISH_ORDER,
  Publisher,
  bash,
  descendants,
  docker,
  exec,
  freePort,
  listeningAddresses,
  loadSdk,
  openClient,
  psList,
  registryLogin,
  sleep,
  waitFor,
} from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: flags } = parseArgs({
  options: {
    repo: { type: "string" },
    prefix: { type: "string", default: "duplive" },
    "registry-port": { type: "string", default: "14873" },
    "relay-port": { type: "string", default: "17000" },
    "daemon-port": { type: "string", default: "16767" },
    base: { type: "string", default: "0.0.9001" },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});
if (!flags.repo) {
  console.error(
    "usage: run.mjs --repo <clean built checkout> [--prefix duplive] [--keep] [--out results.json]",
  );
  process.exit(2);
}

const repo = path.resolve(flags.repo);
const P = flags.prefix;
const names = {
  net: `${P}-net`,
  registry: `${P}-registry`,
  relay: `${P}-relay`,
  daemon: `${P}-daemon`,
  nodeImage: `${P}-node`,
  relayImage: `${P}-relay`,
};
const registryPort = Number(flags["registry-port"]);
const relayPort = Number(flags["relay-port"]);
const daemonPort = Number(flags["daemon-port"]);
const hostRegistry = `http://127.0.0.1:${registryPort}/`;
const innerRegistry = `http://${names.registry}:4873/`;
const PASSWORD = "duplive-pw";
const HOME = "/home/node/.pi-studio";
const LISTEN = "0.0.0.0:6767";

const [maj, min, patch] = flags.base.split(".").map(Number);
const V1 = `${maj}.${min}.${patch}`; // N
const V2 = `${maj}.${min}.${patch + 1}`; // N+1
const V3 = `${maj}.${min}.${patch + 2}`; // N+2, exits at start

const scratch = mkdtempSync(path.join(tmpdir(), `${P}-`));
const results = [];
const openClients = [];

const log = (line) => console.log(line);

/** One scenario: its evidence lines, a pass/fail, and the abort of the whole run on a failure. */
async function scenario(title, fn) {
  const evidence = [];
  const started = Date.now();
  log(`\n=== ${title}`);
  const ev = (line) => {
    evidence.push(line);
    log(`  · ${line}`);
  };
  const expect = (condition, text) => {
    ev(`${condition ? "PASS" : "FAIL"}: ${text}`);
    if (!condition) throw new Error(`expectation failed: ${text}`);
  };
  try {
    await fn(ev, expect);
    results.push({
      title,
      pass: true,
      seconds: Math.round((Date.now() - started) / 1000),
      evidence,
    });
  } catch (err) {
    results.push({
      title,
      pass: false,
      seconds: Math.round((Date.now() - started) / 1000),
      evidence,
      error: String(err.message ?? err),
    });
    throw err;
  }
}

// ─── Daemon container helpers ────────────────────────────────────────────────────────────────────

const dx = (command, opts) => exec(names.daemon, command, opts);
const dbash = (script, opts) => bash(names.daemon, script, opts);
const cli = (args, env = {}) =>
  dx(["pi-studio", "--host", LISTEN, ...args], {
    env: { PI_STUDIO_PASSWORD: PASSWORD, ...env },
    allowFail: true,
  });

/** The agent's Pi process (it renames itself `pi`; launched, it is `node …cli.js --mode rpc`). */
const isPi = (p) => p.args === "pi" || /--mode rpc/.test(p.args);

const health = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${daemonPort}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return await res.json();
  } catch {
    return null;
  }
};
const healthVersion = async () => (await health())?.version ?? null;
const pidFile = async () => {
  const { stdout, code } = await dbash(`cat ${HOME}/pi-studio.pid`, { allowFail: true });
  return code === 0 ? Number(stdout.trim()) : null;
};
const globalRoot = async () => (await dx(["npm", "root", "-g"])).stdout.trim();
const installedVersions = async () => {
  const { stdout } = await dbash(
    `for f in "$(npm root -g)"/@av-pi-studio/*/package.json "$(npm root -g)"/@av-pi-studio/cli/node_modules/@av-pi-studio/*/package.json; do [ -f "$f" ] && echo "$(dirname "$f" | sed "s|$(npm root -g)/||") $(node -p "require('$f').version")"; done`,
  );
  return stdout.trim().split("\n").join("; ");
};
const entryPaths = async () => {
  const { stdout } = await dbash(
    `find "$(npm root -g)" -path '*@av-pi-studio/server/dist/daemon/main.js' | sed "s|$(npm root -g)/||"`,
  );
  return stdout.trim().split("\n").join("; ");
};
/** Requests for the cli packument so far (one `requested` line each); the registry's log lags by up to a second. */
const registryCliRequests = async () => {
  await sleep(1500);
  const { stdout, stderr } = await docker(["logs", names.registry]);
  return `${stdout}${stderr}`
    .split("\n")
    .filter((l) => l.includes("requested 'GET /@av-pi-studio%2fcli'")).length;
};
const restartLog = async () =>
  (await dbash(`cat ${HOME}/logs/update-restart.log`, { allowFail: true })).stdout.trim();
const tail = (text, n = 12) => text.split("\n").slice(-n);

async function startDaemon(env = {}) {
  const res = await cli(["daemon", "start"], env);
  if (res.code !== 0) throw new Error(`daemon start failed: ${res.stdout}${res.stderr}`);
  await waitFor("daemon health", healthVersion, { timeoutMs: 30_000 });
}

async function connectDirect(name) {
  const client = await openClient(sdk, { name, port: daemonPort, password: PASSWORD });
  openClients.push(client);
  return client;
}

const daemonProcs = (list) =>
  list.filter(
    (p) => /runDaemon|daemon\/main\.js/.test(p.args) && p.ppid !== 0 && /node/.test(p.args),
  );

// ─── Run ─────────────────────────────────────────────────────────────────────────────────────────

let sdk;
let publisher;
let A; // direct client 1
let B; // direct client 2
let R; // relay client

async function cleanup() {
  for (const client of openClients) {
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
  if (flags.keep) {
    log(`\n--keep: containers ${Object.values(names).join(", ")} and ${scratch} left in place`);
    return;
  }
  await docker(["rm", "-f", names.daemon, names.relay, names.registry], { allowFail: true });
  await docker(["network", "rm", names.net], { allowFail: true });
  await docker(["rmi", "-f", names.nodeImage, names.relayImage], { allowFail: true });
  rmSync(scratch, { recursive: true, force: true });
}

let failed = false;
try {
  await Promise.all([freePort(registryPort), freePort(relayPort), freePort(daemonPort)]);
  sdk = await loadSdk(repo);

  await scenario(
    "setup: local registry, relay, daemon host, N published, N installed globally",
    async (ev, expect) => {
      await docker(["network", "create", names.net]);
      copyFileSync(path.join(here, "verdaccio.yaml"), path.join(scratch, "verdaccio.yaml"));
      await docker([
        "run",
        "-d",
        "--name",
        names.registry,
        "--network",
        names.net,
        "-p",
        `127.0.0.1:${registryPort}:4873`,
        "-v",
        `${path.join(scratch, "verdaccio.yaml")}:/verdaccio/conf/config.yaml:ro`,
        "verdaccio/verdaccio:6",
      ]);
      await waitFor(
        "registry ping",
        async () => (await fetch(`${hostRegistry}-/ping`).catch(() => null))?.ok,
        { timeoutMs: 60_000 },
      );
      const npmrc = await registryLogin(hostRegistry, scratch);
      publisher = new Publisher({ repo, scratch, registryUrl: hostRegistry, npmrc });
      await publisher.publish(V1);
      ev(`published ${V1} (${PUBLISH_ORDER.length} packages) to ${hostRegistry} only`);

      await docker([
        "build",
        "-f",
        path.join(here, "Dockerfile.node"),
        "--build-arg",
        `REGISTRY=${innerRegistry}`,
        "-t",
        names.nodeImage,
        here,
      ]);
      await docker([
        "build",
        "-f",
        path.join(repo, "docker/relay.Dockerfile"),
        "-t",
        names.relayImage,
        repo,
      ]);
      await docker([
        "run",
        "-d",
        "--name",
        names.relay,
        "--network",
        names.net,
        "-p",
        `127.0.0.1:${relayPort}:7000`,
        names.relayImage,
      ]);
      await docker([
        "run",
        "-d",
        "--init",
        "--name",
        names.daemon,
        "--network",
        names.net,
        "-p",
        `127.0.0.1:${daemonPort}:6767`,
        names.nodeImage,
        "sleep",
        "infinity",
      ]);

      const id = (await dx(["id"])).stdout.trim();
      expect(/uid=1000\(node\)/.test(id), `the daemon host runs as a normal user (${id})`);
      const t0 = Date.now();
      await dx(["npm", "install", "-g", `@av-pi-studio/cli@${V1}`]);
      ev(`npm i -g @av-pi-studio/cli@${V1} took ${Math.round((Date.now() - t0) / 1000)} s`);
      ev(`npm root -g = ${await globalRoot()}`);
      const version = (await dx(["pi-studio", "--version"])).stdout.trim();
      expect(version === V1, `pi-studio --version = ${version}`);
      ev(`installed: ${await installedVersions()}`);
      ev(`daemon entry under npm's layout: ${await entryPaths()}`);
      const owner = (await dbash(`stat -c '%U %a' "$(npm root -g)"`)).stdout.trim();
      ev(`npm global folder owner and mode: ${owner}`);
    },
  );

  await scenario(
    "N: daemon starts on 0.0.0.0, install kind npm-global; the offer appears on every client",
    async (ev, expect) => {
      await dbash(`mkdir -p ${HOME} && cat > ${HOME}/config.json`, {
        input: JSON.stringify({
          daemon: {
            relay: { enabled: true, endpoint: `${names.relay}:7000`, useTls: false },
            extensions: { autoSync: false },
          },
        }),
      });
      const requestsBefore = await registryCliRequests();
      await startDaemon();
      expect((await healthVersion()) === V1, `/api/health answers version ${V1}`);
      const addresses = await listeningAddresses(names.daemon, 6767);
      expect(addresses.includes("0.0.0.0"), `bound addresses of :6767 = ${addresses.join(", ")}`);
      ev(`pid file names pid ${await pidFile()}`);

      A = await connectDirect("duplive-a");
      B = await connectDirect("duplive-b");
      expect(A.pi.hasDaemonUpdateCapability(), "server_info.features.daemonUpdate is advertised");
      const first = await A.pi.getDaemonUpdateStatus();
      expect(first.installKind === "npm-global", `installKind = ${first.installKind}`);
      expect(first.currentVersion === V1, `currentVersion = ${first.currentVersion}`);
      await waitFor(
        "the automatic check at start",
        async () => (await A.pi.getDaemonUpdateStatus()).checkedAt,
        { timeoutMs: 20_000 },
      );
      const afterAuto = await A.pi.getDaemonUpdateStatus();
      expect(
        afterAuto.state.kind === "idle",
        `after the automatic check (nothing newer) state = ${afterAuto.state.kind}`,
      );
      ev(
        `registry saw ${(await registryCliRequests()) - requestsBefore} GET(s) of the cli packument since the daemon started (its automatic check)`,
      );

      // The relay client: pairing link as `pi-studio daemon pair` builds it, dialled through the host port.
      const key = JSON.parse((await dbash(`cat ${HOME}/daemon-keypair.json`)).stdout).publicKeyB64;
      const pairingUrl = sdk.buildPairingUrl(key, {
        baseUrl: "http://localhost:8080",
        relay: { endpoint: `127.0.0.1:${relayPort}`, useTls: false },
      });
      R = await waitFor(
        "relay client connects",
        async () => {
          try {
            const c = await openClient(sdk, { name: "duplive-relay-client", pairingUrl });
            openClients.push(c);
            return c;
          } catch {
            return null;
          }
        },
        { timeoutMs: 30_000, intervalMs: 1000 },
      );
      ev(`relay client connected through ${names.relay} (transport relay)`);

      await publisher.publish(V2);
      ev(`published ${V2}`);
      const marks = [A, B, R].map((c) => c.mark());
      const checked = await A.pi.checkDaemonUpdate();
      expect(
        checked.state.kind === "available" && checked.state.version === V2,
        `client A's check: ${JSON.stringify(checked.state)}`,
      );
      for (const [i, client] of [A, B, R].entries()) {
        const seen = await client.waitEvent(
          "available broadcast",
          (e) => e.type === "status" && e.kind === "available",
          marks[i],
          10_000,
        );
        expect(
          seen.status.state.version === V2,
          `${client.name} received the broadcast: available ${seen.status.state.version} (no request of its own)`,
        );
      }
    },
  );

  let oldDaemonPid;
  await scenario(
    `apply ${V1} → ${V2}: same address, clients reconnect, no old process left`,
    async (ev, expect) => {
      // A pi agent (a `pi` child process, spawned by its first prompt) and a terminal (a shell).
      const agent = await A.pi.createAgent({
        config: { provider: "pi", cwd: "/home/node" },
        labels: {},
      });
      // No model is configured, so the turn never ends: the answer is not awaited, the process is.
      A.pi
        .agent(agent.agentId)
        .send("hello")
        .catch(() => undefined);
      const terminal = await A.daemon.request("create_terminal_request", {
        workspaceId: "duplive",
        cwd: "/home/node",
      });
      ev(
        `agent ${agent.agentId} and terminal slot ${JSON.stringify(terminal.terminal?.slot ?? terminal)} created`,
      );
      await waitFor("the agent's pi process", async () => (await psList(names.daemon)).some(isPi), {
        timeoutMs: 30_000,
      });
      oldDaemonPid = await pidFile();
      const before = await psList(names.daemon);
      const oldTree = descendants(before, oldDaemonPid);
      const oldPi = before.filter(isPi);
      ev(
        `old daemon pid ${oldDaemonPid} (${V1}); its process tree: ${oldTree.map((p) => `${p.pid}:${p.args.slice(0, 40)}`).join(" | ")}`,
      );
      expect(
        oldPi.length >= 1,
        `an agent process \`pi\` exists before the update (${oldPi.map((p) => p.pid).join(", ")})`,
      );
      expect(
        oldTree.length >= 3,
        `the daemon has children (agent + terminal shell): ${oldTree.length - 1}`,
      );

      const marks = [A, B, R].map((c) => c.mark());
      const t0 = Date.now();
      const applied = await A.pi.applyDaemonUpdate();
      expect(applied.ok === true, "apply answered ok at once");
      const second = await B.pi
        .applyDaemonUpdate()
        .catch((e) => ({ ok: false, error: `rpc: ${e.message}` }));
      expect(
        second.ok === false && second.error === "in_progress",
        `a second apply during the update is refused: ${JSON.stringify(second)}`,
      );

      for (const [i, client] of [A, B, R].entries()) {
        await client.waitEvent(
          "reconnected after the restart",
          (e) => e.type === "reconnected",
          marks[i],
          240_000,
        );
        const kinds = client.kindsSince(marks[i]);
        ev(
          `${client.name}: broadcasts ${JSON.stringify(kinds)}, reconnected ${Math.round((client.events.find((e, j) => j >= marks[i] && e.type === "reconnected").at - t0) / 1000)} s after the apply`,
        );
        expect(
          ["installing", "updating_extensions", "restarting"].every((k) => kinds.includes(k)),
          `${client.name} saw installing → updating_extensions → restarting`,
        );
      }
      const stageAt = (kind) =>
        A.events.slice(marks[0]).find((e) => e.type === "status" && e.kind === kind)?.at;
      ev(
        `stage durations seen by client A: install ${((stageAt("updating_extensions") - t0) / 1000).toFixed(1)} s, ` +
          `extensions ${((stageAt("restarting") - stageAt("updating_extensions")) / 1000).toFixed(1)} s`,
      );
      expect((await healthVersion()) === V2, `/api/health answers version ${V2}`);
      const addresses = await listeningAddresses(names.daemon, 6767);
      expect(
        addresses.includes("0.0.0.0"),
        `same address after the update: ${addresses.join(", ")}`,
      );
      const newPid = await pidFile();
      expect(
        newPid !== oldDaemonPid,
        `pid file names the new daemon: ${newPid} (was ${oldDaemonPid})`,
      );
      const after = await psList(names.daemon);
      expect(
        after.some((p) => p.pid === newPid && /node/.test(p.args)),
        `pid ${newPid} is a live node process: ${after.find((p) => p.pid === newPid)?.args.slice(0, 90)}`,
      );
      const survivors = oldTree.filter((old) => after.some((p) => p.pid === old.pid));
      expect(
        survivors.length === 0,
        `none of the old daemon's ${oldTree.length} processes (daemon, pi, shell) is left`,
      );
      expect(!after.some(isPi), "no `pi` agent process exists after the restart");
      ev(
        `process list after: ${after
          .filter((p) => /node|pi|bash/.test(p.args))
          .map((p) => `${p.pid}<${p.ppid} ${p.args.slice(0, 60)}`)
          .join(" | ")}`,
      );
      ev(`installed: ${await installedVersions()}`);
      ev(`entry paths: ${await entryPaths()}`);

      for (const client of [A, B, R]) {
        const status = await client.pi.getDaemonUpdateStatus();
        expect(
          status.currentVersion === V2 &&
            status.lastResult?.outcome === "updated" &&
            status.lastResult.from === V1 &&
            status.lastResult.to === V2,
          `${client.name}: currentVersion ${status.currentVersion}, lastResult ${JSON.stringify(status.lastResult)}`,
        );
      }
      const resultFile = await dbash(
        `test -e ${HOME}/update-result.json && echo present || echo consumed`,
      );
      expect(
        resultFile.stdout.trim() === "consumed",
        "update-result.json was read once and removed by the new daemon",
      );
      const extensionFailures = (
        await dbash(`grep -c 'extensions update failed' ${HOME}/logs/pi-studio.log || true`)
      ).stdout.trim();
      expect(
        extensionFailures === "0",
        "the daemon's log has no 'extensions update failed': `pi update --extensions` ran and succeeded",
      );
      ev(`update-restart.log:\n      ${tail(await restartLog()).join("\n      ")}`);
    },
  );

  await scenario(
    "daemon stop removes the pid file; the daemon starts again",
    async (ev, expect) => {
      const stopped = await cli(["daemon", "stop"]);
      ev(`pi-studio daemon stop → ${stopped.stdout.trim()}`);
      expect(stopped.code === 0, "daemon stop exits 0");
      expect((await pidFile()) === null, "pi-studio.pid is gone");
      expect((await healthVersion()) === null, "nothing answers /api/health");
      expect(daemonProcs(await psList(names.daemon)).length === 0, "no daemon process is left");
      await startDaemon();
      ev(`started again: pid ${await pidFile()}, version ${await healthVersion()}`);
      await Promise.all(
        [A, B, R].map((c) =>
          waitFor(`${c.name} back`, () => c.daemon.state === "open", { timeoutMs: 30_000 }),
        ),
      );
      ev("all three clients reconnected by themselves");
    },
  );

  await scenario(`rollback: ${V3} does not start → back on ${V2}`, async (ev, expect) => {
    await publisher.publish(V3, { broken: true });
    ev(`published ${V3} (server entry exits at start)`);
    const checked = await A.pi.checkDaemonUpdate();
    expect(
      checked.state.kind === "available" && checked.state.version === V3,
      `check: ${JSON.stringify(checked.state)}`,
    );
    const oldPid = await pidFile();
    const marks = [A, R].map((c) => c.mark());
    const t0 = Date.now();
    expect((await A.pi.applyDaemonUpdate()).ok === true, "apply answered ok");
    for (const [i, client] of [A, R].entries()) {
      await client.waitEvent("reconnected", (e) => e.type === "reconnected", marks[i], 300_000);
      ev(
        `${client.name}: broadcasts ${JSON.stringify(client.kindsSince(marks[i]))}, reconnected ${Math.round((Date.now() - t0) / 1000)} s after the apply`,
      );
    }
    expect(
      (await healthVersion()) === V2,
      `the old version answers again: ${await healthVersion()}`,
    );
    const status = await A.pi.getDaemonUpdateStatus();
    expect(
      status.lastResult?.outcome === "rolled_back" &&
        status.lastResult.from === V2 &&
        status.lastResult.to === V3,
      `lastResult = ${JSON.stringify(status.lastResult)}`,
    );
    expect(status.currentVersion === V2, `currentVersion = ${status.currentVersion}`);
    const newPid = await pidFile();
    expect(
      newPid !== oldPid && (await psList(names.daemon)).some((p) => p.pid === newPid),
      `pid file names the live daemon ${newPid} (was ${oldPid})`,
    );
    ev(`installed after the rollback: ${await installedVersions()}`);
    ev(`update-restart.log:\n      ${tail(await restartLog(), 24).join("\n      ")}`);
    await dbash(`rm -f ${HOME}/logs/update-restart.log`);
  });

  await scenario(
    "read-only npm folder: cannot_update(not_writable), apply refused",
    async (ev, expect) => {
      const root = await globalRoot();
      await dx(["chmod", "a-w", root]);
      ev(`chmod a-w ${root}`);
      await cli(["daemon", "restart"]);
      await waitFor("daemon back", healthVersion, { timeoutMs: 30_000 });
      await waitFor("A reconnected", () => A.daemon.state === "open", { timeoutMs: 30_000 });
      const checked = await A.pi.checkDaemonUpdate();
      const state = checked.state;
      expect(
        state.kind === "cannot_update" && state.reason === "not_writable" && state.version === V3,
        `state = ${JSON.stringify(state)}`,
      );
      expect(
        typeof state.command === "string" && state.command.includes("npm"),
        `command shown to the user: ${state.command}`,
      );
      const refused = await A.pi.applyDaemonUpdate();
      expect(
        refused.ok === false && refused.error === "cannot_update",
        `forged apply refused: ${JSON.stringify(refused)}`,
      );
      await dx(["chmod", "u+w", root]);
    },
  );

  await scenario(
    "folder made read-only after the check: failed(permission), old daemon keeps answering",
    async (ev, expect) => {
      await cli(["daemon", "restart"]);
      await waitFor("daemon back", healthVersion, { timeoutMs: 30_000 });
      await waitFor("A reconnected", () => A.daemon.state === "open", { timeoutMs: 30_000 });
      const checked = await A.pi.checkDaemonUpdate();
      expect(
        checked.state.kind === "available" && checked.state.version === V3,
        `check while writable: ${JSON.stringify(checked.state)}`,
      );
      const pidBefore = await pidFile();
      const root = await globalRoot();
      // Everything npm has to replace: the global node_modules, the scope folder and the cli folder.
      const locked = [root, `${root}/@av-pi-studio`];
      await dx(["chmod", "a-w", ...locked]);
      ev(`chmod a-w ${locked.join(" ")} (after the check)`);
      const mark = A.mark();
      expect(
        (await A.pi.applyDaemonUpdate()).ok === true,
        "apply answered ok (the check passed earlier)",
      );
      const failedEvent = await A.waitEvent(
        "failed state",
        (e) => e.type === "status" && e.kind === "failed",
        mark,
        120_000,
      );
      const failure = failedEvent.status.state;
      expect(failure.code === "permission", `failed(${failure.code}) version ${failure.version}`);
      ev(
        `message (tail): ${(failure.message ?? "").split("\n").slice(-3).join(" / ").slice(0, 300)}`,
      );
      const kinds = A.kindsSince(mark);
      expect(
        !kinds.includes("restarting") && !kinds.includes("updating_extensions"),
        `no restart, no extensions step: ${JSON.stringify(kinds)}`,
      );
      expect((await pidFile()) === pidBefore, `same daemon pid ${pidBefore}`);
      expect(
        (await healthVersion()) === V2,
        `the old daemon still answers (${await healthVersion()})`,
      );
      expect(
        (await A.pi.getDaemonUpdateStatus()).currentVersion === V2,
        "client A still talks to it, no reconnect needed",
      );
      expect(
        A.events.slice(mark).every((e) => !(e.type === "conn" && e.state === "closed")),
        "client A's socket never dropped",
      );
      await dx(["chmod", "u+w", ...locked]);
      const rechecked = await A.pi.checkDaemonUpdate();
      expect(
        rechecked.state.kind === "available",
        `the next check replaces failed: ${rechecked.state.kind}`,
      );
    },
  );

  await scenario("PI_STUDIO_UPDATE_AUTOCHECK=false and the Settings switch", async (ev, expect) => {
    const quiet = async (seconds) => {
      const before = await registryCliRequests();
      await sleep(seconds * 1000);
      return (await registryCliRequests()) - before;
    };
    await cli(["daemon", "restart"], { PI_STUDIO_UPDATE_AUTOCHECK: "false" });
    await waitFor("daemon back", healthVersion, { timeoutMs: 30_000 });
    await waitFor("A reconnected", () => A.daemon.state === "open", { timeoutMs: 30_000 });
    const requests = await quiet(8);
    const status = await A.pi.getDaemonUpdateStatus();
    expect(
      requests === 0,
      `env false: the registry saw ${requests} request(s) of the cli packument in 8 s after the start`,
    );
    expect(
      status.autoCheck === false && status.checkedAt === undefined && status.state.kind === "idle",
      `status: autoCheck ${status.autoCheck}, checkedAt ${status.checkedAt}, state ${status.state.kind}`,
    );
    const checked = await A.pi.checkDaemonUpdate();
    expect(
      checked.state.kind === "available" && checked.checkedAt !== undefined,
      `Check now still works: ${checked.state.kind} ${checked.state.version}`,
    );
    const pinned = await A.pi.setDaemonUpdateAutoCheck(true);
    const config = JSON.parse((await dbash(`cat ${HOME}/config.json`)).stdout);
    expect(
      config.daemon.update?.autoCheck === true && pinned.autoCheck === false,
      `switch on: config.json daemon.update.autoCheck = true; effective stays ${pinned.autoCheck} while the env pins false`,
    );
    await cli(["daemon", "restart"]);
    await waitFor("daemon back", healthVersion, { timeoutMs: 30_000 });
    await waitFor("A reconnected", () => A.daemon.state === "open", { timeoutMs: 30_000 });
    const on = await waitFor(
      "the automatic check",
      async () => {
        const s = await A.pi.getDaemonUpdateStatus();
        return s.checkedAt ? s : null;
      },
      { timeoutMs: 20_000 },
    );
    expect(
      on.autoCheck === true && on.state.kind === "available",
      `no env, config true: autoCheck ${on.autoCheck}, the start's check found ${on.state.kind} ${on.state.version}`,
    );
    const off = await A.pi.setDaemonUpdateAutoCheck(false);
    const config2 = JSON.parse((await dbash(`cat ${HOME}/config.json`)).stdout);
    expect(
      off.autoCheck === false && config2.daemon.update.autoCheck === false,
      "switch off: effective false, config.json false",
    );
    await cli(["daemon", "restart"]);
    await waitFor("daemon back", healthVersion, { timeoutMs: 30_000 });
    await waitFor("A reconnected", () => A.daemon.state === "open", { timeoutMs: 30_000 });
    const requests2 = await quiet(8);
    expect(requests2 === 0, `config false: ${requests2} request(s) in 8 s after the start`);
    ev(
      "the 6-hour timer is not observable live; it is covered by update-service.test.ts (fake timer)",
    );
  });

  /**
   * Applies the broken N+2, stops the registry at the `restarting` broadcast (the install has
   * finished by then), and waits for the helper's last log line. Returns what it left behind.
   */
  async function applyThenLoseRegistry(ev, expect) {
    const checked = await A.pi.checkDaemonUpdate();
    expect(
      checked.state.kind === "available" && checked.state.version === V3,
      `check: ${checked.state.kind} ${checked.state.version}`,
    );
    await dbash(`rm -f ${HOME}/logs/update-restart.log`);
    const mark = A.mark();
    expect((await A.pi.applyDaemonUpdate()).ok === true, "apply answered ok");
    await A.waitEvent(
      "restarting",
      (e) => e.type === "status" && e.kind === "restarting",
      mark,
      120_000,
    );
    await docker(["stop", names.registry]);
    ev(
      `registry container stopped at the 'restarting' broadcast (the install of ${V3} had finished)`,
    );
    const t0 = Date.now();
    await waitFor(
      "the helper's last log line",
      async () => /update (updated|rolled_back|failed)/.test(await restartLog()),
      { timeoutMs: 300_000, intervalMs: 1000 },
    );
    const seconds = Math.round((Date.now() - t0) / 1000);
    ev(`the helper finished ${seconds} s after the registry went away`);
    ev(`update-restart.log:\n      ${tail(await restartLog(), 30).join("\n      ")}`);
    return { seconds, mark };
  }

  const startRegistry = async () => {
    await docker(["start", names.registry]);
    await waitFor(
      "registry back",
      async () => (await fetch(`${hostRegistry}-/ping`).catch(() => null))?.ok,
      { timeoutMs: 60_000 },
    );
  };

  await scenario(
    `rollback with the registry stopped, npm's cache warm: ${V2} comes from the cache`,
    async (ev, expect) => {
      const { seconds, mark } = await applyThenLoseRegistry(ev, expect);
      expect(
        seconds < 60,
        `the rollback did not stall on the dead registry (${seconds} s; a plain install waited its whole 120 s limit and failed)`,
      );
      await waitFor(
        "A reconnected",
        () =>
          A.daemon.state === "open" && A.events.slice(mark).some((e) => e.type === "reconnected"),
        { timeoutMs: 60_000 },
      );
      expect(
        (await healthVersion()) === V2,
        `the old version answers again: ${await healthVersion()}`,
      );
      const status = await A.pi.getDaemonUpdateStatus();
      expect(
        status.lastResult?.outcome === "rolled_back" && status.lastResult.to === V3,
        `lastResult = ${JSON.stringify(status.lastResult)}`,
      );
      ev(`installed now: ${await installedVersions()}`);
      await startRegistry();
    },
  );

  await scenario(
    "rollback fails too (registry stopped, npm's cache cleaned): the daemon stays down; the failed outcome is read at the next start",
    async (ev, expect) => {
      const checked = await A.pi.checkDaemonUpdate();
      expect(
        checked.state.kind === "available" && checked.state.version === V3,
        `check: ${checked.state.kind} ${checked.state.version}`,
      );
      ev(
        `npm cache clean --force → ${(await dbash("npm cache clean --force 2>&1 | tail -1", { allowFail: true })).stdout.trim()}`,
      );
      await applyThenLoseRegistry(ev, expect);
      const result = JSON.parse(
        (await dbash(`cat ${HOME}/update-result.json`, { allowFail: true })).stdout || "null",
      );
      ev(`update-result.json = ${JSON.stringify(result)}`);
      expect(result?.outcome === "failed" && result.to === V3, "the helper wrote outcome failed");
      expect(
        (await healthVersion()) === null && (await pidFile()) === null,
        "nothing answers and there is no pid file: the daemon stays down",
      );
      ev(`installed now (the broken version stayed): ${await installedVersions()}`);
      await startRegistry();
      await dx(["npm", "install", "-g", `@av-pi-studio/cli@${V2}`]);
      ev(`recovered by hand: ${await installedVersions()}`);
      await startDaemon();
      expect((await healthVersion()) === V2, `pi-studio daemon start → ${V2} answers`);
      const status = await waitFor(
        "A sees lastResult",
        async () => {
          if (A.daemon.state !== "open") return null;
          const s = await A.pi.getDaemonUpdateStatus();
          return s.lastResult ? s : null;
        },
        { timeoutMs: 30_000 },
      );
      expect(
        status.lastResult.outcome === "failed",
        `lastResult at that start = ${JSON.stringify(status.lastResult)}`,
      );
      expect(
        (
          await dbash(`test -e ${HOME}/update-result.json && echo present || echo consumed`)
        ).stdout.trim() === "consumed",
        "update-result.json read once and removed",
      );
      const stop = await cli(["daemon", "stop"]);
      expect(stop.code === 0 && (await pidFile()) === null, "daemon stop leaves no pid file");
    },
  );

  log("\nALL SCENARIOS PASSED");
} catch (err) {
  failed = true;
  console.error(`\nFAILED: ${err.message ?? err}`);
  try {
    const psOut = await psList(names.daemon);
    console.error(
      `processes in ${names.daemon}:\n${psOut.map((p) => `  ${p.pid}<${p.ppid} ${p.stat} ${p.args.slice(0, 100)}`).join("\n")}`,
    );
    console.error(`update-restart.log:\n${tail(await restartLog(), 30).join("\n")}`);
  } catch {
    /* the daemon host may not exist yet */
  }
} finally {
  if (flags.out) {
    mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    writeFileSync(
      flags.out,
      JSON.stringify({ versions: { N: V1, N1: V2, N2: V3 }, results }, null, 2),
    );
  }
  await cleanup();
}
process.exit(failed ? 1 : 0);
