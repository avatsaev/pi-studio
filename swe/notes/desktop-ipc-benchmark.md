# Desktop IPC benchmark — notes

## What a daemon sends

Measured facts about real daemon traffic, taken at the WebSocket transport boundary of the SDK
(`packages/client`): every frame's size (wire bytes of the text or binary message, binary frames
including their 1–3 byte header) and arrival time. Sizes are per frame, not per RPC.

### Setup

- Machine: AMD Ryzen 9 9955HX (16 cores / 32 threads), 31 GiB RAM, Linux 7.0.14-29-pve, Node v24.22.2.
  The daemon and the measuring client ran on the **same** machine and shared its CPU, over loopback.
- Daemon: dev daemon of `@av-pi-studio/server` 0.0.124 (git `ca94466`), mock provider, real PTYs,
  real file transfer.
- Client: `DaemonClient`, `PiStudioClient`, `TerminalStreamRouter`, `FileTransferClient` from
  `packages/client/dist`; the transport's `onMessage`, `sendText` and `sendBinary` are wrapped to
  record `(direction, kind, bytes, time)`. Client = Node's global `WebSocket`.
- Commands (the script was a throwaway under `/tmp`, deleted afterwards):

```sh
PI_STUDIO_HOME=$(mktemp -d) PI_STUDIO_LISTEN=127.0.0.1:<free port> \
  PI_STUDIO_MOCK_TURN_DELAY_MS=0 npm run dev:daemon
node /tmp/frame-sizes/measure.mjs <free port>
```

- Recordings:
  1. **terminal**: `create_terminal_request` + `subscribe_terminal_request`, then the client typed
     `yes <79 x's> | head -c 104857600; echo FLOOD_DONE_$((1+1))` (100 MiB of 80-byte lines) and
     recorded until the marker arrived. Received payload: 106 168 469 bytes (PTY turns `\n` into `\r\n`).
  2. **file transfer**: `FileTransferClient.upload` of a 256 MiB buffer, then `downloadTo` of the
     same file (268 435 456 bytes each way, both verified).
  3. **timeline**: one mock agent, 600 prompts (`#tool shell`, `#stream reasoning`, a plain prompt,
     in rotation) giving 2604 timeline items, then fetched with `fetch_agent_timeline_request`
     page by page (`direction: after`, `limit: 50`, 53 pages), then once with `limit: 100000`.
     An extra probe read a 5 MiB file with `file_read_request` (the inline-read cap,
     `MAX_INLINE_FILE_READ_BYTES`) to see the largest possible text frame.

Sizes are bytes. Rate = frames / (last frame time − first frame time) within the phase and direction.
One run, no repetitions.

### Terminal flood (100 MiB)

| dir | kind | frames | secs | frames/s | min | median | p99 | max |
|-----|------|-------:|-----:|---------:|----:|-------:|----:|----:|
| in (daemon → client) | binary | 301 | 1.79 | 168 | 4 | 362 398 | 487 433 | 553 220 |
| in | text | 5 | 1.80 | 3 | 71 | 179 | 243 | 243 |
| out (client → daemon) | text | 3 | 1.80 | 2 | 121 | 126 | 147 | 147 |
| out | binary | 1 | – | – | 132 | 132 | 132 | 132 |

The flood arrived at ~57 MiB/s. Frames are far larger than 4 KiB / 64 KiB: the median is ~354 KiB
and the p99 ~476 KiB, because at that rate the daemon's 4 ms coalescing window collects ~230 KB per
flush and a flush is one frame. (Frames of 4 bytes are the tail.) The only client → daemon binary
frame is the typed command.

### File transfer, 256 MiB each way

| phase | dir | kind | frames | secs | frames/s | min | median | p99 | max |
|-------|-----|------|-------:|-----:|---------:|----:|-------:|----:|----:|
| upload | out | binary | 8194 | 2.92 | 2805 | 3 | 32 770 | 32 770 | 32 770 |
| upload | out | text | 1 | – | – | 206 | 206 | 206 | 206 |
| upload | in | text | 2 | 2.92 | 1 | 132 | 158 | 158 | 158 |
| download | in | binary | 8194 | 0.29 | 27 815 | 3 | 32 770 | 32 770 | 32 770 |
| download | in | text | 1 | – | – | 245 | 245 | 245 | 245 |
| download | out | text | 1 | – | – | 156 | 156 | 156 | 156 |

Every chunk is exactly 32 KiB of payload + 2-byte header (32 770); 8192 chunks + Begin + End = 8194
frames. Upload was paced by the client (`bufferedAmount` high water, 1 MiB); the download ran
unpaced at ~880 MiB/s over loopback.

### Long timeline

| phase | dir | kind | frames | secs | frames/s | min | median | p99 | max |
|-------|-----|------|-------:|-----:|---------:|----:|-------:|----:|----:|
| build (600 prompts + live `agent_stream`) | in | text | 5610 | 0.73 | 7694 | 117 | 231 | 373 | 373 |
| build | out | text | 601 | 0.73 | 825 | 177 | 184 | 186 | 186 |
| pages (53 × limit 50) | in | text | 53 | 0.01 | 5311 | 1 056 | 10 966 | 11 042 | 11 042 |
| pages | out | text | 53 | 0.01 | 4403 | 199 | 215 | 215 | 215 |
| one-shot (`limit: 100000`, 2604 items) | in | text | 1 | – | – | 551 972 | 551 972 | 551 972 | 551 972 |

Mock rows are small (~210 B each); a real session with large tool outputs will give bigger pages.

### Largest frames seen

| direction | kind | largest | produced by |
|-----------|------|--------:|-------------|
| daemon → client | text | 5 243 061 (≈ 5.0 MiB) | `file_read_request` of a 5 MiB file (the inline-read cap plus JSON) |
| daemon → client | text (excluding that probe) | 551 972 | `fetch_agent_timeline_request`, `limit: 100000`, 2604 items |
| daemon → client | binary | 553 220 | terminal `Output` frame of the flood |
| client → daemon | text | 215 | timeline page request (the largest request seen; requests are tiny) |
| client → daemon | binary | 32 770 | file upload chunk |

All of it is orders of magnitude under 128 MiB (the largest frame seen, 5 MiB, is about 4 % of 128 MiB); nothing observed needs the cap, but a real timeline or file read with 10⁴–10⁵ rows has not been
tried (TODO(verify)).

### Limits of this measurement

- Daemon and client share a CPU; the terminal's frame size depends on how fast the PTY produces
  and the 4 ms coalescing window, so a slower producer (a real shell program) gives smaller frames.
- Loopback, no relay, a Node client (no browser, no Tauri).
- One run per recording; the mock provider's messages are small.

## Results on three platforms (measured 2026-11-21, written 2026-11-22)

Task sprint-112/task-007. Spec: `swe/features/desktop-transport-bridge.md` § 1. Every figure below
was read from a `results.json` or a `bench.log` of the run named; nothing is estimated unless the
sentence says so.

### Verdict

**The gate failed.** No variant of the channel bridge (spec § 2–3) passes every gated row on all
three platforms. Per the spec's "If it fails" (decision T3), § 2–3 are not built, the tasks of
sprints 115 and 116 are in `blocked/`, and the owner chooses the design (sprint-112/task-008).

| Platform | Per-frame channel (`bridge-frame`) | Batched channel (`bridge-batch`) |
|---|---|---|
| Windows (runner) | Fails B1 median, B2/4 KiB, B2/64 KiB, B4, B4 memory, B5, in all three full runs | Fails the same six rows, in all three full runs |
| macOS (runner) | Fails B2/4 KiB and B4 in all three full runs; one run of run 3 stalled for good (a lost channel message) | Fails B4 in two of three full runs (13 % under its mark); passes every other row |
| Linux (development machine, container) | Fails B4 (half-the-baseline rule) and B4 memory | Fails B4 (half-the-baseline rule) and B4 memory |

The rule "a row that fails only on a virtual runner, within 20 % of its mark, is measured on a real
machine first" does not rescue the gate: on Windows the batched variant misses B4 by 66 %
(29.9 MiB/s against 88.8) and B5 by 33 % (28.6 against 42.4), in three runs that agree within 3 %.
Its B2/4 KiB and B2/64 KiB misses (13 to 18 % under 40 MiB/s) and its B1 miss (1.2 ms against 1 ms)
are inside that 20 %, and so is the macOS B4 miss; a real machine could move those four, not B4 and
B5 on Windows.

No pass mark was changed. Two marks are put to the owner below (§ Proposal).

A fourth transport, `proxy-ws` (a loopback WebSocket proxy owned by Rust: the other design T3 asks
for), was added to the benchmark after the failure and measured on all three platforms. It passes
every gated row on macOS; on Windows and Linux it passes every row except B4 memory growth, where
the page's own WebSocket (the baseline) grows by more in the same runs.

### The runs

All on pull request 60 (branch `feat/desktop-transport-bridge`), release builds, Tauri 2.12.5.

| Run | Commit | Runs × scale | macOS | Windows | What it showed |
|---|---|---|---|---|---|
| [1](https://github.com/avatsaev/pi-studio/actions/runs/44916778278) | `5ff434b` | 1 × 0.1 | exit 0 | exit 1 | Windows, per-frame, B3: `no such connection` (a late acknowledgement after the socket ended). Fixed in the benchmark; a rule for the real bridge |
| [2](https://github.com/avatsaev/pi-studio/actions/runs/44917963549) | `31ae83a` | 3 × 1 | finished | cancelled after 28 minutes | Windows, per-frame, B3: `Channel::send` failed ("failed to send message to the webview") after about 12,100 small frames; the page could not be told and waited 600 s, twice. Led to a bound of 512 unacknowledged messages and a 30 s stall watchdog |
| [3](https://github.com/avatsaev/pi-studio/actions/runs/44921715444) | `6d6a209` | 3 × 1 | exit 1 | exit 0 | macOS, per-frame, B2/4 KiB run 1: one channel message never reached the page and Tauri's ordered channel held the 512 behind it for good. First full Windows data |
| [4](https://github.com/avatsaev/pi-studio/actions/runs/44925277721) | `8ed64c3` | 3 × 1 | exit 0 | exit 0 | Second full sample; agrees with run 3. The lost message did not recur |
| [5](https://github.com/avatsaev/pi-studio/actions/runs/44928495924) | `55b4b5c` | 3 × 1 | exit 0 | exit 0 | Four transports (with `proxy-ws`). The tables below |

Linux: the same binary as run 4 (three transports) and the binary of run 5 (four transports, run
by the benchmark's author), `--runs 3 --scale 1`, in the `pi-desktop-xvfb` container. **The Linux
`results.json` files were kept only in `/tmp` and were lost on 2026-11-22**; the Linux figures here
are the worst-of-three values copied from the runs' output at the time, so the three per-run values
are missing for Linux. TODO(verify): run it once more when a benchmark run is wanted again, and
attach the file.

### Machines and versions

| | Linux | macOS | Windows |
|---|---|---|---|
| Machine | Development machine, AMD Ryzen 9 9955HX (16 cores, 32 threads), Docker container, Xvfb | GitHub runner `macos-15-arm64` (image 20261118.0550.1), "Apple M1 (Virtual)", 3 cores | GitHub runner `windows-2025-vs2026` (image 20261116.315.1), AMD EPYC 7763, 2 cores (4 logical) |
| OS | Ubuntu (the `pi-desktop-xvfb` image) | macOS 15.8.2 | Windows Server 2025 Datacenter |
| Webview | WebKitGTK 4.1 (version not recorded) | WKWebView, `AppleWebKit/605.1.15` | WebView2 157 (`Edg/157.0.0.0`) |
| Page origin | `tauri://localhost` | `tauri://localhost` | `http://tauri.localhost` |
| Timer step | 1 ms | 1 ms | 0.1 ms |
| IPC path for raw bodies | custom protocol (raw bytes) | custom protocol (raw bytes) | custom protocol (raw bytes) |
| Raw bodies sent as JSON arrays | 0 | 0 | 0 |
| Sends reaching Rust out of `seq` order (run 5) | not recorded here | per-frame 15,844 (at most 29 waiting), batched 0 | per-frame 1,188 (at most 28 waiting), batched 0 |

### Windows, run 5

Worst of three in bold, the three runs in brackets; `~` marks a row whose runs differ by more than
20 %. `websocket` is the baseline (what the app does today).

| Row | `websocket` | `bridge-frame` | `bridge-batch` | `proxy-ws` |
|---|---|---|---|---|
| B1 echo, mean ms | **0.26** (0.26 / 0.25 / 0.25) | **1.56** (1.55 / 1.56 / 1.55) | **1.75** (1.75 / 1.57 / 1.74) | **0.39** (0.37 / 0.39 / 0.36) |
| B1 echo, median ms | **0.3** (0.3 / 0.3 / 0.3) | **1.5** (1.5 / 1.5 / 1.5) | **1.5** (1.5 / 1.5 / 1.5) | **0.4** (0.4 / 0.4 / 0.4) |
| B1 echo, p99 ms | **0.4** (0.4 / 0.4 / 0.4) | **2.3** (2.3 / 2.2 / 2.2) | **3.2** (3.2 / 2.2 / 2.6) ~ | **0.5** (0.5 / 0.5 / 0.5) |
| B2 flood 4 KiB, MiB/s | **104.8** (104.8 / 107 / 110.8) | **3.4** (3.5 / 3.4 / 3.4) | **33.5** (33.5 / 34.9 / 33.6) | **90.7** (90.7 / 94.2 / 95.8) |
| B2 flood 64 KiB, MiB/s | **55.3** (117.7 / 76 / 55.3) ~ | **35.6** (35.6 / 36.5 / 38) | **34.7** (35.1 / 34.7 / 34.9) | **175.8** (175.8 / 182.8 / 187.1) |
| B2 flood 256 KiB, MiB/s | **471.4** (471.4 / 477.3 / 535.9) | **68.8** (68.8 / 70 / 70.1) | **65.7** (65.7 / 69.5 / 69.2) | **434.3** (458.8 / 435.2 / 434.3) |
| B3 small frames, frames/s | **36,087** (37,441 / 36,087 / 37,107) | **5,428** (5,592 / 5,516 / 5,428) | **86,419** (86,419 / 91,037 / 102,559) | **38,369** (38,873 / 40,231 / 38,369) |
| B4 download, MiB/s | **177.5** (243.2 / 218.7 / 177.5) ~ | **20** (20.6 / 20 / 20) | **29.9** (29.9 / 30 / 30.5) | **164.1** (169.8 / 164.1 / 173.6) |
| B4 memory growth, MiB | **2,746** (113 / 88 / 2,746) ~ | **650** (650 / 26 / 24) ~ | **2,433** (80 / 2,433 / 48) ~ | **87** (87 / 64 / 78) ~ |
| B5 upload, MiB/s | **84.7** (84.7 / 86.9 / 85.4) | **23.6** (23.6 / 24.4 / 25.2) | **28.6** (31.4 / 28.9 / 28.6) | **83.6** (83.6 / 83.7 / 84) |
| B5 `bufferedAmount` at the end | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) |
| W1 bytes Rust holds, MiB | n/a | **8.06** (8.06 / 8.06 / 8.06) | **8.06** (8.06 / 8.06 / 8.06) | **0.25** (0.25 / 0.25 / 0.25) |
| B7 echo during a download, mean ms | **5.9** (5.7 / 5.9 / 5.7) | **254.8** (254.8 / 248.2 / 249) | **199.4** (196.7 / 199.4 / 197.8) | **7.3** (7.3 / 7.1 / 6.9) |
| B7 echo during a download, p99 ms | **24** (24 / 16.2 / 17.2) ~ | **555.1** (555.1 / 541.5 / 471.7) | **410.5** (347.5 / 362.4 / 410.5) | **33** (33 / 31.9 / 29.6) |
| B7 download during the echo, MiB/s | **112.3** (115.8 / 112.3 / 116.7) | **23.1** (23.3 / 23.1 / 23.1) | **34.9** (35.1 / 34.9 / 35.3) | **187.8** (187.8 / 195 / 197.1) |
| B8 hidden: frames lost | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) |
| B8 hidden: worker timer, latest fire ms | **14** (13 / 14 / 13) | **182** (156 / 182 / 148) | **31** (31 / 29 / 28) | **17** (17 / 13 / 14) ~ |
| B8 hidden: page timer, latest fire ms | **14** (12 / 14 / 13) | **165** (165 / 126 / 162) ~ | **14** (14 / 13 / 12) | **15** (15 / 13 / 14) |
| B8 minimised: frames lost | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) |
| B8 minimised: worker timer, latest fire ms | **16** (13 / 16 / 13) ~ | **172** (172 / 158 / 160) | **32** (32 / 17 / 28) ~ | **15** (15 / 13 / 12) ~ |
| B8 minimised: page timer, latest fire ms | **14** (14 / 13 / 12) | **198** (198 / 154 / 179) ~ | **27** (12 / 27 / 11) ~ | **14** (13 / 14 / 14) |

On Windows the webview did not report the window as hidden (`pageSawHidden` false in every run), so
the B8 rows there say nothing about a throttled page. The per-frame channel could not keep up with
B8's 1,000 frames/s of 4 KiB: it was about 3,700 frames behind when the window was shown and took
about 5 s to catch up.

### macOS, run 5

| Row | `websocket` | `bridge-frame` | `bridge-batch` | `proxy-ws` |
|---|---|---|---|---|
| B1 echo, mean ms | **0.39** (0.36 / 0.36 / 0.39) | **0.8** (0.8 / 0.75 / 0.7) | **1.04** (1.01 / 1 / 1.04) | **0.42** (0.31 / 0.32 / 0.42) ~ |
| B1 echo, median ms | **0** (0 / 0 / 0) | **1** (1 / 1 / 1) | **1** (1 / 1 / 1) | **0** (0 / 0 / 0) |
| B1 echo, p99 ms | **1** (1 / 1 / 1) | **2** (2 / 2 / 2) | **3** (3 / 3 / 3) | **1** (1 / 1 / 1) |
| B2 flood 4 KiB, MiB/s | **48.9** (48.9 / 69.7 / 74.7) ~ | **23.3** (23.3 / 28.5 / 27.8) | **159.9** (159.9 / 185.6 / 181.3) | **52.4** (72.5 / 66.4 / 52.4) ~ |
| B2 flood 64 KiB, MiB/s | **587.2** (587.2 / 594 / 613.9) | **283.5** (283.5 / 335.5 / 298.7) | **127.6** (167 / 176.8 / 127.6) ~ | **460.4** (462.1 / 460.4 / 461.3) |
| B2 flood 256 KiB, MiB/s | **625.9** (680.9 / 733.5 / 625.9) | **554.1** (630.5 / 611 / 554.1) | **319.2** (319.2 / 356.1 / 336.4) | **663.2** (705.2 / 663.2 / 715.1) |
| B3 small frames, frames/s | **16,027** (16,555 / 16,027 / 18,342) | **41,186** (41,186 / 44,444 / 41,229) | **375,234** (498,753 / 377,358 / 375,234) ~ | **12,561** (12,631 / 12,561 / 12,646) |
| B4 download, MiB/s | **359.4** (359.4 / 365.7 / 444.6) | **165.3** (165.3 / 167.8 / 193.2) | **155.9** (155.9 / 160.5 / 158.9) | **292.9** (292.9 / 355.1 / 361.5) |
| B4 memory growth, MiB | **0** (0 / 0 / 0) ~ | **22** (22 / 0 / 0) ~ | **2** (1 / 2 / 2) ~ | **0** (0 / 0 / 0) ~ |
| B5 upload, MiB/s | **74.9** (79.5 / 80 / 74.9) | **54.7** (54.7 / 57.7 / 56.8) | **80.9** (80.9 / 82.5 / 83.9) | **67.9** (73.8 / 68.6 / 67.9) |
| B5 `bufferedAmount` at the end | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) |
| W1 bytes Rust holds, MiB | n/a | **8.06** (8.06 / 8.06 / 8.06) | **8.06** (8.06 / 8.06 / 8.06) | **0.25** (0.25 / 0.25 / 0.25) |
| B7 echo during a download, mean ms | **2.4** (2 / 2.4 / 1) ~ | **128.4** (128.4 / 124.6 / 74.5) ~ | **51.5** (32.2 / 51.5 / 47.5) ~ | **4.8** (3.4 / 4 / 4.8) ~ |
| B7 echo during a download, p99 ms | **16** (12 / 16 / 10) ~ | **382** (382 / 244 / 196) ~ | **115** (76 / 99 / 115) ~ | **29** (22 / 29 / 27) ~ |
| B7 download during the echo, MiB/s | **305.1** (305.1 / 311.3 / 451.1) ~ | **75.2** (79.7 / 75.2 / 108.3) ~ | **170.4** (246.4 / 185.5 / 170.4) ~ | **308** (319.1 / 308 / 356.9) |
| B8 hidden: frames lost | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) |
| B8 hidden: worker timer, latest fire ms | **11** (11 / 11 / 11) | **17** (16 / 17 / 13) ~ | **14** (13 / 12 / 14) | **15** (13 / 13 / 15) |
| B8 hidden: page timer, latest fire ms | **983** (983 / 964 / 952) | **899** (899 / 881 / 860) | **503** (502 / 503 / 502) | **514** (514 / 502 / 502) |
| B8 minimised: frames lost | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) | **0** (0 / 0 / 0) |
| B8 minimised: worker timer, latest fire ms | **15** (11 / 11 / 15) ~ | **20** (15 / 20 / 15) ~ | **17** (14 / 17 / 16) | **14** (12 / 14 / 13) |
| B8 minimised: page timer, latest fire ms | **932** (932 / 926 / 910) | **837** (837 / 824 / 808) | **504** (502 / 504 / 502) | **504** (503 / 504 / 503) |

### Linux

Worst of three. Left: the three-transport run (binary of run 4). Right: the four-transport run
(binary of run 5). The two runs are separate, so their baselines differ.

| Row | `websocket` | `bridge-frame` | `bridge-batch` | | `websocket` | `bridge-batch` | `proxy-ws` |
|---|---|---|---|---|---|---|---|
| B1 echo, mean ms slower than the baseline | n/a | 0.1 | 0.1 | | n/a | 0.12 | 0.01 |
| B2 flood 4 KiB, MiB/s | 516.1 | 61.8 | 475.8 | | 594 | 443 | 552 |
| B2 flood 64 KiB, MiB/s | 2,081.3 | 467.2 | 512 | | 2,065 | 496 | 1,816 |
| B2 flood 256 KiB, MiB/s | 2,133.3 | 622.9 | 611 | | 2,207 | 632 | 2,098 |
| B3 small frames, frames/s | 518,135 | 96,712 | 1,020,408 | | 529,100 | 1,047,120 | 694,444 |
| B4 download, MiB/s | 2,019.7 | 343.6 | 503.9 | | 1,822 | 517 | 1,838 |
| B4 memory growth, MiB | 194 | 439 | 162 | | 198 | not copied | 246 |
| B5 upload, MiB/s | 86.4 | 84.1 | 86.4 | | 86.3 | 86.3 | 86.4 |
| W1 bytes Rust holds | n/a | 8,454,144 | 8,454,144 | | n/a | 8,454,144 | 262,144 |
| B7 echo during a download, mean ms | 5.8 | 31.7 | 23.3 | | 8.0 | 21.4 | 13.1 |
| B7 echo during a download, p99 ms | 32 | 56 | 42 | | 29 | 36 | 122 |
| B7 download during the echo, MiB/s | 2,003.9 | 342.5 | 474.7 | | 2,024 | 498 | 1,914 |
| B6 damaged runs | 0 | 0 | 0 | | 0 | 0 | 0 |

B8 under Xvfb shows nothing about a hidden window (the page timer is about 560 ms late for every
transport, the baseline included). One container run of an earlier binary aborted once in native
code (`corrupted double-linked list`, exit 134) and did not repeat in four later runs; read as a
flake of the display server or WebKitGTK, not proven.

### Each gated row, for the two designs still standing

| Row | Mark | Batched channel: Linux | macOS | Windows | Loopback proxy: Linux | macOS | Windows |
|---|---|---|---|---|---|---|---|
| B1 echo, slower than the baseline | at most 1 ms (the mean where the timer steps by 1 ms) | 0.1: pass | 0.65: pass | 1.2: **FAIL** | 0.01: pass | 0.03: pass | 0.1: pass |
| B2 4 KiB | at least 40 MiB/s | 475.8: pass | 159.9: pass | 33.5: **FAIL** | 552: pass | 52.4: pass | 90.7: pass |
| B2 64 KiB | at least 40 MiB/s | 512: pass | 127.6: pass | 34.7: **FAIL** | 1,816: pass | 460.4: pass | 175.8: pass |
| B2 256 KiB | at least 40 MiB/s | 611: pass | 319.2: pass | 65.7: pass | 2,098: pass | 663.2: pass | 434.3: pass |
| B3 | at least 5,000 frames/s | 1,020,408: pass | 375,234: pass | 86,419: pass | 694,444: pass | 12,561: pass | 38,369: pass |
| B4 download | half the baseline, and 40 MiB/s | 503.9 of 1,009.9: **FAIL** | 155.9 of 179.7: **FAIL** | 29.9 of 88.8: **FAIL** | 1,838 of 911: pass | 292.9 of 179.7: pass | 164.1 of 88.8: pass |
| B4 memory growth | at most 72 MiB | 162: **FAIL** (baseline 194) | 2: pass | 2,433: **FAIL** (baseline 2,746) | 246: **FAIL** (baseline 198) | 0: pass | 87: **FAIL** (baseline 2,746) |
| B5 upload | half the baseline, and 40 MiB/s | 86.4: pass | 80.9: pass | 28.6 of 42.4: **FAIL** | 86.4: pass | 67.9: pass | 83.6: pass |
| B5 `bufferedAmount` at the end | 0 | 0: pass | 0: pass | 0: pass | 0: pass | 0: pass | 0: pass |
| B6 order and integrity | none damaged | pass | pass | pass | pass | pass | pass |
| B8 frames lost | none | 0: pass | 0: pass | 0: pass | 0: pass | 0: pass | 0: pass |
| W1 bytes Rust holds | the window (8 MiB) and a frame; 512 KiB for the proxy | pass | pass | pass | pass | pass | pass |

Not gated, but what a person would feel (B7, the mean round trip of a keystroke while a 1 GiB
download runs on the same connection): baseline 5.8, 2.4 and 5.9 ms on Linux, macOS and Windows;
batched channel 23.3, 51.5 and 199.4 ms; proxy 13.1, 4.8 and 7.3 ms.

### Agreement between the full runs (batched channel)

Windows:

| Row | Mark (run 5) | Run 3 | Run 4 | Run 5 |
|---|---|---|---|---|
| B1 medianMs slower than the baseline | at most 1 ms | 1.2 (baseline 0.3): FAIL | 1.2 (baseline 0.3): FAIL | 1.2 (baseline 0.3): FAIL |
| B1 meanMs slower than the baseline | at most 1 ms where the timer is coarse | 1.46 (baseline 0.26): reported | 1.31 (baseline 0.26): reported | 1.48 (baseline 0.26): reported |
| B2/4KiB MiB/s | at least 40 | 34.1 (baseline 111.7): FAIL | 33.5 (baseline 102.7): FAIL | 33.5 (baseline 104.8): FAIL |
| B2/64KiB MiB/s | at least 40 | 35 (baseline 129.3): FAIL | 33 (baseline 99.7): FAIL | 34.7 (baseline 55.3): FAIL |
| B2/256KiB MiB/s | at least 40 | 66.7 (baseline 453.8): pass | 64.5 (baseline 474.2): pass | 65.7 (baseline 471.4): pass |
| B3 frames/s | at least 5000 | 92,264 (baseline 38,299): pass | 90,400 (baseline 38,550): pass | 86,419 (baseline 36,087): pass |
| B4 MiB/s | at least 88.8 (half the baseline, and 40) | 29.3 (baseline 158.3): FAIL | 29.4 (baseline 167): FAIL | 29.9 (baseline 177.5): FAIL |
| B4 memory growth KiB | at most 73728 | 104,140 (baseline 63,016): FAIL | 131,544 (baseline 107,356): FAIL | 2,491,568 (baseline 2,812,028): FAIL |
| B5 MiB/s | at least 42.4 (half the baseline, and 40) | 27.8 (baseline 84.6): FAIL | 27 (baseline 84.4): FAIL | 28.6 (baseline 84.7): FAIL |
| B7 meanMs of the echo while the download runs | reported only (one socket is shared) | 196.47 (baseline 5.87): reported | 220.41 (baseline 6.02): reported | 199.38 (baseline 5.94): reported |

macOS:

| Row | Mark (run 5) | Run 3 | Run 4 | Run 5 |
|---|---|---|---|---|
| B1 medianMs slower than the baseline | at most 1 ms | 1 (baseline 0): reported | 1 (baseline 0): reported | 1 (baseline 0): reported |
| B1 meanMs slower than the baseline | at most 1 ms where the timer is coarse | 0.2 (baseline 0.53): pass | 0.58 (baseline 0.61): pass | 0.65 (baseline 0.39): pass |
| B2/4KiB MiB/s | at least 40 | 226.7 (baseline 63.1): pass | 199.4 (baseline 42.4): pass | 159.9 (baseline 48.9): pass |
| B2/64KiB MiB/s | at least 40 | 230 (baseline 566.4): pass | 127.4 (baseline 368.9): pass | 127.6 (baseline 587.2): pass |
| B2/256KiB MiB/s | at least 40 | 419 (baseline 673.7): pass | 293.2 (baseline 382.1): pass | 319.2 (baseline 625.9): pass |
| B3 frames/s | at least 5000 | 459,770 (baseline 17,467): pass | 323,625 (baseline 15,616): pass | 375,234 (baseline 16,027): pass |
| B4 MiB/s | at least 179.7 (half the baseline, and 40) | 228.8 (baseline 279.6): pass | 161.7 (baseline 370.2): FAIL | 155.9 (baseline 359.4): FAIL |
| B4 memory growth KiB | at most 73728 | 2,736 (baseline 384): pass | 3,968 (baseline 320): pass | 2,160 (baseline 368): pass |
| B5 MiB/s | at least 40 (half the baseline, and 40) | 81.3 (baseline 70.4): pass | 81.7 (baseline 77.2): pass | 80.9 (baseline 74.9): pass |
| B7 meanMs of the echo while the download runs | reported only (one socket is shared) | 38.19 (baseline 2.38): reported | 46.93 (baseline 1.69): reported | 51.45 (baseline 2.37): reported |

The Windows figures of the batched channel agree within 3 % over three runs while the baseline on
the same runner moved by up to a factor of two (B2/64 KiB: 129, 100, 55 MiB/s), so the channel's
rate there is set by the channel, not by the runner's noise.

### Why the channel is slow on Windows

Read in Tauri 2.12.5 (`src/ipc/channel.rs`) and wry 0.57.2 (`src/webview2/mod.rs`): a raw channel
message under 1,024 bytes is evaluated as a script; a larger one is stored, and a script makes the
page fetch it through the custom protocol. On Windows that request is a `WebResourceRequested`
event handled on the UI thread, the body is copied into a memory stream and handed to the WebView2
browser process, which passes it to the page. The run-5 Windows numbers fit one cost per fetched
message:

| Case (Windows, run 5) | Rate | Messages/s | Time per message |
|---|---|---|---|
| Per-frame, 200-byte text frames (B3; evaluated, no fetch) | 5,428 frames/s | 5,428 | 0.18 ms |
| Per-frame, 4 KiB frames (B2) | 3.4 MiB/s | 873 | 1.15 ms |
| Batched, batches flushed at 64 KiB (B2/64 KiB) | 34.7 MiB/s | 555 | 1.8 ms |
| Batched, 256 KiB frames, one per message (B2/256 KiB) | 65.7 MiB/s | 263 | 3.8 ms |

The counters agree: in run 5 the batched variant sent 157,233 fetched messages and 6,338 evaluated
ones. This is an inference from the rates and the source, not a profile. By the same two points
(about 1.15 ms per message plus about 10 ms per MiB), batches of 1 MiB would carry roughly
90 MiB/s on that runner: an estimate, not measured, and larger batches delay a keystroke queued
behind them.

Is it the runner? The absolute rate, in part: run 1 landed on a faster virtual machine and the
batched variant did 64 MiB/s on the download against a baseline of 504 (one run at a tenth of the
scale). The ratio, no: the channel was 6 to 8 times slower than the page's own WebSocket on both
machines, and `proxy-ws` did 164 MiB/s on the slow one. A real Windows machine was not measured.

### What the channel did wrong along the way

Three failures of the per-frame variant, each on one platform, each a property of Tauri's channel
that the batched variant shares in a milder form (fewer messages):

1. **Windows, run 1.** An acknowledgement sent after the socket ended was answered with
   `no such connection` and hid the real reason. Rule: an unknown handle on an acknowledgement is
   ignored; `closed` is the last word.
2. **Windows, run 2.** `Channel::send` failed after about 12,100 small messages were queued; the
   page cannot be told over the channel that failed. Rule: a window in messages (512) beside the
   window in bytes (8 MiB), and the page detects a dead channel by itself.
3. **macOS, run 3.** One message was never delivered and the ordered channel held everything
   behind it; neither side is told. Not reproduced in runs 4 and 5 or in 35 Linux runs. The cause
   is unproven (candidate: WebKit dropped one fetch). Rule: a stall watchdog, because the channel
   can lose a message silently.

### The hidden window and timers (decision P7)

- **macOS (the page saw `hidden`):** the page's 500 ms timer fired 0.5 to 1 s late while hidden or
  minimised, on every transport; a worker's timer fired at most 20 ms late; no transport lost a
  frame; Rust's 2 s tick was at most 10 ms late over 30 s hidden.
- **Windows:** the page never saw `hidden`, so nothing was throttled and nothing is learned.
- **Linux (Xvfb):** nothing is learned.

Recommendation: P7 stands. The reconnect timers stay worker timers; a page timer would be up to a
second late on macOS.

### What the loopback proxy costs against the channel

- **A local port.** `127.0.0.1` on a random port, one listener per connection, open until the
  page's upgrade or for 10 s. Guarded by a single-use 256-bit token (constant-time compare) and an
  `Origin` check. A browser tab on the machine is refused by the origin; a native program can forge
  the origin, so only the token stops it. After the page connected no listener remains.
- **A socket in the webview again**, though only to loopback: hidden-window and sleep behaviour of
  that leg is the webview's, as today. T3 says "a socket left in the webview is not the fallback";
  whether a loopback leg meets that is the owner's call.
- **No backpressure from the page.** With the page blocked for 3 s the webview took a 128 MiB flood
  into its own memory (Linux); Rust held 256 KiB. The channel bridge stalls the server instead
  (W1: 8 MiB held).
- **Small frames are no faster than today** (macOS: 12,561 frames/s against 375,234 for the batched
  channel; mark 5,000).
- **The password can stay out of the page, as planned for the channel bridge.** The spec has Rust
  add the password to the upgrade request (the `pi-studio.bearer.<password>` subprotocol); Rust
  dials the upstream leg in the proxy too, so it can add it there and the page offers none. Read
  from the spec, not built: the benchmark's proxy carries no password, and the daemon's chosen
  subprotocol must not be passed back to a page that offered none.
- **Unchanged:** TLS, and later an SSH or a relay leg, sit on the upstream side and do not change
  the page's leg.
- **Less to build:** no channel encoding, no acknowledgement window, no order buffer; the page keeps
  its WebSocket transport.

Not evaluated: a streamed response from a custom URI scheme (the spec's other candidate). It would
use the same custom-protocol path that is slow on Windows, with one request per stream instead of
one per message; no number exists for it.

### Proposal to the owner

1. **Design.** Build milestone 2 on the loopback proxy on all three platforms. It is the only
   candidate that met the written marks on Windows without relying on an estimate. Alternatives:
   the batched channel everywhere (accepting about 30 MiB/s and a 200 ms keystroke delay during a
   download on the Windows runner until milestone 3 moves transfers off this path); the channel on
   macOS and Linux with the proxy on Windows (two designs to keep); or measure on real machines
   first.
2. **The B4 memory mark** ("growth at most the window plus 64 MiB") was written for the channel
   design, and the baseline misses it on Linux and Windows (2.7 GiB in one Windows run). Proposed:
   "no more growth than the baseline in the same run, plus 64 MiB".
3. **The half-the-baseline mark of B4** fails a rate of 504 MiB/s on Linux. It matters only if a
   channel design is kept; with the proxy it passes as written.

### Limits

- The macOS and Windows machines are shared virtual runners with 3 and 4 logical cores and no GPU;
  no real machine was measured.
- One server, on loopback, in the same process as the client: no network, no TLS, no real daemon.
- B8 shows a hidden page only on macOS.
- The Linux result files are lost (above).

