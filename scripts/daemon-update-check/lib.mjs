// Helpers of the live daemon-update check (see README.md): process and docker plumbing, the local
// registry (verdaccio) and the publish of the workspace at several versions, the process list
// inside the daemon container, and a thin SDK client that records every update broadcast.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a command, collecting its output. Rejects on a non-zero exit unless `allowFail`. */
export function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : undefined;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = { code: code ?? -1, stdout, stderr };
      if (code !== 0 && !opts.allowFail) {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited ${code}\n${(stderr || stdout).slice(-2000)}`,
          ),
        );
      } else resolve(result);
    });
    child.stdin.end(opts.input ?? "");
  });
}

/** Polls `fn` until it returns something truthy; rejects with `what` after `timeoutMs`. */
export async function waitFor(what, fn, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms: ${what}`);
    await sleep(intervalMs);
  }
}

export function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`port ${port} is in use; pass another one`)));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(port)));
  });
}

// ─── Docker ────────────────────────────────────────────────────────────────────────────────────

export const docker = (args, opts) => run("docker", args, opts);

/** `docker exec` as the unprivileged `node` user, with extra environment variables. */
export function exec(container, command, { env = {}, allowFail = false, timeoutMs, input } = {}) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  return docker(
    ["exec", "-i", "-u", "node", "-w", "/home/node", ...envArgs, container, ...command],
    {
      allowFail,
      timeoutMs,
      input,
    },
  );
}

export const bash = (container, script, opts) => exec(container, ["bash", "-c", script], opts);

// ─── Registry and publishing ─────────────────────────────────────────────────────────────────────

/** Workspace packages the CLI install needs, in dependency order (cli last, as in `publish.sh`). */
export const PUBLISH_ORDER = ["protocol", "relay", "client", "server", "web-client", "cli"];

/** Refuses anything that is not a loopback registry: the check never publishes anywhere else. */
export function assertLocalRegistry(url) {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`refusing to use a non-local registry: ${url}`);
  }
}

/** Creates a user on the local registry and returns an npmrc that publishes there only. */
export async function registryLogin(registryUrl, scratch) {
  assertLocalRegistry(registryUrl);
  const response = await fetch(`${registryUrl}-/user/org.couchdb.user:duplive`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "duplive",
      password: "duplive-password",
      email: "duplive@example.invalid",
      type: "user",
    }),
  });
  const body = await response.json();
  if (!body.token) throw new Error(`registry login failed: ${JSON.stringify(body)}`);
  const host = new URL(registryUrl).host;
  const npmrc = path.join(scratch, "publish.npmrc");
  writeFileSync(npmrc, `registry=${registryUrl}\n//${host}/:_authToken=${body.token}\n`);
  return npmrc;
}

/**
 * Packs every package of the clean checkout once (never touching it), then, per version, rewrites
 * the tarball's `package.json` (version, internal ranges) and publishes to the local registry. A
 * "broken" version has a server entry that exits at once.
 */
export class Publisher {
  constructor({ repo, scratch, registryUrl, npmrc }) {
    assertLocalRegistry(registryUrl);
    this.repo = repo;
    this.scratch = scratch;
    this.registryUrl = registryUrl;
    this.npmrc = npmrc;
    this.packed = new Map();
  }

  async baseTarball(pkg) {
    const cached = this.packed.get(pkg);
    if (cached) return cached;
    const dest = path.join(this.scratch, "base", pkg);
    mkdirSync(dest, { recursive: true });
    const { stdout } = await run(
      "npm",
      [
        "pack",
        path.join(this.repo, "packages", pkg),
        "--pack-destination",
        dest,
        "--json",
        "--ignore-scripts",
      ],
      { env: { ...process.env, npm_config_userconfig: this.npmrc } },
    );
    const file = path.join(
      dest,
      JSON.parse(stdout)[0].filename.replace(/^@/, "").replace("/", "-"),
    );
    this.packed.set(pkg, file);
    return file;
  }

  async publish(version, { broken = false } = {}) {
    if (!/^0\.0\.\d+$/.test(version))
      throw new Error(`use a 0.0.x version (exact ^ ranges): ${version}`);
    for (const pkg of PUBLISH_ORDER) {
      const base = await this.baseTarball(pkg);
      const dir = path.join(this.scratch, "stage", version, pkg);
      mkdirSync(dir, { recursive: true });
      await run("tar", ["-xzf", base, "-C", dir]);
      const manifestPath = path.join(dir, "package", "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.version = version;
      for (const key of ["dependencies", "devDependencies"]) {
        for (const dep of Object.keys(manifest[key] ?? {})) {
          if (dep.startsWith("@av-pi-studio/")) manifest[key][dep] = `^${version}`;
        }
      }
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      if (broken && pkg === "server") {
        const main = path.join(dir, "package", "dist", "daemon", "main.js");
        const [shebang, ...rest] = readFileSync(main, "utf8").split("\n");
        writeFileSync(
          main,
          [
            shebang,
            'process.stderr.write("duplive: this version exits at start on purpose\\n");',
            "process.exit(3);",
            ...rest,
          ].join("\n"),
        );
      }
      const out = path.join(this.scratch, "tarballs", version);
      mkdirSync(out, { recursive: true });
      const packed = await run(
        "npm",
        [
          "pack",
          path.join(dir, "package"),
          "--pack-destination",
          out,
          "--json",
          "--ignore-scripts",
        ],
        { env: { ...process.env, npm_config_userconfig: this.npmrc } },
      );
      const tarball = path.join(
        out,
        JSON.parse(packed.stdout)[0].filename.replace(/^@/, "").replace("/", "-"),
      );
      await run(
        "npm",
        [
          "publish",
          tarball,
          "--registry",
          this.registryUrl,
          "--userconfig",
          this.npmrc,
          "--access",
          "public",
          "--ignore-scripts",
        ],
        { env: { ...process.env, npm_config_userconfig: this.npmrc } },
      );
    }
  }
}

// ─── Inside the daemon container ───────────────────────────────────────────────────────────────

/** `ps` of the container as `{pid, ppid, stat, args}`. */
export async function psList(container) {
  const { stdout } = await exec(container, ["ps", "-eo", "pid=,ppid=,stat=,args="]);
  return stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], args: m[4] }))
    .filter((p) => !p.args.startsWith("ps -eo"));
}

/** `pid` and everything below it. */
export function descendants(list, pid) {
  const found = new Set([pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of list) {
      if (found.has(p.ppid) && !found.has(p.pid)) {
        found.add(p.pid);
        grew = true;
      }
    }
  }
  return list.filter((p) => found.has(p.pid));
}

/** The local addresses a listening TCP socket on `port` is bound to (from /proc/net/tcp{,6}). */
export async function listeningAddresses(container, port) {
  const { stdout } = await exec(container, ["cat", "/proc/net/tcp", "/proc/net/tcp6"]);
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const addresses = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*\d+:\s+([0-9A-F]+):([0-9A-F]{4})\s+\S+\s+0A\b/.exec(line);
    if (m && m[2] === hexPort) {
      addresses.push(m[1] === "00000000" ? "0.0.0.0" : /^0{32}$/.test(m[1]) ? "::" : m[1]);
    }
  }
  return addresses;
}

// ─── SDK client ──────────────────────────────────────────────────────────────────────────────────

export async function loadSdk(repo) {
  const req = createRequire(path.join(repo, "package.json"));
  const client = await import(pathToFileURL(req.resolve("@av-pi-studio/client")).href);
  const pairing = await import(pathToFileURL(path.join(repo, "packages/cli/dist/pairing.js")).href);
  return { ...client, buildPairingUrl: pairing.buildPairingUrl, WebSocket: req("ws") };
}

/**
 * A connected SDK client that reconnects by itself and records, with timestamps, every update
 * broadcast, every connection state change and every reconnect.
 */
export async function openClient(sdk, opts) {
  const { DaemonClient, PiStudioClient, ReconnectionManager } = sdk;
  let transport;
  let url;
  if (opts.pairingUrl) {
    const offer = sdk.parsePairingUrl(opts.pairingUrl);
    url = sdk.relayDialUrl(offer.relay);
    transport = sdk.createRelayTransport({
      daemonPublicKey: offer.publicKey,
      factory: (u) => new sdk.WebSocket(u),
    });
  } else {
    url = `ws://127.0.0.1:${opts.port}`;
    const protocols = opts.password ? [`pi-studio.bearer.${opts.password}`] : [];
    transport = sdk.createWebSocketTransport((u) => new sdk.WebSocket(u, protocols));
  }
  const daemon = new DaemonClient({
    url,
    clientId: opts.name,
    clientType: "cli",
    capabilities: {},
    transport,
    rpcTimeoutMs: 20_000,
  });
  const pi = new PiStudioClient(daemon);
  const events = [];
  const stamp = (event) => events.push({ at: Date.now(), ...event });
  pi.onDaemonUpdateStatus((status) => stamp({ type: "status", kind: status.state.kind, status }));
  daemon.onStateChange((state) => stamp({ type: "conn", state }));
  const reconnect = new ReconnectionManager(daemon, {
    initialDelayMs: 250,
    maxDelayMs: 2000,
    jitter: 0,
  });
  reconnect.onReconnected((info) => stamp({ type: "reconnected", attempt: info.attempt }));
  await daemon.connect();
  reconnect.start();
  const self = {
    name: opts.name,
    daemon,
    pi,
    events,
    mark: () => events.length,
    since: (mark) => events.slice(mark),
    kindsSince: (mark) =>
      events
        .slice(mark)
        .filter((e) => e.type === "status")
        .map((e) => e.kind),
    waitEvent: (what, predicate, mark = 0, timeoutMs = 120_000) =>
      waitFor(`${opts.name}: ${what}`, () => events.slice(mark).find(predicate), {
        timeoutMs,
        intervalMs: 100,
      }),
    close: () => {
      reconnect.stop();
      daemon.close();
    },
  };
  return self;
}
