# Live check of the single binary's self-update

Proves, with real binaries in a container that has no Node and no npm, what the unit tests can only
fake: a daemon that is an unpacked `pi-studio` folder in `$PI_STUDIO_HOME/bin/versions/` updates
itself from N to N+1 through the RPC, rolls a broken N+2 back and skips it, refuses to update where
it is not managed, and survives a corrupted asset; and `pi-studio update` does the same from the
command line. Spec: `swe/features/self-update.md` § Acceptance criteria (milestone 6).
Dated results: [`packages/server/docs/daemon-update-live-results.md`](../../packages/server/docs/daemon-update-live-results.md).
Its sibling for npm installs is [`../daemon-update-check/`](../daemon-update-check/README.md).

**Nothing here reaches GitHub.** The release channel is a local HTTP server started by the script
(`PI_STUDIO_DAEMON_UPDATE_URL=http://127.0.0.1:<http-port>/latest.json`); each version's
`latest.json` and archive names come from `scripts/release/daemon-manifest.mjs`, the release's own
tool.

## Run

```bash
npm run build                                   # the CLI's compiled dist/
node scripts/binary-update-check/run.mjs [--out results.json]
```

Needs Docker (image `debian:bookworm-slim`; the container runs as your uid on the host network) and a
built checkout (`packages/cli/dist/binary-main.js`). It builds four
Linux binaries itself with `build-binary.mjs --version <v> --out-dir <scratch>` (4 s each, 65 MiB
archives; `--version` relabels the compiled version modules for the compile and restores them, so
the checkout's `dist/` is unchanged afterwards) and runs in about a minute. Exit code 0: every
scenario passed.

| Flag | Default | Meaning |
|---|---|---|
| `--repo <dir>` | this checkout | built checkout: its SDK drives the scenarios, its scripts build and publish |
| `--prefix <name>` | `binupd` | the container's name (`<prefix>-daemon`) and the daemon password |
| `--daemon-port`, `--other-port`, `--http-port` | 16767, 16768, 16800 | host ports (the container shares the host network; all bind loopback). Use others when the defaults are taken |
| `--base <0.0.N>` | `0.0.9001` | N; N+1, N+2, N+3 follow |
| `--image <image>` | `debian:bookworm-slim` | the daemon host |
| `--out <file>` | none | the evidence of every scenario and every request of the release channel as JSON |
| `--keep` | off | leave the container and the scratch folder for inspection |

The container and the scratch folder are removed at the end, also after a failure, unless `--keep`.
Remove a kept run with `docker rm -f <prefix>-daemon`.

## What it does

Versions: N = `0.0.9001` is installed, N+1 is the update, N+2 is a build whose daemon cannot start,
N+3 is a later release. The broken N+2 is the real build of that version with its `pi-studio`
replaced by a three-line shell wrapper: everything (`--version`, `__pi`, …) reaches the real
executable (`pi-studio.real`) except `__daemon`, which exits 3 at once.

The scenarios run in order against one container (the state carries over):

| # | Scenario | Passes when |
|---|---|---|
| 1 | setup | four binaries built; N copied to `bin/versions/N`, `bin/current → versions/N`; no `node`, no `npm` on the container's PATH; `bin/current/pi-studio --version` = N |
| 2 | N runs | `daemon start` from `bin/current`; `pi-studio.pid` names a process whose executable is `bin/versions/N/pi-studio`; `installKind = binary`; the start's automatic check made exactly one GET of `latest.json` and found nothing |
| 3 | (d) corrupted asset | `latest.json` names N+1 whose archive has one byte flipped: a check offers N+1 (a second client gets the broadcast), apply ends `installing → failed` (no extensions step, no restart), the same daemon pid answers the same version, no socket dropped, `bin/current` unchanged, no N+1 folder, `bin/tmp` empty, the next check offers N+1 again |
| 4 | (a) apply N → N+1 | an agent (`__pi --mode rpc`) and a terminal exist; a second apply is refused `in_progress`; two direct clients see installing → updating_extensions → restarting and reconnect by themselves; `/api/health` = N+1 on the same address; `pi-studio.pid` names a new process running `bin/versions/N+1/pi-studio`; none of the old daemon's processes is left; `lastResult` = `updated` on both clients; `update-result.json` consumed; `bin/current → versions/N+1`; `bin/versions` = N, N+1; `bin/tmp` empty |
| 5 | (b) rollback | N+2 is offered to the daemon the helper started (so it counts as managed); apply → the helper tries N+2 three times, goes back to N+1; clients reconnect; `lastResult` = `rolled_back`; `skippedVersion` = N+2 and `update-skip.json` holds it; the state right after the rollback is `idle` |
| 6 | (b) skip | `daemon restart`: the start's automatic check does not offer N+2 (`idle`, `skippedVersion` kept); "Check now" does, and the other client gets the broadcast; the file stays; with N+3 as the latest the start's automatic check offers N+3 and the skip is cleared (file removed) |
| 7 | (e) command line | `update --check` reports `N+1 -> N+3`; `update` installs N+3, switches `current`, runs `pi update --extensions`, restarts the daemon on the same address (new pid, running N+3), prunes to N+3 and N+1; both clients reconnect; a second `update` says "already up to date" and does not restart |
| 8 | (c) unmanaged | the same N folder copied to `/work/elsewhere/` and run with another `PI_STUDIO_HOME` and port: `cannot_update(unmanaged_binary)` with N+3 and the releases page; a forged apply is refused `cannot_update`; `pi-studio update --check` reports it, `pi-studio update` fails naming `<home>/bin/versions` and the releases page and installs nothing |

## Reading a failure

A failing expectation prints `FAIL: …`, then the container's `pi-studio` processes, the tail of
`update-restart.log` (the helper's log, in `<psh>/logs/`) and of the daemon's logs. Re-run with
`--keep` and `docker exec -it <prefix>-daemon bash` to look around (`/work/psh` is the daemon's
`PI_STUDIO_HOME`; `ps` does not exist there: `bash /work/ps.sh` lists the processes).
