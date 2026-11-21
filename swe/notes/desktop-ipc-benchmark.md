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
