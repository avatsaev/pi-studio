# Live check of the daemon self-update

Proves, with a real `npm i -g` install in a container, what the unit and integration tests can only
fake: the daemon updates itself from N to N+1 through the RPC, rolls a broken N+2 back, and refuses
or fails cleanly where npm cannot write. Spec: `swe/features/self-update.md` § Acceptance criteria.
Dated results: [`packages/server/docs/daemon-update-live-results.md`](../../packages/server/docs/daemon-update-live-results.md).

**Nothing here touches the real npm registry.** The workspace is published only to a throwaway
verdaccio container (`@av-pi-studio/*` has no uplink there), through a scratch npmrc with a token
of that registry; `lib.mjs` refuses any registry that is not on loopback. The daemon host is a
normal user (`node`, uid 1000) with a user-owned prefix (`~/.npm-global`): as root every folder is
writable and the not-writable scenarios would prove nothing.

## Run

```bash
git worktree add /tmp/wt-daemon-update HEAD     # a CLEAN checkout, never the working tree you edit in
cd /tmp/wt-daemon-update && npm ci && npm run build
node scripts/daemon-update-check/run.mjs --repo /tmp/wt-daemon-update
```

Needs Docker (images `verdaccio/verdaccio:6`, `node:22-bookworm-slim`) and network access for
verdaccio's read-only uplink to npmjs (the daemon's own dependencies). A run takes about ten
minutes. Exit code 0: every scenario passed.

| Flag | Default | Meaning |
|---|---|---|
| `--repo <dir>` | required | clean, built checkout: its packages are packed (never modified); its SDK drives the scenarios; its `docker/relay.Dockerfile` builds the relay |
| `--prefix <name>` | `duplive` | names of the containers (`<prefix>-registry`, `-relay`, `-daemon`), the network and the images |
| `--registry-port`, `--relay-port`, `--daemon-port` | 14873, 17000, 16767 | host ports (loopback only) |
| `--base <0.0.N>` | `0.0.9001` | N; N+1 and N+2 follow. `0.0.x` only: the packages' `^` ranges are then exact |
| `--out <file>` | none | the evidence of every scenario as JSON |
| `--keep` | off | leave the containers and the scratch folder for inspection |

Everything the run creates (containers, network, images, scratch folder) is removed at the end,
also after a failure, unless `--keep` is given. Remove a kept run with
`docker rm -f duplive-daemon duplive-relay duplive-registry; docker network rm duplive-net`.

## What it does

`lib.mjs` packs each package once (`npm pack`), and per version rewrites the tarball's
`package.json` (version, internal ranges), then publishes to the local registry. The broken N+2 has
`process.exit(3)` at the top of `dist/daemon/main.js` (the entry the update helper starts). Packages:
protocol, relay, client, server, cli (cli last, as in `scripts/publish.sh`).

`run.mjs` runs the scenarios in order against one daemon container (the state carries over):

| # | Scenario | Passes when |
|---|---|---|
| 1 | setup | N installed globally by a normal user; `pi-studio --version` = N; the daemon's entry path under npm's layout is printed |
| 2 | the offer | `/api/health` carries N; bound to `0.0.0.0:6767`; `installKind = npm-global`; the start's automatic check ran; after N+1 is published a check by one client reaches two other clients (direct and relay) as a broadcast |
| 3 | apply N → N+1 | a `pi` agent and a terminal exist; a second apply is refused `in_progress`; three clients (two direct, one through the relay) see installing → updating_extensions → restarting and reconnect by themselves; `/api/health` = N+1 on the same address; `pi-studio.pid` names a new live daemon; none of the old daemon's processes (daemon, `pi --mode rpc`, shell) is left and no `pi --mode rpc` exists; `lastResult.outcome = updated` on every client; `update-result.json` consumed |
| 4 | `daemon stop` | the pid file is gone and no daemon process is left; start works again |
| 5 | rollback | N+2 (broken) → apply → the helper fails three starts, reinstalls N+1, `lastResult.outcome = rolled_back`, health = N+1, pid file names the live daemon |
| 6 | read-only npm folder | `cannot_update(not_writable)` with its command; a forged apply is refused `cannot_update` |
| 7 | folder made read-only after the check | `failed(permission)`; no restart, no extensions step; same pid, same version, the client's socket never dropped; the next check replaces `failed` |
| 8 | auto-check | `PI_STUDIO_UPDATE_AUTOCHECK=false`: the registry sees no request after the start, `checkedAt` is unset, Check now works; the switch writes `config.json` (the env still wins); without the env the start checks; switching off stops it |
| 9 | rollback with the registry stopped | the registry is stopped at the `restarting` broadcast; the helper's log and `update-result.json` are recorded, and whether npm's cache serves the previous version offline |
| 10 | recovery | N+1 installed again, the daemon started, the helper's outcome is read once at that start |

The relay is the repository's own image (`docker/relay.Dockerfile`), the daemon dials it as
`<prefix>-relay:7000`, the relay client dials the host port.

## Reading a failure

A failing expectation prints `FAIL: …`, then the container's process list and the tail of
`update-restart.log` (the helper's log, in `~/.pi-studio/logs/`). Re-run with `--keep` and
`docker exec -u node -it duplive-daemon bash` to look around; the daemon's own log is in
`~/.pi-studio/logs/`.
