# Single binary — live results

What the live checks of the compiled single binary proved on Linux, in containers with no Node, npm or
`pi-studio` on them. Specs: `swe/features/single-binary-daemon.md` (§ Acceptance criteria, § TODO(verify)),
`swe/architecture/single-binary-daemon.md` (§ Open points). Each run is dated; the newest is first.

## 2026-11-24 — Pi, extensions, skills, OAuth and glibc (sprint-140/task-004)

**Verdict.** The Pi rows of the acceptance list pass: a real agent turn with a shell call and the todo
tool, `pi install` and the baseline sync with no npm and with `settings.json` gaining only the installed
entry, an excluded package that is installed but not loaded, `skills` list/add/remove, and an OAuth
login that reaches its first prompt. The check found **two defects, both fixed with tests**: a Pi that
exits at start-up (a package that fails to load) left the agent `running` forever and its error reached
only the daemon log (P16), and `pi-studio auth login` could not start an OAuth flow in the binary. The
oldest glibc the linux-x64 binary runs on is **2.17** (CentOS 7); it fails on 2.12.

### Setup

- Repository at `d90c8705` plus the fixes below, `npm run build` already done. The folder under
  `dist-binary/` predated the binary update path, so a fresh one was built in a private root (a copy of
  `scripts/build-binary.mjs` next to symlinks to `packages/`, `node_modules/` and `package.json`; the
  repository's `dist-binary/` was not touched): `node scripts/build-binary.mjs --target linux-x64`
  → `pi-studio-0.0.130-linux-x64/` (151.3 MiB unpacked, `pi-studio` 125 868 208 bytes) and `.tar.gz`
  (67 995 206 bytes, 64.8 MiB). Versions seen: binary 0.0.130, Pi 1.4.0 (`__pi --version`), Bun 1.4.5
  (`bun add v1.4.5` in Pi's install output), `skills` 1.7.4, Docker 29.10.0, host Linux 7.0.14 x64.
- Daemon host: `debian:bookworm-slim` (glibc 2.36; no node, npm, git, curl, CA bundle, `ps`), the unpacked
  folder mounted read-only, throwaway state, run as uid 1000:

  ```
  docker run -d --name live140-main --init --user 1000:1000 -p 127.0.0.1:18767:6767 \
    -v <folder>:/opt/pi-studio:ro -v /tmp/live140-work:/work \
    -e HOME=/work/home -e PI_STUDIO_HOME=/work/psh -e PI_STUDIO_PI_HOME=/work/pihome \
    -e PI_SKIP_VERSION_CHECK=1 -e PI_TELEMETRY=0 -e PATH=/opt/pi-studio:/usr/local/bin:/usr/bin:/bin \
    debian:bookworm-slim sleep infinity
  docker exec live140-main pi-studio --json -H 0.0.0.0:6767 daemon start     # listen address: -H, not an env
  ```

  Processes in the container: `docker-init`, `pi-studio __daemon {...}` and one `pi-studio __pi --mode rpc`
  per agent; no `node`.
- Model credential: only the `github-copilot` entry was copied with `jq` into
  `/tmp/live140-work/pihome/agent/auth.json` (the host's `anthropic` OAuth token had expired, and
  refreshing it in a throwaway home could rotate the owner's refresh token); model
  `github-copilot/claude-haiku-5.5`. The file was never printed; all copies were deleted at the end.
- Drivers: the binary's own CLI inside the container (`pi-studio agent run|logs|ls|reload`,
  `extensions sync|list`, `auth …`, `__pi …`, `__skills …`) and a 40-line scratch script on the host that
  calls `@av-pi-studio/client` (`listSkills`, `installSkills`, `removeSkill`, `listAgentTodos`,
  `loginProvider`) against the published port. Ports: host 18767–18770 only.
- Ran from the same build: `node scripts/binary-smoke.mjs <folder>` (mock turn, terminal echo, 1 MiB
  upload and download, `__pi --version`: all ok) and `scripts/binary-container-check.sh <folder>`
  (ALL CHECKS PASSED), both after the two fixes.

### Results

| # | Item | Result |
|---|---|---|
| 1 | Real agent turn: shell call and the todo tool; baseline sync with no npm | **pass** |
| 2 | `pi install` through Settings → Skills and through `__pi`; `settings.json` gains only the entry | **pass** |
| 3 | `pi-background-tasks` installed beforehand: agent starts, package not loaded; baseline lacks it | **pass** |
| 4 | Another extension fails to load: what Pi does, does the agent's error name it (P16) | **defect found and fixed**; then pass |
| 5 | `skills` list/add/remove; OAuth login to its first prompt | **pass** (OAuth after a fix) |
| 6 | Oldest glibc | **2.17** (CentOS 7) works; CentOS 6 (2.12) fails |

### 1 — A real turn, and the baseline sync

- Boot: `daemon start` reaches "accepting connections" in 51 ms; the baseline sync runs at boot
  (`extensions-sync`): `installed 3 of 3 recommended extensions into /work/pihome/agent; 0 failed` in 2.7 s
  (a second container: 2.3 s), through Pi's package manager = the `bun` script, no npm.
  `settings.json` afterwards: exactly `npm:@juicesharp/rpiv-todo`, `npm:pi-web-access`,
  `npm:@juicesharp/rpiv-ask-user-question` (no `npmCommand`); Pi's install root `pihome/agent/npm`
  (85 MiB after the baseline alone) holds `@juicesharp/rpiv-todo`. `pi-background-tasks` is not in it.
- Turn: `pi-studio agent run -p pi/github-copilot/claude-haiku-5.5 --cwd /work/proj "Use your bash tool to
  run: echo live140-shell-ok $(uname -m). Then use the todo tool to create two todos ("check shell" and
  "report") and mark "check shell" completed. Then answer with one short sentence."` returned after 14.9 s.
  Timeline (`agent logs`): turn started; `shell` (the model's first command had a stray quote: `error`,
  bash `unexpected EOF`), a second `shell` call `completed` with `live140-shell-ok x86_64`; three `todo`
  calls (`Created #1: check shell (pending)`, `Created #2: report (pending)`; `Updated #1 (pending →
  in_progress)`; `Updated #1 (in_progress → completed)`); answer; turn completed.
  `listAgentTodos` over the SDK: `#1 check shell completed`, `#2 report pending`.
- The same prompt shape on **glibc 2.17** (CentOS 7, see item 6): shell and todo calls completed, turn
  completed.
- Answered: the todo tool works, and the baseline sync installs rpiv-todo with no npm on the machine.

### 2 — `pi install` with no npm; `settings.json` before and after

| Path | Command | `settings.json` change |
|---|---|---|
| Settings → Skills (daemon) | SDK `installSkills({source: "npm:pi-btw"})` → `{ok:true, results:[{target:"npm:pi-btw", ok:true}]}` in 0.4 s | + `{"source":"npm:pi-btw","extensions":[],"prompts":[],"themes":[]}` (the skills-only form the daemon writes by design, `resource-service.ts` `installPiPackage`) |
| Pi itself | `PI_CODING_AGENT_DIR=/work/pihome/agent pi-studio __pi install npm:pi-powerline-footer` (0.5 s, `bun add v1.4.5`) | + `"npm:pi-powerline-footer"` |
| Pi itself | `__pi install /work/ext/<local package>` | + the relative path |

`diff` of `jq -S` before and after: only the added entries; `grep npmCommand` finds nothing in any run;
nothing removed. Seeded check with a realistic file (`defaultProvider`, `defaultModel`, `theme`,
`quietStartup`, a filtered `pi-powerline-footer` entry `{"source":…,"extensions":["-index.ts"]}`, the
excluded `pi-background-tasks`, a `skills` path, an unknown `customKey`): after installing `npm:pi-btw`
and `npm:pi-diff-review` and removing `npm:pi-btw` through the daemon (`removeSkill({packageSource})`),
the only change was the added `npm:pi-diff-review` entry plus the missing trailing newline (Pi's own writer,
not the binary's). The excluded entry and the filtered entry were kept and the excluded package was not
installed on disk.
- Answered: `pi install` and `pi remove` work with no npm and write only what they install. (A first
  `skills_remove` failed with bun's `EACCES … moving "@types/retry" to cache dir`: my own `docker exec`
  had run `__pi install` as root in a container whose daemon ran as uid 1000, so bun's cache held
  root-owned files; after `chown` and one user, the removal succeeded. A test-setup slip, not a defect.)

### 3 — An excluded package that is already installed

`__pi install npm:@99percentpeople/pi-background-tasks` (installed `@99percentpeople/pi-background-tasks@2.1.2`
with its `node-pty` 1.2.0-beta.14 dependency, which does not load under Bun: sprint-139) added the entry to
`settings.json`. Then:
- A new agent started and answered; asked to list its tools it named `read, bash, edit, write, todo,
  ask_user_question` and the web tools, and none of the package's `bg_start|bg_wait|bg_status|bg_logs|bg_send|bg_kill`.
- `agent_list_commands_request` on that agent: extension commands `todos` (rpiv-todo), `websearch`,
  `curator`, `google-account`, `search` (pi-web-access), `powerline`, `bash-mode` and others, and the skill
  `btw`; no `bg-attach` or `bg-kill`. So the other extensions load and this one does not.
- `listSkills` still lists the package row (`npm:@99percentpeople/pi-background-tasks`, `filtered:false`):
  it stays installed for the user's own Pi (D2). `pi-studio extensions sync` → `installed 0 of 0`, and
  `settings.json` identical before and after: the sync neither adds nor drops it.
- Answered: the baseline sync (item 1) never installed it; with it installed an agent starts and it is
  not loaded.

### 4 — Another extension fails to load (P16)

Four local packages (`pi.extensions: ["./index.ts"]`) installed one at a time with `__pi install
/work/ext/<name>`, then `pi-studio agent run … "Reply with exactly the word: ok-live140"`:

| Package | Pi's stderr (exit code 1, 0.3 s after spawn) |
|---|---|
| `throw` (`throw new Error("LIVE140-THROW-AT-LOAD")`) | `Error: Failed to load extension "/work/ext/throw/index.ts": Failed to load extension: LIVE140-THROW-AT-LOAD` |
| `missing` (`import "live140-module-that-does-not-exist"`) | `… Failed to load extension: Cannot find module 'live140-module-that-does-not-exist'\nRequire stack:\n- /work/ext/missing/index.ts` |
| `syntax` (invalid TypeScript) | `… Failed to load extension: ParseError: Unexpected keyword 'this'.\n /work/ext/syntax/index.ts:2:2` |
| `noentry` (manifest names a file that does not exist) | none: Pi skips it silently, the agent runs normally |

Each failure ends with `Hint: Start without extensions using "pi -ne".`. **Pi exits** (the whole agent
process, not just the extension) and its stderr **names the file and the reason**. The daemon log
(`pi process exited with commands in flight`, level error) carried it, **but the agent's own error did not**:

- **Defect (before the fix; the same with a Node daemon, Node 24.22.2 running `packages/server/dist`):**
  `agent run` timed out after 30 s (`error: request timed out`), the agent stayed `running` forever, the
  timeline held only the user message, and the stderr was visible only in the daemon log. Cause: Pi died
  while the daemon was still creating the session, the transport emitted its `error` frame while nobody
  was subscribed, and the turn's `prompt` is a fire-and-forget `notify` written to a dead pipe, so
  `PiAgentSession.run()` waited for a terminal event that never comes. A non-zero exit with nothing in
  flight (a Pi that dies mid-turn) did not even fail the transport.
- **Fix** (`rpc-transport.ts`, `agent.ts`): an unexpected non-zero exit with nothing in flight now also
  fails the transport (unless `close()` asked for the exit); `PiAgentSession` remembers the transport's
  `error` frame and `run()` ends a turn at once with an `error` event when the process died before it, and
  ends one in flight when the process dies. Tests: `transport-errors.test.ts` (non-zero exit with nothing
  in flight fails the transport and later requests reject with the stderr; the exit `close()` asked for
  is not a failure) and `pi-adapter.test.ts` ("a dead Pi process ends the turn with its error": before
  and during a turn, and an extension's own `error` frame does not end it).
- After the fix (rebuilt binary): `agent run` answers in about 0.55 s; the agent is `error`; the timeline
  has the user message and `{"kind":"error","message":"pi process exited (code 1): Error: Failed to load
  extension \"/work2/ext/throw/index.ts\": Failed to load extension: LIVE140-THROW-AT-LOAD\nHint: …"}`;
  the `missing` and `syntax` cases the same, naming `…/missing/index.ts` with the module and
  `…/syntax/index.ts:2:2`. Nothing is disabled: `settings.json` identical after a failing agent and an
  `extensions sync`. Recovery: after `__pi remove` of the package, `agent send` on the dead agent answers
  the same error at once (the session is dead), and `agent reload <id>` then `agent send` completes
  (`recovered-live140`).
- Answered: Pi exits when another extension fails to load; its stderr names the file and the reason; with
  the fix the agent's error names it (P16 as the spec states it). Not tried: a failure at run time inside
  an extension's own tool or handler (Pi reports those as `extension_error` events; the mapper already
  turns them into `error` rows), and the real `pi-background-tasks` without the exclusion (proved in
  sprint-139: `Cannot find module 'node-pty'`; the `missing` row is the same failure shape).

### 5 — `skills` and OAuth

- `pi-studio __skills --version` prints `0.0.0` (see *Other observations*). `__skills list -g` on an empty
  home: `No global skills found.` With `HOME=/work/home` and the daemon's spawn environment (`PI_CODING_AGENT_DIR`,
  `GIT_TERMINAL_PROMPT=0`, `DISABLE_TELEMETRY=1`):
  - `__skills add /work/skillsrc -g -a pi -y -s live140-skill` (a local folder with one `SKILL.md`):
    `✓ live140-skill (copied) → ~/.agents/skills/live140-skill`; `list -g` shows it with
    `Source: /work/skillsrc`; the daemon's `listSkills` shows `{name:"live140-skill", origin:"agents_dir"}`.
  - `__skills remove -g -y live140-skill`: `Successfully removed 1 skill(s)`; folder gone, lock file `{}`,
    the daemon's list no longer has it.
  - A remote repo in the bare container: `__skills add anthropics/skills --list` →
    `Failed to clone https://github.com/anthropics/skills.git: Error: Executable not found in $PATH: "git"`.
    **`git` must be on the machine** (the same prerequisite as `pi install git:…`). With git installed
    (`apt-get install git ca-certificates` as root in a second container; daemon as uid 1000, no other
    change), through the daemon: `previewSkillSource("anthropics/skills")` → `kind:"skills_repo"`, 20 skills in
    0.8 s; `installSkills({source:"anthropics/skills", skills:["theme-factory"]})` → `ok` in 1.9 s,
    `origin:"agents_dir"`; `removeSkill({path})` → `ok`, nothing left.
- OAuth login, `pi-studio auth login <provider> --type oauth`, driven with `script(1)` in the container
  (there is no host TTY; keystrokes sent by `printf`), stopped at the first prompt, nothing completed:
  - **Defect (before the fix):** `Cannot find module './anthropic.js' imported from /$bunfs/root/pi-studio`
    and exit 1 before any prompt. Cause: the CLI runs Pi's auth engine in its own process, and only the
    daemon ran Pi's Bun runtime setup (`dist/bun/runtime-setup.js`, which registers the OAuth flows).
  - **Fix:** `preparePiRuntime()` (server `daemon/binary-runtime.ts`, shared with `prepareBinaryDaemon`) is
    handed to the CLI as `CliContext.prepareAuth`; `defaultAuthRuntime(paths, prepare?)` runs it once before
    Pi first loads (not for every command: it renames the process and silences warnings; about 8 ms on `auth status`, 0.198 s → 0.205 s); `binary-main.ts`
    sets it for the `cli` kind. Tests: `auth-runtime.test.ts` (prepare runs once, on first use, before
    Pi loads), `binary-runtime.test.ts` (both prepare steps leave a Node process alone).
  - After the fix: `anthropic` → `? Select Anthropic login method: ❯ Browser login (default) / Copy code
    login (headless)`; choosing the second prints `Complete login in your browser, then copy the code
    Anthropic shows and paste it here.`, the `https://claude.ai/oauth/authorize?…` URL and a QR code, then
    waits for the code. `github-copilot` → `? GitHub Enterprise URL/domain (blank for github.com)`; Enter
    prints `Visit: https://github.com/login/device` and a one-time code (`Expires in 899s.`): this is a real
    call to GitHub from a CA-less image. Killed there. The daemon's own flow, `loginProvider("anthropic",
    "oauth", …)` over the SDK, reaches `Select Anthropic login method:` too.
  - API-key login in the throwaway home: `auth login openrouter --type api_key --api-key <fake>` →
    `logged in (api_key)`; `auth status` → `api key / stored credential`; `auth logout openrouter` →
    `removed stored credential`.
- Answered: `skills` operations and the start of an OAuth login work in the binary. Open: **a complete
  OAuth login was not done** (instruction: stop at the first prompt).

### 6 — The oldest glibc

Static: `objdump -T pi-studio | grep -o GLIBC_[0-9.]*` → highest symbol version `GLIBC_2.17`; needed
libraries `libc, ld-linux-x86-64, libpthread, libdl, libm` (no libstdc++). Run: the folder mounted read-only,
`pi-studio --version`, `__pi --version`, `daemon start`, `daemon status`, `daemon stop`.

| Image | glibc | Result |
|---|---|---|
| debian:bookworm-slim | 2.36 | all (the rest of this document) |
| debian:bullseye-slim / ubuntu:20.04 | 2.31 | all pass |
| debian:buster-slim | 2.28 | all pass |
| ubuntu:18.04 | 2.27 | all pass |
| amazonlinux:2 | 2.26 | all pass |
| debian:stretch-slim | 2.24 | all pass |
| ubuntu:16.04 | 2.23 | all pass |
| ubuntu:14.04 | 2.19 | `--version` prints 0.0.130 (daemon not run) |
| **centos:7** | **2.17** | all pass, and a real agent turn (shell + todo tools) completed |
| **centos:6** | **2.12** | **fails**: `/lib64/libc.so.6: version 'GLIBC_2.14' not found (required by /opt/pi-studio/pi-studio)`, then `GLIBC_2.15` and `GLIBC_2.17` |
| alpine:3.20 | musl | `/opt/pi-studio/pi-studio: not found` (no glibc loader; the four release targets are glibc/macOS) |

Answered: the linux-x64 binary needs **glibc ≥ 2.17** (matches the symbol versions). [INFERENCE] The floor
is set by the pinned Bun, so a Bun bump can raise it; nothing in the release smoke test would notice. Not
tried: arm64 (only linux-x64 was built here), and a CPU without AVX2 (the `bun-linux-x64` target is not the
baseline build).

### Other observations (not fixed)

- `pi-studio __skills --version` prints `0.0.0` in the binary (npm: `1.7.4`): the `skills` CLI reads
  `../package.json` next to its own file, which does not exist inside the executable. Only `--version` and
  its telemetry initialisation (disabled) use it. Cosmetic.
- CLI commands whose daemon handler does not exist: `provider models <id>` (`no handler for list_models`),
  `agent wait` (`wait_for_agent`), `agent inspect` (`inspect_agent_request`), and `provider ls` prints an
  empty table. The same with the Node CLI against this daemon, so unrelated to the binary.
- Pi's `settings.json` writer drops the file's trailing newline (any runtime).
- A package whose manifest names a missing entry file is skipped silently by Pi (the `noentry` case).
- `agent run` returns only after the first turn (`create_agent` awaits it), and the CLI's RPC timeout is 30 s
  (seen: `request timed out` at 30.0 s while the agent kept running); a first turn longer than that would
  show the same error. [INFERENCE] for the long-turn case; unchanged behaviour.

### Spec questions

| Question | Status |
|---|---|
| Both `SettingsManager` replacements inside the compiled binary | **Answered.** The `getNpmCommand` replacement: Pi's installs and the sync run on the `bun` script with no `npmCommand` in `settings.json` (items 1–2). The `resolve()` filter: an excluded entry is neither installed nor loaded, and stays in the file (items 2–3). |
| The server test suite under Bun | **Open, partly tried.** `bun --bun node_modules/vitest/vitest.mjs run` on 5 files: `skills-cli` and `pi-overrides` pass; `self.test.ts` 2 tests fail (they spawn `process.execPath` as Node); `pi-adapter` and `transport-errors` do not load (`z` undefined in `protocol/validation.ts`: vitest's module interop under Bun). The product code under Bun is exercised by this document and the smoke test instead; making the unit suite run under Bun is the owner's call. |
| `skills` CLI operations in the binary | **Answered** (item 5); remote repos need `git`. |
| Extension auto-sync at boot | **Answered** (item 1): 3 of 3 in about 2.5 s, no npm. |
| A complete OAuth login | **Open.** First prompt reached with the CLI (after the fix) for `anthropic` and `github-copilot`, and with the daemon for `anthropic`; not completed on purpose. |
| What Pi does when another extension fails to load (P16) | **Answered** (item 4): it exits, its stderr names the file and reason, and (after the fix) the agent's error does too. |
| The oldest glibc | **Answered** (item 6): 2.17. |
| The Intel macOS runner label (S3) | **Open, not tried**: macOS is another sprint's. |
| A macOS binary on a real Mac (D16) | **Open, not tried**: the owner's. |

Feature-spec acceptance rows covered here: "a real agent turn … runs a shell command and uses the todo
tool" (terminal and a 1 MiB file transfer are in the smoke test), "Pi installs an extension … gains only the
installed entry", "With `pi-background-tasks` already installed … an agent starts".

### Defects found and fixed

| Defect | Files | Tests |
|---|---|---|
| A Pi that exits at start-up (a package that fails to load) leaves the agent `running` forever; its stderr reaches only the daemon log (P16) | `packages/server/src/agent/providers/pi/rpc-transport.ts`, `agent.ts` | `transport-errors.test.ts`, `pi-adapter.test.ts` |
| `pi-studio auth login … --type oauth` fails in the binary with `Cannot find module './anthropic.js'` | `packages/server/src/daemon/binary-runtime.ts`; `packages/cli/src/auth-runtime.ts`, `cli-core.ts`, `auth-commands.ts`, `binary-main.ts` | `auth-runtime.test.ts`, `binary-runtime.test.ts` (new) |

Narrow checks after the fixes: `vitest run` on the pi transport/adapter, `auth-runtime`, `auth-commands`,
`binary-dispatch` and `binary-runtime` tests (all pass), `tsc -b` for server and cli, `oxlint` and `oxfmt`
on the changed files, the binary smoke test and the container check on the rebuilt binary. The full
`npm test` and the full `npm run build` were not run.

### For the owner

- **`git` as a prerequisite** of `skills add <owner/repo>` and `pi install git:…` on a Node-less machine
  (`Executable not found in $PATH: "git"`): document it, or accept it as it is for the npm daemon.
  Recommendation: document; it is the same as on the npm daemon.
- **The supported glibc floor:** 2.17 today (CentOS 7 era). Recommendation: state it in the install docs
  and re-check on every Bun bump (a `objdump -T … | grep GLIBC_` line in the smoke test would catch a raise).
- Leave the `0.0.0` of `__skills --version`, and the CLI commands without a daemon handler, as separate
  tickets if wanted.
